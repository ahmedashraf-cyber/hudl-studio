import { onAuthChanged, signUp, signIn, signInGoogle, logout, currentUser } from './auth.js';
import { createProject, getUserProjects, saveProjectState, loadProject } from './database.js';
import { uploadMedia } from './storage.js';

// ═══════════════════════════════════════
// GLOBAL STATE
// ═══════════════════════════════════════
const S = {
  user: null,
  projects: [],
  currentProject: null,
  app: null,
  proj: { name: 'Untitled', w: 1920, h: 1080, fps: 30, dur: 30 },
  cv: { layers: [], activeLayer: 0, tool: 'brush', size: 18, opacity: 100, fg: '#E31837', bg: '#0a0c10', zoom: 100, hist: [], histIdx: -1 },
  cut: { clips: [], tracks: 4, ph: 0, playing: false, sel: null, media: [], selMedia: null, tick: null },
  ae: { layers: [], ph: 0, playing: false, tick: null, frame: 0 }
};

let PPS = 60; // pixels per second in timeline
let _saveTimer = null;

// ═══════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════
function $(id) { return document.getElementById(id); }
function show(id) { const e = $(id); if (e) e.classList.remove('hidden'); }
function hide(id) { const e = $(id); if (e) e.classList.add('hidden'); }
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const p = $(id); if (p) p.classList.add('active');
}

let _ntTimer = null;
function notify(msg, color = '#3fb950') {
  const n = $('notif');
  $('notif-text').textContent = msg;
  $('notif-dot').style.background = color;
  n.classList.add('show');
  clearTimeout(_ntTimer);
  _ntTimer = setTimeout(() => n.classList.remove('show'), 2600);
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function fmtTC(s) { const m = Math.floor(s / 60), ss = Math.floor(s % 60); return (m ? pad(m) + ':' : '') + pad(ss) + 's'; }
function fmtFull(s, fps) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = Math.floor(s % 60), f = Math.round((s % 1) * (fps || 30));
  return pad(h) + ':' + pad(m) + ':' + pad(ss) + ':' + pad(f);
}

function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(autoSave, 3000);
}

async function autoSave() {
  if (!S.currentProject || !S.user) return;
  const ind = $('save-indicator');
  try {
    await saveProjectState(S.currentProject.id, { cut: { clips: S.cut.clips }, ae: { layers: S.ae.layers } });
    if (ind) { ind.textContent = '● Saved'; ind.classList.add('show'); setTimeout(() => ind.classList.remove('show'), 2000); }
  } catch (e) {
    console.error('Save failed:', e);
  }
}

// ═══════════════════════════════════════
// AUTH FLOW
// ═══════════════════════════════════════
onAuthChanged(async (user) => {
  S.user = user;
  if (user) {
    updateUserUI(user);
    await loadUserProjects();
    showPage('page-launcher');
  } else {
    showPage('page-auth');
  }
});

function updateUserUI(user) {
  const av = $('user-avatar');
  const un = $('user-name');
  if (av) av.textContent = (user.displayName || user.email || 'U').charAt(0).toUpperCase();
  if (un) un.textContent = user.displayName || user.email;
}

// ── AUTH PAGE LOGIC ──
let authMode = 'login';

window.switchAuthTab = function(mode) {
  authMode = mode;
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('on', t.dataset.tab === mode));
  $('auth-name-field').style.display = mode === 'signup' ? 'block' : 'none';
  $('auth-btn').textContent = mode === 'signup' ? 'Create Account' : 'Sign In';
};

window.handleAuth = async function() {
  const email = $('auth-email').value.trim();
  const pass = $('auth-pass').value;
  const name = $('auth-name').value.trim();
  const err = $('auth-err');
  const btn = $('auth-btn');

  if (!email || !pass) { showErr('Please fill in all fields.'); return; }

  btn.disabled = true;
  btn.textContent = 'Loading…';
  err.classList.remove('show');

  try {
    if (authMode === 'signup') {
      if (!name) { showErr('Please enter your name.'); btn.disabled = false; btn.textContent = 'Create Account'; return; }
      await signUp(email, pass, name);
    } else {
      await signIn(email, pass);
    }
  } catch (e) {
    showErr(firebaseErrMsg(e.code));
    btn.disabled = false;
    btn.textContent = authMode === 'signup' ? 'Create Account' : 'Sign In';
  }
};

window.handleGoogleAuth = async function() {
  try {
    await signInGoogle();
  } catch (e) {
    showErr(firebaseErrMsg(e.code));
  }
};

function showErr(msg) {
  const err = $('auth-err');
  err.textContent = msg;
  err.classList.add('show');
}

function firebaseErrMsg(code) {
  const map = {
    'auth/email-already-in-use': 'That email is already registered.',
    'auth/invalid-email': 'Invalid email address.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/user-not-found': 'No account with that email.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/too-many-requests': 'Too many attempts. Try again later.',
    'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
  };
  return map[code] || 'Something went wrong. Please try again.';
}

window.handleLogout = async function() {
  if (S.cut.playing) stopCutPlay();
  if (S.ae.playing) stopAEPlay();
  await logout();
};

// ═══════════════════════════════════════
// LAUNCHER
// ═══════════════════════════════════════
async function loadUserProjects() {
  if (!S.user) return;
  try {
    S.projects = await getUserProjects(S.user.uid);
    renderProjectsList();
  } catch (e) { console.error(e); }
}

function renderProjectsList() {
  const el = $('projects-list');
  if (!el) return;
  if (!S.projects.length) {
    el.innerHTML = '<div class="empty-projects">No projects yet — create your first one above</div>';
    return;
  }
  const appColors = { canvas: '#E31837', cut: '#58a6ff', motion: '#d29922' };
  el.innerHTML = S.projects.map(p => {
    const icon = p.appType === 'canvas' ? '🖼️' : p.appType === 'cut' ? '🎬' : '✨';
    const ago = p.updatedAt ? timeAgo(p.updatedAt.toDate ? p.updatedAt.toDate() : new Date()) : '';
    return `<div class="project-item" onclick="openProject('${p.id}')">
      <div class="project-thumb">${icon}</div>
      <div style="flex:1">
        <div class="project-name">${p.name}</div>
        <div class="project-meta">${ago} · ${p.width}×${p.height}</div>
      </div>
      <span class="project-tag" style="background:${appColors[p.appType]}22;color:${appColors[p.appType]}">${p.appType.charAt(0).toUpperCase()+p.appType.slice(1)}</span>
    </div>`;
  }).join('');
}

function timeAgo(date) {
  const s = Math.floor((Date.now() - date) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

window.openNewProjectModal = function() {
  $('np-modal').classList.add('show');
};

window.closeNPModal = function() {
  $('np-modal').classList.remove('show');
};

window.createNewProject = async function() {
  const name = $('np-name').value.trim() || 'Untitled';
  const appType = $('np-app').value;
  const w = parseInt($('np-w').value) || 1920;
  const h = parseInt($('np-h').value) || 1080;
  const dur = parseInt($('np-dur').value) || 30;
  const fps = parseInt($('np-fps').value) || 30;

  const btn = $('np-create-btn');
  btn.textContent = 'Creating…';
  btn.disabled = true;

  try {
    const id = await createProject(S.user.uid, { name, appType, width: w, height: h, fps, duration: dur });
    const project = { id, name, appType, width: w, height: h, fps, duration: dur, state: {} };
    S.currentProject = project;
    S.proj = { name, w, h, fps, dur };
    S.projects.unshift(project);

    closeNPModal();
    openApp(appType);
    notify(`Project "${name}" created`, '#3fb950');
  } catch (e) {
    notify('Failed to create project: ' + e.message, '#E31837');
  } finally {
    btn.textContent = 'Create Project';
    btn.disabled = false;
  }
};

window.openProject = async function(id) {
  try {
    const project = await loadProject(id);
    if (!project) { notify('Project not found', '#E31837'); return; }
    S.currentProject = project;
    S.proj = { name: project.name, w: project.width, h: project.height, fps: project.fps, dur: project.duration };
    if (project.state?.cut?.clips) S.cut.clips = project.state.cut.clips;
    openApp(project.appType);
  } catch (e) {
    notify('Could not open project', '#E31837');
  }
};

// ═══════════════════════════════════════
// APP SHELL
// ═══════════════════════════════════════
window.openApp = function(name) {
  if (S.cut.playing) stopCutPlay();
  if (S.ae.playing) stopAEPlay();
  S.app = name;
  showPage('page-app');
  $('tl-app-name').textContent = { canvas: 'Canvas', cut: 'Cut', motion: 'Motion' }[name];
  $('tl-file-name').textContent = (S.currentProject?.name || 'Untitled') + '.' + name;
  hide('cv-app'); hide('cut-app'); hide('ae-app');
  buildMenubar(name);
  if (name === 'canvas') { show('cv-app'); buildCanvas(); }
  else if (name === 'cut') { show('cut-app'); buildCut(); }
  else if (name === 'motion') { show('ae-app'); buildMotion(); }
};

window.goToLauncher = async function() {
  if (S.cut.playing) stopCutPlay();
  if (S.ae.playing) stopAEPlay();
  S.app = null;
  await loadUserProjects();
  showPage('page-launcher');
};

window.doSave = async function() {
  await autoSave();
  notify('Saved ✓', '#3fb950');
};

window.doExport = function() {
  notify('Export: choose format in the Export dialog', '#58a6ff');
};

// ═══════════════════════════════════════
// MENU SYSTEM
// ═══════════════════════════════════════
const MENUS = {
  canvas: {
    File: [
      { l: 'New Canvas', k: 'Ctrl+N', fn: () => newCanvas() },
      { l: 'Open Image…', k: 'Ctrl+O', fn: () => cvOpenFile() },
      { sep: true },
      { l: 'Save', k: 'Ctrl+S', fn: () => doSave() },
      { l: 'Export PNG…', fn: () => notify('Exporting PNG…') },
      { l: 'Export JPEG…', fn: () => notify('Exporting JPEG…') },
      { l: 'Send to Cut', fn: () => sendToCut() },
      { sep: true },
      { l: 'Back to Launcher', fn: () => goToLauncher() }
    ],
    Edit: [
      { l: 'Undo', k: 'Ctrl+Z', fn: () => cvUndo() },
      { l: 'Redo', k: 'Ctrl+Shift+Z', fn: () => cvRedo() },
      { sep: true },
      { l: 'Select All', k: 'Ctrl+A', fn: () => notify('Select All') },
    ],
    Image: [
      { l: 'Brightness/Contrast', fn: () => notify('Brightness/Contrast') },
      { l: 'Hue/Saturation', fn: () => notify('Hue/Saturation') },
      { l: 'Curves', fn: () => notify('Curves') },
      { sep: true },
      { l: 'Flip Horizontal', fn: () => cvFlip('h') },
      { l: 'Flip Vertical', fn: () => cvFlip('v') },
      { l: 'Grayscale', fn: () => cvFilter('grayscale') },
      { l: 'Invert', fn: () => cvFilter('invert') },
      { l: 'Sepia', fn: () => cvFilter('sepia') },
      { l: 'Blur', fn: () => cvFilter('blur') },
    ],
    Layer: [
      { l: 'New Layer', k: 'Ctrl+Shift+N', fn: () => cvAddLayer() },
      { l: 'Duplicate Layer', fn: () => cvDupLayer() },
      { l: 'Delete Layer', fn: () => cvDelLayer() },
      { sep: true },
      { l: 'Merge Down', fn: () => notify('Layers merged') },
      { l: 'Flatten Image', fn: () => notify('Image flattened') },
    ],
    Filter: [
      { l: 'Blur', fn: () => cvFilter('blur') },
      { l: 'Sharpen', fn: () => cvFilter('sharpen') },
      { l: 'Grayscale', fn: () => cvFilter('grayscale') },
      { l: 'Invert', fn: () => cvFilter('invert') },
      { l: 'Sepia', fn: () => cvFilter('sepia') },
      { l: 'Pixelate', fn: () => cvFilter('pixelate') },
      { l: 'Emboss', fn: () => cvFilter('emboss') },
    ],
    View: [
      { l: 'Zoom In', k: 'Ctrl++', fn: () => cvZoom(10) },
      { l: 'Zoom Out', k: 'Ctrl+-', fn: () => cvZoom(-10) },
      { l: 'Fit to Screen', k: 'Ctrl+0', fn: () => cvFit() },
      { l: '100%', k: 'Ctrl+1', fn: () => { S.cv.zoom = 100; cvApplyZoom(); } },
      { sep: true },
      { l: 'Show Grid', fn: () => notify('Grid toggled') },
    ],
    Window: [
      { l: 'Layers', fn: () => cvSwitchPanel('layers') },
      { l: 'Properties', fn: () => cvSwitchPanel('props') },
      { l: 'Color', fn: () => cvSwitchPanel('color') },
    ],
    Help: [
      { l: 'About Canvas', fn: () => notify('Canvas — Hudl Studio') },
      { l: 'Shortcuts', fn: () => notify('B:Brush  E:Eraser  T:Text  Ctrl+Z:Undo') },
    ]
  },
  cut: {
    File: [
      { l: 'New Sequence', fn: () => cutNewSeq() },
      { l: 'Import Media…', k: 'Ctrl+I', fn: () => $('cut-file-input')?.click() },
      { sep: true },
      { l: 'Save', k: 'Ctrl+S', fn: () => doSave() },
      { l: 'Export…', fn: () => doExport() },
      { l: 'Send to Motion', fn: () => sendToMotion() },
      { sep: true },
      { l: 'Back to Launcher', fn: () => goToLauncher() }
    ],
    Edit: [
      { l: 'Undo', k: 'Ctrl+Z', fn: () => notify('Undo') },
      { l: 'Redo', k: 'Ctrl+Shift+Z', fn: () => notify('Redo') },
      { sep: true },
      { l: 'Split Clip', k: 'Ctrl+K', fn: () => cutSplit() },
      { l: 'Delete Selected', k: 'Delete', fn: () => cutDelete() },
    ],
    Clip: [
      { l: 'Speed/Duration…', fn: () => notify('Speed dialog') },
      { l: 'Enable/Disable', fn: () => notify('Clip toggled') },
      { l: 'Unlink Audio', fn: () => notify('Audio unlinked') },
      { sep: true },
      { l: 'Send to Motion', fn: () => sendToMotion() },
    ],
    Sequence: [
      { l: 'Settings', fn: () => notify(`${S.proj.w}×${S.proj.h} · ${S.proj.fps}fps · ${S.proj.dur}s`) },
      { l: 'Add Track', fn: () => { S.cut.tracks++; buildCut(); notify('Track added'); } },
      { sep: true },
      { l: 'Go to Start', fn: () => cutSeek(0) },
      { l: 'Go to End', fn: () => cutSeek(S.proj.dur) },
    ],
    Effects: [
      { l: 'Color Correction', fn: () => notify('Color correction added') },
      { l: 'Gaussian Blur', fn: () => notify('Blur added') },
      { l: 'Fade In', fn: () => notify('Fade in applied') },
      { l: 'Fade Out', fn: () => notify('Fade out applied') },
      { l: 'Cross Dissolve', fn: () => notify('Dissolve applied') },
    ],
    Color: [
      { l: 'Apply LUT…', fn: () => notify('LUT picker') },
      { l: 'Reset Color', fn: () => notify('Color reset') },
    ],
    View: [
      { l: 'Zoom In Timeline', k: '=', fn: () => { PPS = Math.min(200, PPS + 20); renderCutTimeline(); } },
      { l: 'Zoom Out Timeline', k: '-', fn: () => { PPS = Math.max(20, PPS - 20); renderCutTimeline(); } },
    ],
    Window: [
      { l: 'Media', fn: () => notify('Media panel') },
      { l: 'Timeline', fn: () => notify('Timeline panel') },
    ],
    Help: [
      { l: 'About Cut', fn: () => notify('Cut — Hudl Studio') },
      { l: 'Shortcuts', fn: () => notify('Space:Play  K:Split  Del:Delete') },
    ]
  },
  motion: {
    File: [
      { l: 'New Composition', fn: () => aeNewComp() },
      { sep: true },
      { l: 'Save', k: 'Ctrl+S', fn: () => doSave() },
      { l: 'Export…', fn: () => doExport() },
      { l: 'Send to Cut', fn: () => sendToCut() },
      { sep: true },
      { l: 'Back to Launcher', fn: () => goToLauncher() }
    ],
    Edit: [
      { l: 'Undo', k: 'Ctrl+Z', fn: () => notify('Undo') },
      { l: 'Redo', k: 'Ctrl+Shift+Z', fn: () => notify('Redo') },
      { sep: true },
      { l: 'Duplicate Layer', k: 'Ctrl+D', fn: () => aeDupLayer() },
      { l: 'Delete Layer', k: 'Delete', fn: () => aeDelLayer() },
    ],
    Composition: [
      { l: 'Settings', fn: () => notify(`${S.proj.w}×${S.proj.h} · ${S.proj.fps}fps · ${S.proj.dur}s`) },
      { l: 'Preview', k: 'Space', fn: () => aeTogglePlay() },
    ],
    Layer: [
      { l: 'New Solid', fn: () => aeAddSolid() },
      { l: 'New Text', fn: () => aeAddText() },
      { l: 'New Shape', fn: () => aeAddShape() },
      { l: 'New Camera', fn: () => aeAddCamera() },
      { l: 'New Light', fn: () => aeAddLight() },
    ],
    Effect: [
      { l: 'Gaussian Blur', fn: () => aeApplyEff('Gaussian Blur') },
      { l: 'Glow', fn: () => aeApplyEff('Glow') },
      { l: 'Color Correction', fn: () => aeApplyEff('Color Correction') },
      { l: 'Lens Flare', fn: () => aeApplyEff('Lens Flare') },
      { l: 'Particle World', fn: () => aeApplyEff('Particle World') },
    ],
    Animation: [
      { l: 'Add Keyframe', k: 'Alt+K', fn: () => notify('Keyframe added') },
      { l: 'Easy Ease', k: 'F9', fn: () => notify('Easy ease applied') },
    ],
    View: [
      { l: 'Zoom In', fn: () => aeZoomView(1.1) },
      { l: 'Zoom Out', fn: () => aeZoomView(0.9) },
      { l: 'Show Grid', fn: () => notify('Grid toggled') },
    ],
    Window: [
      { l: 'Effects', fn: () => aeSwitchTab('effects') },
      { l: 'Properties', fn: () => aeSwitchTab('props') },
      { l: 'Layers', fn: () => aeSwitchTab('layers') },
    ],
    Help: [
      { l: 'About Motion', fn: () => notify('Motion — Hudl Studio') },
      { l: 'Shortcuts', fn: () => notify('Space:Play  Alt+K:Keyframe') },
    ]
  }
};

let _openMBEl = null;
function buildMenubar(key) {
  const mb = $('menubar'); mb.innerHTML = '';
  const defs = MENUS[key]; if (!defs) return;
  Object.keys(defs).forEach(label => {
    const el = document.createElement('div');
    el.className = 'mb-item'; el.textContent = label;
    el.addEventListener('click', e => {
      e.stopPropagation();
      if (_openMBEl === el) { closeMenus(); return; }
      closeMenus(); _openMBEl = el; el.classList.add('open');
      showDropdown(el, defs[label]);
    });
    mb.appendChild(el);
  });
}

function showDropdown(anchor, items) {
  closeDD();
  const ov = document.createElement('div'); ov.className = 'dd-overlay'; ov.id = '_ddov';
  ov.addEventListener('click', closeMenus);
  document.body.appendChild(ov);
  const dd = document.createElement('div'); dd.className = 'dropdown'; dd.id = '_dd';
  items.forEach(item => {
    if (item.sep) { const s = document.createElement('div'); s.className = 'dd-sep'; dd.appendChild(s); return; }
    const el = document.createElement('div'); el.className = 'dd-item';
    const lbl = document.createElement('span'); lbl.textContent = item.l; el.appendChild(lbl);
    if (item.k) { const ks = document.createElement('span'); ks.className = 'dd-key'; ks.textContent = item.k; el.appendChild(ks); }
    el.addEventListener('click', e => { e.stopPropagation(); closeMenus(); item.fn(); });
    dd.appendChild(el);
  });
  const r = anchor.getBoundingClientRect();
  dd.style.top = (r.bottom + 2) + 'px'; dd.style.left = r.left + 'px';
  document.body.appendChild(dd);
}

function closeDD() { $('_dd')?.remove(); $('_ddov')?.remove(); }
function closeMenus() { closeDD(); if (_openMBEl) { _openMBEl.classList.remove('open'); _openMBEl = null; } }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });

// ═══════════════════════════════════════
// CROSS-APP
// ═══════════════════════════════════════
function sendToCut() {
  const cvs = $('main-cvs');
  if (cvs) {
    cvs.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      S.cut.media.push({ name: 'Canvas Export.png', type: 'image', url, duration: 5, thumbnail: cvs.toDataURL('image/jpeg', 0.3) });
      notify('Canvas → Cut media bin', '#58a6ff');
      openApp('cut');
      buildBinList();
    });
  } else { notify('Open Canvas first', '#E31837'); }
}

function sendToMotion() {
  notify('Sending to Motion…', '#d29922');
  setTimeout(() => openApp('motion'), 200);
}

// ═══════════════════════════════════════
// ── CANVAS APP ──
// ═══════════════════════════════════════
let cvDrw = false, cvLX = 0, cvLY = 0;

function buildCanvas() {
  const app = $('cv-app'); app.innerHTML = '';
  app.style.cssText = 'flex:1;display:flex;flex-direction:row;overflow:hidden';
  const W = S.proj.w, H = S.proj.h;

  // Tools sidebar
  const toolDefs = [
    { id: 'select', tip: 'Selection (V)', svg: '<path d="M4 4v16l4-4 3 5 2-1-3-5h5L4 4z" fill="currentColor"/>' },
    { id: 'move', tip: 'Move (M)', svg: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l3 3" stroke="currentColor" stroke-width="1.5" fill="none"/>' },
    { sep: true },
    { id: 'brush', tip: 'Brush (B)', svg: '<path d="M3 17c1-1 3-1.5 4-.5s1.5 3 3 3 2-1.5 4-5L20 4c-.5-.5-1.5-.5-2 0L8 14c-3 3-4.5 2.5-5 3" stroke="currentColor" stroke-width="1.5" fill="none"/>' },
    { id: 'eraser', tip: 'Eraser (E)', svg: '<rect x="3" y="13" width="9" height="6" rx="1" fill="currentColor" opacity="0.3"/><path d="M14 5L5 14l4 4 9-9z" stroke="currentColor" stroke-width="1.5" fill="none"/>' },
    { id: 'fill', tip: 'Fill (G)', svg: '<path d="M12 2l1.5 1.5L6 11l-3 3 1.5 1.5 3-3 7.5-7.5L16.5 6 18 4.5z M19 13c1.1 0 2 .9 2 2s-1 3-2 3-2-.9-2-2 .9-3 2-3z" fill="currentColor"/>' },
    { sep: true },
    { id: 'crop', tip: 'Crop (C)', svg: '<path d="M6 2V18H22M2 6H18V22" stroke="currentColor" stroke-width="1.5" fill="none"/>' },
    { id: 'text', tip: 'Text (T)', svg: '<path d="M4 6h16M12 6v12M9 18h6" stroke="currentColor" stroke-width="1.5" fill="none"/>' },
    { id: 'shape', tip: 'Shapes (U)', svg: '<rect x="3" y="3" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/><circle cx="16" cy="16" r="5" stroke="currentColor" stroke-width="1.5" fill="none"/>' },
    { sep: true },
    { id: 'eyedrop', tip: 'Eyedropper (I)', svg: '<path d="M20 4L16 8M16 8L12 12 9 15 6 18 4 20" stroke="currentColor" stroke-width="1.5" fill="none"/><circle cx="4" cy="20" r="2" fill="currentColor" opacity="0.5"/>' },
    { id: 'zoom', tip: 'Zoom (Z)', svg: '<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M16.5 16.5L21 21M9 11h4M11 9v4" stroke="currentColor" stroke-width="1.5" fill="none"/>' },
  ];

  const sidebar = document.createElement('div'); sidebar.className = 'cv-tools';
  toolDefs.forEach(t => {
    if (t.sep) { const s = document.createElement('div'); s.className = 'cv-sep'; sidebar.appendChild(s); return; }
    const el = document.createElement('div');
    el.className = 'cv-tool' + (t.id === S.cv.tool ? ' on' : '');
    el.id = 'cvt-' + t.id; el.title = t.tip;
    el.innerHTML = `<svg viewBox="0 0 24 24">${t.svg}</svg>`;
    el.addEventListener('click', () => cvSetTool(t.id));
    sidebar.appendChild(el);
  });
  app.appendChild(sidebar);

  // Mid area
  const mid = document.createElement('div'); mid.className = 'cv-mid';
  mid.innerHTML = `
    <div class="cv-ctx" id="cv-ctx">
      <span class="cx-lbl">Size</span><input class="cx-inp" id="cv-sz" type="number" value="${S.cv.size}" min="1" max="800" onchange="S.cv.size=+this.value">
      <span class="cx-lbl" style="margin-left:7px">Opacity</span><input class="cx-inp" id="cv-op" type="number" value="${S.cv.opacity}" min="1" max="100" onchange="S.cv.opacity=+this.value">%
      <div class="cx-div"></div>
      <button class="cx-btn" onclick="cvUndo()">Undo</button>
      <button class="cx-btn" onclick="cvRedo()">Redo</button>
      <div class="cx-div"></div>
      <button class="cx-btn" onclick="cvAddLayer();notify('Layer added')">+ Layer</button>
      <button class="cx-btn" onclick="cvClearLayer()">Clear</button>
      <div class="cx-div"></div>
      <span class="cx-lbl">Zoom</span>
      <button class="cx-btn" onclick="cvZoom(-10)">−</button>
      <span id="cv-zoom-disp" style="font-size:11px;font-family:'DM Mono',monospace;color:var(--tx);padding:0 4px;min-width:36px;text-align:center">100%</span>
      <button class="cx-btn" onclick="cvZoom(10)">+</button>
      <button class="cx-btn" onclick="cvFit()">Fit</button>
    </div>
    <div class="cv-viewport" id="cv-vp">
      <canvas id="main-cvs" style="display:block;box-shadow:0 6px 32px rgba(0,0,0,0.6)"></canvas>
    </div>
    <div class="cv-statusbar">
      <div class="cv-stat">Zoom: <span id="cv-zoom-lbl">100%</span></div>
      <div class="cv-stat">${W}×${H}px</div>
      <div class="cv-stat" id="cv-cursor">X: <span>—</span> Y: <span>—</span></div>
      <div class="cv-stat">Layer: <span id="cv-layer-lbl">Layer 1</span></div>
    </div>`;
  app.appendChild(mid);

  // Right panel
  const rp = document.createElement('div'); rp.className = 'cv-rpanel';
  rp.innerHTML = `
    <div class="panel-tabs">
      <div class="ptab on" onclick="cvSwitchPanel('layers',this)">Layers</div>
      <div class="ptab" onclick="cvSwitchPanel('props',this)">Properties</div>
      <div class="ptab" onclick="cvSwitchPanel('color',this)">Color</div>
    </div>
    <div class="panel-body" id="cv-p-layers"></div>
    <div class="panel-body hidden" id="cv-p-props">${cvPropsHTML()}</div>
    <div class="panel-body hidden" id="cv-p-color">${cvColorHTML()}</div>`;
  app.appendChild(rp);

  // Init canvas
  const cvs = $('main-cvs');
  cvs.width = W; cvs.height = H;
  cvs.style.width = Math.min(W, 800) + 'px'; cvs.style.height = 'auto';
  cvInitCanvas(cvs); cvSetupEvents(cvs); cvSetupDrop($('cv-vp'), cvs);
  if (!S.cv.layers.length) {
    S.cv.layers = [{ name: 'Background', visible: true }, { name: 'Layer 1', visible: true }];
    S.cv.activeLayer = 1;
  }
  buildLayersPanel();
}

function cvPropsHTML() {
  return `<div class="psec"><div class="psec-label">Transform</div>
    ${['X','Y','W','H','Rot°'].map((l,i)=>`<div class="prop-row"><label>${l}</label><input type="number" value="${[0,0,S.proj.w,S.proj.h,0][i]}"></div>`).join('')}
    </div><div class="psec"><div class="psec-label">Appearance</div>
    <div class="slider-row"><div class="sl-lbl">Opacity <span id="cv-op-v">100%</span></div><input type="range" min="0" max="100" value="100" oninput="document.getElementById('cv-op-v').textContent=this.value+'%'"></div>
    <div class="prop-row"><label>Blend</label><select><option>Normal</option><option>Multiply</option><option>Screen</option><option>Overlay</option><option>Soft Light</option><option>Color Dodge</option><option>Difference</option></select></div>
    </div><div class="psec"><div class="psec-label">Histogram</div><canvas id="cv-hist" width="212" height="56" style="width:100%;border-radius:3px"></canvas></div>`;
}

function cvColorHTML() {
  const sw = ['#E31837','#ff6b6b','#ffa94d','#ffd43b','#69db7c','#4dabf7','#da77f2','#f783ac','#ffffff','#adb5bd','#868e96','#343a40','#0a0c10','#003087','#004d40','#3d1a00'];
  return `<div class="psec"><div class="psec-label">Colors</div>
    <div class="fg-bg-row">
      <div class="fg-sw" id="cv-fg-sw" style="background:${S.cv.fg}" title="Foreground" onclick="cvPickFG()"></div>
      <div class="bg-sw" id="cv-bg-sw" style="background:${S.cv.bg}" title="Background"></div>
    </div>
    <div class="prop-row"><label>Hex</label><input id="cv-hex" value="${S.cv.fg}" maxlength="7" oninput="cvSetFG(this.value)" style="font-family:'DM Mono',monospace"></div>
    <div class="slider-row"><div class="sl-lbl">R <span id="cv-rv">227</span></div><input type="range" id="cv-r" min="0" max="255" value="227" oninput="cvRGBChange()"></div>
    <div class="slider-row"><div class="sl-lbl">G <span id="cv-gv">24</span></div><input type="range" id="cv-g" min="0" max="255" value="24" oninput="cvRGBChange()"></div>
    <div class="slider-row"><div class="sl-lbl">B <span id="cv-bv">55</span></div><input type="range" id="cv-b" min="0" max="255" value="55" oninput="cvRGBChange()"></div>
    </div><div class="psec"><div class="psec-label">Swatches</div>
    <div class="color-swatches">${sw.map(c=>`<div class="swatch${c===S.cv.fg?' on':''}" style="background:${c}" onclick="cvSetFG('${c}')" title="${c}"></div>`).join('')}</div></div>`;
}

function buildLayersPanel() {
  const el = $('cv-p-layers'); if (!el) return;
  el.innerHTML = `<div class="psec"><div class="psec-label">Layers <button class="ps-add" onclick="cvAddLayer()">+</button></div>` +
    S.cv.layers.slice().reverse().map((l, ri) => {
      const i = S.cv.layers.length - 1 - ri;
      return `<div class="layer-row${i===S.cv.activeLayer?' on':''}" id="lr-${i}" onclick="cvSetActiveLayer(${i})">
        <div class="layer-thumb"></div>
        <div class="layer-name">${l.name}</div>
        <div class="layer-eye" onclick="event.stopPropagation();cvTogLayer(${i})">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </div></div>`;
    }).join('') + '</div>';
}

function cvInitCanvas(cvs) {
  const ctx = cvs.getContext('2d');
  ctx.fillStyle = '#111420'; ctx.fillRect(0, 0, cvs.width, cvs.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.025)'; ctx.lineWidth = 1;
  for (let x = 0; x < cvs.width; x += 80) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,cvs.height); ctx.stroke(); }
  for (let y = 0; y < cvs.height; y += 80) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(cvs.width,y); ctx.stroke(); }
  ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.font = 'bold 90px DM Sans,sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('CANVAS', cvs.width/2, cvs.height/2+30);
  ctx.font = '20px DM Sans,sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.02)';
  ctx.fillText('Draw or drop images here', cvs.width/2, cvs.height/2+68);
}

function cvSetupEvents(cvs) {
  cvs.addEventListener('mousedown', e => { cvDrw=true; const p=cvPos(e,cvs); cvLX=p.x; cvLY=p.y; cvDraw(e); });
  cvs.addEventListener('mousemove', e => {
    const p = cvPos(e,cvs);
    const cp = $('cv-cursor'); if (cp) cp.innerHTML = `X: <span>${Math.round(p.x)}</span> Y: <span>${Math.round(p.y)}</span>`;
    if (cvDrw) cvDraw(e);
  });
  cvs.addEventListener('mouseup', () => { cvDrw=false; cvSaveHist(); scheduleSave(); });
  cvs.addEventListener('mouseleave', () => { cvDrw=false; });
  cvs.addEventListener('wheel', e => { e.preventDefault(); cvZoom(e.deltaY<0?5:-5); }, { passive:false });
}

function cvSetupDrop(vp, cvs) {
  vp.addEventListener('dragover', e => { e.preventDefault(); vp.classList.add('drag-over'); });
  vp.addEventListener('dragleave', () => vp.classList.remove('drag-over'));
  vp.addEventListener('drop', e => {
    e.preventDefault(); vp.classList.remove('drag-over');
    if (e.dataTransfer.files.length) {
      const f = e.dataTransfer.files[0];
      if (f.type.startsWith('image/')) {
        const r = new FileReader(); r.onload = ev => {
          const img = new Image(); img.onload = () => {
            cvs.getContext('2d').drawImage(img,0,0,Math.min(img.width,cvs.width),Math.min(img.height,cvs.height));
            cvSaveHist(); cvDrawHist(); notify('Image dropped','#3fb950');
          }; img.src = ev.target.result;
        }; r.readAsDataURL(f);
      }
    }
  });
}

function cvPos(e,cvs){const r=cvs.getBoundingClientRect();return{x:(e.clientX-r.left)*(cvs.width/r.width),y:(e.clientY-r.top)*(cvs.height/r.height)};}

function cvDraw(e) {
  const cvs=$('main-cvs'); if(!cvs||!cvDrw)return;
  const ctx=cvs.getContext('2d'); const p=cvPos(e,cvs);
  ctx.globalAlpha=S.cv.opacity/100;
  if(S.cv.tool==='brush'){ctx.globalCompositeOperation='source-over';ctx.strokeStyle=S.cv.fg;ctx.lineWidth=S.cv.size;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(cvLX,cvLY);ctx.lineTo(p.x,p.y);ctx.stroke();}
  else if(S.cv.tool==='eraser'){ctx.globalCompositeOperation='destination-out';ctx.strokeStyle='rgba(0,0,0,1)';ctx.lineWidth=S.cv.size*2;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(cvLX,cvLY);ctx.lineTo(p.x,p.y);ctx.stroke();}
  else if(S.cv.tool==='fill'){ctx.globalCompositeOperation='source-over';ctx.fillStyle=S.cv.fg;ctx.fillRect(0,0,cvs.width,cvs.height);}
  ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
  cvLX=p.x;cvLY=p.y;cvDrawHist();
}
function cvSetTool(t){S.cv.tool=t;document.querySelectorAll('.cv-tool').forEach(b=>b.classList.remove('on'));const b=$('cvt-'+t);if(b)b.classList.add('on');const cvs=$('main-cvs');if(cvs)cvs.style.cursor=t==='brush'?'crosshair':t==='eraser'?'cell':t==='move'?'grab':t==='zoom'?'zoom-in':t==='text'?'text':'default';}
function cvOpenFile(){const fi=document.createElement('input');fi.type='file';fi.accept='image/*';fi.onchange=function(){if(!fi.files.length)return;const r=new FileReader();r.onload=e=>{const img=new Image();img.onload=()=>{const cvs=$('main-cvs');if(!cvs)return;cvs.getContext('2d').drawImage(img,0,0,cvs.width,cvs.height);cvSaveHist();cvDrawHist();notify('Image loaded','#3fb950');};img.src=e.target.result;};r.readAsDataURL(fi.files[0]);};fi.click();}
function cvFilter(type){const cvs=$('main-cvs');if(!cvs)return;const ctx=cvs.getContext('2d');if(type==='blur'){ctx.filter='blur(4px)';ctx.drawImage(cvs,0,0);ctx.filter='none';cvSaveHist();cvDrawHist();notify('Blur applied');return;}const d=ctx.getImageData(0,0,cvs.width,cvs.height);const data=d.data;for(let i=0;i<data.length;i+=4){if(type==='grayscale'){const g=0.299*data[i]+0.587*data[i+1]+0.114*data[i+2];data[i]=data[i+1]=data[i+2]=g;}else if(type==='invert'){data[i]=255-data[i];data[i+1]=255-data[i+1];data[i+2]=255-data[i+2];}else if(type==='sepia'){const r=data[i],g=data[i+1],b=data[i+2];data[i]=Math.min(255,r*0.393+g*0.769+b*0.189);data[i+1]=Math.min(255,r*0.349+g*0.686+b*0.168);data[i+2]=Math.min(255,r*0.272+g*0.534+b*0.131);}else if(type==='emboss'){data[i]=Math.min(255,data[i]+40);data[i+1]=Math.min(255,data[i+1]+40);data[i+2]=Math.min(255,data[i+2]+40);}}if(type==='pixelate'){const ps=10;for(let py=0;py<cvs.height;py+=ps){for(let px=0;px<cvs.width;px+=ps){const p2=ctx.getImageData(px,py,1,1).data;ctx.fillStyle=`rgba(${p2[0]},${p2[1]},${p2[2]},1)`;ctx.fillRect(px,py,ps,ps);}}}else{ctx.putImageData(d,0,0);}cvSaveHist();cvDrawHist();notify(type.charAt(0).toUpperCase()+type.slice(1)+' applied');}
function cvFlip(dir){const cvs=$('main-cvs');if(!cvs)return;const tmp=document.createElement('canvas');tmp.width=cvs.width;tmp.height=cvs.height;tmp.getContext('2d').drawImage(cvs,0,0);const ctx=cvs.getContext('2d');ctx.clearRect(0,0,cvs.width,cvs.height);ctx.save();if(dir==='h'){ctx.scale(-1,1);ctx.drawImage(tmp,-cvs.width,0);}else{ctx.scale(1,-1);ctx.drawImage(tmp,0,-cvs.height);}ctx.restore();cvSaveHist();notify('Flipped '+(dir==='h'?'horizontal':'vertical'));}
function cvZoom(d){S.cv.zoom=Math.max(10,Math.min(800,S.cv.zoom+d));cvApplyZoom();}
function cvFit(){S.cv.zoom=100;cvApplyZoom();}
function cvApplyZoom(){const cvs=$('main-cvs');if(!cvs)return;const mw=Math.min(S.proj.w,800);cvs.style.width=Math.round(mw*(S.cv.zoom/100))+'px';const a=$('cv-zoom-lbl');if(a)a.textContent=S.cv.zoom+'%';const b=$('cv-zoom-disp');if(b)b.textContent=S.cv.zoom+'%';}
function cvAddLayer(){S.cv.layers.push({name:'Layer '+S.cv.layers.length,visible:true});S.cv.activeLayer=S.cv.layers.length-1;buildLayersPanel();const s=$('cv-layer-lbl');if(s)s.textContent=S.cv.layers[S.cv.activeLayer].name;}
function cvSetActiveLayer(i){S.cv.activeLayer=i;document.querySelectorAll('.layer-row').forEach((el,idx)=>el.classList.toggle('on',idx===(S.cv.layers.length-1-i)));const s=$('cv-layer-lbl');if(s)s.textContent=S.cv.layers[i].name;}
function cvTogLayer(i){S.cv.layers[i].visible=!S.cv.layers[i].visible;notify(S.cv.layers[i].name+(S.cv.layers[i].visible?' visible':' hidden'));}
function cvDupLayer(){const l=S.cv.layers[S.cv.activeLayer];S.cv.layers.push({name:l.name+' copy',visible:true});S.cv.activeLayer=S.cv.layers.length-1;buildLayersPanel();notify('Layer duplicated');}
function cvDelLayer(){if(S.cv.layers.length<=1){notify('Cannot delete last layer','#E31837');return;}S.cv.layers.splice(S.cv.activeLayer,1);S.cv.activeLayer=Math.max(0,S.cv.activeLayer-1);buildLayersPanel();notify('Layer deleted');}
function cvClearLayer(){const cvs=$('main-cvs');if(!cvs)return;const ctx=cvs.getContext('2d');ctx.clearRect(0,0,cvs.width,cvs.height);ctx.fillStyle='#111420';ctx.fillRect(0,0,cvs.width,cvs.height);cvSaveHist();cvDrawHist();notify('Layer cleared');}
function cvSwitchPanel(name,el){if(el){document.querySelectorAll('.ptab').forEach(t=>t.classList.remove('on'));el.classList.add('on');}['layers','props','color'].forEach(n=>{const p=$('cv-p-'+n);if(p)p.classList.toggle('hidden',n!==name);});}
function cvSetFG(hex){if(!hex||hex.length<4)return;S.cv.fg=hex;const fs=$('cv-fg-sw');if(fs)fs.style.background=hex;const hi=$('cv-hex');if(hi&&hi.value!==hex)hi.value=hex;document.querySelectorAll('.swatch').forEach(s=>s.classList.toggle('on',s.style.background===hex));}
function cvPickFG(){cvSetTool('eyedrop');notify('Click canvas to sample color');}
function cvRGBChange(){const r=parseInt($('cv-r')?.value||0),g=parseInt($('cv-g')?.value||0),b=parseInt($('cv-b')?.value||0);const hex='#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');cvSetFG(hex);const rv=$('cv-rv');if(rv)rv.textContent=r;const gv=$('cv-gv');if(gv)gv.textContent=g;const bv=$('cv-bv');if(bv)bv.textContent=b;}
function cvSaveHist(){const cvs=$('main-cvs');if(!cvs)return;S.cv.hist=S.cv.hist.slice(0,S.cv.histIdx+1);S.cv.hist.push(cvs.toDataURL());if(S.cv.hist.length>20)S.cv.hist.shift();S.cv.histIdx=S.cv.hist.length-1;}
function cvUndo(){if(S.cv.histIdx<=0){notify('Nothing to undo','#E31837');return;}S.cv.histIdx--;const cvs=$('main-cvs');if(!cvs)return;const img=new Image();img.onload=()=>{cvs.getContext('2d').clearRect(0,0,cvs.width,cvs.height);cvs.getContext('2d').drawImage(img,0,0);cvDrawHist();};img.src=S.cv.hist[S.cv.histIdx];notify('Undo');}
function cvRedo(){if(S.cv.histIdx>=S.cv.hist.length-1){notify('Nothing to redo','#E31837');return;}S.cv.histIdx++;const cvs=$('main-cvs');if(!cvs)return;const img=new Image();img.onload=()=>{cvs.getContext('2d').clearRect(0,0,cvs.width,cvs.height);cvs.getContext('2d').drawImage(img,0,0);cvDrawHist();};img.src=S.cv.hist[S.cv.histIdx];notify('Redo');}
function cvDrawHist(){const h=$('cv-hist');if(!h)return;const hc=h.getContext('2d');hc.fillStyle='#111';hc.fillRect(0,0,h.width,h.height);const cvs=$('main-cvs');if(!cvs)return;const id=cvs.getContext('2d').getImageData(0,0,Math.min(cvs.width,300),Math.min(cvs.height,300)).data;const luma=new Array(256).fill(0);for(let i=0;i<id.length;i+=4)luma[Math.round(0.299*id[i]+0.587*id[i+1]+0.114*id[i+2])]++;const max=Math.max(...luma);hc.fillStyle='rgba(227,24,55,0.7)';for(let j=0;j<256;j++){const bh=(luma[j]/max)*h.height;hc.fillRect(j*(h.width/256),h.height-bh,Math.ceil(h.width/256),bh);}}
function newCanvas(){S.cv={layers:[{name:'Background',visible:true},{name:'Layer 1',visible:true}],activeLayer:1,tool:'brush',size:18,opacity:100,fg:'#E31837',bg:'#0a0c10',zoom:100,hist:[],histIdx:-1};buildCanvas();notify('New canvas');}

// ═══════════════════════════════════════
// ── CUT APP ──
// ═══════════════════════════════════════
function buildCut() {
  const app = $('cut-app'); app.innerHTML = '';
  app.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden';

  app.innerHTML = `
    <div class="cut-top">
      <div class="cut-preview">
        <div class="cut-pv-header">
          <span id="cut-info">Import media — click drop zone or drag files</span>
          <div style="flex:1"></div>
          <span style="font-family:'DM Mono',monospace;font-size:10px">${S.proj.w}×${S.proj.h} · ${S.proj.fps}fps · ${S.proj.dur}s</span>
        </div>
        <div class="cut-screen" id="cut-screen">
          <canvas id="cut-cvs" style="max-width:90%;max-height:90%;border:1px solid var(--b2)"></canvas>
          <div class="pv-play-btn" id="cut-play-btn" onclick="cutTogglePlay()">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M5 3L19 12L5 21Z" id="cut-play-path"/></svg>
          </div>
          <div class="pv-timecode" id="cut-pv-tc">00:00:00:00</div>
        </div>
      </div>
      <div class="cut-rpanel">
        <div class="panel-tabs">
          <div class="ptab on" onclick="cutSwitchPanel('media',this)">Media</div>
          <div class="ptab" onclick="cutSwitchPanel('effects',this)">Effects</div>
          <div class="ptab" onclick="cutSwitchPanel('color',this)">Color</div>
        </div>
        <div class="panel-body" id="cut-p-media">
          <div class="media-dropzone" id="cut-dz" onclick="$('cut-fi').click()">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--mu)" stroke-width="1.5" style="opacity:0.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <p>Drop video / audio / image</p><span>or click to browse</span>
          </div>
          <input type="file" id="cut-fi" style="display:none" multiple accept="video/*,audio/*,image/*">
          <div style="flex:1;overflow-y:auto;padding:4px" id="cut-bin"></div>
        </div>
        <div class="panel-body hidden" id="cut-p-effects">${cutEffectsHTML()}</div>
        <div class="panel-body hidden" id="cut-p-color">${cutColorHTML()}</div>
      </div>
    </div>
    <div class="timeline-shell" id="cut-tl" style="height:220px">${buildTimelineHTML()}</div>`;

  // Init preview canvas
  setTimeout(() => {
    const c = $('cut-cvs'); if (!c) return;
    c.width = S.proj.w; c.height = S.proj.h;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0,0,c.width,c.height);
    g.addColorStop(0,'#0a0c1a'); g.addColorStop(1,'#1a0a0a');
    ctx.fillStyle = g; ctx.fillRect(0,0,c.width,c.height);
    ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.font = 'bold 80px DM Sans,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('CUT', c.width/2, c.height/2+28);
    ctx.fillStyle = 'rgba(88,166,255,0.2)'; ctx.font = '22px DM Sans,sans-serif';
    ctx.fillText('Import media and drag to timeline', c.width/2, c.height/2+70);
  }, 40);

  setupCutDrop(); setupCutFileInput(); renderCutTimeline(); buildBinList();
}

function cutEffectsHTML() {
  return ['Color Correction','Gaussian Blur','Brightness/Contrast','Saturation','Vignette','Film Grain','Fade In','Fade Out','Cross Dissolve']
    .map(e=>`<div class="ae-effect-item" onclick="notify('Effect added: ${e}')"><div class="ae-effect-dot" style="background:var(--red)"></div><div><div style="font-size:12px;font-weight:500">${e}</div></div></div>`)
    .join('');
}

function cutColorHTML() {
  return `<div class="psec"><div class="psec-label">Color Wheels</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:10px">
      ${['Shadows','Midtones','Highlights'].map(l=>`<div style="text-align:center"><div style="width:50px;height:50px;border-radius:50%;background:conic-gradient(#E31837,#ff6b6b,#ffd43b,#3fb950,#58a6ff,#da77f2,#E31837);margin:0 auto 4px;cursor:pointer;border:2px solid var(--b2)"></div><div style="font-size:10px;color:var(--mu)">${l}</div></div>`).join('')}
    </div></div>
    <div class="psec">${['Exposure','Contrast','Highlights','Shadows','Saturation','Temp','Tint'].map(l=>`<div class="slider-row"><div class="sl-lbl">${l} <span>0</span></div><input type="range" min="-100" max="100" value="0" oninput="this.previousElementSibling.querySelector('span').textContent=this.value"></div>`).join('')}</div>`;
}

function cutSwitchPanel(name, el) {
  if (el) { document.querySelectorAll('.cut-rpanel .ptab').forEach(t=>t.classList.remove('on')); el.classList.add('on'); }
  ['media','effects','color'].forEach(n => { const p=$('cut-p-'+n); if(p) p.classList.toggle('hidden', n!==name); });
}

function buildTimelineHTML() {
  const dur = S.proj.dur, fps = S.proj.fps;
  const tracks = ['V1 (Video)','V2 (Video)','A1 (Audio)','A2 (Audio)'].slice(0, S.cut.tracks);
  const step = dur<=30?2:dur<=120?5:30;
  const rulerMarks = Array.from({length:Math.floor(dur/step)+1},(_,i)=>i*step)
    .map(s=>`<div class="ruler-mark" style="left:${s*PPS}px"><span>${fmtTC(s)}</span></div>`).join('');
  return `
    <div class="tl-header">
      <button class="tl-ibtn" onclick="cutSeek(0)" title="Start"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18V6h2v12zm3.5-6L17 6v12z"/></svg></button>
      <button class="tl-ibtn" id="cut-tl-play" onclick="cutTogglePlay()" title="Play (Space)"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5V19L19 12Z" id="cut-tl-path"/></svg></button>
      <button class="tl-ibtn" onclick="cutSeek(${dur})" title="End"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18V6l8 6zm9-12v12h2V6z"/></svg></button>
      <div class="tl-timecode" id="cut-tl-tc">00:00:00:00</div>
      <div style="flex:1"></div>
      <button class="cx-btn" onclick="cutSplit()">Split</button>
      <button class="cx-btn" onclick="cutDelete()">Delete</button>
      <button class="cx-btn" onclick="S.cut.tracks++;buildCut();notify('Track added')">+ Track</button>
      <span style="font-size:11px;color:var(--mu2);margin-left:8px">${dur}s · ${fps}fps</span>
    </div>
    <div class="tl-body">
      <div class="tl-track-labels">${tracks.map(t=>`<div class="track-label">${t}</div>`).join('')}</div>
      <div class="tl-area">
        <div class="tl-ruler" id="tl-ruler" style="width:${dur*PPS}px">${rulerMarks}</div>
        <div class="tl-clips-scroll" id="tl-scroll">
          <div class="tl-rows" id="tl-rows" style="width:${dur*PPS}px">
            ${tracks.map((_,i)=>`<div class="clip-track-row" id="tl-row-${i}" data-track="${i}"></div>`).join('')}
            <div class="playhead" id="cut-ph" style="left:0"><div class="playhead-head"></div><div class="playhead-line"></div></div>
          </div>
        </div>
      </div>
    </div>`;
}

function setupCutDrop() {
  const dz = $('cut-dz'); if (!dz) return;
  dz.addEventListener('dragover', e=>{e.preventDefault();dz.classList.add('drag-over');});
  dz.addEventListener('dragleave', ()=>dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e=>{e.preventDefault();dz.classList.remove('drag-over');handleCutFiles(e.dataTransfer.files);});
}
function setupCutFileInput() {
  const fi = $('cut-fi'); if (!fi) return;
  fi.addEventListener('change', ()=>{handleCutFiles(fi.files);fi.value='';});
}

function handleCutFiles(files) {
  if (!files?.length) return;
  let added = 0;
  Array.from(files).forEach(f => {
    const isVid=f.type.startsWith('video/'), isAud=f.type.startsWith('audio/'), isImg=f.type.startsWith('image/');
    if (!isVid&&!isAud&&!isImg) return;
    const url = URL.createObjectURL(f);
    const item = { name:f.name, type:isVid?'video':isAud?'audio':'image', file:f, url, duration:isImg?5:0, thumbnail:null };
    if (isVid) {
      const v = document.createElement('video'); v.src = url;
      v.onloadedmetadata = () => {
        item.duration = v.duration;
        v.currentTime = 0.5;
        v.onseeked = () => {
          const tc=document.createElement('canvas');tc.width=64;tc.height=36;
          tc.getContext('2d').drawImage(v,0,0,64,36);
          item.thumbnail=tc.toDataURL();buildBinList();renderCutTimeline();
        };
      };
    } else if (isAud) {
      const a=document.createElement('audio');a.src=url;a.onloadedmetadata=()=>{item.duration=a.duration;buildBinList();};
    }
    S.cut.media.push(item); added++;
  });
  if (added) notify(added+' file'+(added>1?'s':'')+' imported','#3fb950');
  buildBinList();
}

function buildBinList() {
  const el=$('cut-bin'); if(!el) return;
  if (!S.cut.media.length) { el.innerHTML='<div style="padding:10px;font-size:11px;color:var(--mu2);text-align:center">No media yet</div>'; return; }
  el.innerHTML = S.cut.media.map((item,i)=>{
    const icon=item.type==='video'?'🎬':item.type==='audio'?'🎵':'🖼️';
    return `<div class="mbin-item${S.cut.selMedia===i?' sel':''}" id="mbi-${i}" draggable="true"
      ondragstart="cutBinDragStart(event,${i})" onclick="cutSelMedia(${i})" ondblclick="cutAddToTL(${i})"
      title="Double-click to add · Drag to timeline">
      <div class="mbin-thumb">${item.thumbnail?`<img src="${item.thumbnail}">`:(item.type==='image'&&item.url?`<img src="${item.url}">`:icon)}</div>
      <div style="flex:1;min-width:0"><div class="mbin-name">${item.name}</div>
      <div class="mbin-dur">${item.duration>0?fmtTC(item.duration):'--'}</div></div></div>`;
  }).join('');
  const inf=$('cut-info'); if(inf) inf.textContent=S.cut.media.length+' file(s) — drag to timeline or double-click';
}

function cutBinDragStart(e,i){S.cut._drag=i;e.dataTransfer.setData('text/plain',''+i);e.dataTransfer.effectAllowed='copy';}
function cutSelMedia(i){S.cut.selMedia=i;document.querySelectorAll('.mbin-item').forEach((el,idx)=>el.classList.toggle('sel',idx===i));}
function cutAddToTL(i) {
  const item=S.cut.media[i]; if(!item) return;
  const track=item.type==='audio'?2:0;
  const start=Math.max(...S.cut.clips.filter(c=>c.track===track).map(c=>c.start+c.dur),-0.01)+0.01;
  const startSec = start < 0 ? 0 : start;
  S.cut.clips.push({mediaIdx:i,name:item.name,type:item.type,track,start:startSec,dur:Math.max(item.duration||5,0.5),color:item.type==='video'?'rgba(88,166,255,0.8)':item.type==='audio'?'rgba(210,153,34,0.8)':'rgba(63,185,80,0.8)'});
  renderCutTimeline(); notify(item.name+' added to track '+(track+1),'#3fb950'); scheduleSave();
}

function renderCutTimeline() {
  for (let t=0; t<S.cut.tracks; t++) {
    const row=$('tl-row-'+t); if(!row) continue;
    row.style.width=S.proj.dur*PPS+'px';
    // setup drop
    row.ondragover=e=>{e.preventDefault();row.classList.add('drag-over');};
    row.ondragleave=()=>row.classList.remove('drag-over');
    row.ondrop=e=>{
      e.preventDefault();row.classList.remove('drag-over');
      const i=parseInt(e.dataTransfer.getData('text/plain'));
      if(isNaN(i)||i<0||i>=S.cut.media.length)return;
      const item=S.cut.media[i];
      const rect=row.getBoundingClientRect();
      const start=Math.max(0,(e.clientX-rect.left)/PPS);
      S.cut.clips.push({mediaIdx:i,name:item.name,type:item.type,track:t,start,dur:Math.max(item.duration||5,0.5),color:item.type==='video'?'rgba(88,166,255,0.8)':item.type==='audio'?'rgba(210,153,34,0.8)':'rgba(63,185,80,0.8)'});
      renderCutTimeline();notify(item.name+' added to track '+(t+1),'#3fb950');scheduleSave();
    };
    // remove old clips
    Array.from(row.querySelectorAll('.tl-clip')).forEach(el=>el.remove());
    S.cut.clips.filter(c=>c.track===t).forEach((c,_,arr)=>{
      const ci=S.cut.clips.indexOf(c);
      const el=document.createElement('div');
      el.className='tl-clip'+(S.cut.sel===ci?' selected':'');
      el.style.cssText=`left:${Math.round(c.start*PPS)}px;width:${Math.max(8,Math.round(c.dur*PPS))}px;background:${c.color}`;
      el.setAttribute('data-ci',ci);
      el.innerHTML=`<div class="clip-resize-l"></div><span style="pointer-events:none;padding:0 4px;overflow:hidden">${c.name}</span><div class="clip-resize-r"></div>`;
      el.addEventListener('click',e=>{e.stopPropagation();S.cut.sel=ci;renderCutTimeline();});
      el.addEventListener('mousedown',e=>{if(e.target.classList.contains('clip-resize-l')||e.target.classList.contains('clip-resize-r'))return;clipMoveStart(e,ci);});
      el.querySelector('.clip-resize-l').addEventListener('mousedown',e=>{e.stopPropagation();clipResizeStart(e,ci,'l');});
      el.querySelector('.clip-resize-r').addEventListener('mousedown',e=>{e.stopPropagation();clipResizeStart(e,ci,'r');});
      row.appendChild(el);
    });
  }
  updateCutPH();
}

let _mv=null;
function clipMoveStart(e,ci){_mv={ci,sx:e.clientX,orig:S.cut.clips[ci].start};document.addEventListener('mousemove',clipMoveMove);document.addEventListener('mouseup',clipMoveUp);}
function clipMoveMove(e){if(!_mv)return;S.cut.clips[_mv.ci].start=Math.max(0,_mv.orig+(e.clientX-_mv.sx)/PPS);renderCutTimeline();}
function clipMoveUp(){_mv=null;document.removeEventListener('mousemove',clipMoveMove);document.removeEventListener('mouseup',clipMoveUp);scheduleSave();}
let _rz=null;
function clipResizeStart(e,ci,edge){_rz={ci,edge,sx:e.clientX,origDur:S.cut.clips[ci].dur,origStart:S.cut.clips[ci].start};document.addEventListener('mousemove',clipRzMove);document.addEventListener('mouseup',clipRzUp);}
function clipRzMove(e){if(!_rz)return;const dx=(e.clientX-_rz.sx)/PPS;const c=S.cut.clips[_rz.ci];if(_rz.edge==='r'){c.dur=Math.max(0.2,_rz.origDur+dx);}else{const nd=Math.max(0.2,_rz.origDur-dx);c.start=Math.max(0,_rz.origStart+(c.dur-nd));c.dur=nd;}renderCutTimeline();}
function clipRzUp(){_rz=null;document.removeEventListener('mousemove',clipRzMove);document.removeEventListener('mouseup',clipRzUp);scheduleSave();}

function cutSplit(){const ci=S.cut.sel;if(ci===null||ci===undefined){notify('Select a clip first','#E31837');return;}const c=S.cut.clips[ci];const ph=S.cut.ph;if(ph<=c.start||ph>=c.start+c.dur){notify('Playhead not on selected clip','#E31837');return;}const c2={...c,start:ph,dur:c.start+c.dur-ph};c.dur=ph-c.start;S.cut.clips.splice(ci+1,0,c2);renderCutTimeline();notify('Clip split');}
function cutDelete(){const ci=S.cut.sel;if(ci===null||ci===undefined){notify('Select a clip first','#E31837');return;}S.cut.clips.splice(ci,1);S.cut.sel=null;renderCutTimeline();notify('Clip deleted');scheduleSave();}
function cutNewSeq(){S.cut={...S.cut,clips:[],ph:0,playing:false,sel:null};buildCut();notify('New sequence');}
function cutSeek(s){S.cut.ph=Math.max(0,Math.min(S.proj.dur,s));updateCutPH();}

function updateCutPH(){
  const ph=$('cut-ph'); if(ph) ph.style.left=Math.round(S.cut.ph*PPS)+'px';
  const tc=fmtFull(S.cut.ph,S.proj.fps);
  const a=$('cut-pv-tc');if(a)a.textContent=tc;
  const b=$('cut-tl-tc');if(b)b.textContent=tc;
}

let _cutTick=null;
function cutTogglePlay(){
  S.cut.playing=!S.cut.playing;
  const pp=$('cut-play-path'),tp=$('cut-tl-path');
  if(S.cut.playing){
    if(pp)pp.setAttribute('d','M6 19h4V5H6v14zm8-14v14h4V5h-4z');
    if(tp)tp.setAttribute('d','M6 19h4V5H6v14zm8-14v14h4V5h-4z');
    _cutTick=setInterval(()=>{
      S.cut.ph+=1/S.proj.fps;
      if(S.cut.ph>=S.proj.dur){S.cut.ph=0;}
      updateCutPH();syncCutVid();
    },1000/S.proj.fps);
  } else stopCutPlay();
}
function stopCutPlay(){S.cut.playing=false;clearInterval(_cutTick);const pp=$('cut-play-path');if(pp)pp.setAttribute('d','M5 3L19 12L5 21Z');const tp=$('cut-tl-path');if(tp)tp.setAttribute('d','M8 5V19L19 12Z');}
function syncCutVid(){
  const ph=S.cut.ph;
  const active=S.cut.clips.find(c=>c.type==='video'&&ph>=c.start&&ph<c.start+c.dur);
  if(active){const item=S.cut.media[active.mediaIdx];if(item?.url&&S.cut._vid){S.cut._vid.currentTime=Math.max(0,ph-active.start);}}
}

// ═══════════════════════════════════════
// ── MOTION APP ──
// ═══════════════════════════════════════
const AE_LAYERS_DEFAULT = [
  {name:'Title Text',type:'Text',color:'#E31837',kfs:[0,30,60,90],on:true},
  {name:'Logo Shape',type:'Shape',color:'#58a6ff',kfs:[0,45,90],on:false},
  {name:'Background',type:'Solid',color:'#d29922',kfs:[0,120],on:false},
  {name:'Particle FX',type:'Effect',color:'#3fb950',kfs:[15,60,105],on:false},
  {name:'Camera 1',type:'Camera',color:'#da77f2',kfs:[0,60],on:false},
];
const AE_EFFECTS = [
  {name:'Gaussian Blur',cat:'Blur',color:'#58a6ff'},{name:'Motion Blur',cat:'Blur',color:'#58a6ff'},
  {name:'Glow',cat:'Stylize',color:'#ffd43b'},{name:'Chromatic Aberration',cat:'Distort',color:'#da77f2'},
  {name:'Film Grain',cat:'Noise',color:'#adb5bd'},{name:'Vignette',cat:'Color',color:'#E31837'},
  {name:'Color Correction',cat:'Color',color:'#E31837'},{name:'Lens Flare',cat:'Generate',color:'#ffd43b'},
  {name:'Shatter',cat:'Simulation',color:'#ff6b6b'},{name:'Particle World',cat:'Simulation',color:'#3fb950'},
];
let _aeAnimInterval=null;

function buildMotion() {
  if (!S.ae.layers.length) S.ae.layers = JSON.parse(JSON.stringify(AE_LAYERS_DEFAULT));
  const app = $('ae-app'); app.innerHTML = '';
  app.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden';

  app.innerHTML = `
    <div class="ae-top">
      <div class="ae-comp-panel">
        <div class="ae-comp-header">
          <span>Comp: ${S.currentProject?.name||'Untitled'}</span>
          <div style="flex:1"></div>
          <span id="ae-tc" style="font-family:'DM Mono',monospace;font-size:10px">0:00:00:00</span>
          <span style="margin-left:10px">${S.proj.w}×${S.proj.h} · ${S.proj.fps}fps · ${S.proj.dur}s</span>
        </div>
        <div class="ae-view" id="ae-view">
          <div class="ae-canvas-wrap" id="ae-wrap"><canvas id="ae-cvs" style="display:block"></canvas></div>
        </div>
      </div>
      <div class="ae-rpanel">
        <div class="ae-tabs">
          <div class="ae-tab on" id="aetab-effects" onclick="aeSwitchTab('effects')">Effects</div>
          <div class="ae-tab" id="aetab-props" onclick="aeSwitchTab('props')">Properties</div>
          <div class="ae-tab" id="aetab-layers" onclick="aeSwitchTab('layers')">Layers</div>
        </div>
        <div id="ae-p-effects" class="ae-effect-list">${AE_EFFECTS.map(e=>`<div class="ae-effect-item" onclick="this.classList.toggle('on');notify(this.classList.contains('on')?'${e.name} applied':'${e.name} removed')"><div class="ae-effect-dot" style="background:${e.color}"></div><div><div style="font-size:12px;font-weight:500">${e.name}</div><div style="font-size:10px;color:var(--mu2)">${e.cat}</div></div></div>`).join('')}</div>
        <div id="ae-p-props" class="ae-effect-list hidden" style="padding:8px">${aePropsHTML()}</div>
        <div id="ae-p-layers" class="ae-effect-list hidden" style="padding:8px">${aeLayerMgmtHTML()}</div>
      </div>
    </div>
    <div class="ae-timeline" id="ae-tl" style="height:230px">${buildAETLHTML()}</div>`;

  aeInitCanvas();
  setTimeout(startAEAnimation, 50);
}

function aePropsHTML(){return `<div style="font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:var(--mu2);margin-bottom:8px">Transform</div>${['Position X','Position Y','Scale X','Scale Y','Rotation','Opacity'].map((l,i)=>`<div class="prop-row"><label>${l}</label><input type="number" value="${[960,540,100,100,0,100][i]}"></div>`).join('')}<div style="height:1px;background:var(--b1);margin:10px 0"></div><div style="font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:var(--mu2);margin-bottom:8px">Anchor Point</div><div class="prop-row"><label>X</label><input type="number" value="960"></div><div class="prop-row"><label>Y</label><input type="number" value="540"></div>`;}

function aeLayerMgmtHTML(){return `<button class="cx-btn" style="width:100%;margin-bottom:6px" onclick="aeAddSolid()">+ Solid</button><button class="cx-btn" style="width:100%;margin-bottom:6px" onclick="aeAddText()">+ Text</button><button class="cx-btn" style="width:100%;margin-bottom:6px" onclick="aeAddShape()">+ Shape</button><button class="cx-btn" style="width:100%;margin-bottom:6px" onclick="aeAddCamera()">+ Camera</button><button class="cx-btn" style="width:100%;margin-bottom:6px" onclick="aeAddLight()">+ Light</button><div style="height:1px;background:var(--b1);margin:6px 0"></div><button class="cx-btn" style="width:100%;margin-bottom:6px;color:var(--red);border-color:var(--red)" onclick="aeDelLayer()">Delete Selected</button><button class="cx-btn" style="width:100%;margin-bottom:6px" onclick="aeDupLayer()">Duplicate</button>`;}

function buildAETLHTML(){
  const fps=S.proj.fps, dur=S.proj.dur, totalF=fps*dur;
  const kfRows=S.ae.layers.map(l=>`<div class="ae-kf-row">${l.kfs.map(f=>`<div class="ae-kf" style="left:${f*4+4}px" onclick="this.classList.toggle('on')"></div>`).join('')}</div>`).join('');
  const layerRows=S.ae.layers.map((l,i)=>`<div class="ae-layer-row${l.on?' on':''}" onclick="aeSelLayer(${i})"><div class="ae-layer-color" style="background:${l.color}"></div><div class="ae-layer-name">${l.name}</div><div class="ae-layer-type">${l.type}</div></div>`).join('');
  return `<div class="ae-tl-header">
    <button class="tl-ibtn" onclick="aeGotoStart()"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18V6h2v12zm3.5-6L17 6v12z"/></svg></button>
    <button class="tl-ibtn" id="ae-play-btn" onclick="aeTogglePlay()"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5V19L19 12Z" id="ae-play-path"/></svg></button>
    <button class="tl-ibtn" onclick="aeGotoEnd()"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18V6l8 6zm9-12v12h2V6z"/></svg></button>
    <div class="tl-timecode" id="ae-tl-tc">0:00:00:00</div>
    <div style="flex:1"></div>
    <button class="cx-btn" onclick="notify('Keyframe added at current time','#d29922')">+ Keyframe</button>
    <button class="cx-btn" onclick="aeNewComp()">New Comp</button>
    <span style="font-size:11px;color:var(--mu2);margin-left:8px">${fps}fps · ${dur}s</span>
  </div>
  <div class="ae-tl-body">
    <div class="ae-layers-col" id="ae-layers-col">${layerRows}</div>
    <div class="ae-kf-area" id="ae-kf-area">
      <div style="position:relative;width:${totalF*4+40}px">${kfRows}
        <div class="ae-playhead" id="ae-ph"><div class="ae-playhead-line"></div></div>
      </div>
    </div>
  </div>`;
}

function aeInitCanvas(){
  const wrap=$('ae-wrap'),view=$('ae-view');if(!wrap||!view)return;
  const vr=view.getBoundingClientRect();
  const scale=Math.min((vr.width-40)/S.proj.w,(vr.height-20)/S.proj.h,1);
  const dw=Math.round(S.proj.w*scale),dh=Math.round(S.proj.h*scale);
  wrap.style.width=dw+'px';wrap.style.height=dh+'px';
  const cvs=$('ae-cvs');cvs.width=S.proj.w;cvs.height=S.proj.h;
  cvs.style.width=dw+'px';cvs.style.height=dh+'px';
}

function renderAEFrame(frame){
  const cvs=$('ae-cvs');if(!cvs)return;
  const ctx=cvs.getContext('2d'),W=cvs.width,H=cvs.height;
  const t=frame/(S.proj.fps*S.proj.dur);
  const g=ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,W*0.7);g.addColorStop(0,'#0d1529');g.addColorStop(1,'#050810');
  ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  for(let i=0;i<3;i++){const ang=t*Math.PI*2*(0.3+i*0.2)+i*2;ctx.beginPath();ctx.arc(W/2+Math.cos(ang)*80,H/2+Math.sin(ang)*40,180+i*130,0,Math.PI*2);ctx.strokeStyle=['rgba(227,24,55,0.08)','rgba(88,166,255,0.06)','rgba(210,153,34,0.05)'][i];ctx.lineWidth=2;ctx.stroke();}
  const sc=0.85+Math.sin(t*Math.PI*2)*0.04;
  ctx.save();ctx.translate(W/2,H/2-50);ctx.scale(sc*2.8,sc*2.8);
  ctx.fillStyle=`rgba(227,24,55,${0.65+Math.sin(t*Math.PI*4)*0.2})`;
  ctx.beginPath();ctx.moveTo(0,-28);ctx.lineTo(24,14);ctx.lineTo(-24,14);ctx.closePath();ctx.fill();
  ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(0,0,7,0,Math.PI*2);ctx.fill();ctx.restore();
  const al=Math.min(1,t*4);
  ctx.fillStyle=`rgba(240,242,245,${al})`;ctx.font='bold 88px DM Sans,sans-serif';ctx.textAlign='center';
  ctx.fillText('HUDL STUDIO',W/2+Math.sin(t*0.5)*4,H/2+72);
  ctx.fillStyle=`rgba(227,24,55,${0.75*al})`;ctx.font='26px DM Sans,sans-serif';
  ctx.fillText('Motion Graphics Engine',W/2,H/2+116);
  for(let y=0;y<H;y+=4){ctx.fillStyle='rgba(0,0,0,0.05)';ctx.fillRect(0,y,W,2);}
}

function startAEAnimation(){
  if(_aeAnimInterval)return;
  S.ae.playing=true;
  _aeAnimInterval=setInterval(()=>{
    if(!$('ae-cvs')){stopAEPlay();return;}
    S.ae.frame=(S.ae.frame+1)%(S.proj.fps*S.proj.dur||150);
    renderAEFrame(S.ae.frame);
    const s=Math.floor(S.ae.frame/S.proj.fps),f=S.ae.frame%S.proj.fps;
    const ts=`0:${pad(Math.floor(s/60))}:${pad(s%60)}:${pad(f)}`;
    const tc=$('ae-tc');if(tc)tc.textContent=ts;
    const tlc=$('ae-tl-tc');if(tlc)tlc.textContent=ts;
    const ph=$('ae-ph');if(ph)ph.style.left=(S.ae.frame*4+4)+'px';
  },1000/(S.proj.fps||30));
}
function stopAEPlay(){S.ae.playing=false;clearInterval(_aeAnimInterval);_aeAnimInterval=null;const p=$('ae-play-path');if(p)p.setAttribute('d','M8 5V19L19 12Z');}
function aeTogglePlay(){if(_aeAnimInterval){stopAEPlay();}else{startAEAnimation();const p=$('ae-play-path');if(p)p.setAttribute('d','M6 19h4V5H6v14zm8-14v14h4V5h-4z');}}
function aeGotoStart(){S.ae.frame=0;renderAEFrame(0);}
function aeGotoEnd(){S.ae.frame=Math.max(0,(S.proj.fps*S.proj.dur||150)-1);renderAEFrame(S.ae.frame);}
function aeZoomView(f){const wrap=$('ae-wrap');if(!wrap)return;wrap.style.width=Math.round(wrap.offsetWidth*f)+'px';wrap.style.height=Math.round(wrap.offsetHeight*f)+'px';}
function aeSwitchTab(name){['effects','props','layers'].forEach(n=>{$('aetab-'+n)?.classList.toggle('on',n===name);$('ae-p-'+n)?.classList.toggle('hidden',n!==name);});}
function aeSelLayer(i){S.ae.layers.forEach(l=>l.on=false);S.ae.layers[i].on=true;document.querySelectorAll('.ae-layer-row').forEach((el,idx)=>el.classList.toggle('on',idx===i));notify('Layer: '+S.ae.layers[i].name);}
function aeDupLayer(){const i=S.ae.layers.findIndex(l=>l.on);if(i<0){notify('Select a layer','#E31837');return;}const l={...S.ae.layers[i],name:S.ae.layers[i].name+' copy',on:false};S.ae.layers.push(l);rebuildAETL();notify('Layer duplicated');}
function aeDelLayer(){const i=S.ae.layers.findIndex(l=>l.on);if(i<0){notify('Select a layer','#E31837');return;}S.ae.layers.splice(i,1);rebuildAETL();notify('Layer deleted');}
function aeAddSolid(){S.ae.layers.unshift({name:'Solid',type:'Solid',color:'#8b949e',kfs:[0,60],on:false});rebuildAETL();notify('Solid added');}
function aeAddText(){S.ae.layers.unshift({name:'Text Layer',type:'Text',color:'#E31837',kfs:[0,30],on:false});rebuildAETL();notify('Text added');}
function aeAddShape(){S.ae.layers.unshift({name:'Shape Layer',type:'Shape',color:'#58a6ff',kfs:[0,45],on:false});rebuildAETL();notify('Shape added');}
function aeAddCamera(){S.ae.layers.unshift({name:'Camera',type:'Camera',color:'#da77f2',kfs:[0],on:false});rebuildAETL();notify('Camera added');}
function aeAddLight(){S.ae.layers.unshift({name:'Light',type:'Light',color:'#ffd43b',kfs:[0],on:false});rebuildAETL();notify('Light added');}
function aeApplyEff(name){notify(name+' applied');}
function aeNewComp(){S.ae={layers:JSON.parse(JSON.stringify(AE_LAYERS_DEFAULT)),ph:0,playing:false,tick:null,frame:0};buildMotion();notify('New composition');}
function rebuildAETL(){const tl=$('ae-tl');if(tl)tl.innerHTML=buildAETLHTML();}

// ═══════════════════════════════════════
// KEYBOARD SHORTCUTS
// ═══════════════════════════════════════
document.addEventListener('keydown', e => {
  if (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT') return;
  if (S.app==='cut') {
    if (e.code==='Space'){e.preventDefault();cutTogglePlay();}
    if ((e.ctrlKey||e.metaKey)&&e.code==='KeyK'){e.preventDefault();cutSplit();}
    if (e.code==='Delete'||e.code==='Backspace'){if(S.cut.sel!==null)cutDelete();}
  }
  if (S.app==='canvas') {
    if (e.code==='KeyB') cvSetTool('brush');
    if (e.code==='KeyE') cvSetTool('eraser');
    if (e.code==='KeyT') cvSetTool('text');
    if (e.code==='KeyZ') cvSetTool('zoom');
    if ((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.code==='KeyZ'){e.preventDefault();cvRedo();}
    else if ((e.ctrlKey||e.metaKey)&&e.code==='KeyZ'){e.preventDefault();cvUndo();}
  }
  if (S.app==='motion') {
    if (e.code==='Space'){e.preventDefault();aeTogglePlay();}
  }
  if ((e.ctrlKey||e.metaKey)&&e.code==='KeyS'){e.preventDefault();doSave();}
});

// Expose globals needed by inline onclick handlers
window.S = S;
window.notify = notify;
window.cvSetTool = cvSetTool;
window.cvZoom = cvZoom;
window.cvFit = cvFit;
window.cvApplyZoom = cvApplyZoom;
window.cvAddLayer = cvAddLayer;
window.cvClearLayer = cvClearLayer;
window.cvUndo = cvUndo;
window.cvRedo = cvRedo;
window.cvSwitchPanel = cvSwitchPanel;
window.cvSetFG = cvSetFG;
window.cvPickFG = cvPickFG;
window.cvRGBChange = cvRGBChange;
window.cvSetActiveLayer = cvSetActiveLayer;
window.cvTogLayer = cvTogLayer;
window.cutBinDragStart = cutBinDragStart;
window.cutSelMedia = cutSelMedia;
window.cutAddToTL = cutAddToTL;
window.cutTogglePlay = cutTogglePlay;
window.cutSplit = cutSplit;
window.cutDelete = cutDelete;
window.cutSeek = cutSeek;
window.cutSwitchPanel = cutSwitchPanel;
window.aeTogglePlay = aeTogglePlay;
window.aeGotoStart = aeGotoStart;
window.aeGotoEnd = aeGotoEnd;
window.aeSwitchTab = aeSwitchTab;
window.aeSelLayer = aeSelLayer;
window.aeDupLayer = aeDupLayer;
window.aeDelLayer = aeDelLayer;
window.aeAddSolid = aeAddSolid;
window.aeAddText = aeAddText;
window.aeAddShape = aeAddShape;
window.aeAddCamera = aeAddCamera;
window.aeAddLight = aeAddLight;
window.aeNewComp = aeNewComp;
window.aeZoomView = aeZoomView;
window.goToLauncher = goToLauncher;
window.doSave = doSave;
window.doExport = doExport;
window.openApp = openApp;
window.$ = $;
