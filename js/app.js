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
  cut: { clips: [], videoTracks: 2, audioTracks: 2, ph: 0, playing: false, sel: null, media: [], selMedia: null, effects: {}, tick: null, _hist: [], _histIdx: -1, mutedTracks: {}, hiddenTracks: {} },
  ae: { layers: [], ph: 0, playing: false, tick: null, frame: 0, media: [], clips: [] }
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
  const current = document.querySelector('.page.active');
  const next = document.getElementById(id);
  if (!next || next === current) return;

  if (current) {
    // Fade out current
    current.style.cssText = 'opacity:0;transform:translateY(-8px);transition:opacity .2s ease,transform .2s ease;pointer-events:none';
    setTimeout(() => {
      // Hide current, show next
      current.classList.remove('active');
      current.style.cssText = '';
      _fsPageIn(next);
    }, 210);
  } else {
    _fsPageIn(next);
  }
}

function _fsPageIn(el) {
  // First make it active (gets display:flex from CSS)
  el.classList.add('active');
  // Then immediately set starting position via inline — won't fight display
  el.style.cssText = 'opacity:0;transform:translateY(12px)';
  // Double rAF ensures browser has painted the display:flex state
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.style.cssText = 'opacity:1;transform:translateY(0);transition:opacity .38s cubic-bezier(0.4,0,0.2,1),transform .38s cubic-bezier(0.4,0,0.2,1)';
    // Clean up inline styles after animation
    setTimeout(() => { el.style.cssText = ''; }, 420);
  }));
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
  if (!S.currentProject?.id || !S.user) return;
  const ind = $('save-indicator');
  try {
    await saveProjectState(S.currentProject.id, {
      cut: {
        clips: S.cut.clips,
        effects: S.cut.effects,
        videoTracks: S.cut.videoTracks,
        audioTracks: S.cut.audioTracks,
        // Save media metadata only (blob URLs can't be persisted, user re-imports)
        media: S.cut.media.map(m => ({
          name: m.name, type: m.type,
          duration: m.duration || 0,
          thumbnail: m.thumbnail || null
        }))
      }
    });
    if (ind) { ind.textContent = '● Saved'; ind.style.color = 'var(--grn)'; }
  } catch (e) {
    console.error('Save failed:', e);
    if (ind) { ind.textContent = '● Save failed'; ind.style.color = '#ff6b6b'; }
  }
}

// ═══════════════════════════════════════
// AUTH FLOW
// ═══════════════════════════════════════
onAuthChanged(async (user) => {
  S.user = user;
  if (user) {
    updateUserUI(user);
    showPage('page-launcher');
    await loadUserProjects();
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
  const pass  = $('auth-pass').value;
  const name  = $('auth-name')?.value.trim();
  const btn   = $('auth-btn');
  const err   = $('auth-err');

  err.classList.remove('show');
  if (!email || !pass) { showErr('Please fill in all fields.'); return; }

  // ── Loading state ──
  const origText = btn.textContent;
  btn.disabled = true;
  btn.classList.add('loading');
  btn.textContent = authMode === 'signup' ? 'Creating account…' : 'Signing in…';

  try {
    if (authMode === 'signup') {
      if (!name) { showErr('Please enter your name.'); resetBtn(); return; }
      await signUp(email, pass, name);
    } else {
      await signIn(email, pass);
    }
    // ── Success state — onAuthChanged will transition the page ──
    btn.textContent = '✓ Success';
    btn.style.background = 'linear-gradient(180deg,#30D158,#25a244)';
    btn.style.boxShadow  = '0 2px 12px rgba(48,209,88,0.35)';
  } catch (e) {
    // Show the raw error so we can debug exactly what's happening
    const msg = e.message || e.code || JSON.stringify(e) || 'Unknown error';
    showErr(msg);
    console.error('Auth error:', e);
    resetBtn();
  }

  function resetBtn(){
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.textContent = origText;
    btn.style.background = '';
    btn.style.boxShadow  = '';
  }
};

window.handleGoogleAuth = async function() {
  const btn = document.querySelector('.btn-google');
  const origHTML = btn?.innerHTML;
  if (btn) { btn.style.opacity = '0.7'; btn.style.pointerEvents = 'none'; }
  try {
    await signInGoogle();
  } catch (e) {
    showErr(e.message && !e.code ? e.message : firebaseErrMsg(e.code));
    if (btn) { btn.style.opacity = ''; btn.style.pointerEvents = ''; }
  }
}

// Wire stubs to real functions (runs when module finishes loading)
window._handleAuth       = window.handleAuth;
window._handleGoogleAuth = window.handleGoogleAuth;
window._switchAuthTab    = window.switchAuthTab;
window._openApp          = window.openApp;
window._handleLogout     = window.handleLogout;
window._openNewProjectModal = window.openNewProjectModal;

// Flush any click that happened before module loaded
if(window._authPending === 'login')  { window._authPending=null; window.handleAuth && window.handleAuth(); }
if(window._authPending === 'google') { window._authPending=null; window.handleGoogleAuth && window.handleGoogleAuth(); }


// Wire real functions to stubs and flush any queued clicks
if(window._flushAuthQueue){
  window._handleAuthReady = window.handleAuth;
  window._handleGoogleAuthReady = window.handleGoogleAuth;
  window._switchAuthTabReady = window.switchAuthTab;
  window._flushAuthQueue();
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
  const el = $('projects-list');
  if (el) el.innerHTML = '<div class="empty-projects" style="color:var(--mu2);padding:20px;text-align:center;font-size:13px">Loading projects…</div>';
  try {
    S.projects = await getUserProjects(S.user.uid);
    renderProjectsList();
  } catch (e) {
    console.error('loadUserProjects error:', e);
    if (el) el.innerHTML = '<div class="empty-projects" style="padding:20px;text-align:center;font-size:13px;color:#ff6b6b">Could not load projects. Check your connection.</div>';
  }
}

function renderProjectsList() {
  const el = $('projects-list');
  if (!el) return;
  if (!S.projects || !S.projects.length) {
    el.innerHTML = '<div class="empty-projects">No projects yet — click <strong>+ New Project</strong> to create one</div>';
    return;
  }
  const appColors = { canvas: 'rgba(232,89,12,0.12)', cut: 'rgba(232,89,12,0.12)' };
  const appTextColors = { canvas: '#FF6B1F', cut: '#FF6B1F' };
  el.innerHTML = S.projects.map(p => {
    const icon = p.appType === 'canvas' ? '🖼️' : '🎬';
    const ago = p.updatedAt ? timeAgo(p.updatedAt.toDate ? p.updatedAt.toDate() : new Date(p.updatedAt?.seconds*1000||Date.now())) : '';
    const dims = `${p.width||1920}×${p.height||1080}`;
    const safeName = (p.name||'Untitled').replace(/'/g, "\'");
    return `<div class="project-item" onclick="window.openProject('${p.id}')">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span class="project-tag" style="background:${appColors[p.appType]};color:${appTextColors[p.appType]};border:0.5px solid rgba(232,89,12,0.2)">${(p.appType==='cut'?'FOOTAGE':(p.appType||'cut').toUpperCase())}</span>
        <button onclick="event.stopPropagation();window.deleteProjectPrompt('${p.id}','${safeName}')"
          style="background:none;border:none;color:#6E6E73;cursor:pointer;font-size:14px;padding:2px 6px;border-radius:6px;transition:all .15s"
          onmouseover="this.style.background='rgba(255,69,58,0.1)';this.style.color='#FF453A'"
          onmouseout="this.style.background='none';this.style.color='#6E6E73'">🗑</button>
      </div>
      <div class="project-name">${p.name||'Untitled'}</div>
      <div class="project-meta">${ago}${ago&&dims?' · ':''}${dims}</div>
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
  const name = $('np-name')?.value.trim() || 'Untitled';
  const appType = $('np-app')?.value || 'cut';
  const w = parseInt($('np-w')?.value) || 1920;
  const h = parseInt($('np-h')?.value) || 1080;
  const dur = parseInt($('np-dur')?.value) || 30;
  const fps = parseInt($('np-fps')?.value) || 30;

  const btn = $('np-create-btn');
  if (btn) { btn.textContent = 'Creating…'; btn.disabled = true; }

  try {
    if (!S.user) throw new Error('Not signed in');
    const id = await createProject(S.user.uid, { name, appType, width: w, height: h, fps, duration: dur });
    const project = { id, name, appType, width: w, height: h, fps, duration: dur, state: {} };
    S.currentProject = project;
    S.proj = { w, h, fps, dur };
    // Reset cut state for fresh project
    S.cut = { clips:[], media:[], effects:{}, sel:null, ph:0, playing:false,
              videoTracks:2, audioTracks:2, tick:null, _hist:[], _histIdx:-1 };
    S.projects.unshift(project);
    closeNPModal();
    openApp(appType);
    notify('Project "'+name+'" created', '#3fb950');
  } catch (e) {
    notify('Failed to create project: ' + (e.message||'Unknown error'), '#E31837');
    console.error(e);
  } finally {
    if (btn) { btn.textContent = 'Create Project'; btn.disabled = false; }
  }
};

window.openProject = async function(id) {
  try {
    notify('Opening project…', '#A1A1A6');
    const project = await loadProject(id);
    if (!project) { notify('Project not found', '#E31837'); return; }
    S.currentProject = project;
    S.proj = { w: project.width||1920, h: project.height||1080, fps: project.fps||30, dur: project.duration||30 };

    // Restore Cut state from saved Firestore state
    const cs = project.state?.cut || {};

    // ── Restore media files from IndexedDB ──
    let restoredMedia = [];
    try {
      const storedFiles = await loadMediaFiles(id);
      // Match stored files back to saved media metadata by name
      const savedMeta = cs.media || [];
      restoredMedia = savedMeta.map(m => {
        const stored = storedFiles.find(sf => sf.name === m.name);
        if (stored) {
          // File found in IndexedDB — restore with fresh blob URL
          return { ...m, url: stored.url, file: stored.blob };
        } else {
          // File not in IndexedDB (e.g. different device/browser) — keep metadata
          return { ...m, url: null };
        }
      });
      // Also add any files in IndexedDB not in saved meta (edge case)
      storedFiles.forEach(sf => {
        if (!restoredMedia.find(m => m.name === sf.name)) {
          restoredMedia.push({ name: sf.name, type: sf.type.startsWith('video') ? 'video' : sf.type.startsWith('audio') ? 'audio' : 'image', url: sf.url, file: sf.blob, duration: 0, thumbnail: null });
        }
      });
    } catch(e) {
      console.warn('Could not restore media from IndexedDB:', e);
      restoredMedia = (cs.media || []).map(m => ({...m, url: null}));
    }

    S.cut = {
      clips:       cs.clips       || [],
      effects:     cs.effects     || {},
      videoTracks: cs.videoTracks || 2,
      audioTracks: cs.audioTracks || 2,
      media:       restoredMedia,
      sel: null, ph: 0, playing: false, tick: null, _hist: [], _histIdx: -1
    };

    openApp(project.appType || 'cut');
    const missingFiles = restoredMedia.filter(m => !m.url).length;
    if (missingFiles > 0) {
      notify('Opened — ' + missingFiles + ' file(s) need re-importing', '#d29922');
    } else {
      notify('Opened: ' + project.name, '#3fb950');
    }
  } catch (e) {
    notify('Could not open project', '#E31837');
    console.error('openProject error:', e);
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
  $('tl-app-name').textContent = { canvas: 'Canvas', cut: 'Footage' }[name] || name;
  $('tl-file-name').textContent = (S.currentProject?.name || 'Untitled') + '.' + name;
  hide('cv-app'); hide('cut-app');

  buildMenubar(name);
  if (name === 'canvas') { show('cv-app'); buildCanvas(); }
  else if (name === 'cut') { show('cut-app'); buildCut(); }

};

function showProjectSettings(){
  if(!window.createModal){
    // Fallback: createModal not loaded yet — retry after a tick
    setTimeout(showProjectSettings, 100);
    return;
  }

  const PRESETS = [
    {label:'▶  16:9  — 1920×1080  (YouTube / Full HD)',  w:1920, h:1080, icon:'🖥'},
    {label:'📱  9:16 — 1080×1920  (TikTok / Reels / Shorts)', w:1080, h:1920, icon:'📱'},
    {label:'⬛  1:1  — 1080×1080  (Instagram Post)',         w:1080, h:1080, icon:'⬛'},
    {label:'📐  4:5  — 1080×1350  (Social Media Ads)',         w:1080, h:1350, icon:'📐'},
    {label:'🎬  21:9 — 2560×1080  (Ultrawide / Cinema)',      w:2560, h:1080, icon:'🎬'},
    {label:'📺  4:3  — 1440×1080  (Classic TV)',               w:1440, h:1080, icon:'📺'},
    {label:'⚙️  Custom…',                                      w:null, h:null, icon:'⚙️'},
  ];

  const currentW = S.proj.w||1920, currentH = S.proj.h||1080;
  const currentAR = (currentW/currentH).toFixed(3);

  // Find active preset
  const activeIdx = PRESETS.findIndex(p => p.w===currentW && p.h===currentH);

  const inpStyle = 'width:100%;padding:8px 10px;background:#0f0f0f;border:0.5px solid rgba(255,255,255,0.12);border-radius:8px;color:#f0f2f5;font-family:DM Sans,sans-serif;font-size:13px;box-sizing:border-box;outline:none';
  const labelStyle = 'display:block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#6e6e73;margin-bottom:6px';

  createModal('Sequence Settings', `
    <div style="font-family:'DM Sans',sans-serif">

      <!-- PRESET CARDS -->
      <div style="margin-bottom:18px">
        <label style="${labelStyle}">Aspect Ratio Preset</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          ${PRESETS.slice(0,6).map((p,i) => {
            const ar = p.w/p.h;
            const isActive = i===activeIdx;
            return `<button type="button" id="ps-preset-${i}"
              onclick="
                document.querySelectorAll('[id^=ps-preset-]').forEach(b=>b.style.background='#1a1a1a');
                this.style.background='rgba(232,89,12,0.15)';
                document.getElementById('ps-w').value=${p.w};
                document.getElementById('ps-h').value=${p.h};
                document.getElementById('ps-ar-display').textContent='${(ar).toFixed(2)}:1 · ${p.w}×${p.h}';
              "
              style="
                display:flex;align-items:center;gap:8px;
                padding:8px 10px;
                background:${isActive?'rgba(232,89,12,0.15)':'#1a1a1a'};
                border:0.5px solid ${isActive?'rgba(232,89,12,0.5)':'rgba(255,255,255,0.08)'};
                border-radius:8px;cursor:pointer;
                color:#f0f2f5;font-family:DM Sans,sans-serif;font-size:11px;font-weight:600;
                text-align:left;transition:all .15s;
              ">
              <div style="
                width:${Math.round(24*Math.min(1,ar))}px;
                height:${Math.round(24*Math.min(1,1/ar))}px;
                background:rgba(232,89,12,0.3);
                border:1px solid rgba(232,89,12,0.6);
                border-radius:2px;flex-shrink:0;min-width:6px;min-height:6px
              "></div>
              <div>
                <div style="font-size:12px;font-weight:700">${p.w && p.h ? (p.w/p.h>1?'Horizontal':'Vertical') : 'Custom'}</div>
                <div style="font-size:10px;color:#6e6e73">${p.w?`${p.w}×${p.h}`:''}</div>
              </div>
            </button>`;
          }).join('')}
        </div>
      </div>

      <!-- LIVE PREVIEW OF AR -->
      <div style="margin-bottom:16px;padding:10px;background:#0f0f0f;border-radius:8px;border:0.5px solid rgba(255,255,255,0.06);text-align:center">
        <div style="font-size:10px;color:#6e6e73;margin-bottom:4px;text-transform:uppercase;letter-spacing:.6px">Current Ratio</div>
        <div id="ps-ar-display" style="font-size:14px;font-weight:700;color:#E8590C">${currentAR}:1 · ${currentW}×${currentH}</div>
      </div>

      <!-- CUSTOM W/H -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px">
        <div>
          <label style="${labelStyle}">Width</label>
          <input id="ps-w" type="number" value="${currentW}" min="100" max="7680" style="${inpStyle}"
            oninput="document.getElementById('ps-ar-display').textContent=(this.value/document.getElementById('ps-h').value).toFixed(2)+':1 · '+this.value+'×'+document.getElementById('ps-h').value">
        </div>
        <div>
          <label style="${labelStyle}">Height</label>
          <input id="ps-h" type="number" value="${currentH}" min="100" max="4320" style="${inpStyle}"
            oninput="document.getElementById('ps-ar-display').textContent=(document.getElementById('ps-w').value/this.value).toFixed(2)+':1 · '+document.getElementById('ps-w').value+'×'+this.value">
        </div>
        <div>
          <label style="${labelStyle}">FPS</label>
          <select id="ps-fps" style="${inpStyle}">
            ${[24,25,30,50,60].map(f=>`<option value="${f}" ${(S.proj.fps||30)===f?'selected':''}>${f} fps</option>`).join('')}
          </select>
        </div>
      </div>

      <!-- DURATION -->
      <div style="margin-bottom:14px">
        <label style="${labelStyle}">Timeline Duration (seconds)</label>
        <input id="ps-dur" type="number" value="${S.proj.dur||30}" min="1" max="3600" style="${inpStyle}">
      </div>

      <!-- SCALE ASSETS OPTION -->
      <div style="padding:10px;background:#0f0f0f;border-radius:8px;border:0.5px solid rgba(255,255,255,0.06)">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
          <input type="checkbox" id="ps-scale" checked
            style="width:14px;height:14px;accent-color:#E8590C;flex-shrink:0">
          <div>
            <div style="font-size:12px;font-weight:600;color:#f0f2f5">Scale assets to new frame size</div>
            <div style="font-size:10px;color:#6e6e73;margin-top:2px">Scales overlay positions proportionally to the new resolution</div>
          </div>
        </label>
      </div>
    </div>
  `, () => {
    const newW   = parseInt(document.getElementById('ps-w').value)   || 1920;
    const newH   = parseInt(document.getElementById('ps-h').value)   || 1080;
    const newFps = parseInt(document.getElementById('ps-fps').value) || 30;
    const newDur = parseInt(document.getElementById('ps-dur').value) || 30;
    const scaleAssets = document.getElementById('ps-scale')?.checked ?? true;

    const oldW = S.proj.w || 1920;
    const oldH = S.proj.h || 1080;

    // ── Update project state ──
    S.proj.w   = newW;
    S.proj.h   = newH;
    S.proj.fps = newFps;
    S.proj.dur = newDur;

    // ── Resize both canvas elements ──
    const transCanvas = document.getElementById('cut-trans-cvs');
    if(transCanvas){ transCanvas.width=newW; transCanvas.height=newH; }

    const cutCvs = document.getElementById('cut-cvs');
    if(cutCvs){ cutCvs.width=newW; cutCvs.height=newH; }

    // ── Resize the preview container to maintain correct AR ──
    applyCanvasAspectRatio(newW, newH);

    // ── Scale overlay positions proportionally ──
    if(scaleAssets && window._overlays && (newW!==oldW || newH!==oldH)){
      const sx = newW / oldW;
      const sy = newH / oldH;
      window._overlays.forEach(ov => {
        // x,y,w,h are normalized 0-1 so they don't need scaling
        // but startTime/endTime positions don't need scaling either
        // Only fontSize needs scaling
        if(ov.fontSize) ov.fontSize = Math.round(ov.fontSize * Math.min(sx,sy));
      });
    }

    // ── Update titlebar resolution display ──
    const resDisp = document.querySelector('.cut-res-display');
    if(resDisp) resDisp.textContent = newW + '×' + newH;

    renderCutTimeline();
    if(window.renderOverlayTimeline) renderOverlayTimeline();
    if(window.syncCutVid) syncCutVid();
    cutSaveHistory('project_settings');
    scheduleSave();
    notify('Sequence: '+newW+'×'+newH+' · '+newFps+'fps', '#3fb950');
  });
}
window.showProjectSettings = showProjectSettings;

// Apply canvas aspect ratio to preview container
function applyCanvasAspectRatio(w, h){
  const screen = document.getElementById('cut-screen');
  const frame  = document.getElementById('cut-viewport-frame');
  if(!screen || !frame) return;

  const ar   = w / h;
  const maxW = screen.clientWidth  * 0.92;
  const maxH = screen.clientHeight * 0.92;
  let pw = maxW, ph2 = maxW / ar;
  if(ph2 > maxH){ ph2 = maxH; pw = maxH * ar; }
  pw = Math.round(pw); ph2 = Math.round(ph2);

  // Resize only the frame boundary — never the video element
  frame.style.width  = pw + 'px';
  frame.style.height = ph2 + 'px';

  // Ensure video element fills frame with object-fit (non-destructive)
  const mv = document.getElementById('cut-main-vid');
  if(mv){
    mv.style.position  = 'absolute';
    mv.style.inset     = '0';
    mv.style.width     = '100%';
    mv.style.height    = '100%';
    mv.style.objectFit = 'contain';
    mv.style.maxWidth  = '';
    mv.style.maxHeight = '';
  }
}
window.applyCanvasAspectRatio = applyCanvasAspectRatio;

window.goToLauncher = async function() {
  if (S.cut.playing) stopCutPlay();
  if (S.ae.playing) stopAEPlay();
  S.app = null;
  await loadUserProjects();
  showPage('page-launcher');
};

window.deleteProjectPrompt = async function(id, name) {
  if (!confirm('Delete project "' + name + '"? This cannot be undone.')) return;
  try {
    await deleteProject(id);
    deleteMediaFiles(id).catch(()=>{});
    S.projects = S.projects.filter(p => p.id !== id);
    renderProjectsList();
    notify('Project deleted', '#E31837');
  } catch (e) {
    notify('Could not delete project', '#E31837');
    console.error(e);
  }
};

window.doSave = async function() {
  if (!S.currentProject?.id || !S.user) { notify('No project to save', '#E31837'); return; }
  const si = $('save-indicator');
  if (si) { si.textContent = '● Saving…'; si.style.color = 'var(--amb)'; }
  try {
    await saveProjectState(S.currentProject.id, {
      cut: {
        clips: S.cut.clips,
        effects: S.cut.effects,
        videoTracks: S.cut.videoTracks,
        audioTracks: S.cut.audioTracks,
        media: S.cut.media.map(m => ({
          name: m.name, type: m.type,
          duration: m.duration || 0,
          thumbnail: m.thumbnail || null
        }))
      }
    });
    if (si) { si.textContent = '● Saved'; si.style.color = 'var(--grn)'; }
    notify('Saved', '#3fb950');
  } catch (e) {
    if (si) { si.textContent = '● Save failed'; si.style.color = '#ff6b6b'; }
    console.error('doSave error:', e);
    notify('Save failed: ' + e.message, '#E31837');
  }
};

window.doExport = function() { showExportModal(); };

function showExportModal(){
  document.querySelectorAll('#export-modal').forEach(m=>m.remove());
  const videoClips=S.cut.clips.filter(c=>c.type==='video').sort((a,b)=>a.start-b.start);
  const totalDur=videoClips.length?Math.max(...videoClips.map(c=>c.start+c.dur)):0;
  const modal=document.createElement('div');
  modal.id='export-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.82);z-index:2000;display:flex;align-items:center;justify-content:center';
  modal.innerHTML=`
    <div style="background:#1e2533;border:1px solid rgba(255,255,255,0.13);border-radius:16px;padding:28px;width:460px;font-family:DM Sans,sans-serif;color:#f0f2f5;box-shadow:0 24px 80px rgba(0,0,0,0.6)">
      <div style="font-size:18px;font-weight:700;margin-bottom:6px">Export Video</div>
      <div style="font-size:13px;color:#8b949e;margin-bottom:20px">Duration: <strong style="color:#f0f2f5">${totalDur.toFixed(1)}s</strong> · ${videoClips.length} video clip(s)</div>
      <div style="margin-bottom:14px">
        <label style="font-size:10px;font-weight:700;color:#8b949e;text-transform:uppercase;letter-spacing:.7px;display:block;margin-bottom:6px">Quality / Resolution</label>
        <select id="exp-quality" style="width:100%;padding:9px 11px;background:#252d3d;border:1px solid rgba(255,255,255,0.11);border-radius:8px;color:#f0f2f5;font-size:13px;outline:none">
          <option value="3840,2160,8000000">4K Ultra HD (3840×2160) — 8 Mbps</option>
          <option value="1920,1080,4000000" selected>1080p Full HD (1920×1080) — 4 Mbps</option>
          <option value="1280,720,2000000">720p HD (1280×720) — 2 Mbps</option>
          <option value="854,480,1000000">480p SD (854×480) — 1 Mbps</option>
          <option value="640,360,500000">360p Low (640×360) — 500 Kbps</option>
        </select>
      </div>
      <div style="margin-bottom:14px">
        <label style="font-size:10px;font-weight:700;color:#8b949e;text-transform:uppercase;letter-spacing:.7px;display:block;margin-bottom:6px">Frame Rate</label>
        <select id="exp-fps" style="width:100%;padding:9px 11px;background:#252d3d;border:1px solid rgba(255,255,255,0.11);border-radius:8px;color:#f0f2f5;font-size:13px;outline:none">
          <option value="60">60 fps — Smooth</option>
          <option value="30" selected>30 fps — Standard</option>
          <option value="25">25 fps — PAL</option>
          <option value="24">24 fps — Cinematic</option>
        </select>
      </div>
      <div id="exp-progress" style="display:none;margin-bottom:14px">
        <div style="font-size:12px;font-weight:600;color:#f0f2f5;margin-bottom:8px" id="exp-status">Preparing...</div>
        <div style="background:#161b24;border-radius:6px;height:10px;overflow:hidden;margin-bottom:6px">
          <div id="exp-bar" style="height:100%;background:linear-gradient(90deg,#E31837,#ff6b6b);width:0%;transition:width 0.3s;border-radius:6px"></div>
        </div>
        <div style="font-size:11px;color:#8b949e" id="exp-eta"></div>
      </div>
      <div style="margin-bottom:14px">
        <label style="font-size:10px;font-weight:700;color:#8b949e;text-transform:uppercase;letter-spacing:.7px;display:block;margin-bottom:6px">File Name</label>
        <input id="exp-filename" type="text" value="${(S.currentProject?.name||'export').replace(/[^\w\s-]/g,'').trim()}" style="width:100%;padding:9px 11px;background:#252d3d;border:1px solid rgba(255,255,255,0.11);border-radius:8px;color:#f0f2f5;font-size:13px;outline:none;box-sizing:border-box" placeholder="my-video">
      </div>
      <div style="font-size:11px;color:#8b949e;background:rgba(88,166,255,0.07);border:1px solid rgba(88,166,255,0.15);border-radius:6px;padding:8px 10px;margin-bottom:18px">
        ℹ️ Exports as WebM with video + audio. Open in VLC or Chrome. To convert to MP4: use VLC → Media → Convert.
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button onclick="document.getElementById('export-modal').remove()" style="padding:9px 20px;border-radius:8px;font-size:13px;font-weight:600;font-family:DM Sans,sans-serif;cursor:pointer;background:transparent;border:1px solid rgba(255,255,255,0.15);color:#8b949e">Cancel</button>
        <button id="exp-btn" onclick="startExport()" style="padding:9px 20px;border-radius:8px;font-size:13px;font-weight:700;font-family:DM Sans,sans-serif;cursor:pointer;background:#E31837;border:none;color:#fff">▶ Export</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

async function startExport(){
  window._exportFileName = (document.getElementById('exp-filename')?.value||'export').trim().replace(/[^\w\s-]/g,'').replace(/\s+/g,'_')||'export';
  const qParts=(document.getElementById('exp-quality').value||'1920,1080,4000000').split(',');
  const W=parseInt(qParts[0])||1920, H=parseInt(qParts[1])||1080, BR=parseInt(qParts[2])||4000000;
  const fps=parseInt(document.getElementById('exp-fps').value)||30;
  const btn=document.getElementById('exp-btn');
  const progressDiv=document.getElementById('exp-progress');
  const bar=document.getElementById('exp-bar');
  const status=document.getElementById('exp-status');
  const eta=document.getElementById('exp-eta');
  btn.disabled=true; btn.textContent='Exporting...';
  progressDiv.style.display='block';

  const videoClips=S.cut.clips.filter(c=>c.type==='video').sort((a,b)=>a.start-b.start);
  if(!videoClips.length){notify('No video clips on timeline','#E31837');btn.disabled=false;btn.textContent='▶ Export';return;}
  const totalDur=Math.max(...videoClips.map(c=>c.start+c.dur));

  // Offscreen canvas for video frames
  const canvas=document.createElement('canvas');
  canvas.width=W; canvas.height=H;
  const ctx=canvas.getContext('2d');

  // AudioContext for capturing audio
  let audioCtx=null, audioDest=null;
  try{
    audioCtx=new (window.AudioContext||window.webkitAudioContext)();
    await audioCtx.resume();
    audioDest=audioCtx.createMediaStreamDestination();
  }catch(err){ console.warn('Audio capture unavailable:',err); }

  // Preload video elements
  status.textContent='Loading video files...';
  const vidEls={};
  const audioSrcNodes={};
  for(const clip of videoClips){
    const item=S.cut.media[clip.mediaIdx];
    if(!item?.url||vidEls[clip.mediaIdx]) continue;
    const v=document.createElement('video');
    v.src=item.url; v.crossOrigin='anonymous'; v.preload='auto'; v.muted=true;
    document.body.appendChild(v);
    await new Promise(r=>{v.oncanplaythrough=r;v.onerror=r;setTimeout(r,5000);});
    vidEls[clip.mediaIdx]=v;
    // Wire audio from this video to AudioContext
    if(audioCtx&&audioDest){
      try{
        const src=audioCtx.createMediaElementSource(v);
        const gain=audioCtx.createGain();
        gain.gain.value=1.0;
        src.connect(gain);
        gain.connect(audioDest);
        audioSrcNodes[clip.mediaIdx]=v;
      }catch(e){ console.warn('Audio wire failed:',e); }
    }
  }

  // Build MediaStream: video from canvas + audio from AudioContext
  const videoStream=canvas.captureStream(fps);
  let finalStream=videoStream;
  if(audioCtx&&audioDest&&audioDest.stream.getAudioTracks().length>0){
    finalStream=new MediaStream([...videoStream.getVideoTracks(),...audioDest.stream.getAudioTracks()]);
  }

  // Pick best supported codec with audio
  const mimeTypes=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm;codecs=h264,mp4a.40.2','video/webm'];
  const mimeType=mimeTypes.find(m=>MediaRecorder.isTypeSupported(m))||'video/webm';
  const recorder=new MediaRecorder(finalStream,{mimeType,videoBitsPerSecond:BR,audioBitsPerSecond:192000});
  const chunks=[];
  recorder.ondataavailable=e=>{if(e.data&&e.data.size>0)chunks.push(e.data);};

  recorder.onstop=async()=>{
    status.textContent='Packaging download...';
    bar.style.width='100%';
    // Cleanup video elements
    Object.values(vidEls).forEach(v=>{v.pause();document.body.contains(v)&&document.body.removeChild(v);});
    if(audioCtx) audioCtx.close();
    await new Promise(r=>setTimeout(r,300));
    const blob=new Blob(chunks,{type:mimeType});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    const fname=(S.currentProject?.name||'export').replace(/[^\w\s-]/g,'').trim().replace(/\s+/g,'_');
    a.download=fname+'_'+W+'x'+H+'_'+fps+'fps.webm';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),30000);
    document.getElementById('export-modal')?.remove();
    notify('✓ Export downloaded — '+fname+'.webm','#3fb950');
  };

  recorder.start(500); // collect every 500ms for stable chunks
  status.textContent='Rendering with audio...';

  const dt=1/fps;
  let t=0;
  let lastActiveVid=null;
  const startTs=Date.now();

  async function renderFrame(){
    if(t>totalDur+dt*2){
      // Stop active video audio
      if(lastActiveVid){lastActiveVid.pause();}
      await new Promise(r=>setTimeout(r,600)); // flush audio buffer
      recorder.stop();
      return;
    }

    const clip=videoClips.find(c=>t>=c.start&&t<c.start+c.dur);
    ctx.fillStyle='#000';
    ctx.fillRect(0,0,W,H);

    if(clip){
      const vid=vidEls[clip.mediaIdx];
      if(vid){
        const fileTime=(clip.fileStart||0)+Math.max(0,t-clip.start);
        // Switch active video when clip changes
        if(lastActiveVid!==vid){
          if(lastActiveVid){lastActiveVid.pause();}
          lastActiveVid=vid;
          vid.currentTime=fileTime;
          vid.muted=false;
          try{ await vid.play(); }catch(e){}
        } else {
          // Keep in sync
          if(Math.abs(vid.currentTime-fileTime)>dt*3) vid.currentTime=fileTime;
        }
        try{ ctx.drawImage(vid,0,0,W,H); }catch(e){}
      }
    } else {
      if(lastActiveVid){lastActiveVid.pause();lastActiveVid=null;}
    }

    // Progress
    const pct=Math.min(98,Math.round((t/totalDur)*100));
    bar.style.width=pct+'%';
    const elapsed=(Date.now()-startTs)/1000;
    const rate=elapsed>0.5?t/elapsed:fps/100;
    const rem=rate>0?(totalDur-t)/rate:0;
    status.textContent=`Rendering: ${pct}% · ${t.toFixed(1)}s / ${totalDur.toFixed(1)}s`;
    if(rem>1) eta.textContent=`~${Math.ceil(rem)}s remaining (${(rate).toFixed(1)}x realtime)`;

    t+=dt;
    // Use setTimeout for consistent frame pacing
    setTimeout(renderFrame, 1000/fps);
  }

  await renderFrame();
}

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

      { sep: true },
      { l: 'Back to Launcher', fn: () => goToLauncher() }
    ],
    Edit: [
      { l: 'Undo', k: 'Ctrl+Z', fn: () => notify('Undo') },
      { l: 'Redo', k: 'Ctrl+Shift+Z', fn: () => notify('Redo') },
      { sep: true },
      { l: 'Split Clip', k: 'Ctrl+K', fn: () => cutSplit() },
      { l: 'Delete Selected', k: 'Delete', fn: () => deleteSelected() },
    ],
    Clip: [
      { l: 'Speed/Duration…', fn: () => notify('Speed dialog') },
      { l: 'Enable/Disable', fn: () => notify('Clip toggled') },
      { l: 'Unlink Audio', fn: () => notify('Audio unlinked') },
      { sep: true },

    ],
    Sequence: [
      { l: 'Project Settings…', fn: () => showProjectSettings() },
      { sep: true },
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
    Overlays: [
      { l: '❄ Freeze Frame…', fn: () => window.showFreezeDialog() },
      { l: 'T  Add Text…', fn: () => window.showTextDialog() },
      { l: '◆ Add Shape / Pattern…', fn: () => window.showShapeDialog() },
      { l: '🖼 Image / Background…', fn: () => window.showImageBgDialog() },
      { sep: true },
      { l: '🎚 Audio Enhancement…', fn: () => window.showAudioFxDialog() },
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

function sendCutToMotion(){
  const videoClips = S.cut.clips.filter(c=>c.type==='video').sort((a,b)=>a.start-b.start);
  if(!videoClips.length){ notify('No video clips in Cut to send','#E31837'); return; }

  // Copy all Cut media + clips to Motion state
  S.ae.media = S.cut.media.map(m=>({...m}));
  S.ae.clips = videoClips.map(c=>({
    mediaIdx: c.mediaIdx,
    name: c.name,
    start: c.start,
    dur: c.dur,
    fileStart: c.fileStart||0,
    color: c.color,
    effects: c.effects ? {...c.effects} : {}
  }));
  S.ae._fromCut = true;
  S.ae._cutDuration = Math.max(...videoClips.map(c=>c.start+c.dur));

  // Navigate to Motion immediately
  openApp('motion');
  notify('Cut project → Motion ✓ · '+videoClips.length+' clips · '+S.ae._cutDuration.toFixed(1)+'s','#d29922');
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
      <div class="cut-lpanel" id="cut-lpanel">
        <div style="padding:10px 10px 6px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--mu2)">Properties</div>
        <div id="cut-props-body" style="padding:0 8px 8px;flex:1;overflow-y:auto;font-size:11px;color:var(--mu)">
          <div id="cut-props-empty" style="padding:20px 0;text-align:center;color:var(--mu2)">Select a clip or overlay</div>
        </div>
      </div>
      <div class="cut-preview">
        <div class="cut-pv-header">
          <span id="cut-info">Import media — click drop zone or drag files</span>
          <div style="flex:1"></div>
          <span style="font-family:'DM Mono',monospace;font-size:10px">${S.proj.w}×${S.proj.h} · ${S.proj.fps}fps · ${S.proj.dur}s</span>
        </div>
        <div class="cut-screen" id="cut-screen">
          <div id="cut-viewport-frame">
            <canvas id="cut-cvs"></canvas>
            <canvas id="cut-trans-cvs"></canvas>
            <!-- video element injected here by syncCutVid -->
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
          <input type="file" id="cut-fi" style="display:none" multiple accept="video/*,audio/*,image/*,.mp3,.aac,.wav,.ogg,.m4a,.flac,.opus,.wma,.aiff,.mp4,.mov,.avi,.mkv,.webm">
          <input type="file" id="cut-fi-audio" style="display:none" multiple accept="audio/*,.mp3,.aac,.wav,.ogg,.m4a,.flac,.opus,.wma,.aiff">
          <div style="padding:6px 10px 0">
            <button onclick="$('cut-fi-audio').click()" style="width:100%;padding:7px 10px;background:rgba(210,153,34,0.06);border:0.5px solid rgba(210,153,34,0.15);border-radius:7px;color:rgba(210,153,34,0.85);font-size:10px;font-weight:700;font-family:'DM Sans',sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:all .15s;letter-spacing:0.03em;text-transform:uppercase"
              onmouseover="this.style.background='rgba(210,153,34,0.12)'" onmouseout="this.style.background='rgba(210,153,34,0.06)'">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
              Import Audio
            </button>
          </div>
          <div style="flex:1;overflow-y:auto;padding:4px" id="cut-bin"></div>
        </div>
        <div class="panel-body hidden" id="cut-p-effects">
          <div id="cut-eff-overlay-hint" style="display:none;margin:6px 8px 2px;padding:6px 8px;background:rgba(0,220,200,0.08);border:0.5px solid rgba(0,220,200,0.25);border-radius:7px;font-size:10px;color:rgba(0,220,200,0.9)">
            Overlay selected — click any Transition to set In/Out animation
          </div>
          ${cutEffectsHTML()}
        </div>
        <div class="panel-body hidden" id="cut-p-color">${cutColorHTML()}</div>
      </div>
    </div>
    <div class="timeline-shell" id="cut-tl">${buildTimelineHTML()}</div>`;

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
  setupTimelineScrollSync();
  // Apply canvas aspect ratio + init pen tool
  setTimeout(()=>{
    applyCanvasAspectRatio(S.proj.w||1920, S.proj.h||1080);
    cutSaveHistory('init');
    _wirePenTool();
    initToolbarResize();
  }, 200);
  // Update resolution display in titlebar
  const resD=document.querySelector('.cut-res-display');
  if(resD) resD.textContent=(S.proj.w||1920)+'×'+(S.proj.h||1080);
  // Canvas click — select overlay, sync timeline + properties panel
  setTimeout(()=>{
    const cv=document.querySelector('#cut-screen canvas');
    if(cv&&!cv._ovClick){
      cv._ovClick=true;
      cv.addEventListener('click',e=>{
        if(e.target.closest('#overlay-editor')) return; // ignore clicks on handles
        const r=cv.getBoundingClientRect();
        const nx=(e.clientX-r.left)/r.width;
        const ny=(e.clientY-r.top)/r.height;
        const ph=S.cut.ph;
        // Check all overlays active at this playhead position
        const active=(window._overlays||[]).filter(o=>ph>=o.startTime&&ph<o.endTime);
        // Find topmost hit (reverse order = last added = on top)
        const hit=active.slice().reverse().find(o=>{
          // Use x,y,w,h if available (shapes, images, text)
          if(o.x!==undefined){
            const ox=o.x-(o.w||0.3)/2, oy=o.y-(o.h||0.2)/2;
            return nx>=ox&&nx<=ox+(o.w||0.3)&&ny>=oy&&ny<=oy+(o.h||0.2);
          }
          // Freeze/fullscreen overlays — hit anywhere
          return o.type==='freeze'||o.type==='image_bg';
        });
        if(hit){
          // 1. Mark as active
          window._activeEditId=hit.id;
          // 2. Show bounding box on preview
          if(window.showOverlayHandles) showOverlayHandles(hit.id);
          // 3. Highlight timeline block
          document.querySelectorAll('.tl-overlay-clip').forEach(c=>{
            c.style.border=c.dataset.ovId===hit.id
              ?'2px solid #fff'
              :'1px solid rgba(255,255,255,0.3)';
          });
          // 4. Populate properties panel
          if(window.updateOverlayProps) updateOverlayProps(hit.id);
          // 5. Scroll properties into view
          const body=document.getElementById('cut-props-body');
          if(body) body.scrollTop=0;
        } else {
          // Click on empty area — deselect
          window._activeEditId=null;
          if(window.removeOverlayHandles) removeOverlayHandles();
          document.querySelectorAll('.tl-overlay-clip').forEach(c=>{
            c.style.border='1px solid rgba(255,255,255,0.3)';
          });
          if(window.updateOverlayProps) updateOverlayProps(null);
        }
      });
    }
  },500);
  setTimeout(()=>{
    setupPlayheadDrag();
    syncCutVid();
    if(window.renderOverlayTimeline) window.renderOverlayTimeline();
  },100);
}


// ── VIDEO EFFECTS ENGINE ──
const CUT_EFFECTS = [
  {name:'Brightness',cat:'Color',color:'#ffd43b',type:'range',prop:'brightness',default:100,min:0,max:300,unit:'%'},
  {name:'Contrast',cat:'Color',color:'#ffd43b',type:'range',prop:'contrast',default:100,min:0,max:300,unit:'%'},
  {name:'Saturation',cat:'Color',color:'#ffd43b',type:'range',prop:'saturate',default:100,min:0,max:300,unit:'%'},
  {name:'Hue Rotate',cat:'Color',color:'#ffd43b',type:'range',prop:'hue-rotate',default:0,min:0,max:360,unit:'deg'},
  {name:'Opacity',cat:'Color',color:'#adb5bd',type:'range',prop:'opacity',default:100,min:0,max:100,unit:'%'},
  {name:'Warm Tone',cat:'Color',color:'#ffa94d',type:'toggle',filter:'sepia(0.3) saturate(1.4)'},
  {name:'Cool Tone',cat:'Color',color:'#4dabf7',type:'toggle',filter:'hue-rotate(200deg) saturate(0.8)'},
  {name:'Gaussian Blur',cat:'Blur',color:'#58a6ff',type:'range',prop:'blur',default:0,min:0,max:20,unit:'px'},
  {name:'Sharpen',cat:'Blur',color:'#58a6ff',type:'toggle',filter:'contrast(1.4) saturate(1.2)'},
  {name:'Grayscale',cat:'Stylize',color:'#adb5bd',type:'toggle',filter:'grayscale(100%)'},
  {name:'Sepia',cat:'Stylize',color:'#d29922',type:'toggle',filter:'sepia(100%)'},
  {name:'Invert',cat:'Stylize',color:'#da77f2',type:'toggle',filter:'invert(100%)'},
  {name:'Vignette',cat:'Stylize',color:'#343a40',type:'vignette'},
  {name:'Film Grain',cat:'Stylize',color:'#868e96',type:'grain'},
  {name:'Vintage',cat:'Stylize',color:'#d29922',type:'toggle',filter:'sepia(0.5) contrast(1.2) brightness(0.9) saturate(0.8)'},
  {name:'Noir',cat:'Stylize',color:'#495057',type:'toggle',filter:'grayscale(100%) contrast(1.4) brightness(0.8)'},
  {name:'Fade',cat:'Stylize',color:'#adb5bd',type:'toggle',filter:'opacity(0.7) brightness(1.2) saturate(0.6)'},
  {name:'Vivid',cat:'Stylize',color:'#E31837',type:'toggle',filter:'saturate(1.8) contrast(1.1)'},
  {name:'Matte',cat:'Stylize',color:'#868e96',type:'toggle',filter:'contrast(0.85) brightness(1.1) saturate(0.9)'},
  {name:'Dreamy',cat:'Stylize',color:'#da77f2',type:'toggle',filter:'blur(1px) brightness(1.1) saturate(1.2)'},
  {name:'Cinematic Bars',cat:'Overlay',color:'#212529',type:'overlay',mode:'bars'},
  {name:'Lens Flare',cat:'Overlay',color:'#ffd43b',type:'overlay',mode:'flare'},
  {name:'Light Leak',cat:'Overlay',color:'#ffa94d',type:'overlay',mode:'leak'},
  {name:'Fade In',cat:'Transition',color:'#3fb950',type:'transition',mode:'fadein',dur:1},
  {name:'Fade Out',cat:'Transition',color:'#3fb950',type:'transition',mode:'fadeout',dur:1},
  {name:'Cross Dissolve',cat:'Transition',color:'#3fb950',type:'transition',mode:'dissolve',dur:1},
  {name:'Zoom In',cat:'Transition',color:'#58a6ff',type:'transition',mode:'zoomin',dur:0.8},
  {name:'Zoom Out',cat:'Transition',color:'#58a6ff',type:'transition',mode:'zoomout',dur:0.8},
  {name:'Slide Left',cat:'Transition',color:'#da77f2',type:'transition',mode:'slideleft',dur:0.7},
  {name:'Slide Right',cat:'Transition',color:'#da77f2',type:'transition',mode:'slideright',dur:0.7},
  {name:'Wipe Left',cat:'Transition',color:'#ffa94d',type:'transition',mode:'wipeleft',dur:0.6},
  {name:'Wipe Right',cat:'Transition',color:'#ffa94d',type:'transition',mode:'wiperight',dur:0.6},
  {name:'Blur Transition',cat:'Transition',color:'#58a6ff',type:'transition',mode:'blur',dur:0.8},
  {name:'Flash White',cat:'Transition',color:'#f8f9fa',type:'transition',mode:'flash',dur:0.4},
  {name:'Flash Black',cat:'Transition',color:'#212529',type:'transition',mode:'flashblack',dur:0.4},
  {name:'Spin',cat:'Transition',color:'#da77f2',type:'transition',mode:'spin',dur:0.8},

  // ── ESSENTIAL DISSOLVES ──
  {name:'Dip to Black',cat:'Dissolve',color:'#212529',type:'transition',mode:'dip_black',dur:0.8},
  {name:'Dip to White',cat:'Dissolve',color:'#f8f9fa',type:'transition',mode:'dip_white',dur:0.8},
  {name:'Additive Dissolve',cat:'Dissolve',color:'#74c0fc',type:'transition',mode:'additive',dur:1},
  {name:'Film Dissolve',cat:'Dissolve',color:'#d29922',type:'transition',mode:'film_dissolve',dur:1},
  {name:'Morph Cut',cat:'Dissolve',color:'#3fb950',type:'transition',mode:'morph',dur:0.6},

  // ── STYLIZED WIPES ──
  {name:'Wipe Up',cat:'Wipe',color:'#ffa94d',type:'transition',mode:'wipeup',dur:0.6},
  {name:'Wipe Down',cat:'Wipe',color:'#ffa94d',type:'transition',mode:'wipedown',dur:0.6},
  {name:'Clock Wipe',cat:'Wipe',color:'#e67700',type:'transition',mode:'clock',dur:0.8},
  {name:'Radial Wipe',cat:'Wipe',color:'#e67700',type:'transition',mode:'radial',dur:0.8},
  {name:'Iris Round',cat:'Wipe',color:'#da77f2',type:'transition',mode:'iris_round',dur:0.7},
  {name:'Iris Diamond',cat:'Wipe',color:'#da77f2',type:'transition',mode:'iris_diamond',dur:0.7},
  {name:'Band Wipe H',cat:'Wipe',color:'#ffa94d',type:'transition',mode:'band_h',dur:0.6},
  {name:'Band Wipe V',cat:'Wipe',color:'#ffa94d',type:'transition',mode:'band_v',dur:0.6},

  // ── MOTION ZOOMS ──
  {name:'Zoom Blur In',cat:'Zoom',color:'#58a6ff',type:'transition',mode:'zoom_blur_in',dur:0.7},
  {name:'Zoom Blur Out',cat:'Zoom',color:'#58a6ff',type:'transition',mode:'zoom_blur_out',dur:0.7},
  {name:'Ken Burns',cat:'Zoom',color:'#4dabf7',type:'transition',mode:'ken_burns',dur:1.5},
  {name:'Push In',cat:'Zoom',color:'#74c0fc',type:'transition',mode:'push_in',dur:0.8},
  {name:'Pull Back',cat:'Zoom',color:'#74c0fc',type:'transition',mode:'pull_back',dur:0.8},

  // ── SPORT SPOTLIGHTS ──
  {name:'Player Spotlight',cat:'Spotlight',color:'#E31837',type:'transition',mode:'spotlight',dur:1.2},
  {name:'Spotlight Sweep',cat:'Spotlight',color:'#E31837',type:'transition',mode:'spotlight_sweep',dur:1},
  {name:'Zoom to Player',cat:'Spotlight',color:'#ff6b6b',type:'transition',mode:'zoom_player',dur:1},
  {name:'Highlight Ring',cat:'Spotlight',color:'#ffd43b',type:'transition',mode:'highlight_ring',dur:1},

  // ── ADVANCED ──
  {name:'Glitch',cat:'Advanced',color:'#da77f2',type:'transition',mode:'glitch',dur:0.4},
  {name:'RGB Split',cat:'Advanced',color:'#da77f2',type:'transition',mode:'rgb_split',dur:0.5},
  {name:'VR 360 Roll',cat:'Advanced',color:'#4dabf7',type:'transition',mode:'vr_roll',dur:1},
  {name:'VR 360 Spin',cat:'Advanced',color:'#4dabf7',type:'transition',mode:'vr_spin',dur:1},
];

if(!S.cut.effects) S.cut.effects={};

function cutEffectsHTML() {
  const ci=S.cut.sel;
  const cats=[...new Set(CUT_EFFECTS.map(e=>e.cat))];
  const header=ci!==null&&ci!==undefined
    ? `<div style="padding:8px 10px;font-size:11px;color:var(--blu);background:rgba(88,166,255,0.08);border-bottom:1px solid var(--b1)">Applying to: <strong>${S.cut.clips[ci]?.name||'clip'}</strong></div>`
    : `<div style="padding:8px 10px;font-size:11px;color:var(--red);background:rgba(227,24,55,0.08);border-bottom:1px solid var(--b1)">Select a clip on timeline first</div>`;
  return header + cats.map(cat=>`
    <div style="padding:6px 8px 2px;font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--mu2)">${cat}</div>
    ${CUT_EFFECTS.filter(e=>e.cat===cat).map(e=>{
      const i=CUT_EFFECTS.indexOf(e);
      const active=isEffectActive(i);
      return `<div class="ae-effect-item${active?' on':''}" id="eff-${i}" onclick="cutToggleEffect(${i})">
        <div class="ae-effect-dot" style="background:${e.color}"></div>
        <div style="flex:1">
          <div style="font-size:12px;font-weight:500">${e.name}</div>
          <div style="font-size:10px;color:var(--mu2)">${e.cat}</div>
        </div>
        ${active?'<div style="width:8px;height:8px;border-radius:50%;background:var(--grn);flex-shrink:0"></div>':''}
      </div>
      ${active&&e.type==='range'?`<div style="padding:0 10px 6px">
          <input type="range" min="${e.min}" max="${e.max}" value="${getEffectVal(i)}" style="width:100%;accent-color:#E8590C" oninput="cutUpdateEffect(${i},this.value)" onclick="event.stopPropagation()">
          <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--mu2)"><span>${e.min}${e.unit}</span><span id="ev-${i}" style="color:var(--tx);font-weight:600">${getEffectVal(i)}${e.unit}</span><span>${e.max}${e.unit}</span></div>
          <div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap">
            ${['linear','ease-in','ease-out','cinematic'].map(eq=>`<button onclick="event.stopPropagation();cutSetEffectEasing(${i},'${eq}')" style="font-size:9px;padding:2px 6px;border-radius:4px;border:0.5px solid var(--b2);background:rgba(255,255,255,0.04);color:var(--mu);cursor:pointer">${eq}</button>`).join('')}
          </div>
        </div>`:''}`;
    }).join('')}
  `).join('');
}

function isEffectActive(i){
  const ci=S.cut.sel; if(ci===null||ci===undefined)return false;
  return !!(S.cut.effects[ci]||[]).find(e=>e.i===i);
}

function getEffectVal(i){
  const ci=S.cut.sel; if(ci===null||ci===undefined)return CUT_EFFECTS[i].default||0;
  const e=(S.cut.effects[ci]||[]).find(e=>e.i===i);
  return e?e.v:(CUT_EFFECTS[i].default||0);
}

function cutToggleEffect(i){
  // If an overlay is active, apply transition to that overlay instead
  if(window._activeEditId){
    const ov=(window._overlays||[]).find(o=>o.id===window._activeEditId);
    const eff=CUT_EFFECTS[i];
    if(ov && eff && eff.type==='transition'){
      cutSaveHistory('overlay_transition');
      // Determine in vs out based on current setting (toggle in → out → both → off)
      const mode = eff.mode;
      const outMode = mode==='fadein'?'fadeout':mode==='zoomin'?'zoomout':mode;
      if(!ov.inTransition || ov.inTransition==='none'){
        ov.inTransition = mode; ov.inDuration = eff.dur||0.5;
        notify('Overlay IN: '+eff.name,'#3fb950');
      } else if(!ov.outTransition || ov.outTransition==='none'){
        ov.outTransition = outMode; ov.outDuration = eff.dur||0.5;
        notify('Overlay OUT: '+eff.name,'#3fb950');
      } else {
        ov.inTransition='none'; ov.outTransition='none';
        notify('Overlay transitions removed','#E31837');
      }
      renderOverlayTimeline();
      if(window.updateOverlayProps) updateOverlayProps(window._activeEditId);
      syncCutVid();
      return;
    }
  }
  const ci=S.cut.sel;
  if(ci===null||ci===undefined){notify('Select a clip or overlay first','#E31837');return;}
  cutSaveHistory('effect_toggle');
  if(!S.cut.effects[ci]) S.cut.effects[ci]=[];
  const idx=S.cut.effects[ci].findIndex(e=>e.i===i);
  const eff=CUT_EFFECTS[i];
  if(idx>=0){
    S.cut.effects[ci].splice(idx,1);
    notify(eff.name+' removed');
  } else {
    // Apply from current playhead position within clip
    const clip=S.cut.clips[ci];
    const offsetInClip=Math.max(0,S.cut.ph-clip.start);
    const clipDur = S.cut.clips[ci]?.dur || 2;
    const defaultStartOffset = eff.type==='transition'
      ? Math.max(0, S.cut.ph - clip.start)  // transition starts at current playhead
      : 0;                                   // filters start at clip beginning
    S.cut.effects[ci].push({
      i,
      v: eff.default||0,
      startOffset: defaultStartOffset,
      effectDur: eff.type==='transition' ? Math.min(eff.dur||1, clipDur*0.5) : clipDur,
      visible: true,
    });
    notify(eff.name+' applied at '+fmtTC(offsetInClip)+' into clip','#3fb950');
  }
  applyVideoEffects();
  showEffectIndicator(i,idx<0);
  const p=$('cut-p-effects'); if(p) p.innerHTML=cutEffectsHTML();
  renderCutTimeline(); // redraw timeline to show effect bars
  syncCutVid();        // update canvas with new effect immediately
  if(ci !== null && ci !== undefined) updatePropsPanel(ci); // refresh props so transition sliders appear
  scheduleSave();
}

function showEffectIndicator(effectIdx,adding){
  const screen=$('cut-screen'); if(!screen)return;
  let ind=$('eff-indicator');
  if(!ind){
    ind=document.createElement('div');
    ind.id='eff-indicator';
    ind.style.cssText='position:absolute;top:12px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.75);color:#fff;padding:6px 16px;border-radius:20px;font-size:13px;font-weight:600;font-family:DM Sans,sans-serif;z-index:50;pointer-events:none;transition:opacity 0.4s';
    screen.appendChild(ind);
  }
  const eff=CUT_EFFECTS[effectIdx];
  ind.style.opacity='1';
  if(!adding){
    ind.innerHTML='<span style="color:#ff6b6b">✕</span> '+eff.name+' removed';
  } else if(eff.type==='transition'){
    ind.innerHTML='<span style="color:#3fb950">↔</span> '+eff.name+' transition';
    // Also draw transition marker on clip in timeline
    drawTransitionMarker(effectIdx);
  } else {
    ind.innerHTML='<span style="color:#3fb950">✓</span> '+eff.name;
  }
  clearTimeout(ind._t);
  ind._t=setTimeout(()=>{ind.style.opacity='0';},2200);
}

function drawTransitionMarker(effectIdx){
  const ci=S.cut.sel; if(ci===null||ci===undefined)return;
  const clip=S.cut.clips[ci];
  const eff=CUT_EFFECTS[effectIdx];
  const offsetInClip=Math.max(0,S.cut.ph-clip.start);
  const el=document.querySelector('[data-ci="'+ci+'"]');
  if(!el)return;
  // Remove old marker
  el.querySelectorAll('.trans-marker').forEach(m=>m.remove());
  // Add visual marker at the point where transition starts
  const marker=document.createElement('div');
  marker.className='trans-marker';
  const pct=(offsetInClip/clip.dur)*100;
  marker.style.cssText='position:absolute;top:0;bottom:0;left:'+pct+'%;width:3px;background:rgba(63,185,80,0.9);pointer-events:none;z-index:5';
  // Label
  const lbl=document.createElement('div');
  lbl.style.cssText='position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:9px;color:#3fb950;white-space:nowrap;font-family:DM Sans,sans-serif;background:rgba(0,0,0,0.7);padding:1px 4px;border-radius:3px';
  lbl.textContent=eff.name;
  marker.appendChild(lbl);
  el.appendChild(marker);
}

let _effUpdateTimer=null;
function cutSetEffectEasing(i, easing){
  const ci=S.cut.sel; if(ci===null||ci===undefined)return;
  const e=S.cut.effects[ci]?.find(e=>e.i===i);
  if(e){ e.easing=easing; syncCutVid(); }
}

function cutUpdateEffect(i,v){
  const ci=S.cut.sel; if(ci===null||ci===undefined)return;
  clearTimeout(_effUpdateTimer);
  _effUpdateTimer=setTimeout(()=>cutSaveHistory('effect_update'),400);
  if(!S.cut.effects[ci]) S.cut.effects[ci]=[];
  const e=S.cut.effects[ci].find(e=>e.i===i);
  if(e) e.v=parseFloat(v);
  const lbl=$('ev-'+i); if(lbl) lbl.textContent=v+CUT_EFFECTS[i].unit;
  applyVideoEffects();
  syncCutVid(); // update canvas filter in real time
}

function applyVideoEffects(){
  const ci=S.cut.sel;
  const vid=document.querySelector('#cut-screen video');
  const cvs=$('cut-cvs');
  const filterStr=buildFilterStr(ci);
  if(vid) vid.style.filter=filterStr;
  if(cvs) cvs.style.filter=filterStr;
  // Overlays
  let overlay=$('cut-overlay');
  const effects=(ci!==null&&ci!==undefined)?(S.cut.effects[ci]||[]):[];
  const hasOverlay=effects.some(ef=>['overlay','vignette','grain'].includes(CUT_EFFECTS[ef.i]?.type));
  if(hasOverlay){
    const screen=$('cut-screen');
    if(!overlay&&screen){overlay=document.createElement('div');overlay.id='cut-overlay';overlay.style.cssText='position:absolute;inset:0;pointer-events:none;z-index:10';screen.appendChild(overlay);}
    if(overlay){
      let html='';
      effects.forEach(ef=>{
        const e=CUT_EFFECTS[ef.i]; if(!e)return;
        if(e.type==='vignette') html+=`<div style="position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 50%,rgba(0,0,0,0.7) 100%)"></div>`;
        if(e.type==='grain') html+=`<div style="position:absolute;inset:0;background-image:url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22><filter id=%22n%22><feTurbulence type=%22fractalNoise%22 baseFrequency=%220.65%22/></filter><rect width=%22200%22 height=%22200%22 filter=%22url(%23n)%22 opacity=%220.12%22/></svg>');opacity:0.5"></div>`;
        if(e.type==='overlay'&&e.mode==='bars') html+=`<div style="position:absolute;top:0;left:0;right:0;height:10.5%;background:#000"></div><div style="position:absolute;bottom:0;left:0;right:0;height:10.5%;background:#000"></div>`;
        if(e.type==='overlay'&&e.mode==='flare') html+=`<div style="position:absolute;top:8%;left:15%;width:100px;height:100px;border-radius:50%;background:radial-gradient(circle,rgba(255,220,100,0.5),transparent)"></div><div style="position:absolute;top:15%;left:30%;width:40px;height:40px;border-radius:50%;background:rgba(255,200,50,0.3)"></div>`;
        if(e.type==='overlay'&&e.mode==='leak') html+=`<div style="position:absolute;top:0;right:0;width:35%;height:100%;background:linear-gradient(to left,rgba(255,120,40,0.35),transparent)"></div>`;
      });
      overlay.innerHTML=html;
    }
  } else if(overlay){overlay.innerHTML='';}
  // Trigger canvas re-render with new filter
  if(typeof syncCutVid === 'function') syncCutVid();
}

function buildFilterStr(ci){
  if(ci===null||ci===undefined) return 'none';
  const effects=S.cut.effects[ci]||[];
  const clip=S.cut.clips[ci];
  const ph=S.cut.ph;
  const parts=[];
  effects.forEach(ef=>{
    if(ef.visible===false) return; // user toggled off
    const e=CUT_EFFECTS[ef.i]; if(!e||e.type==="transition")return;
    // Respect effect segment timing (startOffset + effectDur on clip timeline)
    if(clip){
      const effStart=clip.start+(ef.startOffset||0);
      const effEnd=effStart+(ef.effectDur!==undefined?ef.effectDur:clip.dur);
      if(ph<effStart||ph>=effEnd) return; // outside effect window
    }
    if(e.type==='range') parts.push(e.prop+'('+ef.v+e.unit+')');
    else if(e.type==='toggle') parts.push(e.filter);
  });
  return parts.length?parts.join(' '):'none';
}

function cutColorHTML() {
  return `<div class="psec"><div class="psec-label">Color Wheels</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:10px">
      ${['Shadows','Midtones','Highlights'].map(l=>`<div style="text-align:center"><div style="width:50px;height:50px;border-radius:50%;background:conic-gradient(#E31837,#ff6b6b,#ffd43b,#3fb950,#58a6ff,#da77f2,#E31837);margin:0 auto 4px;cursor:pointer;border:2px solid var(--b2)"></div><div style="font-size:10px;color:var(--mu)">${l}</div></div>`).join('')}
    </div></div>
    <div class="psec">${['Exposure','Contrast','Highlights','Shadows','Saturation','Temp','Tint'].map(l=>`<div class="slider-row"><div class="sl-lbl">${l} <span>0</span></div><input type="range" min="-100" max="100" value="0" oninput="this.previousElementSibling.querySelector('span').textContent=this.value"></div>`).join('')}</div>`;
}

function cutSwitchPanel(name, el) {
  if(name==='effects'){
    setTimeout(()=>{const p=$('cut-p-effects');if(p)p.innerHTML=cutEffectsHTML();},50);
  }
  if (el) { document.querySelectorAll('.cut-rpanel .ptab').forEach(t=>t.classList.remove('on')); el.classList.add('on'); }
  ['media','effects','color'].forEach(n => { const p=$('cut-p-'+n); if(p) p.classList.toggle('hidden', n!==name); });
}

function buildTrackLabelsHTML(tracks){
  if(!S.cut.mutedTracks)  S.cut.mutedTracks  = {};
  if(!S.cut.hiddenTracks) S.cut.hiddenTracks = {};
  return tracks.map(t => {
    const isVideo  = t.trackIdx < S.cut.videoTracks;
    const isOff    = isVideo ? !!S.cut.hiddenTracks[t.trackIdx] : !!S.cut.mutedTracks[t.trackIdx];
    const offCls   = isOff ? ' track-label-off' : '';
    const dimStyle = isOff ? 'opacity:0.4;' : '';

    // Eye icon (video) or Speaker icon (audio)
    const onIcon  = isVideo
      ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
      : '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/></svg>';
    const offIcon = isVideo
      ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22"/></svg>'
      : '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';

    const fn       = isVideo ? 'toggleTrackVisibility' : 'toggleTrackMute';
    const btnTitle = isVideo ? (isOff?'Show track':'Hide track') : (isOff?'Unmute':'Mute');

    return '<div class="track-label ' + t.cls + offCls + '" style="height:30px;min-height:30px;box-sizing:border-box;display:flex;align-items:center;gap:4px;padding:0 4px" data-track="' + t.trackIdx + '">'
      + '<span style="flex:1;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' + dimStyle + '">' + t.label + '</span>'
      + '<button class="tl-track-icon' + (isOff?' tl-track-off':'') + '" onclick="' + fn + '(' + t.trackIdx + ')" title="' + btnTitle + '">'
      + (isOff ? offIcon : onIcon)
      + '</button>'
      + '</div>';
  }).join('');
}

function buildTimelineHTML() {
  const dur = S.proj.dur, fps = S.proj.fps;
  const tracks = [];
  for(let v=S.cut.videoTracks;v>=1;v--) tracks.push({label:'V'+v,cls:'video-track',trackIdx:v-1});
  for(let a=1;a<=S.cut.audioTracks;a++) tracks.push({label:'A'+a,cls:'audio-track',trackIdx:S.cut.videoTracks+a-1});
  const step = dur<=30?2:dur<=120?5:30;
  const rulerMarks = Array.from({length:Math.floor(dur/step)+1},(_,i)=>i*step)
    .map(s=>'<div class="ruler-mark" style="left:'+Math.round(s*PPS)+'px"><span>'+fmtTC(s)+'</span></div>').join('');
  const trackRows = tracks.map(t=>'<div class="clip-track-row'+(t.trackIdx<S.cut.videoTracks?' video-row':' audio-row')+'" id="tl-row-'+t.trackIdx+'" data-track="'+t.trackIdx+'"></div>').join('');

  // ── UNIFIED SIDEBAR (tools + labels) ──
  var sidebar = '<div class="tl-sidebar" id="tl-sidebar">'
    + '<div class="tl-sidebar-top">'
      + '<div class="vt-btn active" id="vt-select" data-tool="select" title="Select (V)" onclick="setCutTool(\'select\')"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M4 0l16 12-8 2-4 8L4 0z"/></svg></div>'
      + '<div class="vt-btn" id="vt-text" data-tool="text" title="Text (T)" onclick="setCutTool(\'text\')"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M2 4h20v3h-8v13h-4V7H2z"/></svg></div>'
      + '<div class="vt-btn vt-has-sub" id="vt-shape" data-tool="shape" title="Shape (R)" onclick="setCutTool(\'shape\')" oncontextmenu="showShapeSubmenu(event)" onmousedown="handleShapeMousedown(event)"><svg id="vt-shape-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg><span class="vt-sub-arrow">▾</span></div>'
      + '<div class="vt-btn" id="vt-pen" data-tool="pen" title="Pen (P)" onclick="setCutTool(\'pen\')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></div>'
      + '<div class="vt-btn" id="vt-split" data-tool="split" title="Blade (S)" onclick="setCutTool(\'split\')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="2" x2="8" y2="22"/><path d="M4 6l4 4-4 4"/></svg></div>'
    + '</div>'
    + '<div class="tl-sidebar-ruler"></div>'
    + '<div class="tl-sidebar-labels" id="tl-track-labels">'
      + buildTrackLabelsHTML(tracks)
    + '</div>'
  + '</div>';

  // ── CONTENT AREA (header + ruler + tracks) ──
  var content = '<div class="tl-content" id="tl-tracks-area">'
    + '<div class="tl-header">'
      + '<button class="tl-ibtn" onclick="cutSeek(0)" title="Go to start"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18V6h2v12zm3.5-6L17 6v12z"/></svg></button>'
      + '<button class="tl-ibtn" id="cut-tl-play" onclick="cutTogglePlay()" title="Play/Pause (Space)"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5V19L19 12Z" id="cut-tl-path"/></svg></button>'
      + '<button class="tl-ibtn" onclick="cutSeek('+dur+')" title="Go to end"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18V6l8 6zm9-12v12h2V6z"/></svg></button>'
      + '<div class="tl-timecode" id="cut-tl-tc">00:00:00:00</div>'
      + '<div style="flex:1"></div>'
      + '<button class="cx-btn" onclick="cutSplit()">Split</button>'
      + '<button class="cx-btn" onclick="deleteSelected()">Delete</button>'
      + '<button class="cx-btn" onclick="cutAddTrack(\'video\')">+ Video</button>'
      + '<button class="cx-btn" onclick="cutAddTrack(\'audio\')">+ Audio</button>'
      + '<span style="font-size:10px;color:var(--mu2);margin-left:6px">'+dur+'s · '+fps+'fps</span>'
    + '</div>'
    + '<div class="tl-area">'
      + '<div class="tl-ruler" id="tl-ruler" style="width:'+Math.round(dur*PPS)+'px">'+rulerMarks+'</div>'
      + '<div class="tl-clips-scroll" id="tl-scroll">'
        + '<div class="tl-rows" id="tl-rows" style="width:'+Math.round(dur*PPS)+'px;min-width:100%">'
          + trackRows
          + '<div class="playhead" id="cut-ph" style="left:0"><div class="playhead-head"></div><div class="playhead-line"></div></div>'
        + '</div>'
      + '</div>'
    + '</div>'
  + '</div>';

  return sidebar + content;
}

function setupCutDrop() {
  const dz = $('cut-dz');
  if (!dz) return;
  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', ()  => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('drag-over');
    handleCutFiles(e.dataTransfer.files);
  });
}

function setupCutFileInput() {
  const fi = $('cut-fi');
  if (fi) fi.addEventListener('change', () => { handleCutFiles(fi.files); fi.value=''; });
  const fiAudio = $('cut-fi-audio');
  if (fiAudio) fiAudio.addEventListener('change', () => { handleCutFiles(fiAudio.files); fiAudio.value=''; });
}

function handleCutFiles(files) {
  if (!files?.length) return;
  let added = 0;
  Array.from(files).forEach(f => {
    const ext = f.name.split('.').pop().toLowerCase();
    const audioExts = ['mp3','aac','wav','ogg','m4a','flac','opus','wma','aiff','aif','ape','alac'];
    const videoExts = ['mp4','mov','avi','mkv','webm','m4v','flv','wmv','3gp','ts','mts'];
    const isVid = f.type.startsWith('video/') || videoExts.includes(ext);
    const isAud = f.type.startsWith('audio/') || audioExts.includes(ext);
    const isImg = f.type.startsWith('image/');
    if (!isVid&&!isAud&&!isImg) return;
    const url = URL.createObjectURL(f);
    const item = { name:f.name, type:isVid?'video':isAud?'audio':'image', file:f, url, duration:isImg?5:0, thumbnail:null };
    if (isVid) {
      const v = document.createElement('video'); v.src = url;
      v.onloadedmetadata = () => {
        item.duration = v.duration;
        item.hasAudio = true; // assume video has audio by default
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
    // Persist file bytes in IndexedDB so it survives page reload
    if (S.currentProject?.id) {
      saveMediaFile(S.currentProject.id, f).catch(e => console.warn('MediaStore save failed:', e));
    }
  });
  if (added) notify(added+' file'+(added>1?'s':'')+' imported','#3fb950');
  buildBinList();
}

function buildBinList() {
  const el=$('cut-bin'); if(!el) return;
  if (!S.cut.media.length) { el.innerHTML='<div style="padding:24px 12px;text-align:center"><div style="font-size:22px;opacity:0.25;margin-bottom:8px">📂</div><div style="font-size:11px;color:rgba(255,255,255,0.25);font-weight:500">No media yet</div><div style="font-size:10px;color:rgba(255,255,255,0.15);margin-top:3px">Drop files or click above</div></div>'; return; }
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

// ── PROPERTIES PANEL ──
function updatePropsPanel(ci){
  const body=$('cut-props-body'); if(!body) return;
  if(ci===null||ci===undefined){
    body.innerHTML='<div style="padding:20px 8px;text-align:center;color:var(--mu2);font-size:11px">Select a clip or overlay</div>';
    return;
  }
  const c=S.cut.clips[ci]; if(!c){body.innerHTML='';return;}
  const item=S.cut.media[c.mediaIdx]||{};
  const fmtN=n=>Math.round(n*100)/100;
  const speed=c.speed||1;
  const inp=(id,val,step,min,onch)=>`<input type="number" id="${id}" value="${val}" step="${step}" min="${min||0}" style="width:62px;background:#161616;border:0.5px solid rgba(255,255,255,0.1);border-radius:5px;color:var(--tx);font-size:11px;padding:2px 5px;outline:none" onchange="${onch}">`;

  const fadeIn  = c.fadeIn  || 0;
  const fadeOut = c.fadeOut || 0;
  const vol     = c.volume  !== undefined ? c.volume : 1;
  const fx = c.audioFx || {};
  const audioSection = c.type==='audio'||c.linkedToVideo ? `
    <div class="prop-section">🔊 Audio</div>
    <div class="prop-row"><span class="prop-label">Volume</span>
      <input type="range" id="vol-val-${ci}-input" min="0" max="200" value="${Math.round(vol*100)}" style="flex:1;accent-color:#E8590C"
        oninput="S.cut.clips[${ci}].volume=this.value/100;if(!S.cut.clips[${ci}].audioFx)S.cut.clips[${ci}].audioFx={};S.cut.clips[${ci}].audioFx.volume=parseInt(this.value);document.getElementById('vol-pct-${ci}').textContent=this.value+'%'">
      <span id="vol-pct-${ci}" style="font-size:10px;color:var(--mu);min-width:32px;text-align:right">${Math.round(vol*100)}%</span>
    </div>
    <div class="prop-section" style="color:rgba(255,220,80,0.9)">🎚 Fade</div>
    <div class="prop-row">
      <span class="prop-label" style="color:rgba(255,220,80,0.8)">Fade In</span>
      <input type="number" id="fade-in-val-${ci}" value="${fadeIn.toFixed(2)}" min="0" step="0.1"
        style="width:58px;background:#161616;border:0.5px solid rgba(255,255,255,0.1);border-radius:5px;color:var(--tx);font-size:11px;padding:2px 5px;outline:none"
        onchange="S.cut.clips[${ci}].fadeIn=Math.max(0,parseFloat(this.value)||0);renderCutTimeline();cutSaveHistory('fade_in')">
      <span style="font-size:10px;color:var(--mu)">s</span>
    </div>
    <div class="prop-row">
      <span class="prop-label" style="color:rgba(255,220,80,0.8)">Fade Out</span>
      <input type="number" id="fade-out-val-${ci}" value="${fadeOut.toFixed(2)}" min="0" step="0.1"
        style="width:58px;background:#161616;border:0.5px solid rgba(255,255,255,0.1);border-radius:5px;color:var(--tx);font-size:11px;padding:2px 5px;outline:none"
        onchange="S.cut.clips[${ci}].fadeOut=Math.max(0,parseFloat(this.value)||0);renderCutTimeline();cutSaveHistory('fade_out')">
      <span style="font-size:10px;color:var(--mu)">s</span>
    </div>
    ${fx.bass!==undefined||fx.treble!==undefined||fx.preset ? `
    <div class="prop-section" style="color:rgba(255,180,50,0.85)">🎛 EQ (applied)</div>
    <div class="prop-row"><span class="prop-label">Bass</span><span class="prop-val">${fx.bass||0} dB</span></div>
    <div class="prop-row"><span class="prop-label">Mid</span><span class="prop-val">${fx.mid||0} dB</span></div>
    <div class="prop-row"><span class="prop-label">Treble</span><span class="prop-val">${fx.treble||0} dB</span></div>
    ${fx.preset&&fx.preset!=='none'?'<div class="prop-row"><span class="prop-label">Preset</span><span class="prop-val">'+fx.preset+'</span></div>':''}
    ` : ''}
    <div class="prop-row" style="padding:4px 0">
      <button onclick="showAudioEnhanceDialog(${ci})" style="width:100%;padding:6px;background:rgba(232,89,12,0.12);border:0.5px solid rgba(232,89,12,0.35);border-radius:6px;color:#E8590C;font-size:11px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif">🎵 Audio Enhancement…</button>
    </div>` : '';

  body.innerHTML=`
    <div class="prop-section">${c.type==='video'?'📹 Video':c.type==='audio'?'🎵 Audio':'📎'} Clip</div>
    <div class="prop-row"><span class="prop-label">Name</span><span class="prop-val" title="${c.name||''}" style="font-size:10px">${(c.name||'').substring(0,16)}</span></div>
    <div class="prop-row"><span class="prop-label">Track</span><span class="prop-val">${c.type==='video'?'V':'A'}${c.track+1}</span></div>
    <div class="prop-section">⏱ Timing</div>
    <div class="prop-row"><span class="prop-label">Start</span>
      ${inp('ps-start',fmtN(c.start),0.1,0,`S.cut.clips[${ci}].start=parseFloat(this.value)||0;renderCutTimeline()`)}
    </div>
    <div class="prop-row"><span class="prop-label">Duration</span>
      ${inp('ps-dur',fmtN(c.dur),0.1,0.1,`S.cut.clips[${ci}].dur=Math.max(0.1,parseFloat(this.value)||0.1);renderCutTimeline()`)}
    </div>
    <div class="prop-row"><span class="prop-label">End</span><span class="prop-val">${fmtN(c.start+c.dur)}s</span></div>
    <div class="prop-section">⚡ Speed</div>
    <div class="prop-row">
      <span class="prop-label">Speed %</span>
      <input type="number" id="spd-pct-panel-${ci}" value="${Math.round(speed*100)}" min="10" max="800" step="5"
        style="width:58px;background:#161616;border:0.5px solid rgba(255,255,255,0.1);border-radius:5px;color:var(--tx);font-size:11px;padding:2px 5px;outline:none"
        onchange="applyClipSpeed(${ci},parseFloat(this.value)||100,false);updatePropsPanel(${ci})">
      <span style="font-size:10px;color:var(--mu);">%</span>
    </div>
    <div class="prop-row">
      <span class="prop-label">Duration</span>
      <span class="prop-val" style="color:#E8590C">${fmtN(c.dur)}s</span>
    </div>
    <div class="prop-row" style="padding:2px 0">
      <button onclick="showSpeedDialog(${ci})" style="width:100%;padding:5px;background:rgba(232,89,12,0.1);border:0.5px solid rgba(232,89,12,0.3);border-radius:6px;color:#E8590C;font-size:10px;cursor:pointer;font-family:'DM Sans',sans-serif">⚡ Speed / Duration…</button>
    </div>
    ${audioSection}
    ${(()=>{
      // Show collapsible transition controls for ALL transitions on this clip
      const efArr = S.cut.effects[ci]||[];
      const trIdxs = efArr.map((e,i)=>i).filter(i=>CUT_EFFECTS[efArr[i].i]?.type==='transition');
      if(!trIdxs.length) return '';
      return trIdxs.map(efIdx2=>{
      const ef2 = efArr[efIdx2];
      const trName = CUT_EFFECTS[ef2.i]?.name||'Transition';
      const accordionId = 'tr-acc-'+ci+'-'+efIdx2;
      const isOpen = window._trAccordion?.[accordionId] !== false; // default open
      const maxStart = Math.max(0, c.dur - 0.1);
      const maxDur   = Math.max(0.1, c.dur - (ef2.startOffset||0));
      return `
        <div style="border:0.5px solid rgba(232,89,12,0.25);border-radius:8px;margin:4px 0;overflow:hidden;background:rgba(232,89,12,0.04)">
          <div style="display:flex;align-items:center;padding:8px 10px;cursor:pointer;user-select:none;gap:8px"
            onclick="window._trAccordion=window._trAccordion||{};window._trAccordion['${accordionId}']=!document.getElementById('${accordionId}').hidden;document.getElementById('${accordionId}').hidden=!document.getElementById('${accordionId}').hidden;this.querySelector('.tr-chevron').style.transform=document.getElementById('${accordionId}').hidden?'rotate(-90deg)':'rotate(0deg)'">
            <div style="width:3px;height:28px;border-radius:2px;background:linear-gradient(180deg,#E8590C,#ff8c42);flex-shrink:0"></div>
            <div style="flex:1;min-width:0">
              <div style="font-size:11px;font-weight:700;color:#fff;letter-spacing:0.3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${trName}</div>
              <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:1px">${(ef2.startOffset||0).toFixed(1)}s &rarr; ${((ef2.startOffset||0)+(ef2.effectDur||1)).toFixed(1)}s &nbsp;·&nbsp; ${(ef2.effectDur||1).toFixed(1)}s</div>
            </div>
            <span class="tr-chevron" style="font-size:9px;color:rgba(255,255,255,0.3);transition:transform 0.2s;transform:${isOpen?'rotate(0deg)':'rotate(-90deg)'}">▼</span>
          </div>
          <div id="${accordionId}" ${isOpen?'':'hidden'} style="padding:6px 0">
          <div style="display:flex;justify-content:flex-end;padding:0 8px 4px">
            <button onclick="event.stopPropagation();const e=S.cut.effects[${ci}][${efIdx2}];e&&(S.cut.effects[${ci}].splice(${efIdx2},1),renderCutTimeline(),updatePropsPanel(${ci}),syncCutVid(),scheduleSave())" style="font-size:9px;padding:2px 6px;border-radius:4px;border:0.5px solid rgba(255,69,58,0.3);background:rgba(255,69,58,0.08);color:#ff453a;cursor:pointer">✕ Remove</button>
          </div>
        <div class="prop-section">↔ Transition: ${CUT_EFFECTS[ef2.i]?.name||'Transition'}</div>
        <div class="prop-row"><span class="prop-label">Start</span>
          <input type="range" min="0" max="${maxStart.toFixed(1)}" step="0.1"
            value="${(ef2.startOffset||0).toFixed(1)}"
            style="flex:1;accent-color:#E8590C"
            oninput="S.cut.effects[${ci}][${efIdx2}].startOffset=parseFloat(this.value);this.nextElementSibling.textContent=parseFloat(this.value).toFixed(1)+'s';syncCutVid();">
          <span style="font-size:10px;color:var(--mu);min-width:36px;text-align:right">${(ef2.startOffset||0).toFixed(1)}s</span>
        </div>
        <div class="prop-row"><span class="prop-label">Duration</span>
          <input type="range" min="0.1" max="${maxDur.toFixed(1)}" step="0.1"
            value="${(ef2.effectDur||1).toFixed(1)}"
            style="flex:1;accent-color:#E8590C"
            oninput="S.cut.effects[${ci}][${efIdx2}].effectDur=parseFloat(this.value);this.nextElementSibling.textContent=parseFloat(this.value).toFixed(1)+'s';syncCutVid();">
          <span style="font-size:10px;color:var(--mu);min-width:36px;text-align:right">${(ef2.effectDur||1).toFixed(1)}s</span>
        </div>
        <div class="prop-row"><span class="prop-label">Completion</span>
          <input type="range" min="0" max="100" step="1"
            value="${Math.round((ef2.completion||100))}"
            style="flex:1;accent-color:#E8590C"
            oninput="S.cut.effects[${ci}][${efIdx2}].completion=parseInt(this.value);this.nextElementSibling.textContent=this.value+'%';syncCutVid();">
          <span style="font-size:10px;color:var(--mu);min-width:36px;text-align:right">${Math.round(ef2.completion||100)}%</span>
        </div>
        <div class="prop-row"><span class="prop-label">Softness</span>
          <input type="range" min="0" max="1" step="0.05"
            value="${(ef2.softness||0).toFixed(2)}"
            style="flex:1;accent-color:#E8590C"
            oninput="S.cut.effects[${ci}][${efIdx2}].softness=parseFloat(this.value);this.nextElementSibling.textContent=Math.round(this.value*100)+'%';syncCutVid();">
          <span style="font-size:10px;color:var(--mu);min-width:36px;text-align:right">${Math.round((ef2.softness||0)*100)}%</span>
        </div>
        <div class="prop-row"><span class="prop-label">Easing</span>
          <select style="flex:1;background:#161616;border:0.5px solid rgba(255,255,255,0.1);border-radius:5px;color:var(--tx);font-size:11px;padding:2px 4px"
            onchange="S.cut.effects[${ci}][${efIdx2}].easing=this.value;syncCutVid();">
            ${['linear','ease-in','ease-out','ease-in-out','cinematic'].map(e=>`<option value="${e}" ${(ef2.easing||'linear')===e?'selected':''}>${e.charAt(0).toUpperCase()+e.slice(1)}</option>`).join('')}
          </select>
        </div>
        ${(()=>{ const trMode=CUT_EFFECTS[ef2.i]?.mode||'';
          const isWipe=['wipeleft','wiperight','wipeup','wipedown','clock','radial','iris_round','iris_diamond','band_h','band_v'].includes(trMode);
          if(!isWipe) return '';
          return `<div class="prop-row"><span class="prop-label">Direction</span>
            <select style="flex:1;background:#161616;border:0.5px solid rgba(255,255,255,0.1);border-radius:5px;color:var(--tx);font-size:11px;padding:2px 4px"
              onchange="S.cut.effects[${ci}][${efIdx2}].direction=this.value;syncCutVid();">
              ${['forward','reverse'].map(d=>`<option value="${d}" ${(ef2.direction||'forward')===d?'selected':''}>${d.charAt(0).toUpperCase()+d.slice(1)}</option>`).join('')}
            </select>
          </div>`;
        })()}
          </div>
        </div>
      `;
      }).join('');
    })()}
    <div class="prop-section">🎬 Actions</div>
    <div style="display:flex;gap:4px;flex-wrap:wrap;padding:2px 0">
      <button onclick="deleteSelected()" style="flex:1;padding:5px;background:rgba(255,69,58,0.1);border:0.5px solid rgba(255,69,58,0.2);border-radius:6px;color:#ff453a;font-size:10px;cursor:pointer;font-family:'DM Sans',sans-serif">🗑 Delete</button>
      <button onclick="cutSplit()" style="flex:1;padding:5px;background:rgba(255,255,255,0.04);border:0.5px solid rgba(255,255,255,0.1);border-radius:6px;color:var(--tx2);font-size:10px;cursor:pointer;font-family:'DM Sans',sans-serif">✂ Split</button>
      <button onclick="cutDuplicate(${ci})" style="flex:1;padding:5px;background:rgba(255,255,255,0.04);border:0.5px solid rgba(255,255,255,0.1);border-radius:6px;color:var(--tx2);font-size:10px;cursor:pointer;font-family:'DM Sans',sans-serif">⧉ Dupe</button>
    </div>
    ${(S.cut.effects[ci]||[]).length>0?`
    <div class="prop-section">🎛 Effects Stack</div>
    <div style="display:flex;flex-direction:column;gap:3px">
      ${(S.cut.effects[ci]||[]).map((ef,efIdx)=>{
        const eff=CUT_EFFECTS[ef.i]||{name:'Effect',color:'#888'};
        const isVisible=ef.visible!==false;
        return '<div style="display:flex;align-items:center;gap:4px;padding:4px 6px;background:'+(isVisible?'rgba(255,255,255,0.04)':'rgba(255,255,255,0.01)')+';border:0.5px solid rgba(255,255,255,'+(isVisible?'0.08':'0.03')+');border-radius:6px">'
          +'<div style="width:8px;height:8px;border-radius:50%;background:'+eff.color+';flex-shrink:0"></div>'
          +'<span style="flex:1;font-size:10px;color:'+(isVisible?'var(--tx)':'var(--mu2)')+';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+eff.name+'</span>'
          +'<button onclick="S.cut.effects['+ci+']['+efIdx+'].visible=S.cut.effects['+ci+']['+efIdx+'].visible===false;applyVideoEffects();syncCutVid();updatePropsPanel('+ci+')" title="Toggle visibility" style="background:none;border:none;cursor:pointer;color:'+(isVisible?'rgba(255,255,255,0.6)':'rgba(255,100,100,0.5)')+';font-size:11px;padding:0 2px;line-height:1">'+(isVisible?'👁':'👁̶')+'</button>'
          +'<button onclick="cutSaveHistory();S.cut.effects['+ci+'].splice('+efIdx+',1);applyVideoEffects();renderCutTimeline();updatePropsPanel('+ci+')" title="Remove effect" style="background:none;border:none;cursor:pointer;color:#ff453a;font-size:11px;padding:0 2px;line-height:1">×</button>'
          +'</div>';
      }).join('')}
    </div>`:''}`;

  // _origDur is set in applyClipSpeed, not here
}

// ── SPEED / TIME REMAPPING ENGINE ──────────────────────────

// Apply speed to a clip with optional ripple edit
// ripple=true: shift all clips that start AFTER this clip's original end
function applyClipSpeed(ci, newSpeedPct, ripple){
  const c = S.cut.clips[ci];
  if(!c) return;

  const newSpeed = Math.max(0.1, Math.min(16, newSpeedPct / 100));
  
  // Store original untrimed duration the first time
  if(c._origDur === undefined || c._origDur === null){
    c._origDur = c.dur * (c.speed||1); // original source duration
  }
  
  const oldDur  = c.dur;
  const newDur  = c._origDur / newSpeed;
  const oldEnd  = c.start + oldDur;
  const newEnd  = c.start + newDur;
  const delta   = newDur - oldDur; // positive = clip got longer

  c.speed = newSpeed;
  c.dur   = newDur;

  // Ripple edit: shift all clips that started at or after the old end
  if(ripple && delta !== 0){
    S.cut.clips.forEach((other, oi) => {
      if(oi === ci) return;
      if(other.start >= oldEnd - 0.01){
        other.start = Math.max(0, other.start + delta);
      }
    });
  }

  cutSaveHistory('speed_change');
  renderCutTimeline();
  // Re-populate props panel with updated values
  if(S.cut.sel === ci) updatePropsPanel(ci);
}
window.applyClipSpeed = applyClipSpeed;

// Show speed dialog (from context menu)
function showSpeedDialog(ci){
  const c = S.cut.clips[ci];
  if(!c) return;
  if(c._origDur === undefined) c._origDur = c.dur * (c.speed||1);
  const currentPct = Math.round((c.speed||1) * 100);
  const isAudio = c.type==='audio' || c.linkedToVideo;

  showModal(`
    <div style="font-family:'DM Sans',sans-serif">
      <h3 style="margin:0 0 16px;font-size:16px;font-weight:700;color:var(--tx)">⚡ Speed / Duration</h3>
      
      <div style="margin-bottom:14px">
        <label style="display:block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--mu2);margin-bottom:8px">Speed</label>
        <div style="display:flex;align-items:center;gap:10px">
          <input type="range" id="spd-slider" min="10" max="800" value="${currentPct}" step="5"
            style="flex:1;accent-color:#E8590C"
            oninput="
              const v=parseFloat(this.value);
              document.getElementById('spd-pct').value=v;
              document.getElementById('spd-preview').textContent=(c=S.cut.clips[${ci}],c._origDur||(c.dur*(c.speed||1)),(c._origDur/(v/100)).toFixed(2))+'s';
              document.getElementById('spd-mult').textContent=(v/100).toFixed(2)+'x';
            ">
          <input type="number" id="spd-pct" value="${currentPct}" min="10" max="800" step="5"
            style="width:70px;padding:6px 8px;background:var(--n2);border:0.5px solid var(--b2);border-radius:8px;color:var(--tx);font-size:14px;font-weight:600;text-align:center;outline:none"
            oninput="document.getElementById('spd-slider').value=this.value;
              document.getElementById('spd-preview').textContent=(c=S.cut.clips[${ci}],c._origDur||(c.dur*(c.speed||1)),(c._origDur/(parseFloat(this.value)/100)).toFixed(2))+'s';
              document.getElementById('spd-mult').textContent=(parseFloat(this.value)/100).toFixed(2)+'x';">
          <span style="font-size:12px;color:var(--mu2)">%</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:11px;color:var(--mu2)">
          <span>10%</span>
          <span style="color:var(--tx);font-weight:600" id="spd-mult">${(currentPct/100).toFixed(2)}x</span>
          <span>800%</span>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
        <div style="background:var(--n3);border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:10px;color:var(--mu2);margin-bottom:4px">ORIGINAL</div>
          <div style="font-size:14px;font-weight:700;color:var(--tx)">${(c._origDur||c.dur).toFixed(2)}s</div>
        </div>
        <div style="background:var(--n3);border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:10px;color:var(--mu2);margin-bottom:4px">NEW DURATION</div>
          <div style="font-size:14px;font-weight:700;color:#E8590C" id="spd-preview">${((c._origDur||c.dur)/(currentPct/100)).toFixed(2)}s</div>
        </div>
      </div>

      <div style="margin-bottom:14px">
        <label style="display:block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--mu2);margin-bottom:6px">Presets</label>
        <div style="display:flex;gap:5px;flex-wrap:wrap">
          ${[['25%','Slow 4x'],['50%','Slow 2x'],['75%','Slow 1.3x'],['100%','Normal'],['150%','Fast 1.5x'],['200%','Fast 2x'],['400%','Fast 4x']].map(([p,l])=>`
            <button onclick="document.getElementById('spd-pct').value='${parseInt(p)}';document.getElementById('spd-slider').value='${parseInt(p)}';document.getElementById('spd-preview').textContent=((S.cut.clips[${ci}]._origDur||S.cut.clips[${ci}].dur)/(${parseInt(p)}/100)).toFixed(2)+'s';document.getElementById('spd-mult').textContent=(${parseInt(p)}/100).toFixed(2)+'x'"
              style="padding:4px 10px;background:${p==='100%'?'var(--red)':'var(--n4)'};border:0.5px solid var(--b2);border-radius:6px;color:var(--tx);font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;transition:all .15s">${l}<br><span style="font-size:9px;color:var(--mu2)">${p}</span>
            </button>`).join('')}
        </div>
      </div>

      ${isAudio ? `
      <div style="margin-bottom:14px;padding:10px;background:var(--n3);border-radius:8px;border:0.5px solid var(--b2)">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:var(--tx)">
          <input type="checkbox" id="spd-pitch" checked style="accent-color:#E8590C;width:14px;height:14px">
          Preserve audio pitch (prevent chipmunk effect)
        </label>
        <div style="font-size:10px;color:var(--mu2);margin-top:4px;margin-left:22px">Uses pitch correction when checked</div>
      </div>` : ''}

      <div style="margin-bottom:0">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:var(--tx)">
          <input type="checkbox" id="spd-ripple" checked style="accent-color:#E8590C;width:14px;height:14px">
          Ripple edit — shift subsequent clips
        </label>
        <div style="font-size:10px;color:var(--mu2);margin-top:4px;margin-left:22px">Moves all clips after this one to fill/close the gap</div>
      </div>
    </div>
  `, () => {
    const pct     = parseFloat(document.getElementById('spd-pct').value) || 100;
    const ripple  = document.getElementById('spd-ripple')?.checked ?? true;
    const pitch   = document.getElementById('spd-pitch')?.checked ?? true;
    S.cut.clips[ci]._preservePitch = pitch;
    applyClipSpeed(ci, pct, ripple);
    notify('Speed set to '+pct+'%', '#3fb950');
  });
}
window.showSpeedDialog = showSpeedDialog;

// ── AUDIO FADE HANDLES ────────────────────────────────────────
// Draws a canvas overlay on audio clips showing:
//   • Fade-in triangle (top-left handle)
//   • Fade-out triangle (top-right handle)
//   • Gain line (horizontal, draggable up/down)
function buildAudioFadeHandles(el, c, ci){
  // Ensure clip has fade/gain state
  if(c.fadeIn  === undefined) c.fadeIn  = 0;    // seconds
  if(c.fadeOut === undefined) c.fadeOut = 0;    // seconds
  if(c.volume  === undefined) c.volume  = 1;    // 0-2 gain

  // ── Canvas for fade shape ──
  const cvs = document.createElement('canvas');
  cvs.className = 'fade-canvas';
  cvs.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2;border-radius:5px';
  el.appendChild(cvs);

  function drawFades(){
    const W = el.offsetWidth, H = el.offsetHeight;
    if(!W||!H) return;
    cvs.width = W; cvs.height = H;
    const ctx = cvs.getContext('2d');
    ctx.clearRect(0,0,W,H);

    const inPx  = Math.round((c.fadeIn  || 0) * PPS);
    const outPx = Math.round((c.fadeOut || 0) * PPS);
    const gainY = Math.round(H * (1 - Math.min(2, Math.max(0, c.volume||1)) / 2)); // 0=top, H=bottom

    // Fade-in triangle (dark overlay that tapers to 0)
    if(inPx > 2){
      ctx.beginPath();
      ctx.moveTo(0,0); ctx.lineTo(inPx,0); ctx.lineTo(0,H); ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fill();
      // Diagonal line
      ctx.beginPath(); ctx.moveTo(0,H); ctx.lineTo(inPx,0);
      ctx.strokeStyle = 'rgba(255,220,80,0.9)'; ctx.lineWidth=1.5; ctx.stroke();
    }

    // Fade-out triangle
    if(outPx > 2){
      ctx.beginPath();
      ctx.moveTo(W,0); ctx.lineTo(W-outPx,0); ctx.lineTo(W,H); ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fill();
      ctx.beginPath(); ctx.moveTo(W,H); ctx.lineTo(W-outPx,0);
      ctx.strokeStyle = 'rgba(255,220,80,0.9)'; ctx.lineWidth=1.5; ctx.stroke();
    }

    // Gain line (horizontal across clip)
    ctx.beginPath();
    ctx.moveTo(0, gainY); ctx.lineTo(W, gainY);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth=1; ctx.setLineDash([3,3]); ctx.stroke();
    ctx.setLineDash([]);
  }

  // Draw after layout
  requestAnimationFrame(drawFades);

  const clipW = () => el.offsetWidth;
  const clipH = () => el.offsetHeight;

  // ── Fade-In handle (top-left corner triangle) ──
  const fiHandle = document.createElement('div');
  fiHandle.title = 'Drag → to set Fade In';
  fiHandle.style.cssText = [
    'position:absolute','top:0','left:0',
    'width:12px','height:12px',
    'cursor:e-resize','z-index:10',
    'background:linear-gradient(135deg,rgba(255,220,80,0.9) 50%,transparent 50%)',
    'border-radius:5px 0 0 0',
  ].join(';');
  el.appendChild(fiHandle);

  // ── Fade-Out handle (top-right corner triangle) ──
  const foHandle = document.createElement('div');
  foHandle.title = 'Drag ← to set Fade Out';
  foHandle.style.cssText = [
    'position:absolute','top:0','right:0',
    'width:12px','height:12px',
    'cursor:w-resize','z-index:10',
    'background:linear-gradient(225deg,rgba(255,220,80,0.9) 50%,transparent 50%)',
    'border-radius:0 5px 0 0',
  ].join(';');
  el.appendChild(foHandle);

  // ── Gain dot (center of gain line) ──
  const gainHandle = document.createElement('div');
  gainHandle.title = 'Drag ↑↓ to adjust volume';
  gainHandle.style.cssText = [
    'position:absolute','left:50%','transform:translate(-50%,-50%)',
    'width:10px','height:10px',
    'border-radius:50%',
    'background:rgba(255,255,255,0.7)',
    'border:1.5px solid rgba(0,0,0,0.5)',
    'cursor:ns-resize','z-index:10',
    'top:' + Math.round((1 - Math.min(2, c.volume||1)/2)*100) + '%',
  ].join(';');
  el.appendChild(gainHandle);

  // ── Drag: Fade-In ──
  fiHandle.addEventListener('mousedown', e => {
    e.stopPropagation(); e.preventDefault();
    const sx = e.clientX;
    const origFi = c.fadeIn || 0;
    const onMove = mv => {
      const dx = (mv.clientX - sx) / PPS;
      c.fadeIn = Math.max(0, Math.min(c.dur * 0.9, origFi + dx));
      // Update props panel live
      const fiEl = document.getElementById('fade-in-val-' + ci);
      if(fiEl) fiEl.value = c.fadeIn.toFixed(2);
      drawFades();
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      cutSaveHistory('fade_in');
      scheduleSave();
      // Refresh props panel
      if(S.cut.sel === ci) updatePropsPanel(ci);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // ── Drag: Fade-Out ──
  foHandle.addEventListener('mousedown', e => {
    e.stopPropagation(); e.preventDefault();
    const sx = e.clientX;
    const origFo = c.fadeOut || 0;
    const onMove = mv => {
      const dx = (mv.clientX - sx) / PPS;
      c.fadeOut = Math.max(0, Math.min(c.dur * 0.9, origFo - dx));
      const foEl = document.getElementById('fade-out-val-' + ci);
      if(foEl) foEl.value = c.fadeOut.toFixed(2);
      drawFades();
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      cutSaveHistory('fade_out');
      scheduleSave();
      if(S.cut.sel === ci) updatePropsPanel(ci);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // ── Drag: Gain line ──
  gainHandle.addEventListener('mousedown', e => {
    e.stopPropagation(); e.preventDefault();
    const sy = e.clientY;
    const origVol = c.volume || 1;
    const H = el.offsetHeight;
    const onMove = mv => {
      const dy = (mv.clientY - sy) / H; // fraction of clip height
      c.volume = Math.max(0, Math.min(2, origVol - dy * 2));
      // Move handle
      gainHandle.style.top = Math.round((1 - c.volume/2)*100) + '%';
      const volEl = document.getElementById('vol-val-' + ci + '-input');
      if(volEl) volEl.value = Math.round(c.volume * 100);
      drawFades();
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      cutSaveHistory('gain');
      scheduleSave();
      if(S.cut.sel === ci) updatePropsPanel(ci);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}
window.buildAudioFadeHandles = buildAudioFadeHandles;

// ── SHAPES SUBMENU ──────────────────────────────────────────
const SHAPE_ICONS = {
  rect:    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>',
  circle:  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>',
  triangle:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12,3 22,21 2,21"/></svg>',
  star:    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>',
  line:    '<svg width="15" height="15" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><line x1="3" y1="21" x2="21" y2="3"/></svg>',
  arrow:   '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12,5 19,12 12,19"/></svg>',
};
let _pendingShapeClick = null;

function handleShapeMousedown(e){
  // Long-press (400ms) → show submenu; short click → activate tool
  _pendingShapeClick = setTimeout(()=>{ _pendingShapeClick=null; showShapeSubmenu(e); }, 400);
}
document.addEventListener('mouseup', ()=>{ if(_pendingShapeClick){ clearTimeout(_pendingShapeClick); _pendingShapeClick=null; }});

function showShapeSubmenu(e){
  e.preventDefault(); e.stopPropagation();
  document.getElementById('shape-submenu')?.remove();
  const menu = document.createElement('div');
  menu.id = 'shape-submenu';
  menu.style.cssText = 'position:fixed;background:#1a1a1a;border:0.5px solid rgba(255,255,255,0.12);border-radius:10px;padding:6px;display:grid;grid-template-columns:1fr 1fr;gap:4px;z-index:9999;box-shadow:0 8px 32px rgba(0,0,0,0.6)';
  const shapes = [
    {id:'rect',    label:'Rectangle'},
    {id:'circle',  label:'Ellipse'},
    {id:'triangle',label:'Triangle'},
    {id:'star',    label:'Star'},
    {id:'line',    label:'Line'},
    {id:'arrow',   label:'Arrow'},
  ];
  shapes.forEach(s => {
    const btn = document.createElement('div');
    btn.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 10px;border-radius:7px;cursor:pointer;color:rgba(255,255,255,0.7);font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;transition:all .1s';
    btn.innerHTML = SHAPE_ICONS[s.id] + '<span>' + s.label + '</span>';
    btn.addEventListener('mouseenter', ()=>{ btn.style.background='rgba(232,89,12,0.15)'; btn.style.color='#E8590C'; });
    btn.addEventListener('mouseleave', ()=>{ btn.style.background=''; btn.style.color='rgba(255,255,255,0.7)'; });
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      setActiveShape(s.id);
      menu.remove();
    });
    menu.appendChild(btn);
  });
  // Position near the shape button
  const btn = document.getElementById('vt-shape');
  if(btn){
    const r = btn.getBoundingClientRect();
    menu.style.left = (r.right + 6) + 'px';
    menu.style.top  = (r.top - 4)  + 'px';
  }
  document.body.appendChild(menu);
  setTimeout(()=>document.addEventListener('click',()=>menu.remove(),{once:true}),10);
}

function setActiveShape(shapeId){
  const btn = document.getElementById('vt-shape');
  if(btn){
    btn.dataset.shape = shapeId;
    const ico = btn.querySelector('#vt-shape-icon');
    if(ico) ico.outerHTML = SHAPE_ICONS[shapeId].replace('<svg','<svg id="vt-shape-icon"');
  }
  _activeShape = shapeId;
  setCutTool('shape');
}
let _activeShape = 'rect';

// ── RESIZABLE TOOLBAR SIDEBAR ────────────────────────────────
function initToolbarResize(){
  const handle = document.getElementById('tl-sidebar-resize');
  const sidebar = document.getElementById('tl-tools-sidebar');
  if(!handle || !sidebar) return;
  let dragging=false, startX=0, startW=0;
  handle.addEventListener('mousedown', e=>{
    dragging=true; startX=e.clientX; startW=sidebar.offsetWidth;
    document.body.style.cursor='ew-resize';
    e.preventDefault();
  });
  document.addEventListener('mousemove', e=>{
    if(!dragging) return;
    const newW = Math.max(36, Math.min(120, startW + (e.clientX - startX)));
    sidebar.style.width = newW + 'px';
    sidebar.classList.toggle('wide', newW >= 70);
  });
  document.addEventListener('mouseup', ()=>{ if(dragging){ dragging=false; document.body.style.cursor=''; } });
}

// ── TOOL SWITCHER ───────────────────────────────────────────
function setCutTool(tool){
  _activeTool = tool;
  document.querySelectorAll('.vt-btn').forEach(b => b.classList.toggle('active', b.dataset.tool===tool));
  // Update cursor on preview
  const screen = document.getElementById('cut-screen');
  if(screen){
    const cursors = {select:'default',text:'text',shape:'crosshair',pen:'crosshair',split:'col-resize'};
    screen.style.cursor = cursors[tool] || 'default';
  }
  // If text tool clicked — open text overlay dialog at playhead
  if(tool==='text' && window.showTextDialog){
    showTextDialog();
    setTimeout(()=>setCutTool('select'),200); // revert after
  }
  // If shape tool — open shape dialog
  if(tool==='shape' && window.showShapeDialog){
    showShapeDialog();
    setTimeout(()=>setCutTool('select'),200);
  }
}
window.setCutTool = setCutTool;

// ── PEN TOOL ENGINE ─────────────────────────────────────────
// Manages anchor points on the preview canvas for custom shapes
let _penPoints = [];   // [{x,y,cpx,cpy}] normalized 0-1
let _penActive  = false;

function initPenTool(screen){
  if(!screen || screen._penInit) return;
  screen._penInit = true;

  screen.addEventListener('click', e => {
    if(_activeTool !== 'pen') return;
    const r   = screen.getBoundingClientRect();
    const nx  = (e.clientX - r.left)  / r.width;
    const ny  = (e.clientY - r.top)   / r.height;

    if(_penPoints.length > 2 && Math.hypot(nx-_penPoints[0].x, ny-_penPoints[0].y) < 0.03){
      // Close path — create shape overlay
      _closePenPath();
      return;
    }
    _penPoints.push({x:nx, y:ny, cpx:nx, cpy:ny});
    _drawPenOverlay(screen);
  });

  screen.addEventListener('mousemove', e => {
    if(_activeTool !== 'pen' || !_penPoints.length) return;
    const r  = screen.getBoundingClientRect();
    const nx = (e.clientX - r.left)  / r.width;
    const ny = (e.clientY - r.top)   / r.height;
    _drawPenOverlay(screen, nx, ny);
  });

  screen.addEventListener('keydown', e => {
    if(e.code==='Escape' && _activeTool==='pen'){
      _penPoints = [];
      const ov = document.getElementById('pen-overlay-svg');
      if(ov) ov.remove();
    }
  });
}

function _drawPenOverlay(screen, curX, curY){
  let svg = document.getElementById('pen-overlay-svg');
  if(!svg){
    svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.id = 'pen-overlay-svg';
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:50';
    screen.appendChild(svg);
  }
  svg.innerHTML = '';
  const W = screen.clientWidth, H = screen.clientHeight;

  // Draw path
  if(_penPoints.length > 1){
    const d = _penPoints.map((p,i) =>
      i===0 ? 'M'+Math.round(p.x*W)+' '+Math.round(p.y*H)
             : 'L'+Math.round(p.x*W)+' '+Math.round(p.y*H)
    ).join(' ');
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d', d + (curX!==undefined ? ' L'+Math.round(curX*W)+' '+Math.round(curY*H) : ''));
    path.setAttribute('stroke','#E8590C');
    path.setAttribute('stroke-width','2');
    path.setAttribute('fill','none');
    path.setAttribute('stroke-dasharray','4 2');
    svg.appendChild(path);
  }

  // Draw anchor points
  _penPoints.forEach((p,i) => {
    const cx = Math.round(p.x*W), cy = Math.round(p.y*H);
    const circle = document.createElementNS('http://www.w3.org/2000/svg','circle');
    circle.setAttribute('cx', cx); circle.setAttribute('cy', cy); circle.setAttribute('r','5');
    circle.setAttribute('fill', i===0?'#3fb950':'#E8590C');
    circle.setAttribute('stroke','#fff'); circle.setAttribute('stroke-width','1.5');
    svg.appendChild(circle);
  });

  // Preview line to cursor
  if(curX !== undefined && _penPoints.length > 0){
    const last = _penPoints[_penPoints.length-1];
    const line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1',Math.round(last.x*W)); line.setAttribute('y1',Math.round(last.y*H));
    line.setAttribute('x2',Math.round(curX*W));   line.setAttribute('y2',Math.round(curY*H));
    line.setAttribute('stroke','rgba(232,89,12,0.5)'); line.setAttribute('stroke-width','1');
    svg.appendChild(line);
    // Show "close" indicator near first point
    if(_penPoints.length>2 && Math.hypot(curX-_penPoints[0].x,curY-_penPoints[0].y)<0.03){
      const cl = document.createElementNS('http://www.w3.org/2000/svg','circle');
      cl.setAttribute('cx',Math.round(_penPoints[0].x*W)); cl.setAttribute('cy',Math.round(_penPoints[0].y*H));
      cl.setAttribute('r','9'); cl.setAttribute('stroke','#3fb950'); cl.setAttribute('stroke-width','2');
      cl.setAttribute('fill','none');
      svg.appendChild(cl);
    }
  }
}

function _closePenPath(){
  if(_penPoints.length < 2) return;
  // Convert pen points to a SVG path shape overlay
  if(window.showShapeFromPen) window.showShapeFromPen(_penPoints);
  _penPoints = [];
  const svg = document.getElementById('pen-overlay-svg');
  if(svg) svg.remove();
  setCutTool('select');
}
window.initPenTool = initPenTool;

// Wire pen tool to cut-screen after buildCut
function _wirePenTool(){
  const screen = document.getElementById('cut-screen');
  if(screen) initPenTool(screen);
}

// ── KEYBOARD TOOL SHORTCUTS ──────────────────────────────────
// Wired into the global keydown handler (V=select, P=pen, T=text, R=rect)

// ── TRACK MUTE / VISIBILITY ─────────────────────────────────
function toggleTrackMute(trackIdx){
  if(!S.cut.mutedTracks) S.cut.mutedTracks={};
  S.cut.mutedTracks[trackIdx] = !S.cut.mutedTracks[trackIdx];
  const isMuted = S.cut.mutedTracks[trackIdx];
  // Apply mute to live audio elements
  S.cut.clips.filter(c=>c.track===trackIdx).forEach(c=>{
    const item=S.cut.media[c.mediaIdx];
    if(item?.url&&_audioEls[item.url]) _audioEls[item.url].muted = !!isMuted;
  });
  // Apply mute to main video element if it's on this track
  const mv=$('cut-main-vid');
  if(mv){
    const ci=parseInt(mv.dataset.clipIdx||'-1');
    if(!isNaN(ci)&&S.cut.clips[ci]?.track===trackIdx) mv.muted=!!isMuted;
  }
  // Rebuild labels to update icon state (lightweight, no full re-render)
  rebuildTrackLabels();
  cutSaveHistory('track_mute');
  notify(isMuted?'Track muted':'Track unmuted','#3fb950');
}
window.toggleTrackMute = toggleTrackMute;

function toggleTrackVisibility(trackIdx){
  if(!S.cut.hiddenTracks) S.cut.hiddenTracks={};
  S.cut.hiddenTracks[trackIdx] = !S.cut.hiddenTracks[trackIdx];
  const isHidden = S.cut.hiddenTracks[trackIdx];
  // Rebuild labels + sync preview
  rebuildTrackLabels();
  syncCutVid();
  cutSaveHistory('track_visibility');
  notify(isHidden?'Track hidden':'Track visible','#3fb950');
}
window.toggleTrackVisibility = toggleTrackVisibility;

function cutBinDragStart(e,i){S.cut._drag=i;e.dataTransfer.setData('text/plain',''+i);e.dataTransfer.effectAllowed='copy';}
function cutSelMedia(i){S.cut.selMedia=i;document.querySelectorAll('.mbin-item').forEach((el,idx)=>el.classList.toggle('sel',idx===i));}
function cutAddToTL(i) {
  const item=S.cut.media[i]; if(!item) return;
  // Smart track insertion: find lowest video track (V1 first)
  let track, startSec;
  if(item.type==='audio'){
    track = S.cut.videoTracks; // first audio track
    const ends = S.cut.clips.filter(c=>c.track===track).map(c=>c.start+c.dur);
    startSec = ends.length ? Math.max(...ends)+0.01 : 0;
  } else {
    // Find first video track (lowest index = V1) that is empty or has space at end
    track = 0;
    for(let vt=0; vt<S.cut.videoTracks; vt++){
      const clipsOnTrack = S.cut.clips.filter(c=>c.type==='video'&&c.track===vt);
      if(clipsOnTrack.length===0){ track=vt; break; } // empty track found
      track = vt; // keep going, use last tried
    }
    const ends = S.cut.clips.filter(c=>c.track===track).map(c=>c.start+c.dur);
    startSec = ends.length ? Math.max(...ends)+0.01 : 0;
  }
  S.cut.clips.push({mediaIdx:i,name:item.name,type:item.type,track,start:startSec,dur:Math.max(item.duration||5,0.5),fileStart:0,color:item.type==='video'?'rgba(88,166,255,0.8)':item.type==='audio'?'rgba(210,153,34,0.8)':'rgba(63,185,80,0.8)'});
  // If video file, also add linked audio clip on first audio track
  if(item.type==='video'&&item.hasAudio!==false){
    const audioTrackIdx=S.cut.videoTracks; // first audio track
    S.cut.clips.push({
      mediaIdx:i,
      name:item.name+' [Audio]',
      type:'audio',
      track:audioTrackIdx,
      start:startSec,
      dur:Math.max(item.duration||5,0.5),
      fileStart:0,
      linkedToVideo:true,
      color:'rgba(210,153,34,0.6)'
    });
  }
  cutSaveHistory('add_clip');
  renderCutTimeline(); notify(item.name+' added','#3fb950'); scheduleSave();
  // Ensure viewport frame has correct dimensions, then initialize video
  applyCanvasAspectRatio(S.proj.w||1920, S.proj.h||1080);
  const _startInit = (attempts) => {
    const delay = attempts === 5 ? 80 : 250;
    setTimeout(() => {
      setupPlayheadDrag();
      syncCutVid();
      const mv2 = document.getElementById('cut-main-vid');
      if(mv2 && mv2.readyState < 2 && attempts > 0){
        _startInit(attempts - 1);
      }
    }, delay);
  };
  _startInit(5);
}

function renderCutTimeline() {
  const totalTk=S.cut.videoTracks+S.cut.audioTracks;
  // Update timeline shell height
  const shell=$('cut-tl');
  // Height = header(38) + ruler(18) + tracks*30 + 4px padding
  if(shell) shell.style.height=Math.max(120,(38+18+totalTk*30+4))+'px';

  // Always rebuild track rows completely to ensure correct order
  const rows=$('tl-rows');
  if(rows){
    const ph=document.getElementById('cut-ph');
    // Remove all existing track rows
    rows.querySelectorAll('.clip-track-row').forEach(r=>r.remove());
    // Recreate in correct order: V1,V2,...Vn, A1,A2,...An
    for(let t=0;t<totalTk;t++){
      const row=document.createElement('div');
      row.id='tl-row-'+t;
      row.className='clip-track-row '+(t<S.cut.videoTracks?'video-row':'audio-row');
      row.setAttribute('data-track',t);
      const _ce0=S.cut.clips.length?Math.max(...S.cut.clips.map(c=>c.start+c.dur)):0;
      row.style.width=Math.max(S.proj.dur,_ce0+5)*PPS+'px';
      if(ph) rows.insertBefore(row,ph); else rows.appendChild(row);
    }
  }

  for (let t=0; t<totalTk; t++) {
    const row=$('tl-row-'+t); if(!row) continue;
    const _ce1=S.cut.clips.length?Math.max(...S.cut.clips.map(c=>c.start+c.dur)):0;
    row.style.width=Math.max(S.proj.dur,_ce1+5)*PPS+'px';
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
      S.cut.clips.push({mediaIdx:i,name:item.name,type:item.type,track:t,start,dur:Math.max(item.duration||5,0.5),fileStart:0,color:item.type==='video'?'rgba(88,166,255,0.8)':item.type==='audio'?'rgba(210,153,34,0.8)':'rgba(63,185,80,0.8)'});
      // Auto-add audio track for video clips
      if(item.type==='video'&&item.hasAudio!==false){
        const audioTrackIdx=S.cut.videoTracks;
        S.cut.clips.push({mediaIdx:i,name:item.name+' [Audio]',type:'audio',track:audioTrackIdx,start,dur:Math.max(item.duration||5,0.5),fileStart:0,linkedToVideo:true,color:'rgba(210,153,34,0.6)'});
      }
      renderCutTimeline();notify(item.name+' added','#3fb950');scheduleSave();
    };
    // remove old clips
    Array.from(row.querySelectorAll('.tl-clip')).forEach(el=>el.remove());
    S.cut.clips.filter(c=>c.track===t).forEach((c,_,arr)=>{
      const ci=S.cut.clips.indexOf(c);
      const el=document.createElement('div');
      el.className='tl-clip'+(S.cut.sel===ci?' selected':'');
      // Width = duration * pixels-per-second (strict 1:1 with ruler)
      const clipW = Math.max(8, Math.round(c.dur * PPS));
      const clipL = Math.round(c.start * PPS);
      el.style.left       = clipL + 'px';
      el.style.width      = clipW + 'px';
      el.style.background = c.color;
      el.setAttribute('data-ci', ci);
      // fileStart stored on element for waveform offset
      el.dataset.fileStart = String(c.fileStart || 0);
      el.dataset.dur       = String(c.dur);
      el.innerHTML = '<div class="clip-resize-l"></div>'
        + '<span>' + c.name.replace(/\.[^.]+$/, '').substring(0, 22) + '</span>'
        + '<div class="clip-resize-r"></div>';
      // ── Effect bars ──
      const clipEffects = S.cut.effects[ci]||[];
      clipEffects.forEach((ef,efIdx) => {
        const eff = CUT_EFFECTS[ef.i];
        if(!eff) return;
        const effectStartPx = Math.round((ef.startOffset||0) * PPS);
        const effectDurPx   = Math.max(6, Math.round((ef.effectDur||c.dur) * PPS));
        const bar = document.createElement('div');
        bar.className = 'effect-bar';
        bar.dataset.ci = String(ci);
        bar.dataset.efIdx = String(efIdx);
        bar.style.cssText = [
          `left:${effectStartPx}px`,
          `width:${effectDurPx}px`,
          `background:${eff.color||'#888'}cc`,
          `position:absolute`,
          `bottom:2px`,
          `height:5px`,
          `border-radius:3px`,
          `z-index:4`,
          `cursor:pointer`,
          `box-shadow:0 0 0 1px rgba(0,0,0,0.3)`,
          `display:flex`,
          `align-items:center`,
          `overflow:hidden`,
        ].join(';');
        bar.title = eff.name + ' — click to select, drag edges to trim';

        // Left drag handle
        const lh = document.createElement('div');
        lh.style.cssText = 'width:8px;height:100%;cursor:ew-resize;background:rgba(255,255,255,0.35);flex-shrink:0;border-radius:3px 0 0 3px;';
        bar.appendChild(lh);

        // Label
        const lbl = document.createElement('span');
        lbl.style.cssText = 'font-size:7px;font-weight:700;color:#fff;padding:0 2px;pointer-events:none;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;flex:1';
        lbl.textContent = eff.name;
        bar.appendChild(lbl);

        // Right drag handle
        const rh = document.createElement('div');
        rh.style.cssText = 'width:8px;height:100%;cursor:ew-resize;background:rgba(255,255,255,0.35);flex-shrink:0;border-radius:0 3px 3px 0;';
        bar.appendChild(rh);

        // Click — select and show in props
        bar.addEventListener('click', e => {
          e.stopPropagation();
          S.cut.sel = ci;
          const body = document.getElementById('cut-props-body');
          if(body){
            const rangeRow = eff.type==='range'
              ? '<div class="prop-section">Settings</div>'
                + '<div class="prop-row"><span class="prop-label">'+eff.name+'</span>'
                + '<input type="range" min="'+(eff.min||0)+'" max="'+(eff.max||200)+'" value="'+(ef.v||eff.default||100)+'"'
                + ' style="flex:1;accent-color:#E8590C"'
                + ' oninput="S.cut.effects['+ci+']['+efIdx+'].v=parseFloat(this.value);applyVideoEffects();">'
                + '</div>'
              : '';
            body.innerHTML =
              '<div class="prop-section">'+eff.name+' Effect</div>'
              + '<div class="prop-row"><span class="prop-label">Clip</span><span class="prop-val">'+c.name.substring(0,14)+'</span></div>'
              + '<div class="prop-section">Timing on Clip</div>'
              + '<div class="prop-row"><span class="prop-label">Start</span>'
              + '<input type="number" value="'+(ef.startOffset||0).toFixed(2)+'" step="0.1" min="0"'
              + ' style="width:62px;background:#161616;border:0.5px solid rgba(255,255,255,0.1);border-radius:5px;color:var(--tx);font-size:11px;padding:2px 5px;outline:none"'
              + ' onchange="S.cut.effects['+ci+']['+efIdx+'].startOffset=Math.max(0,parseFloat(this.value));renderCutTimeline()">'
              + '</div>'
              + '<div class="prop-row"><span class="prop-label">Duration</span>'
              + '<input type="number" value="'+(ef.effectDur||c.dur).toFixed(2)+'" step="0.1" min="0.1"'
              + ' style="width:62px;background:#161616;border:0.5px solid rgba(255,255,255,0.1);border-radius:5px;color:var(--tx);font-size:11px;padding:2px 5px;outline:none"'
              + ' onchange="S.cut.effects['+ci+']['+efIdx+'].effectDur=Math.max(0.1,parseFloat(this.value));renderCutTimeline()">'
              + '</div>'
              + rangeRow
              + '<div class="prop-section">Actions</div>'
              + '<div style="display:flex;gap:4px;padding:2px 0">'
              + '<button onclick="cutSaveHistory(&quot;remove_effect&quot;);S.cut.effects['+ci+'].splice('+efIdx+',1);renderCutTimeline();notify(&quot;Effect removed&quot;)"'
              + ' style="flex:1;padding:5px;background:rgba(255,69,58,0.1);border:0.5px solid rgba(255,69,58,0.2);border-radius:6px;color:#ff453a;font-size:10px;cursor:pointer;font-family:DM Sans,sans-serif">Delete Effect</button>'
              + '</div>';
          }
        });

        // Drag left handle (trim start)
        lh.addEventListener('mousedown', e => {
          e.stopPropagation(); e.preventDefault();
          const sx = e.clientX;
          const origStart = ef.startOffset || 0;
          const origDur   = ef.effectDur || c.dur;
          const onMove = mv => {
            const dx = (mv.clientX - sx) / PPS;
            const ns = Math.max(0, Math.min(origStart + dx, origStart + origDur - 0.1));
            ef.startOffset = ns;
            ef.effectDur   = Math.max(0.1, origDur - (ns - origStart));
            bar.style.left  = Math.round(ef.startOffset * PPS) + 'px';
            bar.style.width = Math.max(6, Math.round(ef.effectDur * PPS)) + 'px';
          };
          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            cutSaveHistory('effect_trim');
            renderCutTimeline();
            syncCutVid(); // immediately apply new timing
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });

        // Drag right handle (trim end)
        rh.addEventListener('mousedown', e => {
          e.stopPropagation(); e.preventDefault();
          const sx = e.clientX;
          const origDur = ef.effectDur || c.dur;
          const onMove = mv => {
            const dx = (mv.clientX - sx) / PPS;
            ef.effectDur = Math.max(0.1, origDur + dx);
            bar.style.width = Math.max(6, Math.round(ef.effectDur * PPS)) + 'px';
          };
          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            cutSaveHistory('effect_trim');
            renderCutTimeline();
            syncCutVid(); // immediately apply new timing
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });

        el.appendChild(bar);
      });
      // Use CAPTURE phase so this fires before any child stopPropagation
      el.addEventListener('click', e => {
        // Don't trigger on resize handles or effect bar drags
        if(e.target.classList.contains('clip-resize-l')) return;
        if(e.target.classList.contains('clip-resize-r')) return;
        if(e._effectBarHandled) return; // effect bar already handled
        e.stopPropagation();
        _selectClip(ci);
      }, true); // capture:true — fires before children
      el.addEventListener('contextmenu',e=>{e.stopPropagation();clipContextMenu(e,ci);});
      el.addEventListener('mousedown', e => {
        if(e.target.classList.contains('clip-resize-l')||e.target.classList.contains('clip-resize-r')) return;
        // Select immediately on mousedown (before any drag), capture phase
        _selectClip(ci);
        clipMoveStart(e, ci);
      }, true); // capture:true
      el.querySelector('.clip-resize-l').addEventListener('mousedown',e=>{e.stopPropagation();clipResizeStart(e,ci,'l');});
      el.querySelector('.clip-resize-r').addEventListener('mousedown',e=>{e.stopPropagation();clipResizeStart(e,ci,'r');});
      // Waveform for audio clips (with fileStart offset for split clips)
      if(c.type==='audio'&&S.cut.media[c.mediaIdx]?.url&&window.generateWaveformForClip){
        const _url=S.cut.media[c.mediaIdx].url;
        const _fs=c.fileStart||0;
        const _dur=c.dur;
        setTimeout(()=>{ if(el.isConnected) generateWaveformForClip(el, _url, _fs, _dur); },100);
      }
      // Fade handles + gain line for audio clips
      if(c.type==='audio'||c.linkedToVideo){
        buildAudioFadeHandles(el, c, ci);
      }
      row.appendChild(el);
    });
  }
  updateCutPH();
}

// ── CLIP SELECTION HELPER ────────────────────────────────────
// Central function called from click, mousedown, context menu
function _selectClip(ci){
  if(S.cut.sel === ci) return; // already selected — no work
  S.cut.sel = ci;
  window._activeEditId = null;
  // Clear overlay selection
  if(window.removeOverlayHandles) removeOverlayHandles();
  document.querySelectorAll('.tl-overlay-clip').forEach(c =>
    c.style.border = '1px solid rgba(255,255,255,0.3)'
  );
  // Update visual selection on all clip elements (no DOM rebuild)
  document.querySelectorAll('.tl-clip:not(.tl-overlay-clip)').forEach(c =>
    c.classList.toggle('selected', c.dataset.ci === String(ci))
  );
  // Populate properties panel
  updatePropsPanel(ci);
  // Refresh effects panel
  setTimeout(refreshEffectsPanel, 50);
}
window._selectClip = _selectClip;

let _mv=null;
function clipMoveStart(e,ci){
  // Block move if a resize is in progress (prevents accidental moves when grabbing handles)
  if(S.cut._isResizing) return;

  const el = e.currentTarget || e.target.closest('.tl-clip');

  if(e.altKey){
    // ── ALT + DRAG: duplicate clip and drag the copy ──
    e.preventDefault();
    cutSaveHistory('alt_duplicate');

    // Deep-clone clip
    const orig = S.cut.clips[ci];
    const dup  = JSON.parse(JSON.stringify(orig));
    // Deep-clone effects
    if(S.cut.effects[ci]){
      const newCi = S.cut.clips.length;
      S.cut.effects[newCi] = JSON.parse(JSON.stringify(S.cut.effects[ci]));
    }
    S.cut.clips.push(dup);
    const dupCi = S.cut.clips.length - 1;

    // Ghost: dim the ORIGINAL to show it's staying put
    if(el){ el.style.opacity = '0.4'; }

    // Change cursor to show "copy" mode
    document.body.style.cursor = 'copy';

    // Start dragging the NEW duplicate
    _mv = {
      ci:       dupCi,
      sx:       e.clientX,
      sy:       e.clientY,
      origStart:dup.start,
      origTrack:dup.track,
      el:       null,       // will be found after first render
      isAltDup: true,
      origEl:   el,
      origCi:   ci,
    };

    // Immediately render so the dup exists in the DOM
    renderCutTimeline();

    document.addEventListener('mousemove', clipMoveMove);
    document.addEventListener('mouseup',   clipMoveUp);
    return;
  }

  // ── Normal drag: move the clip ──
  _mv = {
    ci,
    sx:       e.clientX,
    sy:       e.clientY,
    origStart:S.cut.clips[ci].start,
    origTrack:S.cut.clips[ci].track,
    el:       el,
  };
  if(el){ el.style.opacity='0.7'; el.style.zIndex='100'; }
  document.addEventListener('mousemove', clipMoveMove);
  document.addEventListener('mouseup',   clipMoveUp);
}
function clipMoveMove(e){
  if(!_mv) return;
  // For alt-dup: lazy-find the new element on first mouse move
  if(_mv.isAltDup && !_mv.el){
    _mv.el = document.querySelector('[data-ci="'+_mv.ci+'"]');
    if(_mv.el){ _mv.el.style.opacity='0.85'; _mv.el.style.zIndex='100'; _mv.el.style.outline='1.5px dashed rgba(255,220,80,0.8)'; }
  }
  const dx=e.clientX-_mv.sx;
  const dy=e.clientY-_mv.sy;
  let newStart=Math.max(0,_mv.origStart+dx/PPS);
  const _clipDur=S.cut.clips[_mv.ci].dur;
  // Snap start edge
  const _sS=window.getSnapPoint?window.getSnapPoint(newStart*PPS,_mv.ci,'start'):null;
  // Snap end edge
  const _sE=window.getSnapPoint?window.getSnapPoint((newStart+_clipDur)*PPS,_mv.ci,'end'):null;
  if(_sS!==null){newStart=Math.max(0,_sS);window.showSnapLine&&showSnapLine(_sS);}
  else if(_sE!==null){newStart=Math.max(0,_sE-_clipDur);window.showSnapLine&&showSnapLine(_sE);}
  else{window.hideSnapLine&&hideSnapLine();}
  S.cut.clips[_mv.ci].start=newStart;
  // Vertical: change track (each track is 30px tall)
  const totalTracks=S.cut.videoTracks+S.cut.audioTracks;
  const trackDelta=Math.round(dy/30);
  const newTrack=Math.max(0,Math.min(totalTracks-1,_mv.origTrack+trackDelta));
  S.cut.clips[_mv.ci].track=newTrack;
  // Update color based on track type
  const isAudioTrack=newTrack>=S.cut.videoTracks;
  if(isAudioTrack&&S.cut.clips[_mv.ci].type!=='audio'){
    S.cut.clips[_mv.ci].color='rgba(210,153,34,0.8)';
  } else if(!isAudioTrack){
    const orig=S.cut.clips[_mv.ci];
    orig.color=orig.type==='image'?'rgba(63,185,80,0.8)':'rgba(88,166,255,0.8)';
  }
  renderCutTimeline();
}
function clipMoveUp(){
  if(!_mv) return;
  // Restore cursor
  document.body.style.cursor = '';

  if(_mv.isAltDup){
    // Restore original clip opacity
    if(_mv.origEl){ _mv.origEl.style.opacity=''; }
    else {
      const oe=document.querySelector('[data-ci="'+_mv.origCi+'"]');
      if(oe) oe.style.opacity='';
    }
    // Select the new duplicate
    S.cut.sel = _mv.ci;
  }

  const el = document.querySelector('[data-ci="'+_mv.ci+'"]');
  if(el){ el.style.opacity=''; el.style.zIndex=''; }
  const wasAltDup = _mv?.isAltDup;
  _mv = null;
  window.hideSnapLine&&hideSnapLine();
  document.removeEventListener('mousemove', clipMoveMove);
  document.removeEventListener('mouseup',   clipMoveUp);
  cutSaveHistory(wasAltDup ? 'alt_duplicate_placed' : 'move');
  renderCutTimeline();
  scheduleSave();
}
let _rz=null;
function clipResizeStart(e,ci,edge){
  S.cut._isResizing = true; // global flag — blocks clip move while resizing
  _rz={ci,edge,sx:e.clientX,origDur:S.cut.clips[ci].dur,origStart:S.cut.clips[ci].start};
  document.addEventListener('mousemove',clipRzMove);
  document.addEventListener('mouseup',clipRzUp);
}
function clipRzMove(e){
  if(!_rz) return;
  const dx = (e.clientX-_rz.sx)/PPS;
  const c  = S.cut.clips[_rz.ci];
  if(_rz.edge==='r'){
    // Right edge: snap the end position
    let newEnd = _rz.origStart + Math.max(0.2, _rz.origDur + dx);
    const snappedEnd = window.getSnapPoint ? window.getSnapPoint(newEnd*PPS, _rz.ci, 'end') : null;
    if(snappedEnd!==null){ newEnd=snappedEnd; window.showSnapLine&&showSnapLine(snappedEnd); }
    else { window.hideSnapLine&&hideSnapLine(); }
    c.dur = Math.max(0.2, newEnd - c.start);
  } else {
    // Left edge: snap the start position
    let newStart = Math.max(0, _rz.origStart + dx);
    const snappedStart = window.getSnapPoint ? window.getSnapPoint(newStart*PPS, _rz.ci, 'start') : null;
    if(snappedStart!==null){ newStart=snappedStart; window.showSnapLine&&showSnapLine(snappedStart); }
    else { window.hideSnapLine&&hideSnapLine(); }
    const nd = Math.max(0.2, (_rz.origStart + _rz.origDur) - newStart);
    c.start = newStart;
    c.dur   = nd;
  }
  renderCutTimeline();
}
function clipRzUp(){
  S.cut._isResizing=false; // release resize lock
  _rz=null;
  window.hideSnapLine&&hideSnapLine();
  document.removeEventListener('mousemove',clipRzMove);
  document.removeEventListener('mouseup',clipRzUp);
  cutSaveHistory('trim');
  scheduleSave();
}

// Refresh effects panel when clip selected
function refreshEffectsPanel(){
  const p=$('cut-p-effects');
  if(p&&$('cut-tab-effects')?.classList.contains('on')) p.innerHTML=cutEffectsHTML();
  applyVideoEffects();
}

function cutSplit(){
  const ph=S.cut.ph; // current playhead position in seconds

  // Find clip under playhead — check ALL clips, prefer selected one
  let ci=S.cut.sel;
  const clipAtPH=S.cut.clips.findIndex(c=>ph>c.start&&ph<c.start+c.dur);

  if(clipAtPH<0){notify('Place playhead on a clip to split','#E31837');return;}

  // If selected clip is under playhead use it, otherwise use clip at playhead
  if(ci===null||ci===undefined||!(ph>S.cut.clips[ci]?.start&&ph<S.cut.clips[ci]?.start+S.cut.clips[ci]?.dur)){
    ci=clipAtPH;
    S.cut.sel=ci;
  }

  const c=S.cut.clips[ci];
  // Double check
  if(!c||ph<=c.start||ph>=c.start+c.dur){notify('Playhead must be on a clip','#E31837');return;}
  cutSaveHistory('split'); // snapshot before split

  // Split: both halves stay on the SAME track
  const origStart = c.start;
  const origEnd   = origStart + c.dur;
  const splitFileOffset = ph - origStart;

  // Left part: shorten original in place
  c.dur = ph - origStart;

  // Right part: same track, starts at split point
  const c2 = {
    ...c,
    start: ph,
    dur:   origEnd - ph,
    fileStart: (c.fileStart||0) + splitFileOffset,
    effects: {}
  };
  S.cut.clips.push(c2);

  // Only split the selected clip — don't auto-split linked audio
  // User can select audio clip separately to split it

  rebuildTrackLabels();
  renderCutTimeline();
  setupPlayheadDrag();
  notify('Split at '+fmtTC(ph),'#3fb950');
}

function makeTrackIcon(isVideo, trackIdx){
  const isMuted  = S.cut.mutedTracks?.[trackIdx];
  const isHidden = S.cut.hiddenTracks?.[trackIdx];
  const btn = document.createElement('button');
  btn.className = 'tl-track-icon' + (isMuted||isHidden?' tl-track-off':'');
  btn.title = isVideo ? (isHidden?'Show track':'Hide track') : (isMuted?'Unmute track':'Mute track');
  if(isVideo){
    btn.innerHTML = isHidden
      ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22"/></svg>'
      : '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    btn.addEventListener('click', ()=>toggleTrackVisibility(trackIdx));
  } else {
    btn.innerHTML = isMuted
      ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>'
      : '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/></svg>';
    btn.addEventListener('click', ()=>toggleTrackMute(trackIdx));
  }
  return btn;
}

function rebuildTrackLabels(){
  const labels=$('tl-track-labels'); if(!labels) return;
  const totalTracks = S.cut.videoTracks + S.cut.audioTracks;
  labels.innerHTML='';

  for(let v=S.cut.videoTracks; v>=1; v--){
    const trackIdx=v-1;
    const d=document.createElement('div');
    d.className='track-label video-track'+(S.cut.hiddenTracks?.[trackIdx]?' track-label-off':'');
    d.style.cssText='height:30px;min-height:30px;box-sizing:border-box;cursor:context-menu;display:flex;align-items:center;gap:4px;padding:0 4px';
    const name=document.createElement('span');
    name.style.cssText='flex:1;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'+(S.cut.hiddenTracks?.[trackIdx]?'opacity:0.4':'');
    name.textContent='V'+v+' (Video)';
    d.appendChild(name);
    d.appendChild(makeTrackIcon(true,trackIdx));
    d.addEventListener('contextmenu',e=>trackLabelContextMenu(e,trackIdx));
    labels.appendChild(d);
  }
  for(let a=1; a<=S.cut.audioTracks; a++){
    const trackIdx=S.cut.videoTracks+(a-1);
    const d=document.createElement('div');
    d.className='track-label audio-track'+(S.cut.mutedTracks?.[trackIdx]?' track-label-off':'');
    d.style.cssText='height:30px;min-height:30px;box-sizing:border-box;cursor:context-menu;display:flex;align-items:center;gap:4px;padding:0 4px';
    const name=document.createElement('span');
    name.style.cssText='flex:1;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'+(S.cut.mutedTracks?.[trackIdx]?'opacity:0.4':'');
    name.textContent='A'+a+' (Audio)';
    d.appendChild(name);
    d.appendChild(makeTrackIcon(false,trackIdx));
    d.addEventListener('contextmenu',e=>trackLabelContextMenu(e,trackIdx));
    labels.appendChild(d);
  }

  // ── Rebuild clip rows in matching visual order ──
  const rows=$('tl-rows'); if(!rows) return;
  const phEl=document.getElementById('cut-ph');
  const _contentEnd = S.cut.clips.length ? Math.max(...S.cut.clips.map(c=>c.start+c.dur)) : 0;
  const _tlWidth = Math.max(S.proj.dur, _contentEnd + 2) * PPS;

  rows.querySelectorAll('.clip-track-row').forEach(r=>r.remove());

  // Video rows in descending order (highest index first = top)
  for(let v=S.cut.videoTracks; v>=1; v--){
    const t=v-1; // internal track index
    const row=document.createElement('div');
    row.id='tl-row-'+t;
    row.className='clip-track-row video-row';
    row.setAttribute('data-track',String(t));
    row.style.cssText='height:30px;min-height:30px;box-sizing:border-box;width:'+_tlWidth+'px';
    if(phEl) rows.insertBefore(row,phEl); else rows.appendChild(row);
  }
  // Audio rows in ascending order
  for(let a=1; a<=S.cut.audioTracks; a++){
    const t=S.cut.videoTracks+(a-1); // internal track index
    const row=document.createElement('div');
    row.id='tl-row-'+t;
    row.className='clip-track-row audio-row';
    row.setAttribute('data-track',String(t));
    row.style.cssText='height:30px;min-height:30px;box-sizing:border-box;width:'+_tlWidth+'px';
    if(phEl) rows.insertBefore(row,phEl); else rows.appendChild(row);
  }

  // Update timeline height to fit all tracks exactly
  const shell=$('cut-tl');
  if(shell) shell.style.height=Math.max(120,(38+18+totalTracks*30+4))+'px';
}
// ── CUT UNDO / REDO ──
function cutSaveHistory(label) {
  // Deep-clone to prevent future mutations affecting history entries
  const clips    = JSON.parse(JSON.stringify(S.cut.clips));
  const effects  = JSON.parse(JSON.stringify(S.cut.effects));
  const overlays = (window._overlays||[]).map(o => {
    const {_img, ...rest} = o;
    return JSON.parse(JSON.stringify(rest));
  });
  const state = {
    clips, effects, overlays,
    videoTracks: S.cut.videoTracks,
    audioTracks: S.cut.audioTracks,
    _t: Date.now() // timestamp makes every entry unique by default
  };
  const snap = JSON.stringify(state);

  // Drop any future history (user branched)
  S.cut._hist = S.cut._hist.slice(0, S.cut._histIdx + 1);

  // Smart dedup: skip only if the actual DATA (not timestamp) is identical to previous
  if (S.cut._hist.length > 0) {
    const prev = JSON.parse(S.cut._hist[S.cut._hist.length - 1]);
    const sameClips    = JSON.stringify(prev.clips)    === JSON.stringify(clips);
    const sameEffects  = JSON.stringify(prev.effects)  === JSON.stringify(effects);
    const sameOverlays = JSON.stringify(prev.overlays) === JSON.stringify(overlays);
    const sameTracks   = prev.videoTracks === S.cut.videoTracks && prev.audioTracks === S.cut.audioTracks;
    if (sameClips && sameEffects && sameOverlays && sameTracks) return; // no real change
  }

  S.cut._hist.push(snap);
  if (S.cut._hist.length > 100) S.cut._hist.shift();
  S.cut._histIdx = S.cut._hist.length - 1;
}

function cutUndo(){
  if(S.cut._histIdx <= 0){ notify('Nothing to undo','#E31837'); return; }
  S.cut._histIdx--;
  const snap = JSON.parse(S.cut._hist[S.cut._histIdx]);
  S.cut.clips = snap.clips;
  S.cut.videoTracks = snap.videoTracks;
  S.cut.audioTracks = snap.audioTracks;
  S.cut.effects = snap.effects;
  if(snap.overlays) window._overlays = snap.overlays;
  S.cut.sel = null;
  rebuildTrackLabels();
  renderCutTimeline();
  if(window.renderOverlayTimeline) renderOverlayTimeline();
  syncCutVid();
  notify('Undo ↩','#58a6ff');
}

function cutRedo(){
  if(S.cut._histIdx >= S.cut._hist.length - 1){ notify('Nothing to redo','#E31837'); return; }
  S.cut._histIdx++;
  const snap = JSON.parse(S.cut._hist[S.cut._histIdx]);
  S.cut.clips = snap.clips;
  S.cut.videoTracks = snap.videoTracks;
  S.cut.audioTracks = snap.audioTracks;
  S.cut.effects = snap.effects;
  if(snap.overlays) window._overlays = snap.overlays;
  S.cut.sel = null;
  rebuildTrackLabels();
  renderCutTimeline();
  if(window.renderOverlayTimeline) renderOverlayTimeline();
  syncCutVid();
  notify('Redo ↪','#58a6ff');
}

function cutDuplicate(ciOverride){
  // Accept explicit clip index (from props panel button) or use current selection
  const ci = (ciOverride !== undefined && ciOverride !== null) ? ciOverride : S.cut.sel;
  if(ci === null || ci === undefined || !S.cut.clips[ci]){
    notify('Select a clip first', '#E31837');
    return;
  }
  cutSaveHistory('duplicate');
  const c = S.cut.clips[ci];

  // ── Deep-clone all clip properties ──
  const dup = JSON.parse(JSON.stringify(c));

  // Place immediately after original on the same track
  dup.start = c.start + c.dur;

  // ── Clone effects (stored by clip index, not on clip object) ──
  const newCi = S.cut.clips.length;
  if(S.cut.effects[ci] && S.cut.effects[ci].length > 0){
    S.cut.effects[newCi] = JSON.parse(JSON.stringify(S.cut.effects[ci]));
  }

  S.cut.clips.push(dup);
  S.cut.sel = newCi;

  renderCutTimeline();
  // Also update props panel to show new clip
  setTimeout(() => updatePropsPanel(newCi), 50);
  notify('Clip duplicated (Ctrl+Z to undo)', '#3fb950');
  scheduleSave();
}

// ── UNIFIED DELETE: handles clips AND overlays ──────────────
function deleteOverlay(id){
  if(!id) return;
  cutSaveHistory('delete_overlay');
  window._overlays = (window._overlays||[]).filter(o => o.id !== id);
  window._activeEditId = null; // clear global selection
  if(window.removeOverlayHandles) removeOverlayHandles();
  if(window.renderOverlayTimeline) renderOverlayTimeline();
  if(window.syncCutVid) syncCutVid();
  if(window.updateOverlayProps) updateOverlayProps(null);
  notify('Overlay deleted', '#E31837');
}
window.deleteOverlay = deleteOverlay;

function deleteSelected(){
  if(window._activeEditId){
    // Overlay is selected — delete it
    deleteOverlay(window._activeEditId);
  } else if(S.cut.sel !== null && S.cut.sel !== undefined){
    // Clip is selected — delete it
    cutDelete();
  } else {
    notify('Select a clip or overlay first', '#E31837');
  }
}
window.deleteSelected = deleteSelected;

function cutDelete(){
  const ci=S.cut.sel;
  if(ci===null||ci===undefined){notify('Select a clip first','#E31837');return;}
  const c=S.cut.clips[ci];
  cutSaveHistory('delete_clip'); // snapshot before delete
  S.cut.clips.splice(ci,1);
  // Also delete linked audio
  if(c.type==='video'){
    const li=S.cut.clips.findIndex(a=>a.linkedToVideo&&a.mediaIdx===c.mediaIdx&&Math.abs(a.start-c.start)<0.5);
    if(li>=0) S.cut.clips.splice(li,1);
  }
  S.cut.sel=null;
  stopAudioPlayback();
  renderCutTimeline();
  // Re-sync mute state after deletion (un-mute video if no standalone audio left)
  setTimeout(()=>{ _syncVideoMute(); },50);
  notify('Clip deleted');
  scheduleSave();
}
function cutNewSeq(){S.cut={...S.cut,clips:[],ph:0,playing:false,sel:null};buildCut();notify('New sequence');}

function cutAddTrack(type){
  type=type||'video';
  if(type==='video'){
    // New video track = next highest index, renders at top visually (no clip shifting)
    S.cut.videoTracks++;
  } else {
    // New audio track = next highest audio index, renders at bottom
    S.cut.audioTracks++;
  }
  cutSaveHistory('add_track');
  rebuildTrackLabels();
  renderCutTimeline();
  if(window.renderOverlayTimeline) renderOverlayTimeline();
  notify((type==='video'?'Video':'Audio')+' track added','#3fb950');
}
function cutSeek(s){
  const maxT = Math.max(S.proj.dur, S.cut.clips.length ? Math.max(...S.cut.clips.map(c=>c.start+c.dur)) : 0);
  const newPh = Math.max(0, Math.min(maxT, s));
  // If scrubbing back before a freeze, allow it to play again
  _playedFreezes.forEach(id => {
    const ov = window._overlays && window._overlays.find(o=>o.id===id);
    if(ov && newPh < ov.endTime) _playedFreezes.delete(id);
  });
  S.cut.ph = newPh;
  updateCutPH();
}

function updateCutPH(){
  const ph=$('cut-ph');
  if(!ph) return;
  const leftPx = Math.round(S.cut.ph * PPS);
  ph.style.left = leftPx + 'px';
  // Auto-scroll timeline to keep playhead visible during playback
  const scroll = $('tl-scroll');
  if(scroll && S.cut.playing){
    const viewLeft  = scroll.scrollLeft;
    const viewRight = scroll.scrollLeft + scroll.clientWidth;
    const margin    = scroll.clientWidth * 0.15; // 15% margin from edges
    if(leftPx > viewRight - margin){
      scroll.scrollLeft = leftPx - margin;
    } else if(leftPx < viewLeft + margin && scroll.scrollLeft > 0){
      scroll.scrollLeft = Math.max(0, leftPx - margin);
    }
  }
  const tc=fmtFull(S.cut.ph,S.proj.fps);
  const a=$('cut-pv-tc');if(a)a.textContent=tc;
  const b=$('cut-tl-tc');if(b)b.textContent=tc;
  // Always sync video frame when scrubbing (even when paused)
  if(!S.cut.playing) setTimeout(syncCutVid, 20);
}

let _cutTick=null;
let _activeTool='select'; // select | pen | text | shape
let _freezeActive=false;       // true while a freeze overlay is playing
// Offscreen canvas cache for freeze frames (overlay.id → offscreen canvas)
const _freezeFrameCache = new Map();
function cacheFreezeFrame(freezeId, canvas){
  if(_freezeFrameCache.has(freezeId)) return;
  const off=document.createElement('canvas');
  off.width=canvas.width; off.height=canvas.height;
  off.getContext('2d').drawImage(canvas,0,0);
  _freezeFrameCache.set(freezeId, off);
}
function drawFreezeFrame(freezeId, ctx, W, H){
  const off=_freezeFrameCache.get(freezeId);
  if(!off) return false;
  try{ ctx.drawImage(off,0,0,W,H); return true; }catch(e){ return false; }
}
window._freezeFrameCache = _freezeFrameCache;
window.cacheFreezeFrame  = cacheFreezeFrame;
window.drawFreezeFrame   = drawFreezeFrame;
let _freezeLastTime=null;      // timestamp of last RAF frame for freeze advancement
let _freezeStartPh=null;       // timeline ph at the moment freeze started
let _audioOnlyLastTime=null;   // for audio-only clock-driven playback
const _playedFreezes=new Set();// freeze overlay ids already played — skip re-triggering
let _justExitedFreeze=false;   // flag to resync video after freeze ends
let _freezeExitTime=0;         // timestamp of freeze exit — skip canvas for 500ms after
let _freezeSavedVideoTime=0;   // video.currentTime saved when freeze started
function cutTogglePlay(){
  // Only clear played freezes when starting from near the beginning
  if(!S.cut.playing && S.cut.ph < 0.5) _playedFreezes.clear();
  S.cut.playing=!S.cut.playing;
  const pp=$('cut-play-path'),tp=$('cut-tl-path');
  if(S.cut.playing){
    if(pp)pp.setAttribute('d','M6 19h4V5H6v14zm8-14v14h4V5h-4z');
    if(tp)tp.setAttribute('d','M6 19h4V5H6v14zm8-14v14h4V5h-4z');
    // Start playback: video element is master clock
    const startPh=S.cut.ph;
    // Find the clip that contains the current playhead position
    const activeClip=S.cut.clips.find(c=>c.type==='video'&&startPh>=c.start&&startPh<c.start+c.dur);
    const mv=$('cut-main-vid')||document.querySelector('#cut-screen video');

    if(activeClip&&mv){
      const item=S.cut.media[activeClip.mediaIdx];
      if(item?.url){
        const clipIdx=S.cut.clips.indexOf(activeClip);
        // Set source if different
        if(!mv.src||!mv.src.includes(item.url.split('blob:')[1]||item.url)){
          mv.src=item.url;
        }
        mv.dataset.clipIdx=String(clipIdx);
        // CRITICAL: seek to the correct offset WITHIN the file
        // If clip starts at 5s in timeline and video file offset is also from 0,
        // we need to seek to (S.cut.ph - clip.start) seconds into the file
        // fileStart = where in the actual file this clip begins
        const fileOffset=(activeClip.fileStart||0) + Math.max(0, startPh - activeClip.start);
        mv.currentTime=fileOffset;
        mv.play().catch(e=>console.log('play err',e));
        mv.style.display='block';
        const canvas=$('cut-trans-cvs');
        if(canvas) canvas.style.display='none';
        const placeholder=$('cut-cvs');
        if(placeholder) placeholder.style.display='none';
      }
    }

    // RAF loop: read position FROM video (don't increment S.cut.ph directly)
    function playFrame(){
      if(!S.cut.playing) return;
      // Redraw canvas overlays every frame
      const phNow=S.cut.ph;
      const activeNow=S.cut.clips.find(c=>c.type==='video'&&phNow>=c.start&&phNow<c.start+c.dur);
      if(activeNow){
        const ciNow2=S.cut.clips.indexOf(activeNow);
        const trNow=getClipTransition(ciNow2);
        // Only count transition as active if playhead is within its window
        const trActive = (()=>{
          if(!trNow) return null;
          const trStart = activeNow.start + (trNow.startOffset||0);
          const trEnd   = trStart + (trNow.effectDur||trNow.dur||1);
          return (phNow >= trStart && phNow < trEnd) ? trNow : null;
        })();
        const hasEffNow=(S.cut.effects[ciNow2]||[]).filter(e=>CUT_EFFECTS[e.i]?.type!=='transition').length>0;
        const activeFreezeNow=window._overlays&&window._overlays.find(o=>o.type==='freeze'&&phNow>=o.startTime&&phNow<o.endTime&&!_playedFreezes.has(o.id));
        const hasOverlays=window._overlays&&window._overlays.some(o=>phNow>=o.startTime&&phNow<o.endTime&&!(o.type==='freeze'&&_playedFreezes.has(o.id)));
        if(activeFreezeNow){
          // ── FREEZE ACTIVE ──
          const mv2=$('cut-main-vid');
          if(!_freezeActive){
            _freezeActive=true;
            _freezeLastTime=performance.now();
            _freezeStartPh=phNow;
            _freezeSavedVideoTime=(mv2&&mv2.currentTime)||0;
            if(mv2&&!mv2.paused) mv2.pause();
            stopAudioPlayback();
          }
          const now2=performance.now();
          const dt=Math.min((now2-(_freezeLastTime||now2))/1000,0.05);
          _freezeLastTime=now2;
          S.cut.ph=Math.min(phNow+dt, activeFreezeNow.endTime);
          updateCutPH();
          syncCutVid();
        } else if(_freezeActive){
          // ── FREEZE JUST ENDED ──
          // Mark as played FIRST, before any state reset
          if(window._overlays){
            window._overlays
              .filter(o=>o.type==='freeze'&&phNow>=o.endTime)
              .forEach(o=>_playedFreezes.add(o.id));
            // Also catch by start position
            if(_freezeStartPh!==null){
              window._overlays
                .filter(o=>o.type==='freeze'&&_freezeStartPh>=o.startTime&&_freezeStartPh<o.endTime)
                .forEach(o=>_playedFreezes.add(o.id));
            }
          }
          _freezeActive=false;
          _freezeLastTime=null;
          const _resumePh=_freezeStartPh!==null?_freezeStartPh:S.cut.ph;
          _freezeStartPh=null;
          _freezeExitTime=performance.now();
          S.cut.ph=_resumePh;
          updateCutPH();
          const mv2=$('cut-main-vid');
          const c2e=document.getElementById('cut-trans-cvs');
          if(mv2){mv2.style.opacity='1';mv2.style.display='block';}
          if(c2e){c2e.style.display='none';}
          if(mv2&&_freezeSavedVideoTime>0) mv2.currentTime=_freezeSavedVideoTime;
          _freezeSavedVideoTime=0;
          startAudioPlayback();
          if(mv2&&S.cut.playing){
            let _a=0;
            const _p=()=>{if(!S.cut.playing||_a>3)return;_a++;mv2.play().catch(e=>{if(e.name==='AbortError'&&_a<=3)setTimeout(_p,150*_a);});};
            setTimeout(_p,80);
          }
        } else if(trActive||hasEffNow||hasOverlays){
          // Throttle overlay/effect canvas to 30fps during playback
          const _now4=performance.now();
          if(_now4-_lastCanvasTime>=33){
            _lastCanvasTime=_now4;
            syncCutVid();
          }
        } else {
          // No overlays/effects — show video element directly
          const canv=document.getElementById('cut-trans-cvs');
          const mv2=document.getElementById('cut-main-vid');
          // Hide canvas
          if(canv) canv.style.display='none';
          // Show mv — use opacity (not display) since mv is always display:block
          if(mv2){ mv2.style.opacity='1'; mv2.style.display='block'; }
          if(mv2&&mv2.paused&&S.cut.playing) mv2.play().catch(()=>{});
        }
      }
      const vidEl=$('cut-main-vid');
      const ciNow=vidEl?parseInt(vidEl.dataset.clipIdx):NaN;
      const clipNow=!isNaN(ciNow)?S.cut.clips[ciNow]:null;
      if(S.cut._scrubbing) { _cutTick=requestAnimationFrame(playFrame); return; }
      // Audio-only mode: no video clip at playhead — advance ph via real clock
      const hasVideoAtPh = S.cut.clips.some(c=>c.type==='video'&&S.cut.ph>=c.start&&S.cut.ph<c.start+c.dur);
      if(!hasVideoAtPh&&S.cut.playing&&!_freezeActive){
        const _now3=performance.now();
        const _dt3=Math.min((_audioOnlyLastTime?(_now3-_audioOnlyLastTime)/1000:1/60),0.1);
        _audioOnlyLastTime=_now3;
        const maxPh=S.cut.clips.length?Math.max(...S.cut.clips.map(c=>c.start+c.dur)):S.proj.dur;
        S.cut.ph=Math.min(S.cut.ph+_dt3,maxPh);
        updateCutPH();
        if(S.cut.ph>=maxPh){ stopCutPlay(); return; }
      } else { _audioOnlyLastTime=null; }
      if(clipNow&&vidEl&&!vidEl.paused&&!_freezeActive){
        // Video is driving — read current position (not during freeze — ph is driven by clock then)
        // ph = clip timeline start + (currentTime - fileStart)
        S.cut.ph=clipNow.start+(vidEl.currentTime-(clipNow.fileStart||0))/(1); // ph tracks real time
        // Ensure playbackRate matches clip speed
        const targetRate=Math.max(0.1,clipNow.speed||1);
        if(Math.abs(vidEl.playbackRate-targetRate)>0.01) vidEl.playbackRate=targetRate;
        // Apply video fade
        const vidGain = getClipGainAtPh(clipNow, S.cut.ph);
        if(!_freezeActive) vidEl.volume = Math.min(1, vidGain);
        updateCutPH();
        // Check if we've reached end of THIS CLIP (fileStart + dur = end position in file)
        const clipEndInFile = (clipNow.fileStart||0) + clipNow.dur;
        if(vidEl.currentTime >= clipEndInFile - 0.05){
          // Find next clip on timeline
          const currentEnd = clipNow.start + clipNow.dur;
          const nextClip = S.cut.clips
            .filter(c=>c.type==='video' && c!==clipNow && c.start >= currentEnd-0.3)
            .sort((a,b)=>a.start-b.start)[0];
          if(nextClip){
            const item=S.cut.media[nextClip.mediaIdx];
            if(item?.url){
              // Switch to next clip — seek to its fileStart position
              if(vidEl.dataset.mediaIdx !== String(nextClip.mediaIdx)){
                vidEl.dataset.mediaIdx = String(nextClip.mediaIdx);
                vidEl.src = item.url;
              }
              vidEl.dataset.clipIdx = String(S.cut.clips.indexOf(nextClip));
              vidEl.currentTime = nextClip.fileStart||0;
              vidEl.play().catch(()=>{});
              S.cut.ph = nextClip.start;
              updateCutPH();
            }
          } else {
            // No next clip — stop at the end of the last clip
            stopCutPlay();
            // Set playhead to exact end of this clip
            S.cut.ph = clipNow.start + clipNow.dur;
            updateCutPH();
            vidEl.pause();
            return;
          }
        }
      } else if(clipNow&&vidEl&&vidEl.paused&&S.cut.playing&&!S.cut._scrubbing&&!_freezeActive){
        // Video stalled — restart only if still within clip bounds AND not in freeze
        const clipEndFile2=(clipNow.fileStart||0)+clipNow.dur;
        if(vidEl.currentTime < clipEndFile2-0.1){
          vidEl.playbackRate=clipNow.speed||1;
          vidEl.play().catch(()=>{});
        }
      }
      if(!_freezeActive) syncAudioPlayback(); // don't sync audio during freeze
      _syncVideoMute();
      _cutTick=requestAnimationFrame(playFrame);
    }
    _cutTick=requestAnimationFrame(playFrame);
    startAudioPlayback();
    _syncVideoMute();
  } else stopCutPlay();
}
// Mute/unmute the main video based on whether standalone audio is active at this position
function _syncVideoMute(){
  const mv = document.getElementById('cut-main-vid');
  if (!mv) return;
  const ph = S.cut.ph;
  // If any standalone audio clip is playing at this position, mute the video
  // to prevent the video audio from mixing with the standalone audio track
  const standaloneAudioActive = S.cut.clips.some(c =>
    c.type === 'audio' && !c.linkedToVideo &&
    ph >= c.start && ph < c.start + c.dur &&
    S.cut.media[c.mediaIdx]?.url
  );
  mv.muted = standaloneAudioActive;
}

function stopCutPlay(){
  S.cut.playing=false;
  _freezeActive=false;
  _freezeLastTime=null;
  _freezeStartPh=null;
  _audioOnlyLastTime=null;
  _playedFreezes.clear(); // allow freezes to play again on next playback
  cancelAnimationFrame(_cutTick);
  _cutTick=null;
  clearInterval(_cutTick);
  const mv=$('cut-main-vid');
  if(mv){
    const ciStop=parseInt(mv.dataset.clipIdx);
    const clipStop=!isNaN(ciStop)?S.cut.clips[ciStop]:null;
    if(clipStop&&!mv.paused){
      S.cut.ph=clipStop.start+(mv.currentTime-(clipStop.fileStart||0));
      updateCutPH();
    }
    mv.pause();
  }
  stopAudioPlayback();const pp=$('cut-play-path');if(pp)pp.setAttribute('d','M5 3L19 12L5 21Z');const tp=$('cut-tl-path');if(tp)tp.setAttribute('d','M8 5V19L19 12Z');}

// ── AUDIO ENGINE ── (single source, no echo) ──
const _audioEls = {};
function getAudioEl(url){
  if(!_audioEls[url]){
    // Kill any existing audio elements for this URL first
    document.querySelectorAll('audio[data-url]').forEach(a=>{
      if(a.dataset.url===url){a.pause();a.remove();}
    });
    const a=document.createElement('audio');
    a.src=url; a.preload='auto'; a.dataset.url=url;
    document.body.appendChild(a);
    _audioEls[url]=a;
  }
  return _audioEls[url];
}

function startAudioPlayback(){
  // Stop ALL audio first to prevent echo
  stopAudioPlayback();
  const ph = S.cut.ph;
  // Only play standalone audio-only clips — video audio comes from cut-main-vid directly
  S.cut.clips.filter(c => c.type === 'audio' && !c.linkedToVideo).forEach(c => {
    const item = S.cut.media[c.mediaIdx];
    if (!item?.url) return;
    if (ph >= c.start && ph < c.start + c.dur) {
      const a = getAudioEl(item.url);
      a.currentTime = (c.fileStart || 0) + Math.max(0, ph - c.start);
      a.play().catch(() => {});
    }
  });
}

function stopAudioPlayback(){
  // Pause ALL cached audio elements
  Object.values(_audioEls).forEach(a => { a.pause(); });
  // Mute pool videos (transitions only)
  Object.values(_vidPool).forEach(v => { v.pause(); v.muted = true; });
  // Main video
  const mv = $('cut-main-vid');
  if (mv && !mv.paused) mv.pause();
  // Purge audio elements whose URL is no longer used by any clip on the timeline
  purgeStaleAudioEls();
}

function purgeStaleAudioEls(){
  // Only standalone audio clips keep _audioEls entries
  const activeUrls = new Set(
    S.cut.clips
      .filter(c => c.type === 'audio' && !c.linkedToVideo)
      .map(c => S.cut.media[c.mediaIdx]?.url)
      .filter(Boolean)
  );
  Object.keys(_audioEls).forEach(url => {
    if (!activeUrls.has(url)) {
      const a = _audioEls[url];
      a.pause();
      a.src = '';
      if (document.body.contains(a)) document.body.removeChild(a);
      delete _audioEls[url];
    }
  });
}

// Compute gain (0-1) for a clip at a given playhead position, accounting for fade in/out
function getClipGainAtPh(c, ph){
  const elapsed   = ph - c.start;
  const remaining = c.start + c.dur - ph;
  let gain = c.volume !== undefined ? c.volume : 1;

  // Fade in
  if(c.fadeIn > 0 && elapsed < c.fadeIn){
    gain *= elapsed / c.fadeIn;
  }
  // Fade out
  if(c.fadeOut > 0 && remaining < c.fadeOut){
    gain *= remaining / c.fadeOut;
  }
  return Math.max(0, Math.min(2, gain));
}

function syncAudioPlayback(){
  const ph = S.cut.ph;
  const standaloneCips = S.cut.clips.filter(c => c.type === 'audio' && !c.linkedToVideo);

  // Pause any cached audio that no longer has an active clip at playhead
  Object.keys(_audioEls).forEach(url => {
    const a = _audioEls[url];
    const activeClip = standaloneCips.find(c =>
      S.cut.media[c.mediaIdx]?.url === url &&
      ph >= c.start && ph < c.start + c.dur
    );
    if (!activeClip) {
      if (!a.paused) a.pause();
    } else {
      const expected = (activeClip.fileStart || 0) + Math.max(0, ph - activeClip.start);
      if (a.paused && S.cut.playing) {
        a.currentTime = expected;
        a.play().catch(() => {});
      } else if (!a.paused && Math.abs(a.currentTime - expected) > 0.5) {
        a.currentTime = expected;
      }
      // Apply fade gain
      a.volume = Math.min(1, getClipGainAtPh(activeClip, ph));
    }
  });
  // Start audio for clips not yet in cache
  standaloneCips.forEach(c => {
    const item = S.cut.media[c.mediaIdx];
    if (!item?.url) return;
    if (ph >= c.start && ph < c.start + c.dur) {
      const a = getAudioEl(item.url);
      const expected = (c.fileStart || 0) + Math.max(0, ph - c.start);
      if (a.paused && S.cut.playing) { a.currentTime = expected; a.play().catch(() => {}); }
    }
  });
}


// ── TRANSITION ENGINE ──
// Hidden video elements for blending
const _vidPool = {};
function getPoolVid(url){
  if(!_vidPool[url]){
    const v=document.createElement('video');
    v.src=url; v.muted=true; v.preload='auto'; // ALWAYS muted — only main vid has audio
    v.style.display='none'; document.body.appendChild(v);
    _vidPool[url]=v;
  }
  return _vidPool[url];
}

function getClipTransition(ci){
  // Returns the transition whose window contains current ph — or first if none match
  const effs=S.cut.effects[ci]||[];
  const ph=S.cut.ph;
  const clip=S.cut.clips[ci];
  const allTr=[];
  for(const ef of effs){
    const e=CUT_EFFECTS[ef.i];
    if(e&&e.type==='transition'){
      const merged=Object.assign({},e,{
        startOffset:ef.startOffset||0,
        effectDur:ef.effectDur||e.dur||1,
        softness:ef.softness,
        completion:ef.completion,
        easing:ef.easing,
        direction:ef.direction,
        _efIdx:effs.indexOf(ef),
      });
      allTr.push(merged);
    }
  }
  if(!allTr.length) return null;
  // Return the transition whose window contains current ph
  if(clip){
    const active=allTr.find(tr=>{
      const ts=clip.start+(tr.startOffset||0);
      const te=ts+(tr.effectDur||tr.dur||1);
      return ph>=ts&&ph<te;
    });
    if(active) return active;
  }
  // Fallback: return first transition
  return allTr[0];
}

function getTransitionDur(ci){
  const e=getClipTransition(ci);
  return e?e.dur:0;
}

let _lastCanvasTime = 0;

// ── Transition easing helper ──
function _applyEasing(t, mode){
  if(!mode || mode==='linear') return t;
  if(mode==='ease-in')      return t * t;
  if(mode==='ease-out')     return t * (2 - t);
  if(mode==='ease-in-out')  return t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
  if(mode==='cinematic'){   // smooth S-curve (sine)
    return (1 - Math.cos(Math.PI * t)) / 2;
  }
  return t;
}
function syncCutVid(){
  const ph = S.cut.ph;
  const screen = $('cut-screen');
  if(!screen) return;

  // Find active video clip at current playhead
  const videoClips = S.cut.clips.filter(c => c.type === 'video');
  const active = videoClips.find(c => 
    ph >= c.start && ph < c.start + c.dur &&
    !S.cut.hiddenTracks?.[c.track]
  );

  // Ensure pool vids exist for all clips
  videoClips.forEach(c => {
    const item = S.cut.media[c.mediaIdx];
    if(item?.url) getPoolVid(item.url);
  });

  // Get or create main video element — always inside the viewport frame
  const frame = document.getElementById('cut-viewport-frame') || screen;
  let mv = $('cut-main-vid');
  if(!mv){
    mv = document.createElement('video');
    mv.id = 'cut-main-vid';
    mv.muted = false;
    if('preservesPitch' in mv) mv.preservesPitch = true;
    if('mozPreservesPitch' in mv) mv.mozPreservesPitch = true;
    if('webkitPreservesPitch' in mv) mv.webkitPreservesPitch = true;
    // Position fills the frame, object-fit preserves native AR
    mv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;z-index:0;';
    mv.addEventListener('timeupdate', () => {
      if(S.cut.playing) return;
      const ci = parseInt(mv.dataset.clipIdx);
      if(isNaN(ci)) return;
      const clip = S.cut.clips[ci];
      if(!clip) return;
      S.cut.ph = clip.start + (mv.currentTime - (clip.fileStart||0));
      updateCutPH();
    });
    frame.appendChild(mv);
  }

  // Get or create canvas for transitions/effects — also in frame
  let canvas = $('cut-trans-cvs');
  if(!canvas){
    canvas = document.createElement('canvas');
    canvas.id = 'cut-trans-cvs';
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:none;pointer-events:none;';
    frame.appendChild(canvas);
  }

  const placeholder = $('cut-cvs');

  // Check if any overlays are active at this ph (even without video)
  const hasActiveOverlays = (window._overlays||[]).some(o =>
    ph >= o.startTime && ph < o.endTime &&
    !(o.type==='freeze' && _playedFreezes?.has(o.id))
  );

  if(!active){
    if(mv && !mv.paused) mv.pause();
    mv.style.opacity = '0';

    if(hasActiveOverlays){
      // Show canvas with just overlays on black background
      canvas.style.display = 'block';
      if(placeholder) placeholder.style.display = 'none';
      if(canvas.width !== (S.proj.w||1280)){
        canvas.width  = S.proj.w||1280;
        canvas.height = S.proj.h||720;
      }
      const ctx0 = canvas.getContext('2d');
      ctx0.clearRect(0,0,canvas.width,canvas.height);
      ctx0.fillStyle = '#000';
      ctx0.fillRect(0,0,canvas.width,canvas.height);
      if(window.renderOverlaysOnCanvas)
        window.renderOverlaysOnCanvas(ctx0,canvas.width,canvas.height,ph,_playedFreezes);
    } else {
      canvas.style.display = 'none';
      if(placeholder) placeholder.style.display = 'block';
    }
    return;
  }

  // Active clip found — always hide placeholder immediately
  if(placeholder){ placeholder.style.display = 'none'; }

  const activeCI = S.cut.clips.indexOf(active);
  const item = S.cut.media[active.mediaIdx];
  if(!item?.url){ return; }

  // Check for transition or effects
  const tr = getClipTransition(activeCI);
  const hasEffects = (S.cut.effects[activeCI]||[]).filter(e => {
    if(CUT_EFFECTS[e.i]?.type === 'transition') return false; // handled separately as tr
    if(e.visible===false) return false;
    // Check if effect is active at current ph
    const effStart = active.start + (e.startOffset||0);
    const effEnd   = effStart + (e.effectDur||active.dur);
    return ph >= effStart && ph < effEnd;
  }).length > 0;
  // Always use canvas if overlays are present OR if transition/effects active
  // Skip canvas mode for 500ms after freeze exit — let video resume cleanly
  // trInWindow is the tr object when inside the transition window, null otherwise
  const trInWindow = (()=>{
    if(!tr) return null;
    const _ts = active.start + (tr.startOffset||0);
    const _te = _ts + (tr.effectDur||tr.dur||1);
    return (ph >= _ts && ph < _te) ? tr : null;
  })();
  if((trInWindow || hasEffects || hasActiveOverlays) && (performance.now()-(_freezeExitTime||0)) > 500){
    mv.style.opacity = '0';     // hidden but display:block so browser decodes
    canvas.style.display = 'block';
    canvas.style.zIndex  = '2';  // canvas covers mv visually
    if(placeholder) placeholder.style.display = 'none'; // hide placeholder in canvas mode
    const projW = S.proj.w||1280, projH = S.proj.h||720;
    if(canvas.width !== projW || canvas.height !== projH){
      canvas.width = projW; canvas.height = projH;
    }

    // ── CRITICAL: Always set up mv.src BEFORE drawing from it ──
    if(mv.dataset.mediaIdx !== String(active.mediaIdx) || !mv.src || mv.src.includes('undefined')){
      mv.dataset.mediaIdx = String(active.mediaIdx);
      mv.src = item.url;
    }
    mv.dataset.clipIdx = String(activeCI);

    // Sync position when paused or when video needs seeking
    const targetT = (active.fileStart||0) + Math.max(0, ph - active.start);
    if(!S.cut.playing && Math.abs(mv.currentTime - targetT) > 0.05){
      mv.currentTime = targetT;
    }

    const ctx = canvas.getContext('2d');
    const drawSrc = mv;

    // Center-crop draw helper — preserves native video AR in any canvas size
    function _drawVideoFrame(src, ctx, cW, cH){
      if(!src || src.readyState < 2) return false;
      const vW = src.videoWidth  || cW;
      const vH = src.videoHeight || cH;
      if(!vW || !vH) return false;
      const canvasAR = cW / cH;
      const videoAR  = vW / vH;
      let sx=0, sy=0, sw=vW, sh=vH;
      if(videoAR > canvasAR){
        // Video wider than canvas — crop left/right (center crop horizontally)
        sw = Math.round(vH * canvasAR);
        sx = Math.round((vW - sw) / 2);
      } else if(videoAR < canvasAR){
        // Video taller than canvas — crop top/bottom (center crop vertically)
        sh = Math.round(vW / canvasAR);
        sy = Math.round((vH - sh) / 2);
      }
      try{
        ctx.drawImage(src, sx, sy, sw, sh, 0, 0, cW, cH);
        return true;
      }catch(e){ return false; }
    }

    // Keep mv playing even when hidden — needed for frame decoding
    if(S.cut.playing && mv.paused && !_freezeActive){
      mv.play().catch(()=>{});
    }
    // Pre-seek when paused
    if(!S.cut.playing){
      const t0 = (active.fileStart||0) + Math.max(0, ph - active.start);
      if(Math.abs(mv.currentTime - t0) > 0.05) mv.currentTime = t0;
    }

    // Base draw: if NO active transition, draw video normally
    // If transition IS active, skip base draw — each transition draws its own video
    if(drawSrc.readyState >= 2){
      if(!trInWindow){
        // No transition: draw video at full opacity
        ctx.clearRect(0,0,canvas.width,canvas.height);
        if(_drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height)){
          canvas._hasGoodFrame = true;
        }
      }
      // else: transition active — clear canvas, let transition draw everything
      else {
        ctx.clearRect(0,0,canvas.width,canvas.height);
      }
    } else if(!canvas._hasGoodFrame){
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle = '#000';
      ctx.fillRect(0,0,canvas.width,canvas.height);
    }
    // else: keep last good frame — no clear

    // ── Draw transitions FIRST (before overlays) ──
    if(trInWindow){
      const elapsed = ph - active.start - (tr.startOffset||0);
      const rawProg  = Math.max(0, Math.min(1, elapsed / (tr.effectDur||tr.dur||1)));
      // Apply completion cap (0-100%) — limits how far the transition goes
      const compCap  = (tr.completion !== undefined ? tr.completion : 100) / 100;
      const progress = _applyEasing(rawProg, tr.easing) * compCap;
      ctx.save();
      if(tr.mode==='fadein'){
        // Fade in: 0=invisible → 1=full video
        ctx.globalAlpha = progress;
        _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height);
        ctx.globalAlpha = 1;
      }
      else if(tr.mode==='fadeout'){
        // Fade out: 0=full video → 1=black
        _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height);
        ctx.globalAlpha = progress;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 1;
      }
      else if(tr.mode==='dissolve'){
        // Cross dissolve: 0=full video → 1=invisible
        ctx.globalAlpha = 1 - progress;
        _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height);
        ctx.globalAlpha = 1;
      }
      else if(tr.mode==='zoomin'){
        // Zoom in: starts zoomed-in fully visible, scales down to normal
        const s = 1 + (1-progress)*0.4;
        ctx.translate(canvas.width/2, canvas.height/2);
        ctx.scale(s, s);
        ctx.translate(-canvas.width/2, -canvas.height/2);
        _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height);
      }
      else if(tr.mode==='zoomout'){
        // Zoom out exit: normal → shrinks away
        const s = 1 - progress*0.35;
        ctx.translate(canvas.width/2, canvas.height/2);
        ctx.scale(s, s);
        ctx.translate(-canvas.width/2, -canvas.height/2);
        ctx.globalAlpha = 1 - progress;
        _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height);
        ctx.globalAlpha = 1;
      }
      else if(tr.mode==='slideleft'){
        // Slide left exit: video slides off to the left
        const x = -canvas.width * progress;
        try{ ctx.drawImage(drawSrc, x, 0, canvas.width, canvas.height); }catch(e){}
      }
      else if(tr.mode==='slideright'){
        // Slide right exit: video slides off to the right
        const x = canvas.width * progress;
        try{ ctx.drawImage(drawSrc, x, 0, canvas.width, canvas.height); }catch(e){}
      }
      else if(tr.mode==='wipeleft'){
        // Wipe left: video wiped away from right edge moving left
        const wipeX = canvas.width * (1 - progress); // visible width
        const soft  = (tr.softness||0) * 60;
        ctx.save();
        if(soft > 1){
          _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height);
          const grd = ctx.createLinearGradient(wipeX-soft, 0, wipeX+soft, 0);
          grd.addColorStop(0, 'rgba(0,0,0,0)');
          grd.addColorStop(1, 'rgba(0,0,0,1)');
          ctx.globalCompositeOperation = 'destination-out';
          ctx.fillStyle = grd;
          ctx.fillRect(wipeX-soft, 0, soft*2, canvas.height);
          ctx.fillStyle = 'rgba(0,0,0,1)';
          ctx.fillRect(wipeX+soft, 0, canvas.width, canvas.height);
          ctx.globalCompositeOperation = 'source-over';
        } else {
          ctx.beginPath();
          ctx.rect(0, 0, wipeX, canvas.height);
          ctx.clip();
          _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height);
        }
        ctx.restore();
      }
      else if(tr.mode==='wiperight'){
        // Wipe right: video wiped away from left edge moving right
        const wipeX2 = canvas.width * progress; // hidden width from left
        const soft2  = (tr.softness||0) * 60;
        ctx.save();
        if(soft2 > 1){
          _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height);
          const grd2 = ctx.createLinearGradient(wipeX2-soft2, 0, wipeX2+soft2, 0);
          grd2.addColorStop(0, 'rgba(0,0,0,1)');
          grd2.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.globalCompositeOperation = 'destination-out';
          ctx.fillStyle = 'rgba(0,0,0,1)';
          ctx.fillRect(0, 0, wipeX2-soft2, canvas.height);
          ctx.fillStyle = grd2;
          ctx.fillRect(wipeX2-soft2, 0, soft2*2, canvas.height);
          ctx.globalCompositeOperation = 'source-over';
        } else {
          ctx.beginPath();
          ctx.rect(wipeX2, 0, canvas.width-wipeX2, canvas.height);
          ctx.clip();
          _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height);
        }
        ctx.restore();
      }
      else if(tr.mode==='blur'){
        // Blur out: 0=sharp → 1=blurry+faded
        ctx.filter = `blur(${Math.round(progress*18)}px)`;
        ctx.globalAlpha = 1 - progress*0.6;
        _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height);
        ctx.filter = 'none'; ctx.globalAlpha = 1;
      }
      else if(tr.mode==='flash'){
        // Flash white: video → white flash → video
        _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height);
        const fa = progress < 0.5 ? progress*2 : (1-progress)*2;
        ctx.fillStyle = `rgba(255,255,255,${fa})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      else if(tr.mode==='flashblack'){
        // Flash black: video → black flash → video
        _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height);
        const fb = progress < 0.5 ? progress*2 : (1-progress)*2;
        ctx.fillStyle = `rgba(0,0,0,${fb})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      else if(tr.mode==='spin'){
        // Spin out: video spins and fades away
        const angle = progress * Math.PI * 2;
        ctx.translate(canvas.width/2, canvas.height/2);
        ctx.rotate(angle);
        ctx.translate(-canvas.width/2, -canvas.height/2);
        ctx.globalAlpha = 1 - progress;
        _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height);
        ctx.globalAlpha = 1;
      }
      // ── DISSOLVES ──
      else if(tr.mode==='dip_black'){ const mid=progress<0.5?progress*2:1-(progress-0.5)*2; ctx.globalAlpha=mid; _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height); ctx.globalAlpha=1; ctx.fillStyle='#000'; ctx.globalAlpha=1-mid; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.globalAlpha=1; }
      else if(tr.mode==='dip_white'){ const mid=progress<0.5?progress*2:1-(progress-0.5)*2; ctx.globalAlpha=mid; _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height); ctx.globalAlpha=1; ctx.fillStyle='#fff'; ctx.globalAlpha=1-mid; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.globalAlpha=1; }
      else if(tr.mode==='additive'){ ctx.globalAlpha=progress; _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height); ctx.fillStyle='rgba(255,255,255,'+(1-progress)*0.3+')'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.globalAlpha=1; }
      else if(tr.mode==='film_dissolve'){ ctx.globalAlpha=progress; _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height); ctx.globalAlpha=1; if(progress<0.5){ctx.fillStyle='rgba(0,0,0,'+(0.5-progress)+')';ctx.fillRect(0,0,canvas.width,canvas.height);} }
      else if(tr.mode==='morph'){ ctx.filter=`blur(${(1-Math.abs(progress-0.5)*2)*6}px)`; ctx.globalAlpha=progress; _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height); ctx.filter='none'; ctx.globalAlpha=1; }

      // ── WIPES ──
      else if(tr.mode==='wipeup'){ _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height); ctx.clearRect(0,0,canvas.width,canvas.height*(1-progress)); }
      else if(tr.mode==='wipedown'){ _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height); ctx.clearRect(0,canvas.height*progress,canvas.width,canvas.height); }
      else if(tr.mode==='clock'){ ctx.save(); ctx.beginPath(); ctx.moveTo(canvas.width/2,canvas.height/2); ctx.arc(canvas.width/2,canvas.height/2,Math.max(canvas.width,canvas.height),-(Math.PI/2),-(Math.PI/2)+progress*Math.PI*2); ctx.closePath(); ctx.clip(); _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height); ctx.restore(); }
      else if(tr.mode==='radial'){ const R=Math.max(canvas.width,canvas.height)*progress; ctx.save(); ctx.beginPath(); ctx.arc(canvas.width/2,canvas.height/2,R,0,Math.PI*2); ctx.clip(); _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height); ctx.restore(); }
      else if(tr.mode==='iris_round'){ const R=Math.max(canvas.width,canvas.height)*progress; ctx.save(); ctx.beginPath(); ctx.arc(canvas.width/2,canvas.height/2,R,0,Math.PI*2); ctx.clip(); _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height); ctx.restore(); }
      else if(tr.mode==='iris_diamond'){ const hw=canvas.width*progress,hh=canvas.height*progress; ctx.save(); ctx.beginPath(); ctx.moveTo(canvas.width/2,canvas.height/2-hh); ctx.lineTo(canvas.width/2+hw,canvas.height/2); ctx.lineTo(canvas.width/2,canvas.height/2+hh); ctx.lineTo(canvas.width/2-hw,canvas.height/2); ctx.closePath(); ctx.clip(); _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height); ctx.restore(); }
      else if(tr.mode==='band_h'){ const bh=canvas.height/4; for(let i=0;i<4;i++){const y=i*bh; ctx.save(); ctx.beginPath(); const w2=canvas.width*progress; const x=(i%2===0)?0:canvas.width-w2; ctx.rect(x,y,w2,bh); ctx.clip(); _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height); ctx.restore();} }
      else if(tr.mode==='band_v'){ const bw=canvas.width/4; for(let i=0;i<4;i++){const x=i*bw; ctx.save(); ctx.beginPath(); const h2=canvas.height*progress; const y=(i%2===0)?0:canvas.height-h2; ctx.rect(x,y,bw,h2); ctx.clip(); _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height); ctx.restore();} }

      // ── MOTION ZOOMS ──
      else if(tr.mode==='zoom_blur_in'){ const s=1+progress*0.5; ctx.save(); ctx.translate(canvas.width/2,canvas.height/2); ctx.scale(s,s); ctx.translate(-canvas.width/2,-canvas.height/2); ctx.filter=`blur(${(1-progress)*8}px)`; ctx.globalAlpha=progress; _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height); ctx.filter='none'; ctx.globalAlpha=1; ctx.restore(); }
      else if(tr.mode==='zoom_blur_out'){ const s=1+(1-progress)*0.5; ctx.save(); ctx.translate(canvas.width/2,canvas.height/2); ctx.scale(s,s); ctx.translate(-canvas.width/2,-canvas.height/2); ctx.filter=`blur(${(1-progress)*8}px)`; ctx.globalAlpha=progress; _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height); ctx.filter='none'; ctx.globalAlpha=1; ctx.restore(); }
      else if(tr.mode==='ken_burns'){ const s=1+progress*0.15; const tx=(progress-0.5)*canvas.width*0.1; ctx.save(); ctx.translate(canvas.width/2+tx,canvas.height/2); ctx.scale(s,s); ctx.translate(-canvas.width/2,-canvas.height/2); _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height); ctx.restore(); }
      else if(tr.mode==='push_in'){ const s=0.85+progress*0.15; ctx.save(); ctx.translate(canvas.width/2,canvas.height/2); ctx.scale(s,s); ctx.translate(-canvas.width/2,-canvas.height/2); ctx.globalAlpha=Math.min(1,progress*2); _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height); ctx.globalAlpha=1; ctx.restore(); }
      else if(tr.mode==='pull_back'){ const s=1+progress*0.2; ctx.save(); ctx.translate(canvas.width/2,canvas.height/2); ctx.scale(s,s); ctx.translate(-canvas.width/2,-canvas.height/2); ctx.globalAlpha=Math.min(1,progress*2); _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height); ctx.globalAlpha=1; ctx.restore(); }

      // ── SPORT SPOTLIGHTS ──
      else if(tr.mode==='spotlight'){
        _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height);
        // Dark overlay with bright circle in center
        ctx.fillStyle='rgba(0,0,0,0.7)'; ctx.fillRect(0,0,canvas.width,canvas.height);
        const r=Math.min(canvas.width,canvas.height)*0.35*Math.min(1,progress*2);
        const g=ctx.createRadialGradient(canvas.width/2,canvas.height/2,0,canvas.width/2,canvas.height/2,r);
        g.addColorStop(0,'rgba(0,0,0,0.9)'); g.addColorStop(0.7,'rgba(0,0,0,0.3)'); g.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle=g; ctx.fillRect(0,0,canvas.width,canvas.height);
        // Redraw center bright
        ctx.save(); ctx.beginPath(); ctx.arc(canvas.width/2,canvas.height/2,r,0,Math.PI*2); ctx.clip(); _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height); ctx.restore();
      }
      else if(tr.mode==='spotlight_sweep'){
        _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height);
        ctx.fillStyle='rgba(0,0,0,0.65)'; ctx.fillRect(0,0,canvas.width,canvas.height);
        const sx=canvas.width*progress, sy=canvas.height/2;
        const r2=Math.min(canvas.width,canvas.height)*0.3;
        ctx.save(); ctx.beginPath(); ctx.arc(sx,sy,r2,0,Math.PI*2); ctx.clip(); _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height); ctx.restore();
      }
      else if(tr.mode==='zoom_player'){
        // Zoom into center with vignette
        const s=1+progress*1.2; ctx.save(); ctx.translate(canvas.width/2,canvas.height/2); ctx.scale(s,s); ctx.translate(-canvas.width/2,-canvas.height/2); _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height); ctx.restore();
        const vig=ctx.createRadialGradient(canvas.width/2,canvas.height/2,canvas.width*0.2,canvas.width/2,canvas.height/2,canvas.width*0.7);
        vig.addColorStop(0,'rgba(0,0,0,0)'); vig.addColorStop(1,'rgba(0,0,0,'+progress*0.7+')');
        ctx.fillStyle=vig; ctx.fillRect(0,0,canvas.width,canvas.height);
      }
      else if(tr.mode==='highlight_ring'){
        _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height);
        const r3=Math.min(canvas.width,canvas.height)*0.25;
        ctx.strokeStyle=`rgba(255,220,0,${Math.sin(progress*Math.PI)})`; ctx.lineWidth=6;
        ctx.beginPath(); ctx.arc(canvas.width/2,canvas.height/2,r3,0,Math.PI*2); ctx.stroke();
        ctx.strokeStyle=`rgba(255,255,255,${Math.sin(progress*Math.PI)*0.5})`; ctx.lineWidth=2;
        ctx.beginPath(); ctx.arc(canvas.width/2,canvas.height/2,r3+10,0,Math.PI*2); ctx.stroke();
      }

      // ── ADVANCED ──
      else if(tr.mode==='glitch'){
        _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height);
        if(Math.random()>0.4){
          const slices=8;
          for(let i=0;i<slices;i++){
            const sy2=i*(canvas.height/slices);
            const sh=canvas.height/slices;
            const offset=(Math.random()-0.5)*40*(1-progress);
            ctx.save(); ctx.beginPath(); ctx.rect(0,sy2,canvas.width,sh); ctx.clip();
            try{ctx.drawImage(drawSrc,offset,0,canvas.width,canvas.height);}catch(e){}
            ctx.restore();
          }
          ctx.fillStyle=`rgba(255,0,0,${(1-progress)*0.15})`; ctx.fillRect(0,0,canvas.width,canvas.height);
        }
      }
      else if(tr.mode==='rgb_split'){
        ctx.globalAlpha=progress;
        const off=Math.round((1-progress)*15);
        try{
          ctx.save(); ctx.globalCompositeOperation='screen';
          ctx.filter='url(#none)';
          ctx.fillStyle='rgba(255,0,0,0.5)'; ctx.fillRect(0,0,1,1); // activate
          ctx.drawImage(drawSrc,-off,0,canvas.width,canvas.height);
          ctx.drawImage(drawSrc,off,0,canvas.width,canvas.height);
          ctx.restore();
          _drawVideoFrame(drawSrc,ctx,canvas.width,canvas.height);
        }catch(e){}
        ctx.globalAlpha=1;
      }
      else if(tr.mode==='vr_roll'){ ctx.save(); ctx.translate(canvas.width/2,canvas.height/2); ctx.rotate(progress*Math.PI*2); const s2=1+Math.abs(Math.sin(progress*Math.PI))*0.2; ctx.scale(s2,s2); ctx.translate(-canvas.width/2,-canvas.height/2); ctx.globalAlpha=progress; _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height); ctx.globalAlpha=1; ctx.restore(); }
      else if(tr.mode==='vr_spin'){ ctx.save(); ctx.translate(canvas.width/2,canvas.height/2); ctx.scale(progress,1); ctx.translate(-canvas.width/2,-canvas.height/2); ctx.globalAlpha=progress; _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height); ctx.globalAlpha=1; ctx.restore(); }

      else { _drawVideoFrame(drawSrc, ctx, canvas.width, canvas.height); }
      ctx.restore();
      // Draw overlays AFTER transition (last layer = topmost)
      if(window.renderOverlaysOnCanvas)
        window.renderOverlaysOnCanvas(ctx, canvas.width, canvas.height, ph, _playedFreezes);
    } else {
      // Effects only — apply CSS filter via canvas, then overlays on top
      const filterStr = buildFilterStr(activeCI);
      ctx.filter = filterStr !== 'none' ? filterStr : 'none';
      try{ _drawVideoFrame(drawSrc,ctx,canvas.width,canvas.height); }catch(e){}
      ctx.filter = 'none';
      if(window.renderOverlaysOnCanvas)
        window.renderOverlaysOnCanvas(ctx, canvas.width, canvas.height, ph, _playedFreezes);
    }
    return;
  }

  // NOTE: hasOverlaysNow is now handled in the canvas path above
  // (hasActiveOverlays check). No separate path needed here.

  // ── PLAIN VIDEO PATH ─────────────────────────────────────────
  // Show video element AND draw to canvas simultaneously as fallback
  if(placeholder) placeholder.style.display = 'none';

  // Always ensure src is correct
  const wantedMediaIdx = String(active.mediaIdx);
  if(mv.dataset.mediaIdx !== wantedMediaIdx || !mv.src || mv.src === window.location.href){
    mv.dataset.mediaIdx = wantedMediaIdx;
    mv.src = item.url;
    // Do NOT call mv.load() — it resets readyState causing black frames
    // The browser auto-loads when src changes
  }
  mv.dataset.clipIdx = String(activeCI);

  if(!S.cut.playing){
    const targetTime = (active.fileStart||0) + Math.max(0, ph - active.start);
    if(Math.abs(mv.currentTime - targetTime) > 0.02) mv.currentTime = targetTime;
    if(!mv.paused) mv.pause();
  }

  // Plain path: show mv directly, hide canvas
  mv.style.opacity = '1';
  mv.style.display = 'block';
  canvas.style.display = 'none';

  // Plain video path — no overlays, no effects
  // Just show the video element directly for best performance
  if(hasActiveOverlays){
    // This shouldn't be reached (handled in canvas path above)
    // but as safety: use canvas
    canvas.style.display = 'block';
    mv.style.display = 'none';
    const projW2 = S.proj.w||1280, projH2 = S.proj.h||720;
    if(canvas.width !== projW2){ canvas.width=projW2; canvas.height=projH2; }
    const ctx3 = canvas.getContext('2d');
    if(mv.readyState >= 2) try{ ctx3.drawImage(mv,0,0,canvas.width,canvas.height); }catch(e){}
    if(window.renderOverlaysOnCanvas)
      window.renderOverlaysOnCanvas(ctx3,canvas.width,canvas.height,ph,_playedFreezes);
  }

  // Apply filter
  const filterStr = buildFilterStr(activeCI);
  mv.style.filter = filterStr !== 'none' ? filterStr : '';
  // Apply transform
  const tr2 = active.transform;
  if(tr2){
    const sx=tr2.scaleX/100, sy=tr2.scaleY/100, rot=tr2.rotation, tx2=tr2.x, ty2=tr2.y;
    mv.style.transform=`translate(${tx2}%,${ty2}%) rotate(${rot}deg) scale(${sx},${sy})`;
    mv.style.transformOrigin='center center';
  } else {
    mv.style.transform='';
  }
  S.cut._vid = mv;
}


// Make playhead draggable
function setupPlayheadDrag(){
  const ph=$('cut-ph'); const scroll=$('tl-scroll'); if(!ph||!scroll) return;
  let dragging=false;
  ph.style.pointerEvents='auto'; ph.style.cursor='ew-resize'; ph.style.zIndex='30';
  ph.querySelector('.playhead-head').style.pointerEvents='auto';
  ph.querySelector('.playhead-head').style.cursor='ew-resize';

  function startDrag(e){
    e.preventDefault(); e.stopPropagation(); dragging=true;
    S.cut._scrubbing=true;
    // Pause video while scrubbing to prevent AbortError
    const mv=$('cut-main-vid');
    if(mv&&!mv.paused) mv.pause();
    document.addEventListener('mousemove',onDrag);
    document.addEventListener('mouseup',stopDrag);
    document.addEventListener('touchmove',onDragTouch,{passive:false});
    document.addEventListener('touchend',stopDrag);
  }
  function getX(e){return e.touches?e.touches[0].clientX:e.clientX;}
  function onDrag(e){
    if(!dragging)return;
    const rect=scroll.getBoundingClientRect();
    const x=getX(e)-rect.left+scroll.scrollLeft;
    S.cut.ph=Math.max(0,Math.min(Math.max(S.proj.dur,S.cut.clips.length?Math.max(...S.cut.clips.map(c=>c.start+c.dur)):0),x/PPS));
    // Update playhead position display
    const phEl=$('cut-ph');
    if(phEl) phEl.style.left=Math.round(S.cut.ph*PPS)+'px';
    const tc=fmtFull(S.cut.ph,S.proj.fps);
    const a=$('cut-pv-tc');if(a)a.textContent=tc;
    const b=$('cut-tl-tc');if(b)b.textContent=tc;
    // Seek video directly - NO syncCutVid call to avoid conflicts
    const mv=$('cut-main-vid');
    if(mv){
      const ci=parseInt(mv.dataset.clipIdx);
      const clip=!isNaN(ci)?S.cut.clips[ci]:null;
      // Find correct clip at new position
      const newClip=S.cut.clips.find(c=>c.type==='video'&&S.cut.ph>=c.start&&S.cut.ph<c.start+c.dur);
      if(newClip){
        const item=S.cut.media[newClip.mediaIdx];
        if(item?.url){
          const newCI=S.cut.clips.indexOf(newClip);
          if(mv.dataset.mediaIdx!==String(newClip.mediaIdx)){
            mv.dataset.mediaIdx=String(newClip.mediaIdx);
            mv.src=item.url;
          }
          mv.dataset.clipIdx=String(newCI);
          const targetTime=(newClip.fileStart||0)+Math.max(0,S.cut.ph-newClip.start);
          mv.currentTime=targetTime;
          mv.style.display='block';
        }
      }
    }
  }
  function onDragTouch(e){e.preventDefault();onDrag(e);}
  function stopDrag(){
    dragging=false;
    S.cut._scrubbing=false;
    document.removeEventListener('mousemove',onDrag);
    document.removeEventListener('mouseup',stopDrag);
    document.removeEventListener('touchmove',onDragTouch);
    document.removeEventListener('touchend',stopDrag);
  }

  ph.addEventListener('mousedown',startDrag);
  ph.addEventListener('touchstart',startDrag,{passive:false});
  ph.querySelector('.playhead-head').addEventListener('mousedown',startDrag);

  // Mouse wheel: default=horizontal scroll, Ctrl+wheel=zoom anchored to mouse
  const tlScroll2=$('tl-scroll');
  if(tlScroll2&&!tlScroll2._wheelZoom){
    tlScroll2._wheelZoom=true;
    tlScroll2.addEventListener('wheel',e=>{
      if(e.ctrlKey||e.metaKey){
        e.preventDefault();
        // Anchor zoom to mouse cursor position
        const rect2=tlScroll2.getBoundingClientRect();
        const mouseX=e.clientX-rect2.left+tlScroll2.scrollLeft;
        const mouseTime=mouseX/PPS;
        const oldPPS=PPS;
        PPS=Math.max(8,Math.min(600,PPS*(e.deltaY<0?1.18:0.85)));
        // Keep mouse position fixed after zoom
        tlScroll2.scrollLeft=Math.max(0,mouseTime*PPS-(e.clientX-rect2.left));
        renderCutTimeline();
      } else {
        // Default: horizontal scroll (no modifier needed)
        e.preventDefault();
        tlScroll2.scrollLeft+=e.deltaY*(e.shiftKey?3:1);
      }
    },{passive:false});
  }
  // Also allow clicking anywhere on ruler to set playhead
  // ── Expand ruler and rows to fit long content ──
  const _allClipsEnd = S.cut.clips.length ? Math.max(...S.cut.clips.map(c=>c.start+c.dur)) : 0;
  const _tlTotalDur  = Math.max(S.proj.dur, _allClipsEnd + 5);
  const _tlTotalWidth = _tlTotalDur * PPS;
  // Update ruler width AND regenerate tick marks to match actual content length
  const rulerEl = $('tl-ruler');
  if(rulerEl){
    rulerEl.style.width = _tlTotalWidth + 'px';
    // Adaptive step based on zoom (PPS) — like Premiere Pro
    const targetPx = 80; // target pixels between major marks
    const rawStep = targetPx / PPS;
    const nice = [1/30,1/24,0.5,1,2,5,10,15,30,60,120,300,600];
    const _step = nice.find(s=>s>=rawStep)||600;
    const _sub = _step/4;
    const marks = [];
    for(let s=0;s<=_tlTotalDur+_step;s+=_sub){
      const px=Math.round(s*PPS);
      if(Math.abs(Math.round(s/_step)*_step-s)<0.0001){
        marks.push("<div class='ruler-mark' style='left:"+px+"px'><span>"+fmtTC(s)+"</span></div>");
      } else {
        marks.push("<div style='position:absolute;left:"+px+"px;top:10px;width:1px;height:5px;background:rgba(255,255,255,0.15)'></div>");
      }
    }
    rulerEl.innerHTML = marks.join("");
  }
  const rowsEl = $('tl-rows');
  if(rowsEl) rowsEl.style.width = _tlTotalWidth + 'px';

  const ruler=$('tl-ruler');
  if(ruler && !ruler._listenerAttached){
    ruler._listenerAttached=true;
    ruler.addEventListener('mousedown',function(e){
      const rect=ruler.getBoundingClientRect();
      S.cut.ph=Math.max(0,Math.min(Math.max(S.proj.dur,S.cut.clips.length?Math.max(...S.cut.clips.map(c=>c.start+c.dur)):0),(e.clientX-rect.left+scroll.scrollLeft)/PPS));
      updateCutPH();syncCutVid();
      dragging=true;
      S.cut._scrubbing=true;
      const mv2=$('cut-main-vid');
      if(mv2&&!mv2.paused) mv2.pause();
      document.addEventListener('mousemove',function moveRuler(e){
        if(!dragging)return;
        S.cut.ph=Math.max(0,Math.min(Math.max(S.proj.dur,S.cut.clips.length?Math.max(...S.cut.clips.map(c=>c.start+c.dur)):0),(e.clientX-rect.left+scroll.scrollLeft)/PPS));
        const phEl=$('cut-ph');if(phEl)phEl.style.left=Math.round(S.cut.ph*PPS)+'px';
        const tc2=fmtFull(S.cut.ph,S.proj.fps);
        const a2=$('cut-pv-tc');if(a2)a2.textContent=tc2;
        const b2=$('cut-tl-tc');if(b2)b2.textContent=tc2;
        const mv3=$('cut-main-vid');
        if(mv3){
          const nc=S.cut.clips.find(c=>c.type==='video'&&S.cut.ph>=c.start&&S.cut.ph<c.start+c.dur);
          if(nc){const item3=S.cut.media[nc.mediaIdx];if(item3?.url){if(mv3.dataset.mediaIdx!==String(nc.mediaIdx)){mv3.dataset.mediaIdx=String(nc.mediaIdx);mv3.src=item3.url;}mv3.dataset.clipIdx=String(S.cut.clips.indexOf(nc));mv3.currentTime=(nc.fileStart||0)+Math.max(0,S.cut.ph-nc.start);mv3.style.display='block';}}
        }
      });
      document.addEventListener('mouseup',function(){dragging=false;S.cut._scrubbing=false;},{once:true});
    });
  }
}

// ── SCROLL SYNC: ruler + sidebar labels sync with tl-scroll ──
function setupTimelineScrollSync(){
  const scroll = $('tl-scroll');
  if(!scroll || scroll._syncAttached) return;
  scroll._syncAttached = true;
  scroll.addEventListener('scroll', () => {
    // Sync ruler horizontal position
    const ruler = $('tl-ruler');
    if(ruler) ruler.scrollLeft = scroll.scrollLeft;
    // Sync sidebar labels vertical position (alignment fix)
    const labels = document.getElementById('tl-track-labels');
    if(labels) labels.scrollTop = scroll.scrollTop;
  }, { passive: true });
}
window.setupTimelineScrollSync = setupTimelineScrollSync;



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
        <div class="ae-view" id="ae-view" style="position:relative">
          <div class="ae-canvas-wrap" id="ae-wrap"><canvas id="ae-cvs" style="display:block"></canvas></div>
          <video id="ae-vid" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:none"></video>
          <div id="ae-play-overlay" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none">
            <div id="ae-play-btn-big" onclick="aeToggleVideoPlay()" style="width:56px;height:56px;border-radius:50%;background:rgba(227,24,55,0.85);display:flex;align-items:center;justify-content:center;cursor:pointer;pointer-events:all;transition:all 0.15s;box-shadow:0 4px 20px rgba(0,0,0,0.4)">
              <svg id="ae-play-icon" width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M8 5V19L19 12Z"/></svg>
            </div>
          </div>
          <div id="ae-vid-tc" style="position:absolute;bottom:8px;right:12px;font-size:11px;font-family:DM Mono,monospace;color:rgba(255,255,255,0.7);background:rgba(0,0,0,0.5);padding:2px 8px;border-radius:4px;display:none">0:00</div>
        </div>
      </div>
      <div class="ae-rpanel">
        <div class="ae-tabs">
          <div class="ae-tab on" id="aetab-media" onclick="aeSwitchTab('media')">Media</div>
          <div class="ae-tab" id="aetab-effects" onclick="aeSwitchTab('effects')">Effects</div>
          <div class="ae-tab" id="aetab-layers" onclick="aeSwitchTab('layers')">Layers</div>
        </div>
        <div id="ae-p-media" class="ae-effect-list">
          <div class="media-dropzone" style="margin:9px" onclick="$('ae-file-input').click()">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--mu)" stroke-width="1.5" style="opacity:0.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <p style="font-size:12px;color:var(--mu);margin-top:6px">Import video / image</p>
          </div>
          <input type="file" id="ae-file-input" style="display:none" multiple accept="video/*,image/*">
          <div id="ae-media-bin" style="padding:4px;overflow-y:auto"></div>
        </div>
        <div id="ae-p-effects" class="ae-effect-list hidden">${AE_EFFECTS.map(e=>`<div class="ae-effect-item" onclick="this.classList.toggle('on');notify(this.classList.contains('on')?'${e.name} applied':'${e.name} removed')"><div class="ae-effect-dot" style="background:${e.color}"></div><div><div style="font-size:12px;font-weight:500">${e.name}</div><div style="font-size:10px;color:var(--mu2)">${e.cat}</div></div></div>`).join('')}</div>
        <div id="ae-p-layers" class="ae-effect-list hidden" style="padding:8px">${aeLayerMgmtHTML()}</div>
      </div>
    </div>
    <div class="ae-timeline" id="ae-tl" style="height:230px">${buildAETLHTML()}</div>`;

  aeInitCanvas();
  // If coming from Cut, play the Cut timeline instead of default animation
  if(S.ae._fromCut && S.ae.clips.length){
    setTimeout(()=>{
      aeRebuildMediaBin();
      // Auto-select first clip to show video
      if(S.ae.media.length) aeSelectMedia(0);
      // Set up playback from Cut timeline
      aeSetupCutPlayback();
    }, 100);
  } else {
    setTimeout(startAEAnimation, 50);
  }
  // Setup file input
  setTimeout(()=>{
    const fi=$('ae-file-input');
    if(fi) fi.addEventListener('change',()=>{ aeHandleFiles(fi.files); fi.value=''; });
    aeRebuildMediaBin();
  },100);
}

function aeHandleFiles(files){
  if(!files?.length) return;
  Array.from(files).forEach(f=>{
    if(!f.type.startsWith('video/')&&!f.type.startsWith('image/')) return;
    const url=URL.createObjectURL(f);
    const item={name:f.name,type:f.type.startsWith('video/')?'video':'image',url,duration:0,thumbnail:null};
    if(item.type==='video'){
      const v=document.createElement('video');v.src=url;
      v.onloadedmetadata=()=>{
        item.duration=v.duration;
        v.currentTime=0.5;
        v.onseeked=()=>{
          const tc=document.createElement('canvas');tc.width=64;tc.height=36;
          tc.getContext('2d').drawImage(v,0,0,64,36);
          item.thumbnail=tc.toDataURL();
          aeRebuildMediaBin();
        };
      };
    }
    S.ae.media.push(item);
    // Add as video layer in timeline
    S.ae.clips.push({mediaIdx:S.ae.media.length-1,name:f.name,start:0,dur:0,color:'rgba(88,166,255,0.8)'});
    aeRebuildMediaBin();
    notify(f.name+' imported to Motion','#3fb950');
  });
}

function aeRebuildMediaBin(){
  const bin=$('ae-media-bin'); if(!bin) return;
  if(!S.ae.media.length){bin.innerHTML='<div style="padding:10px;font-size:11px;color:var(--mu2);text-align:center">No media yet</div>';return;}
  bin.innerHTML=S.ae.media.map((item,i)=>`
    <div class="mbin-item" onclick="aeSelectMedia(${i})" style="cursor:pointer;${S.ae._selMedia===i?'background:rgba(227,24,55,0.15)':''}">
      <div class="mbin-thumb">${item.thumbnail?`<img src="${item.thumbnail}" style="width:100%;height:100%;object-fit:cover">`:(item.type==='image'?`<img src="${item.url}" style="width:100%;height:100%;object-fit:cover">`:'🎬')}</div>
      <div style="flex:1;min-width:0">
        <div class="mbin-name">${item.name}</div>
        <div class="mbin-dur">${item.duration>0?fmtTC(item.duration):'--'}</div>
      </div>
    </div>`).join('');
}

function aeToggleVideoPlay(){
  const vid=$('ae-vid');
  if(!vid||vid.style.display==='none') return;
  const icon=$('ae-play-icon');
  if(vid.paused){
    // Resume from correct clip position
    const clips=S.ae.clips?S.ae.clips.sort((a,b)=>a.start-b.start):[];
    const ci=S.ae._cutPlayIdx||0;
    const c=clips[ci];
    if(c){
      const targetTime=c.fileStart||0;
      // Only seek if far off (e.g. after src change)
      if(Math.abs(vid.currentTime-targetTime)>c.dur){
        vid.currentTime=targetTime;
        vid.addEventListener('seeked',()=>vid.play().catch(()=>{}),{once:true});
      } else {
        vid.play().catch(()=>{});
      }
    } else {
      vid.play().catch(()=>{});
    }
    if(icon) icon.innerHTML='<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
  } else {
    vid.pause();
    if(icon) icon.innerHTML='<path d="M8 5V19L19 12Z"/>';
  }
}

function aeJumpToClip(clips, idx, vid, autoPlay){
  // Jump to a specific clip index — waits for seek before playing
  if(idx >= clips.length) idx = 0;
  S.ae._cutPlayIdx = idx;
  const c = clips[idx];
  const item = S.ae.media[c.mediaIdx];
  if(!item?.url) return;
  const targetTime = c.fileStart || 0;
  // Change src if different file
  if(vid.dataset.aeSrc !== item.url){
    vid.dataset.aeSrc = item.url;
    vid.src = item.url;
  }
  // Wait for seeked before playing
  const doPlay = ()=>{
    if(autoPlay) vid.play().catch(()=>{});
  };
  vid.pause();
  if(Math.abs(vid.currentTime - targetTime) > 0.05){
    vid.currentTime = targetTime;
    vid.addEventListener('seeked', doPlay, {once:true});
    setTimeout(()=>{ vid.removeEventListener('seeked', doPlay); doPlay(); }, 500);
  } else {
    doPlay();
  }
}

function aeSetupCutPlayback(){
  const vid = $('ae-vid');
  const cvs = $('ae-cvs');
  if(!vid || !S.ae.clips.length) return;
  const clips = S.ae.clips.sort((a,b)=>a.start-b.start);

  // Show video, hide canvas
  vid.style.display = 'block';
  if(cvs) cvs.style.display = 'none';
  const playOverlay = $('ae-play-overlay');
  const vidTc = $('ae-vid-tc');
  if(playOverlay) playOverlay.style.display = 'flex';
  if(vidTc) vidTc.style.display = 'block';

  S.ae._cutPlayIdx = 0;

  // Remove any old listener
  vid.ontimeupdate = null;
  vid.onpause = null;
  vid.onplay = null;

  vid.ontimeupdate = ()=>{
    const ci = S.ae._cutPlayIdx;
    if(ci >= clips.length) return;
    const c = clips[ci];
    const endInFile = (c.fileStart||0) + c.dur;

    // Check if current clip has ended
    if(vid.currentTime >= endInFile - 0.05){
      const nextIdx = ci + 1 < clips.length ? ci + 1 : 0;
      aeJumpToClip(clips, nextIdx, vid, true);
      return;
    }

    // Update timecodes
    const tPos = c.start + (vid.currentTime - (c.fileStart||0));
    const tc = $('ae-tc');
    if(tc) tc.textContent = fmtFull(Math.max(0,tPos), S.proj.fps);
    if(vidTc) vidTc.textContent = fmtFull(Math.max(0,tPos), S.proj.fps);
  };

  vid.onpause = ()=>{ const i=$('ae-play-icon'); if(i) i.innerHTML='<path d="M8 5V19L19 12Z"/>'; };
  vid.onplay  = ()=>{ const i=$('ae-play-icon'); if(i) i.innerHTML='<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>'; };

  // Jump to first clip and show first frame (don't auto-play)
  aeJumpToClip(clips, 0, vid, false);
  notify('Cut timeline loaded — '+clips.length+' clip(s) · '+S.ae._cutDuration?.toFixed(1)+'s','#d29922');
}

function aeSelectMedia(i){
  S.ae._selMedia=i;
  const item=S.ae.media[i];
  if(!item) return;
  aeRebuildMediaBin();
  // Show video/image in composition view
  const vid=$('ae-vid');
  const cvs=$('ae-cvs');
  if(item.type==='video'&&vid){
    vid.src=item.url;
    vid.style.display='block';
    if(cvs) cvs.style.display='none';
    const po=$('ae-play-overlay');if(po) po.style.display='flex';
    const vtc=$('ae-vid-tc');if(vtc) vtc.style.display='block';
    vid.onloadedmetadata=()=>{
      if(S.ae.clips[i]) S.ae.clips[i].dur=vid.duration;
    };
    vid.play().catch(()=>{});
    notify('Playing: '+item.name);
  } else if(item.type==='image'&&cvs){
    vid.style.display='none';
    cvs.style.display='block';
    const img=new Image();
    img.onload=()=>{
      const ctx=cvs.getContext('2d');
      ctx.clearRect(0,0,cvs.width,cvs.height);
      ctx.drawImage(img,0,0,cvs.width,cvs.height);
    };
    img.src=item.url;
  }
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
function aeSwitchTab(name){
  ['media','effects','layers'].forEach(n=>{
    const tab=$('aetab-'+n);
    const panel=$('ae-p-'+n);
    if(tab) tab.classList.toggle('on',n===name);
    if(panel) panel.classList.toggle('hidden',n!==name);
  });
}
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
    if (e.code==='Delete'||e.code==='Backspace'){
      e.preventDefault();
      deleteSelected();
    }
    if ((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.code==='KeyZ'){e.preventDefault();cutRedo();}
    else if ((e.ctrlKey||e.metaKey)&&e.code==='KeyZ'){e.preventDefault();cutUndo();}
    if ((e.ctrlKey||e.metaKey)&&e.code==='KeyY'){e.preventDefault();cutRedo();}
    // Ctrl+D: duplicate selected clip
    if ((e.ctrlKey||e.metaKey)&&e.code==='KeyD'){e.preventDefault();cutDuplicate();}
    // Tool shortcuts
    if(!e.ctrlKey&&!e.metaKey&&e.code==='KeyV') setCutTool('select');
    if(!e.ctrlKey&&!e.metaKey&&e.code==='KeyP') setCutTool('pen');
    if(!e.ctrlKey&&!e.metaKey&&e.code==='KeyT') setCutTool('text');
    if(!e.ctrlKey&&!e.metaKey&&e.code==='KeyR') setCutTool('shape');
    // Arrow keys: move playhead frame by frame
    if (!e.ctrlKey&&!e.metaKey&&e.code==='ArrowRight'){e.preventDefault();const fps=S.proj.fps||30;S.cut.ph=Math.min(S.cut.ph+(e.shiftKey?1:1/fps),99999);updateCutPH();syncCutVid();}
    if (!e.ctrlKey&&!e.metaKey&&e.code==='ArrowLeft'){e.preventDefault();const fps=S.proj.fps||30;S.cut.ph=Math.max(0,S.cut.ph-(e.shiftKey?1:1/fps));updateCutPH();syncCutVid();}
    // = / - keys: zoom in/out anchored to playhead
    if(e.code==='Equal'||e.code==='NumpadAdd'){e.preventDefault();
      const sc=$('tl-scroll');if(sc){
        const phPx=S.cut.ph*PPS-sc.scrollLeft;
        PPS=Math.min(600,PPS*1.25);
        sc.scrollLeft=Math.max(0,S.cut.ph*PPS-phPx);
        renderCutTimeline();
      }
    }
    if(e.code==='Minus'||e.code==='NumpadSubtract'){e.preventDefault();
      const sc=$('tl-scroll');if(sc){
        const phPx=S.cut.ph*PPS-sc.scrollLeft;
        PPS=Math.max(8,PPS*0.8);
        sc.scrollLeft=Math.max(0,S.cut.ph*PPS-phPx);
        renderCutTimeline();
      }
    }
  }
  if (S.app==='canvas') {
    if (e.code==='KeyB') cvSetTool('brush');
    if (e.code==='KeyE') cvSetTool('eraser');
    if (e.code==='KeyT') cvSetTool('text');
    if (e.code==='KeyZ') cvSetTool('zoom');
    if ((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.code==='KeyZ'){e.preventDefault();cvRedo();}
    else if ((e.ctrlKey||e.metaKey)&&e.code==='KeyZ'){e.preventDefault();cvUndo();}
  }

  if ((e.ctrlKey||e.metaKey)&&e.code==='KeyS'){e.preventDefault();doSave();}
});

// ── CONTEXT MENUS ──
function showContextMenu(e, items){
  e.preventDefault(); e.stopPropagation();
  document.querySelectorAll('.ctx-menu').forEach(m=>m.remove());
  const menu=document.createElement('div');
  menu.className='ctx-menu';
  // Estimate menu height (each item ~34px + padding)
  const estHeight = items.length * 34 + 16;
  const estWidth = 220;
  // Position: flip up if near bottom, flip left if near right edge
  const x = Math.min(e.clientX, window.innerWidth - estWidth - 10);
  const y = (e.clientY + estHeight > window.innerHeight - 40)
    ? Math.max(10, e.clientY - estHeight)
    : e.clientY;
  menu.style.cssText=`position:fixed;left:${x}px;top:${y}px;background:#1a1f2c;border:1px solid rgba(255,255,255,0.13);border-radius:9px;padding:4px;z-index:9999;min-width:200px;box-shadow:0 8px 32px rgba(0,0,0,0.6);animation:ddIn 0.1s ease`;
  items.forEach(item=>{
    if(item.sep){
      const s=document.createElement('div');
      s.style.cssText='height:1px;background:rgba(255,255,255,0.07);margin:3px 6px';
      menu.appendChild(s);
      return;
    }
    const el=document.createElement('div');
    el.style.cssText=`padding:7px 13px;font-size:12px;border-radius:5px;cursor:pointer;color:${item.danger?'#ff6b6b':'var(--tx)'};display:flex;align-items:center;gap:8px`;
    el.innerHTML=`<span style="font-size:14px">${item.icon||'▸'}</span><span>${item.label}</span>`;
    el.addEventListener('mouseenter',()=>el.style.background='rgba(255,255,255,0.07)');
    el.addEventListener('mouseleave',()=>el.style.background='');
    el.addEventListener('click',()=>{menu.remove();item.fn();});
    menu.appendChild(el);
  });
  document.body.appendChild(menu);
  // Close on outside click
  setTimeout(()=>document.addEventListener('click',function close(){menu.remove();document.removeEventListener('click',close);},{once:true}),10);
}

// Track label right-click → delete track
function trackLabelContextMenu(e, trackIdx){
  const isAudio = trackIdx >= S.cut.videoTracks;
  const trackType = isAudio ? 'audio' : 'video';
  const clipsOnTrack = S.cut.clips.filter(c=>c.track===trackIdx);
  showContextMenu(e,[
    {icon:'🗑️', label:`Delete ${trackType.charAt(0).toUpperCase()+trackType.slice(1)} Track`, danger:true, fn:()=>{
      if(clipsOnTrack.length>0){
        const ok=confirm('Delete track and all '+clipsOnTrack.length+' clip(s) on it?');
        if(!ok)return;
        // Remove all clips on this track
        S.cut.clips=S.cut.clips.filter(c=>c.track!==trackIdx);
        // Shift clips on higher tracks down by 1
        S.cut.clips.forEach(c=>{if(c.track>trackIdx)c.track--;});
      } else {
        S.cut.clips.forEach(c=>{if(c.track>trackIdx)c.track--;});
      }
      if(isAudio) S.cut.audioTracks=Math.max(1,S.cut.audioTracks-1);
      else S.cut.videoTracks=Math.max(1,S.cut.videoTracks-1);
      rebuildTrackLabels();
      renderCutTimeline();
      setupPlayheadDrag();
      notify('Track deleted','#3fb950');
    }},
    {sep:true},
    {icon:'➕', label:'Add Video Track Above', fn:()=>{cutAddTrack('video');}},
    {icon:'➕', label:'Add Audio Track', fn:()=>{cutAddTrack('audio');}},
  ]);
}

// Clip right-click → context menu
function clipContextMenu(e, ci){
  S.cut.sel=ci;
  renderCutTimeline();
  const c=S.cut.clips[ci];
  showContextMenu(e,[
    {icon:'✂️', label:'Split at Playhead', fn:()=>cutSplit()},
    {sep:true},
    {icon:'⬅️', label:'Trim Start to Playhead', fn:()=>{
      const ph=S.cut.ph;
      if(ph>c.start&&ph<c.start+c.dur){
        const trimAmt=ph-c.start;
        // Trim video clip
        c.fileStart=(c.fileStart||0)+trimAmt;
        c.dur-=trimAmt;
        c.start=ph;
        // Sync linked audio
        const linkedA=S.cut.clips.find(a=>a.linkedToVideo&&a.mediaIdx===c.mediaIdx&&Math.abs(a.start-(c.start-trimAmt))<0.2);
        if(linkedA){linkedA.fileStart=(linkedA.fileStart||0)+trimAmt;linkedA.dur-=trimAmt;linkedA.start=ph;}
        renderCutTimeline();notify('Trimmed from start');
      } else notify('Playhead not on clip','#E31837');
    }},
    {icon:'➡️', label:'Trim End to Playhead', fn:()=>{
      const ph=S.cut.ph;
      if(ph>c.start&&ph<c.start+c.dur){
        const newDur=ph-c.start;
        c.dur=newDur;
        // Sync linked audio
        const linkedA=S.cut.clips.find(a=>a.linkedToVideo&&a.mediaIdx===c.mediaIdx&&Math.abs(a.start-c.start)<0.2);
        if(linkedA) linkedA.dur=newDur;
        renderCutTimeline();notify('Trimmed to end');
      } else notify('Playhead not on clip','#E31837');
    }},
    {sep:true},
    {icon:'🔗', label:'Merge with Next Clip', fn:()=>mergeWithNext(ci)},
    {icon:'🔗', label:'Merge with Previous Clip', fn:()=>mergeWithPrev(ci)},
    {sep:true},
    {icon:'🗑️', label:'Delete Clip + Audio', danger:true, fn:()=>{
      // Delete video clip
      S.cut.clips.splice(ci,1);
      // Also delete linked audio clip
      const linkedIdx=S.cut.clips.findIndex(a=>a.linkedToVideo&&a.mediaIdx===c.mediaIdx&&Math.abs(a.start-c.start)<0.5);
      if(linkedIdx>=0) S.cut.clips.splice(linkedIdx,1);
      S.cut.sel=null;
      renderCutTimeline();notify('Clip + audio deleted');scheduleSave();
    }},
    {icon:'🎬', label:'Delete Video Only', danger:true, fn:()=>{
      S.cut.clips.splice(ci,1);
      S.cut.sel=null;
      renderCutTimeline();notify('Video clip deleted');scheduleSave();
    }},
    {sep:true},
    {icon:'⚡', label:'Speed / Duration…', fn:()=>showSpeedDialog(ci)},
    {icon:'⚙️', label:'Scale & Rotation…', fn:()=>window.showTransformDialog(ci)},
    ...(c.type==='audio'?[{icon:'🎵', label:'Audio Enhancement…', fn:()=>window.showAudioEnhanceDialog&&showAudioEnhanceDialog(ci)}]:[]),
  ]);
}

function mergeWithNext(ci){
  const c=S.cut.clips[ci];
  const next=S.cut.clips.find((c2,i2)=>i2!==ci&&c2.track===c.track&&Math.abs(c2.start-(c.start+c.dur))<0.5&&c2.mediaIdx===c.mediaIdx);
  if(!next){notify('No adjacent clip to merge on same track','#E31837');return;}
  c.dur=next.start+next.dur-c.start;
  const ni=S.cut.clips.indexOf(next);
  // Also merge linked audio
  const audioLinked=S.cut.clips.find(a=>a.linkedToVideo&&a.mediaIdx===c.mediaIdx&&Math.abs(a.start-next.start)<0.2);
  const audioBase=S.cut.clips.find(a=>a.linkedToVideo&&a.mediaIdx===c.mediaIdx&&Math.abs(a.start-c.start)<0.2&&a!==audioLinked);
  if(audioBase&&audioLinked){audioBase.dur=c.dur;S.cut.clips.splice(S.cut.clips.indexOf(audioLinked),1);}
  S.cut.clips.splice(ni,1);
  renderCutTimeline();notify('Clips merged ✓','#3fb950');scheduleSave();
}

function mergeWithPrev(ci){
  const c=S.cut.clips[ci];
  const prev=S.cut.clips.find((c2,i2)=>i2!==ci&&c2.track===c.track&&Math.abs((c2.start+c2.dur)-c.start)<0.5&&c2.mediaIdx===c.mediaIdx);
  if(!prev){notify('No adjacent clip before this one','#E31837');return;}
  // Extend prev to cover both
  prev.dur=c.start+c.dur-prev.start;
  // Also merge linked audio
  const audioC=S.cut.clips.find(a=>a.linkedToVideo&&a.mediaIdx===c.mediaIdx&&Math.abs(a.start-c.start)<0.2);
  const audioPrev=S.cut.clips.find(a=>a.linkedToVideo&&a.mediaIdx===c.mediaIdx&&Math.abs(a.start-prev.start)<0.2&&a!==audioC);
  if(audioPrev&&audioC){audioPrev.dur=prev.dur;S.cut.clips.splice(S.cut.clips.indexOf(audioC),1);}
  S.cut.clips.splice(ci,1);
  renderCutTimeline();notify('Merged with previous ✓','#3fb950');scheduleSave();
}

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
window.cutToggleEffect = cutToggleEffect;
window.cutAddTrack = cutAddTrack;
window.rebuildTrackLabels = rebuildTrackLabels;
window.showEffectIndicator = showEffectIndicator;
window.getPoolVid = getPoolVid;
window.cutUpdateEffect = cutUpdateEffect;
window.cutAddTrack = cutAddTrack;
window.refreshEffectsPanel = refreshEffectsPanel;
window.cutBinDragStart = cutBinDragStart;
window.cutSelMedia = cutSelMedia;
window.cutAddToTL = cutAddToTL;
window.cutTogglePlay = cutTogglePlay;
window.syncCutVid = syncCutVid;
window.cutSplit          = cutSplit;
window.cutDelete         = cutDelete;
window.cutDuplicate       = cutDuplicate;
window.renderCutTimeline  = renderCutTimeline;
window.updatePropsPanel   = updatePropsPanel;
window.applyVideoEffects  = applyVideoEffects;
window.rebuildTrackLabels = rebuildTrackLabels;
// Audio FX is defined in cut-features.js — re-export after it loads
setTimeout(()=>{
  if(window.showAudioEnhanceDialog) return; // already set by cut-features.js
  window.showAudioEnhanceDialog = (ci) => {
    if(window.createModal) window.showAudioFxDialog?.();
    else notify('Audio FX dialog not ready yet','#E31837');
  };
},200);
window.cutUndo = cutUndo;
window.cutRedo = cutRedo;
window.cutSaveHistory = cutSaveHistory;
window.clipContextMenu = clipContextMenu;
window.trackLabelContextMenu = trackLabelContextMenu;
window.mergeWithNext = mergeWithNext;
window.mergeWithPrev = mergeWithPrev;
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
window.sendToMotion = sendToMotion;
window.sendCutToMotion = sendCutToMotion;
window.sendToCut = sendToCut;
window.aeSetupCutPlayback = aeSetupCutPlayback;
window.aeToggleVideoPlay = aeToggleVideoPlay;
window.aeJumpToClip = aeJumpToClip;
window.aeHandleFiles = aeHandleFiles;
window.aeSelectMedia = aeSelectMedia;
window.aeRebuildMediaBin = aeRebuildMediaBin;
window.doSave = doSave;
window.doExport = doExport;
window.showExportModal = showExportModal;
window.startExport = startExport;
window.openApp = openApp;
window.$ = $;
