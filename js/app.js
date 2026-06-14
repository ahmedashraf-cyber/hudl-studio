// ═══════════════════════════════════════
// GLOBAL STATE
// ═══════════════════════════════════════
const S = {
  user: null,
  projects: [],
  currentProject: null,
  app: null,
  proj: { name: 'Untitled', w: 1920, h: 1080, fps: 60, dur: 30 },
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
        // Strip runtime-only properties that are too large for Firestore (1MB limit):
        // _imgData = base64 frame-hold image (can be 100-500KB per clip)
        // _img = Image element reference (not serializable)
        clips: S.cut.clips.map(c => {
          if(c._imgData || c._img) {
            const {_imgData, _img, ...rest} = c;
            return rest;
          }
          return c;
        }),
        // BUG4 FIX: save effects keyed by clip UUID not array index
        // so they survive any reordering of the clips array on reload
        effects: (()=>{
          const byId = {};
          Object.entries(S.cut.effects || {}).forEach(([idx, efArr]) => {
            const clip = S.cut.clips[parseInt(idx)];
            const key = clip?.mediaId ? (clip.mediaId + '_' + idx) : String(idx);
            byId[key] = efArr;
          });
          return byId;
        })(),
        videoTracks: S.cut.videoTracks,
        audioTracks: S.cut.audioTracks,
        mutedTracks: S.cut.mutedTracks || {},   // BUG2 FIX: persist muted state
        overlays: (window._overlays || []).map(o => ({...o, _img: undefined, _imgData: undefined})),
        media: S.cut.media.map(m => ({
          name: m.name,
          id: m.id || m.mediaId || null,      // UUID — permanent identity
          mediaId: m.mediaId || m.id || null, // kept for compat
          type: m.type,
          duration: m.duration || 0,
          width: m.width || null,
          height: m.height || null,
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
  // Ensure Firestore network is active (handles browser tab resume / offline recovery)
  try { await db.enableNetwork(); } catch(_) {}
  // Try up to 2 times with a short delay between attempts
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      S.projects = await getUserProjects(S.user.uid);
      renderProjectsList();
      return;
    } catch (e) {
      console.error('loadUserProjects error (attempt ' + attempt + '):', e.code, e.message, e);
      if (attempt < 2) {
        // Wait 1.5s then retry once
        await new Promise(r => setTimeout(r, 1500));
        if (el) el.innerHTML = '<div class="empty-projects" style="color:var(--mu2);padding:20px;text-align:center;font-size:13px">Retrying…</div>';
      } else {
        if (el) el.innerHTML =
          '<div class="empty-projects" style="padding:20px;text-align:center;font-size:13px;color:#ff6b6b">' +
          'Could not load projects.<br><span style="color:var(--mu2);font-size:11px">' + (e.message || e.code || 'Unknown error') + '</span><br><br>' +
          '<button onclick="loadUserProjects()" style="background:var(--red);color:#fff;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px">Retry</button>' +
          '</div>';
      }
    }
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
  const fps = parseInt($('np-fps')?.value) || 30;
  const resPreset = $('np-res-preset')?.value || '1920x1080';
  // Resolution: read from inputs (preset selector keeps them in sync)
  const w = parseInt($('np-w')?.value) || 1920;
  const h = parseInt($('np-h')?.value) || 1080;
  const autoRes = resPreset === 'auto'; // flag to auto-inherit from first video
  // Duration: always open-ended (3600s = 1hr workspace; timeline expands dynamically with content)
  const dur = 3600;

  const btn = $('np-create-btn');
  if (btn) { btn.textContent = 'Creating…'; btn.disabled = true; }

  try {
    if (!S.user) throw new Error('Not signed in');
    const id = await createProject(S.user.uid, { name, appType, width: w, height: h, fps, duration: dur });
    const project = { id, name, appType, width: w, height: h, fps, duration: dur, state: {} };
    S.currentProject = project;
    S.proj = { w, h, fps, dur, autoRes };
    // Reset cut state for fresh project
    S.cut = { clips:[], media:[], effects:{}, sel:null, ph:0, playing:false,
              videoTracks:2, audioTracks:2, tick:null, _hist:[], _histIdx:-1 };
    window._overlays = [];
    window._overlayIdCounter = 0;
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
    S.proj = { w: project.width||1920, h: project.height||1080, fps: project.fps||30, dur: 3600 };

    // Restore Cut state from saved Firestore state
    // project.state is stored as JSON string (via JSON.stringify in saveProjectState)
    const _stateRaw = project.state;
    const _stateParsed = typeof _stateRaw === 'string'
      ? (() => { try{ return JSON.parse(_stateRaw); }catch(e){ return {}; } })()
      : (_stateRaw || {});
    const cs = _stateParsed?.cut || {};

    // ── Restore media files from IndexedDB ──
    let restoredMedia = [];
    try {
      const storedFiles = await loadMediaFiles(id);
      const savedMeta = cs.media || [];

      // ── ID-FIRST restore with consumption pool ────────────────────────────
      // BUG3 FIX: use a mutable pool so two savedMeta entries with the same
      // filename each get their own distinct IDB blob, not both the first match.
      const _pool = storedFiles.slice();

      restoredMedia = savedMeta.map(m => {
        const savedId = m.id || m.mediaId;
        // 1. UUID match — exact, collision-free
        let idx = savedId ? _pool.findIndex(sf => sf.mediaId === savedId) : -1;
        // 2. Legacy name fallback — consume the match so next same-name entry
        //    gets the next IDB record, not the same first one again
        if (idx === -1) idx = _pool.findIndex(sf => sf.name === m.name);
        const base = { ...m, id: savedId || null, mediaId: savedId || null };
        if (idx !== -1) {
          const sf = _pool.splice(idx, 1)[0];
          return { ...base, url: sf.url, file: sf.blob };
        }
        return { ...base, url: null };
      });

      // ── Migration: assign permanent UUIDs to any items that still lack one ──
      const _now = Date.now();
      const _migratedItems = []; // track which items got new UUIDs so we can re-save to IDB
      restoredMedia.forEach((m, idx) => {
        if (!m.id) {
          m.id = id + '_migr_' + _now + '_' + idx + '_' + Math.random().toString(36).slice(2,5);
          m.mediaId = m.id;
          if (m.file) _migratedItems.push(m); // has blob — re-save with UUID key
        }
      });

      // BUG3 ROOT FIX: re-save migrated blobs to IDB under their new UUID keys.
      // Without this, next reload falls back to name-matching again because IDB
      // only has the legacy key (projectId/filename) with no mediaId — not the
      // migration UUID. Re-saving under UUID key makes all future reloads use
      // the exact UUID path, permanently breaking the name-collision chain.
      if (_migratedItems.length > 0 && window.saveMediaFile) {
        _migratedItems.forEach(m => {
          // Re-save blob under UUID key — fire-and-forget (don't block UI)
          const _blob = m.file instanceof Blob ? m.file : new Blob([m.file]);
          const _file = new File([_blob], m.name, { type: _blob.type || 'video/mp4' });
          saveMediaFile(id, _file, m.id).catch(e =>
            console.warn('[BUG3] UUID re-save failed for', m.name, e)
          );
        });
      }

      // Also remap any clips that still reference numeric mediaIdx → migrate to mediaId
      const _savedClips = cs.clips || [];
      _savedClips.forEach(c => {
        if (c.mediaIdx !== undefined && c.mediaIdx !== null && !c.mediaId) {
          const m = restoredMedia[c.mediaIdx];
          if (m) { c.mediaId = m.id; }
          delete c.mediaIdx;
        }
      });

      // Add any orphaned IndexedDB files not already in meta (UUID-only, no name match)
      storedFiles.forEach(sf => {
        const alreadyRestored = restoredMedia.some(m =>
          sf.mediaId && (m.id === sf.mediaId || m.mediaId === sf.mediaId)
        );
        if (!alreadyRestored && sf.mediaId) {
          restoredMedia.push({
            name: sf.name, id: sf.mediaId, mediaId: sf.mediaId,
            type: sf.type.startsWith('video') ? 'video' : sf.type.startsWith('audio') ? 'audio' : 'image',
            url: sf.url, file: sf.blob, duration: 0, thumbnail: null
          });
        }
      });
    } catch(e) {
      console.warn('Could not restore media from IndexedDB:', e);
      restoredMedia = (cs.media || []).map(m => ({...m, url: null}));
    }

    S.cut = {
      clips:       cs.clips       || [],
      effects:     cs.effects     || {},
      videoTracks: cs.videoTracks || 2,  // default=2 matches new-project creation default
      audioTracks: cs.audioTracks || 2,
      mutedTracks: cs.mutedTracks || {},
      media:       restoredMedia,
      sel: null, ph: 0, playing: false, tick: null, _hist: [], _histIdx: -1
    };

    // BUG2 FIX: infer videoTracks/audioTracks from clip data for old projects
    // where these fields were never saved to Firestore (cs.videoTracks=undefined)
    if (!cs.videoTracks) {
      const _vClips = S.cut.clips.filter(c => c.type==='video'||c.type==='image'||c.type==='frame_hold');
      const _aClips = S.cut.clips.filter(c => c.type==='audio');
      const _maxV = _vClips.length ? Math.max(..._vClips.map(c=>c.track||0)) + 1 : 1;
      const _minA = _aClips.length ? Math.min(..._aClips.map(c=>c.track||999)) : null;
      S.cut.videoTracks = _minA !== null ? Math.min(_maxV, _minA) : _maxV;
      S.cut.videoTracks = Math.max(1, S.cut.videoTracks);
      const _maxA = _aClips.length ? Math.max(..._aClips.map(c=>c.track||0)) : S.cut.videoTracks;
      S.cut.audioTracks = Math.max(1, _maxA - S.cut.videoTracks + 1);
    }

    // Validate clip tracks: ensure video clips stay on video rows, audio on audio rows
    // This fixes any misassignment from saved state or old default mismatch
    S.cut.clips.forEach(c => {
      const isVisual = c.type==='video'||c.type==='image'||c.type==='frame_hold';
      const isAudio  = c.type==='audio';
      if (isVisual && c.track >= S.cut.videoTracks) {
        c.track = Math.min(c.track, S.cut.videoTracks - 1);
      } else if (isAudio && c.track < S.cut.videoTracks) {
        c.track = S.cut.videoTracks;  // bump to first audio row
      }
    });
    // BUG4 FIX: remap effects from UUID-keyed back to array-index-keyed
    // Handles both old format (numeric keys) and new format (UUID_idx keys)
    if(S.cut.effects && S.cut.clips.length){
      const remapped = {};
      Object.entries(S.cut.effects).forEach(([key, efArr]) => {
        // New format: "mediaId_idx" — extract the index part
        if(key.includes('_') && isNaN(parseInt(key))){
          // Find clip by matching the UUID prefix
          const [uuid, ...rest] = key.split('_');
          // Try to find by exact clip UUID match first
          const ci = S.cut.clips.findIndex(c => c.mediaId === uuid ||
            key.startsWith(c.mediaId + '_'));
          if(ci >= 0) remapped[ci] = efArr;
          else {
            // Fallback: try numeric index from end of key
            const numIdx = parseInt(rest[rest.length-1]);
            if(!isNaN(numIdx) && numIdx < S.cut.clips.length) remapped[numIdx] = efArr;
          }
        } else {
          // Old format: pure numeric index — keep as-is
          const numIdx = parseInt(key);
          if(!isNaN(numIdx)) remapped[numIdx] = efArr;
        }
      });
      S.cut.effects = remapped;
    }

    // Restore overlays
    window._overlays = (cs.overlays || []).map(o => ({...o, _img: undefined, _imgData: undefined}));
    window._overlayIdCounter = window._overlays.reduce((max, o) => {
      const n = parseInt((o.id||'').replace('ov_',''))||0; return Math.max(max,n);
    }, window._overlayIdCounter||0);

    // Restore image_bg overlay blob URLs from media library (blob URLs die on reload)
    // Primary path: overlay has mediaIdx → use the already-restored media url
    // Fallback: match by name in IndexedDB stored files
    const _imgBgOverlays = window._overlays.filter(o => o.type === 'image_bg' && o.bgType === 'image' && o.name);
    if(_imgBgOverlays.length > 0){
      // First pass: try to restore from restoredMedia using mediaIdx
      _imgBgOverlays.forEach(o => {
        if(o.mediaId){
          const mItem = restoredMedia.find(m=>m.id===o.mediaId);
          if(mItem && mItem.url){
            o.url  = mItem.url;
            o._img = null;
          }
        }
      });
      // Second pass: any still missing → scan IndexedDB by name
      const _stillMissing = _imgBgOverlays.filter(o => !o.url || o.url.startsWith('blob:') === false);
      if(_stillMissing.length > 0 || _imgBgOverlays.some(o => !o.url)){
        loadMediaFiles(id).then(storedFiles => {
          _imgBgOverlays.forEach(o => {
            if(o.url) return; // already restored
            const match = storedFiles.find(sf => sf.name === o.name || sf.name === 'ov_' + o.name);
            if(match){ o.url = match.url; o._img = null; }
          });
          if(window.syncCutVid) syncCutVid();
        }).catch(e => console.warn('Could not restore overlay images:', e));
      } else {
        // All restored via mediaIdx — just redraw
        setTimeout(() => { if(window.syncCutVid) syncCutVid(); }, 100);
      }
    }

    window._vpZoom = 1; // reset viewport zoom on project open
    openApp(project.appType || 'cut');
    const missingFiles = restoredMedia.filter(m => !m.url).length;
    if (missingFiles > 0) {
      notify('Opened — ' + missingFiles + ' file(s) need re-importing', '#d29922');
    } else {
      notify('Opened: ' + project.name, '#3fb950');
    }
    // Regenerate _imgData for frame_hold clips (stripped on save, must be rebuilt on load)
    _regenerateFrameHolds();
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
  // TotalMatch opens as its own full page
  if(name === 'totalmatch'){
    window.location.href = '/totalmatch.html';
    return;
  }
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

  // Store base (fit) dimensions so _applyVpZoom can scale from them
  frame._baseW = pw;
  frame._baseH = ph2;

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

  // Wire hover tracking for viewport zoom (once only)
  if(!screen._vpHooked){
    screen._vpHooked = true;
    screen.addEventListener('mouseenter', () => { window._mouseOverViewport = true; });
    screen.addEventListener('mouseleave', () => { window._mouseOverViewport = false; });
    // Ctrl+wheel over viewport → zoom viewport
    screen.addEventListener('wheel', e => {
      if(!window._mouseOverViewport) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1/1.1;
      window._vpZoom = Math.max(0.25, Math.min(4, (window._vpZoom||1) * factor));
      _applyVpZoom();
    }, {passive: false});
  }

  // Apply current zoom (reset to 1 on new project open)
  window._vpZoom = window._vpZoom || 1;
  _applyVpZoom();
}
window.applyCanvasAspectRatio = applyCanvasAspectRatio;

// ── Viewport Zoom ─────────────────────────────────────────────────────────────
// Scales cut-viewport-frame independently of timeline PPS zoom.
// Uses CSS transform so nothing else (overlays, bbox, event coords) is affected —
// the frame's logical size stays the same; only its visual presentation scales.
function _applyVpZoom(){
  const frame  = document.getElementById('cut-viewport-frame');
  const screen = document.getElementById('cut-screen');
  if(!frame || !screen) return;

  const z = window._vpZoom || 1;

  // At zoom=1 the frame fits snugly. At zoom>1 we scale up and let cut-screen scroll.
  // We set transform-origin to center so zoom is centered on the preview.
  frame.style.transformOrigin = '50% 50%';
  frame.style.transform       = z === 1 ? '' : `scale(${z.toFixed(3)})`;

  // cut-screen needs overflow:auto when zoomed so user can pan
  screen.style.overflow = z > 1 ? 'auto' : 'visible';

  // When zoomed in, expand cut-screen's scroll area to fit the scaled frame.
  // We do this with a transparent spacer div.
  let spacer = document.getElementById('cut-vp-spacer');
  if(z > 1){
    const bW = (frame._baseW || frame.offsetWidth)  * z;
    const bH = (frame._baseH || frame.offsetHeight) * z;
    if(!spacer){
      spacer = document.createElement('div');
      spacer.id = 'cut-vp-spacer';
      spacer.style.cssText = 'position:absolute;pointer-events:none;top:0;left:0;';
      screen.appendChild(spacer);
    }
    spacer.style.width  = bW + 'px';
    spacer.style.height = bH + 'px';
  } else {
    if(spacer) spacer.remove();
  }

  // Update zoom badge
  _updateVpZoomBadge(z);
}
window._applyVpZoom = _applyVpZoom;

function _updateVpZoomBadge(z){
  let badge = document.getElementById('vp-zoom-badge');
  const screen = document.getElementById('cut-screen');
  if(!screen) return;

  if(!badge){
    badge = document.createElement('div');
    badge.id = 'vp-zoom-badge';
    badge.title = 'Click for zoom presets · Double-click to reset · Scroll to zoom';
    badge.style.cssText = [
      'position:absolute','bottom:38px','left:8px',
      'background:rgba(0,0,0,0.72)','color:rgba(255,255,255,0.8)',
      'font-size:10px','font-family:DM Mono,monospace',
      'padding:3px 8px','border-radius:5px',
      'pointer-events:all','cursor:pointer',
      'z-index:50','user-select:none',
      'border:0.5px solid rgba(255,255,255,0.14)',
      'display:flex','align-items:center','gap:4px'
    ].join(';');

    // Click → toggle dropdown
    badge.addEventListener('click', e => {
      e.stopPropagation();
      const existing = document.getElementById('vp-zoom-menu');
      if(existing){ existing.remove(); return; }

      const menu = document.createElement('div');
      menu.id = 'vp-zoom-menu';
      menu.style.cssText = [
        'position:absolute',
        'bottom:' + (badge.offsetTop - badge.offsetParent.clientHeight + badge.offsetHeight + 4) + 'px',
        'left:8px',
        'background:#1a1f28',
        'border:0.5px solid rgba(255,255,255,0.14)',
        'border-radius:7px',
        'padding:4px',
        'z-index:200',
        'min-width:100px',
        'box-shadow:0 8px 24px rgba(0,0,0,0.6)'
      ].join(';');

      const presets = [
        { label: '400%', v: 4 },
        { label: '200%', v: 2 },
        { label: '150%', v: 1.5 },
        { label: '125%', v: 1.25 },
        { label: '100%', v: 1 },
        { label: '75%',  v: 0.75 },
        { label: '50%',  v: 0.5 },
        { label: '25%',  v: 0.25 },
      ];

      presets.forEach(p => {
        const row = document.createElement('div');
        const current = Math.round((window._vpZoom||1)*100) === Math.round(p.v*100);
        row.style.cssText = [
          'padding:5px 10px',
          'font-size:11px',
          'font-family:DM Mono,monospace',
          'border-radius:5px',
          'cursor:pointer',
          'color:' + (current ? '#E8590C' : 'rgba(255,255,255,0.8)'),
          'background:' + (current ? 'rgba(232,89,12,0.1)' : 'transparent'),
          'display:flex','align-items:center','justify-content:space-between','gap:16px'
        ].join(';');
        row.textContent = p.label;
        if(current){
          const tick = document.createElement('span');
          tick.textContent = '✓';
          tick.style.cssText = 'color:#E8590C;font-size:10px';
          row.appendChild(tick);
        }
        row.addEventListener('mouseenter', () => { if(!current) row.style.background='rgba(255,255,255,0.06)'; });
        row.addEventListener('mouseleave', () => { if(!current) row.style.background='transparent'; });
        row.addEventListener('click', ev => {
          ev.stopPropagation();
          window._vpZoom = p.v;
          _applyVpZoom();
          menu.remove();
        });
        menu.appendChild(row);
      });

      // Position relative to cut-screen
      const br = badge.getBoundingClientRect();
      const sr = screen.getBoundingClientRect();
      menu.style.bottom = (sr.bottom - br.top + 4) + 'px';
      menu.style.left   = (br.left - sr.left) + 'px';

      screen.appendChild(menu);

      // Close on outside click
      const _close = ev => { if(!menu.contains(ev.target) && ev.target !== badge){ menu.remove(); document.removeEventListener('click', _close); } };
      setTimeout(() => document.addEventListener('click', _close), 10);
    });

    // Double-click → reset
    badge.addEventListener('dblclick', e => {
      e.stopPropagation();
      document.getElementById('vp-zoom-menu')?.remove();
      window._vpZoom = 1;
      _applyVpZoom();
    });

    screen.appendChild(badge);
  }

  const pct = Math.round(z * 100);
  badge.innerHTML = '<span>' + pct + '%</span><span style="font-size:8px;opacity:0.6;margin-left:1px">▾</span>';
  badge.style.color   = z === 1 ? 'rgba(255,255,255,0.45)' : '#E8590C';
  badge.style.opacity = z === 1 ? '0.6' : '1';
  badge.style.borderColor = z === 1 ? 'rgba(255,255,255,0.1)' : 'rgba(232,89,12,0.4)';
}
window._updateVpZoomBadge = _updateVpZoomBadge;

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
        clips: S.cut.clips.map(c => {
          if(c._imgData || c._img) { const {_imgData, _img, ...rest} = c; return rest; }
          return c;
        }),
        // BUG4 FIX: save effects keyed by clip UUID not array index
        // so they survive any reordering of the clips array on reload
        effects: (()=>{
          const byId = {};
          Object.entries(S.cut.effects || {}).forEach(([idx, efArr]) => {
            const clip = S.cut.clips[parseInt(idx)];
            const key = clip?.mediaId ? (clip.mediaId + '_' + idx) : String(idx);
            byId[key] = efArr;
          });
          return byId;
        })(),
        videoTracks: S.cut.videoTracks,
        audioTracks: S.cut.audioTracks,
        mutedTracks: S.cut.mutedTracks || {},   // BUG2 FIX: persist muted state
        overlays: (window._overlays || []).map(o => ({...o, _img: undefined, _imgData: undefined})),
        media: S.cut.media.map(m => ({
          name: m.name,
          id: m.id || m.mediaId || null,      // UUID — permanent identity
          mediaId: m.mediaId || m.id || null, // kept for compat
          type: m.type,
          duration: m.duration || 0,
          width: m.width || null,
          height: m.height || null,
          thumbnail: m.thumbnail || null
        }))
      }
    }, {
      // Persist workspace settings so refresh restores exact state
      fps: S.proj.fps, width: S.proj.w, height: S.proj.h, duration: S.proj.dur
    });
    if (si) { si.textContent = '● Saved'; si.style.color = 'var(--grn)'; }
    notify('Saved', '#3fb950');
  } catch (e) {
    if (si) { si.textContent = '● Save failed'; si.style.color = '#ff6b6b'; }
    console.error('doSave error:', e);
    notify('Save failed: ' + e.message, '#E31837');
  }
};


// ══════════════════════════════════════════════════════════════
// F1: MARQUEE SELECTION
// Drag on empty timeline area to select clips by intersection
// ══════════════════════════════════════════════════════════════
function setupMarqueeSelection(){
  const scroll = document.getElementById('tl-scroll');
  if(!scroll || scroll._marqueeAttached) return;
  scroll._marqueeAttached = true;

  let _mq = null; // marquee state
  let _mqEl = null; // marquee DOM element

  scroll.addEventListener('mousedown', e => {
    // Only start marquee on empty area (not on a clip or resize handle)
    if(e.target.closest('.tl-clip') || e.target.closest('.tl-overlay-clip') ||
       e.target.closest('.playhead') || e.target.closest('.clip-resize-l') ||
       e.target.closest('.clip-resize-r')) return;
    if(e.button !== 0) return;
    if(_activeTool !== 'select') return;

    const scrollRect = scroll.getBoundingClientRect();
    const startX = e.clientX - scrollRect.left + scroll.scrollLeft;
    const startY = e.clientY - scrollRect.top  + scroll.scrollTop;

    _mq = { startX, startY, moved: false };

    const onMove = (ev) => {
      const curX = ev.clientX - scrollRect.left + scroll.scrollLeft;
      const curY = ev.clientY - scrollRect.top  + scroll.scrollTop;
      const dx = curX - _mq.startX, dy = curY - _mq.startY;
      if(!_mq.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      _mq.moved = true;

      // Draw marquee rect
      if(!_mqEl){
        _mqEl = document.createElement('div');
        _mqEl.style.cssText = 'position:absolute;border:1.5px solid rgba(88,166,255,0.8);background:rgba(88,166,255,0.12);pointer-events:none;z-index:50;border-radius:2px;';
        const rows = document.getElementById('tl-rows');
        if(rows) rows.appendChild(_mqEl);
      }
      const x = Math.min(_mq.startX, curX);
      const y = Math.min(_mq.startY, curY);
      const w = Math.abs(dx), h = Math.abs(dy);
      _mqEl.style.left = x+'px'; _mqEl.style.top = y+'px';
      _mqEl.style.width = w+'px'; _mqEl.style.height = h+'px';

      // Intersection hit-test: select clips AND overlays that overlap the marquee
      // Use <= for boundary checks so items at exact row edges are included
      const mqLeft = x / PPS, mqRight = (x+w) / PPS;
      const mqTop  = y,        mqBottom = y + h;
      window._selectedClips = new Set();
      window._selectedOverlays = window._selectedOverlays || new Set();
      window._selectedOverlays.clear();

      // Hit-test clips
      S.cut.clips.forEach((c, ci) => {
        const clipL = c.start, clipR = c.start + c.dur;
        let rowTop;
        if(c.track < S.cut.videoTracks){
          rowTop = (S.cut.videoTracks - 1 - c.track) * 30;
        } else {
          rowTop = S.cut.videoTracks * 30 + (c.track - S.cut.videoTracks) * 30;
        }
        const rowBot = rowTop + 30;
        // Use <= so clips at exact boundary edges are captured
        const hOverlap = clipL <= mqRight && clipR >= mqLeft;
        const vOverlap = rowTop <= mqBottom && rowBot >= mqTop;
        if(hOverlap && vOverlap) window._selectedClips.add(ci);
      });

      // Hit-test overlays
      (window._overlays||[]).forEach(ov => {
        const ovL = ov.startTime, ovR = ov.endTime;
        const ovTrack = ov.track || 0;
        const rowTop = (S.cut.videoTracks - 1 - ovTrack) * 30;
        const rowBot = rowTop + 30;
        const hOverlap = ovL <= mqRight && ovR >= mqLeft;
        const vOverlap = rowTop <= mqBottom && rowBot >= mqTop;
        if(hOverlap && vOverlap) window._selectedOverlays.add(ov.id);
      });

      // Visual feedback for clips
      document.querySelectorAll('.tl-clip:not(.tl-overlay-clip)').forEach(el => {
        const ci = parseInt(el.dataset.ci);
        el.classList.toggle('selected', window._selectedClips.has(ci));
      });
      // Visual feedback for overlay clips
      document.querySelectorAll('.tl-overlay-clip').forEach(el => {
        const ovId = el.dataset.ovId;
        el.classList.toggle('selected', window._selectedOverlays.has(ovId));
      });
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if(_mqEl){ _mqEl.remove(); _mqEl = null; }
      if(!_mq?.moved){
        // Plain click on empty area = deselect all
        window._selectedClips = new Set();
        document.querySelectorAll('.tl-clip.selected').forEach(el => el.classList.remove('selected'));
        S.cut.sel = null;
      } else {
        // Mark that a marquee drag just ended — suppress the follow-up click clear
        _lastMarqueeEnd = Date.now();
        const _totalSel = (window._selectedClips?.size||0) + (window._selectedOverlays?.size||0);
        if(window._selectedClips?.size === 1 && !window._selectedOverlays?.size){
          S.cut.sel = [...window._selectedClips][0];
          if(typeof updatePropsPanel === 'function') updatePropsPanel(S.cut.sel);
        } else if(_totalSel > 1){
          // Multi-selection — clear single-selection state
          S.cut.sel = null;
          // Ensure all selected clips are visually highlighted
          if(window._highlightSelected) window._highlightSelected();
          // Ensure overlay clips show selected border
          document.querySelectorAll('.tl-overlay-clip').forEach(el => {
            el.classList.toggle('selected', window._selectedOverlays?.has(el.dataset.ovId)||false);
          });
        }
      }
      _mq = null;
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}
window.setupMarqueeSelection = setupMarqueeSelection;

// ══════════════════════════════════════════════════════════════
// F2: MEDIA FOLDERS
// Create folders in media panel, nest files under them
// ══════════════════════════════════════════════════════════════
function createMediaFolder(name){
  const folder = {
    id: 'folder_' + Date.now(),
    name: name || 'New Folder',
    isFolder: true,
    expanded: true,
  };
  S.cut.media.push(folder);
  buildBinList();
  scheduleSave();
  return folder;
}
window.createMediaFolder = createMediaFolder;

function moveMediaToFolder(mediaIdx, folderId){
  const item = S.cut.media[mediaIdx];
  if(!item || item.isFolder) return;
  item.folderId = folderId || null; // null = top level
  buildBinList();
  scheduleSave();
}
window.moveMediaToFolder = moveMediaToFolder;

// ══════════════════════════════════════════════════════════════
// F2: Folder directory import (webkitdirectory)
// ══════════════════════════════════════════════════════════════
function setupFolderImport(){
  let fi = document.getElementById('cut-fi-folder');
  if(fi) return; // already set up
  fi = document.createElement('input');
  fi.type = 'file';
  fi.id = 'cut-fi-folder';
  fi.setAttribute('webkitdirectory', '');
  fi.setAttribute('directory', '');
  fi.multiple = true;
  fi.style.display = 'none';
  document.body.appendChild(fi);
  fi.addEventListener('change', () => {
    if(!fi.files?.length) return;
    // Create a folder with the directory name
    const folderName = fi.files[0].webkitRelativePath?.split('/')[0] || 'Imported Folder';
    const folder = createMediaFolder(folderName);
    // Import all files in the folder
    const filesToImport = Array.from(fi.files).filter(f => !f.webkitRelativePath.includes('/.'));
    handleCutFiles(filesToImport, folder.id);
    fi.value = '';
  });
}
window.setupFolderImport = setupFolderImport;

window.doExport = function() { showExportModal(); };

function showExportModal(){
  // Create AudioContext synchronously in the gesture handler — unlocks it permanently
  try{
    if(window._exportMasterVid){ try{window._exportMasterVid.pause();if(document.body.contains(window._exportMasterVid))window._exportMasterVid.remove();}catch(e){} window._exportMasterVid=null; }
    if(window._exportAudioCtx){ try{window._exportAudioCtx.close();}catch(e){} window._exportAudioCtx=null; }
    const _ctx = new (window.AudioContext||window.webkitAudioContext)({sampleRate:48000});
    _ctx.resume(); // Must call in gesture stack
    // Unlock with a silent oscillator — no video element, no ghost audio
    const _osc = _ctx.createOscillator();
    const _g   = _ctx.createGain(); _g.gain.value = 0;
    _osc.connect(_g); _g.connect(_ctx.destination);
    _osc.start(); _osc.stop(_ctx.currentTime + 0.001);
    window._exportAudioCtx = _ctx;
  }catch(e){ console.warn('[Export] AudioContext unlock failed:', e); }

  // Build modal UI
  document.querySelectorAll('#export-modal').forEach(m=>m.remove());
  const videoClips=S.cut.clips.filter(c=>c.type==='video').sort((a,b)=>a.start-b.start);
  const _allEnds=S.cut.clips.map(c=>c.start+c.dur);
  const _ovEnds=(window._overlays||[]).map(o=>o.endTime||0);
  const totalDur=Math.max(0,..._allEnds,..._ovEnds);
  const modal=document.createElement('div');
  modal.id='export-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.82);z-index:2000;display:flex;align-items:center;justify-content:center';
  modal.innerHTML=`
    <div style="background:#1e2533;border:1px solid rgba(255,255,255,0.13);border-radius:16px;padding:28px;width:460px;font-family:DM Sans,sans-serif;color:#f0f2f5;box-shadow:0 24px 80px rgba(0,0,0,0.6)">
      <div style="font-size:18px;font-weight:700;margin-bottom:6px">Export Video</div>
      <div style="font-size:13px;color:#8b949e;margin-bottom:20px">Duration: <strong style="color:#f0f2f5">${totalDur.toFixed(1)}s</strong> &middot; ${videoClips.length} video clip(s)</div>
      <div style="margin-bottom:14px">
        <label style="font-size:10px;font-weight:700;color:#8b949e;text-transform:uppercase;letter-spacing:.7px;display:block;margin-bottom:6px">Quality / Resolution</label>
        <select id="exp-quality" style="width:100%;padding:9px 11px;background:#252d3d;border:1px solid rgba(255,255,255,0.11);border-radius:8px;color:#f0f2f5;font-size:13px;outline:none">
          <option value="3840,2160,16000000">4K Ultra HD (3840&times;2160) &mdash; 16 Mbps</option>
          <option value="1920,1080,8000000" selected>1080p Full HD (1920&times;1080) &mdash; 8 Mbps</option>
          <option value="1280,720,4000000">720p HD (1280&times;720) &mdash; 4 Mbps</option>
          <option value="854,480,2000000">480p SD (854&times;480) &mdash; 2 Mbps</option>
        </select>
      </div>
      <div style="margin-bottom:14px">
        <label style="font-size:10px;font-weight:700;color:#8b949e;text-transform:uppercase;letter-spacing:.7px;display:block;margin-bottom:6px">Frame Rate</label>
        <select id="exp-fps" style="width:100%;padding:9px 11px;background:#252d3d;border:1px solid rgba(255,255,255,0.11);border-radius:8px;color:#f0f2f5;font-size:13px;outline:none">
          <option value="60">60 fps &mdash; Smooth</option>
          <option value="30" selected>30 fps &mdash; Standard</option>
          <option value="24">24 fps &mdash; Cinematic</option>
        </select>
      </div>
      <div id="exp-progress" style="display:none;margin-bottom:14px">
        <div style="font-size:12px;font-weight:600;color:#f0f2f5;margin-bottom:4px" id="exp-status">Preparing...</div>
        <div style="background:#161b24;border-radius:6px;height:10px;overflow:hidden;margin-bottom:4px">
          <div id="exp-bar" style="height:100%;background:linear-gradient(90deg,#E31837,#ff6b6b);width:0%;transition:width 0.4s;border-radius:6px"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#8b949e">
          <span id="exp-phase">—</span>
          <span id="exp-eta">—</span>
        </div>
      </div>
      <div style="margin-bottom:14px">
        <label style="font-size:10px;font-weight:700;color:#8b949e;text-transform:uppercase;letter-spacing:.7px;display:block;margin-bottom:6px">File Name</label>
        <input id="exp-filename" type="text" value="${(S.currentProject?.name||'export').replace(/[^\w\s-]/g,'').trim()}" style="width:100%;padding:9px 11px;background:#252d3d;border:1px solid rgba(255,255,255,0.11);border-radius:8px;color:#f0f2f5;font-size:13px;outline:none;box-sizing:border-box" placeholder="my-video">
      </div>
      <div style="font-size:11px;color:#8b949e;background:rgba(88,166,255,0.07);border:1px solid rgba(88,166,255,0.15);border-radius:6px;padding:8px 10px;margin-bottom:18px">
        Export includes all video, audio tracks, overlays, effects, and frame holds.
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button onclick="document.getElementById('export-modal').remove();window._exportCancelled=true;" style="padding:9px 20px;border-radius:8px;font-size:13px;font-weight:600;font-family:DM Sans,sans-serif;cursor:pointer;background:transparent;border:1px solid rgba(255,255,255,0.15);color:#8b949e">Cancel</button>
        <button id="exp-btn" onclick="startExport()" style="padding:9px 20px;border-radius:8px;font-size:13px;font-weight:700;font-family:DM Sans,sans-serif;cursor:pointer;background:#E31837;border:none;color:#fff">&#x25B6; Export</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

async function startExport(){
  // ── UI setup ──────────────────────────────────────────────────────────────
  const fname   = (document.getElementById('exp-filename')?.value||'export').trim().replace(/[^\w\s-]/g,'').replace(/\s+/g,'_')||'export';
  const qParts  = (document.getElementById('exp-quality')?.value||'1920,1080,8000000').split(',');
  const W       = parseInt(qParts[0])||1920;
  const H       = parseInt(qParts[1])||1080;
  const BR      = parseInt(qParts[2])||8000000;
  const fps     = parseInt(document.getElementById('exp-fps')?.value)||30;
  const btn     = document.getElementById('exp-btn');
  const bar     = document.getElementById('exp-bar');
  const status  = document.getElementById('exp-status');
  const phaseEl = document.getElementById('exp-phase');
  const etaEl   = document.getElementById('exp-eta');
  const progDiv = document.getElementById('exp-progress');

  btn.disabled=true; btn.textContent='Exporting...';
  progDiv.style.display='block';

  // Kill any previous export loop
  window._exportCancelled=true;
  await new Promise(r=>setTimeout(r,80));
  window._exportCancelled=false;
  const _tok=Symbol(); window._exportTok=_tok;
  const _alive=()=>!window._exportCancelled && window._exportTok===_tok;

  const _set=(msg,pct,ph,eta)=>{
    if(!_alive())return;
    if(status)  status.textContent =msg;
    if(bar)     bar.style.width    =(pct||0)+'%';
    if(phaseEl) phaseEl.textContent=ph||'';
    if(etaEl)   etaEl.textContent  =eta||'';
  };
  const _fail=(msg)=>{
    if(status)  status.textContent ='✖ '+msg;
    if(phaseEl) phaseEl.textContent='';
    if(etaEl)   etaEl.textContent  ='';
    if(bar)     bar.style.width    ='0%';
    if(btn){btn.disabled=false;btn.textContent='↺ Retry';btn.onclick=startExport;}
  };

  // ── Timeline data ─────────────────────────────────────────────────────────
  const videoClips=S.cut.clips.filter(c=>c.type==='video').sort((a,b)=>a.start-b.start);
  if(!videoClips.length){_fail('No video clips on timeline');return;}
  const totalDur=Math.max(0.1,...S.cut.clips.map(c=>c.start+c.dur),...(window._overlays||[]).map(o=>o.endTime||0));

  // Audio = ONLY type==='audio' clips (never video native audio)
  const audioClips=S.cut.clips.filter(c=>c.type==='audio'&&!S.cut.mutedTracks?.[c.track]).sort((a,b)=>a.start-b.start);

  // ── Canvas — MUST be in DOM so captureStream captures draws ──────────────
  const canvas=document.createElement('canvas');
  canvas.width=W; canvas.height=H;
  canvas.style.cssText='position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.001;pointer-events:none;z-index:1;';
  document.body.appendChild(canvas);
  const ctx=canvas.getContext('2d');

  // ── PHASE 1: Pre-load video elements ─────────────────────────────────────
  _set('Loading video files...',3,'Phase 1/4 — Loading','');
  const drawEls={};
  await Promise.all([...new Set(videoClips.map(c=>c.mediaId).filter(Boolean))].map(mIdx=>{
    const item=getMediaById(mIdx);
    if(!item?.url)return Promise.resolve();
    // BUG1 FIX: images must use <img> not <video>
    // A <video> with an image src waits up to 12s for loadeddata that never fires,
    // causing the app to freeze/hang when any image clip exists on the timeline.
    if(item.type==='image'){
      const img = new Image();
      img.src = item.url;
      drawEls[mIdx] = img;
      return new Promise(r=>{
        if(img.complete){r();return;}
        img.onload  = r;
        img.onerror = r;
        setTimeout(r, 5000);
      });
    }
    const v=document.createElement('video');
    v.muted=true;v.volume=0;v.preload='auto';v.playsInline=true;
    // Must be visible in viewport for Chrome to decode blob URLs
    v.style.cssText='position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.001;pointer-events:none;z-index:2;';
    v.src=item.url; document.body.appendChild(v); drawEls[mIdx]=v;
    return new Promise(r=>{
      if(v.readyState>=2){r();return;}
      let ok=false;
      const done=()=>{if(ok)return;ok=true;['loadeddata','canplay','error'].forEach(e=>v.removeEventListener(e,done));r();};
      ['loadeddata','canplay','error'].forEach(e=>v.addEventListener(e,done));
      setTimeout(done,12000); v.load();
    });
  }));
  if(!_alive()){canvas.remove();return;}

  // ── PHASE 2: Decode audio tracks offline ─────────────────────────────────
  _set('Decoding audio...',8,'Phase 2/4 — Audio','');
  let _mixedAudio=null;
  if(audioClips.length){
    try{
      const offCtx=new OfflineAudioContext(2,Math.ceil(totalDur*48000)+48000,48000);
      await Promise.all(audioClips.map(async ac=>{
        const item=getMediaById(ac.mediaId); if(!item?.url)return;
        try{
          const buf=await offCtx.decodeAudioData(await(await fetch(item.url)).arrayBuffer());
          const src=offCtx.createBufferSource();
          const gn=offCtx.createGain();
          src.buffer=buf; gn.gain.value=ac.volume!==undefined?Math.min(1,ac.volume):1;
          src.connect(gn); gn.connect(offCtx.destination);
          src.start(Math.max(0,ac.start),ac.fileStart||0,ac.dur);
        }catch(e){console.warn('[Export] audio:',e.message);}
      }));
      _mixedAudio=await offCtx.startRendering();
      console.log('[Export] audio rendered:',_mixedAudio.duration.toFixed(1)+'s');
    }catch(e){console.warn('[Export] OfflineAudio:',e);}
  }
  if(!_alive()){canvas.remove();return;}

  // ── PHASE 3: Set up MediaRecorder + AudioContext ──────────────────────────
  _set('Setting up recorder...',12,'Phase 3/4 — Setup','');

  // Fresh AudioContext for recording — created right before recorder.start()
  let recCtx=null, recGain=null, recDest=null;
  try{
    recCtx=new(window.AudioContext||window.webkitAudioContext)({sampleRate:48000});
    await Promise.race([recCtx.resume(),new Promise(r=>setTimeout(r,500))]);
    recGain=recCtx.createGain(); recGain.gain.value=1;
    recDest=recCtx.createMediaStreamDestination();
    recGain.connect(recDest);
  }catch(e){console.warn('[Export] recCtx:',e);}

  const videoStream=canvas.captureStream(fps);
  const audioTracks=recDest?.stream.getAudioTracks().filter(t=>t.readyState==='live')||[];
  const finalStream=audioTracks.length
    ?new MediaStream([...videoStream.getVideoTracks(),...audioTracks])
    :videoStream;

  // Best supported WebM codec
  const mimeType=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(m=>MediaRecorder.isTypeSupported(m))||'video/webm';
  const chunks=[];
  const recorder=new MediaRecorder(finalStream,{mimeType,videoBitsPerSecond:BR,audioBitsPerSecond:192000});
  recorder.ondataavailable=e=>{if(e.data?.size>0)chunks.push(e.data);};

  recorder.onstop=async()=>{
    if(!_alive()){canvas.remove();return;}
    _set('Packaging...',99,'Packaging','');
    await new Promise(r=>setTimeout(r,200));
    const blob=new Blob(chunks,{type:mimeType});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download=`${fname}_${W}x${H}_${fps}fps.webm`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    canvas.remove();
    Object.values(drawEls).forEach(v=>{try{v.pause();if(document.body.contains(v))v.remove();}catch(e){}});
    try{if(recCtx)recCtx.close();}catch(e){}
    try{if(window._exportAudioCtx){window._exportAudioCtx.close();window._exportAudioCtx=null;}}catch(e){}
    _set('Done!',100,'','');
    document.getElementById('export-modal')?.remove();
    notify(`✓ Export — ${fname}.webm  (${(blob.size/1024/1024).toFixed(1)} MB · ${totalDur.toFixed(0)}s)`,'#3fb950');
  };

  // ── PHASE 4: Real-time render loop ────────────────────────────────────────
  // setInterval draws frames at real-time pace.
  // captureStream records wall-clock time → file duration = totalDur seconds.
  // Audio PCM scheduled on recCtx AFTER recorder.start() so it plays during recording.

  recorder.start(500); // 500ms chunks

  // Schedule decoded audio to start with recording
  if(_mixedAudio&&recCtx&&recGain){
    try{
      const audioT0=recCtx.currentTime+0.05;
      const src=recCtx.createBufferSource();
      src.buffer=_mixedAudio; src.connect(recGain);
      src.start(audioT0,0,_mixedAudio.duration);
    }catch(e){console.warn('[Export] audio schedule:',e);}
  }

  const renderStartMs=Date.now();
  const msPerFrame=Math.round(1000/fps);
  let lastClipIdx=-1, lastVid=null;

  // Pre-seek first clip so first frame isn't black
  const fc=videoClips[0];
  if(fc&&drawEls[fc.mediaId]){
    const v=drawEls[fc.mediaId];
    v.currentTime=fc.fileStart||0; v.playbackRate=fc.speed||1;
    await new Promise(r=>{const h=()=>{v.removeEventListener('seeked',h);r();};v.addEventListener('seeked',h);setTimeout(r,2000);});
    try{await v.play();}catch(e){}
    lastVid=v; lastClipIdx=0;
  }

  _set('Rendering...',14,'Phase 4/4 — Rendering','Calculating...');

  await new Promise(resolve=>{
    const intervalId=setInterval(()=>{
      if(!_alive()){
        clearInterval(intervalId);
        if(recorder.state!=='inactive')recorder.stop();
        resolve(); return;
      }
      const elapsed=(Date.now()-renderStartMs)/1000;
      if(elapsed>=totalDur){
        clearInterval(intervalId);
        if(lastVid&&!lastVid.paused)lastVid.pause();
        if(recorder.state!=='inactive')recorder.stop();
        resolve(); return;
      }

      // Draw scene at current elapsed time
      const t=elapsed;
      const fh=S.cut.clips.find(c=>c.type==='frame_hold'&&t>=c.start&&t<c.start+c.dur);
      if(fh){
        if(fh._imgData&&(!fh._img||!fh._img.complete)){fh._img=new Image();fh._img.src=fh._imgData;}
        ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);
        if(fh._img?.complete){
          const ci=S.cut.clips.indexOf(fh),p=[];
          (S.cut.effects[ci]||[]).forEach(ef=>{if(ef.visible===false)return;const e=CUT_EFFECTS[ef.i];if(!e||e.type==='transition')return;const es=fh.start+(ef.startOffset||0),ee=es+(ef.effectDur??fh.dur);if(t<es||t>=ee)return;if(e.type==='range')p.push(e.prop+'('+ef.v+e.unit+')');else if(e.type==='toggle')p.push(e.filter);});
          ctx.save();if(p.length)ctx.filter=p.join(' ');ctx.globalAlpha=(fh.opacity!==undefined)?Math.max(0,Math.min(1,fh.opacity)):1;ctx.drawImage(fh._img,0,0,W,H);ctx.globalAlpha=1;ctx.filter='none';ctx.restore();
        }
        if(lastVid&&!lastVid.paused)lastVid.pause();
      } else {
        const clip=videoClips.find(c=>t>=c.start&&t<c.start+c.dur);
        if(clip){
          const vid=drawEls[clip.mediaId];
          const _isImgClip = clip.type==='image'; // BUG1 FIX: images use <img>, not <video>
          const ci=videoClips.indexOf(clip);
          if(ci!==lastClipIdx){
            if(!_isImgClip&&lastVid&&lastVid!==vid&&!lastVid.paused)lastVid.pause();
            lastClipIdx=ci;
            if(!_isImgClip) lastVid=vid;
            if(vid && !_isImgClip){
              const ft=(clip.fileStart||0)+Math.max(0,(t-clip.start)*(clip.speed||1));
              vid.muted=true;vid.volume=0;vid.playbackRate=(clip.reverse?-(clip.speed||1):(clip.speed||1));
              vid.currentTime=ft;
              vid.play().catch(()=>{});
            }
          }
          ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);
          // Image clips: draw immediately when loaded (complete), no readyState check
          const _drawReady = _isImgClip ? (vid && vid.complete) : (vid && vid.readyState>=2);
          if(_drawReady){
            const ci2=S.cut.clips.indexOf(clip),vp=[];
            (S.cut.effects[ci2]||[]).forEach(ef=>{if(ef.visible===false)return;const e=CUT_EFFECTS[ef.i];if(!e||e.type==='transition')return;const es=clip.start+(ef.startOffset||0),ee=es+(ef.effectDur??clip.dur);if(t<es||t>=ee)return;if(e.type==='range')vp.push(e.prop+'('+ef.v+e.unit+')');else if(e.type==='toggle')vp.push(e.filter);});
            ctx.save();if(vp.length)ctx.filter=vp.join(' ');
            ctx.globalAlpha=(clip.opacity!==undefined)?Math.max(0,Math.min(1,clip.opacity)):1;
            try{ctx.drawImage(vid,0,0,W,H);}catch(e){}
            ctx.globalAlpha=1;ctx.filter='none';ctx.restore();
          }
        } else {
          ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);
          if(lastVid&&!lastVid.paused){lastVid.pause();lastVid=null;}lastClipIdx=-1;
        }
      }
      // Overlays on top
      if((window._overlays||[]).some(o=>t>=o.startTime&&t<o.endTime)&&window.renderOverlaysOnCanvas)
        window.renderOverlaysOnCanvas(ctx,W,H,t,new Set());

      // Progress
      const pct=Math.min(98,Math.round((elapsed/totalDur)*84)+14);
      const remSec=Math.max(0,totalDur-elapsed);
      const remStr=remSec>1?`~${Math.ceil(remSec)}s remaining`:'Almost done...';
      _set(`Rendering: ${pct}%`,pct,`Phase 4/4 — ${elapsed.toFixed(1)}s / ${totalDur.toFixed(1)}s`,remStr);
    }, msPerFrame);
  });
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
      { l: 'Sequence Settings…', fn: () => showProjectSettings() },
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
      { sep: true },
      { l: '⊞ Monitor Overlays…', fn: () => window.showMonitorOverlayPanel() },
      { l: 'T  Add Text…', fn: () => window.cutAddTextClip ? window.cutAddTextClip() : window.showTextDialog() },
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
      { l: 'Zoom In Timeline', k: '=', fn: () => {
        const _sc=document.getElementById('tl-scroll');
        const _ph=S.cut.ph||0;
        const _vw=_sc?_sc.clientWidth:800;
        PPS=Math.min(600,PPS*1.25); window.PPS=PPS;
        window._snapCache=null;
        renderCutTimeline();
        if(_sc) _sc.scrollLeft=Math.max(0,_ph*PPS-_vw*0.4);
      } },
      { l: 'Zoom Out Timeline', k: '-', fn: () => {
        const _sc=document.getElementById('tl-scroll');
        const _ph=S.cut.ph||0;
        const _vw=_sc?_sc.clientWidth:800;
        PPS=Math.max(8,PPS*0.8); window.PPS=PPS;
        window._snapCache=null;
        renderCutTimeline();
        if(_sc) _sc.scrollLeft=Math.max(0,_ph*PPS-_vw*0.4);
      } },
      { l: 'Zoom Reset Timeline', k: '0', fn: () => {
        const _sc=document.getElementById('tl-scroll');
        const _ph=S.cut.ph||0;
        const _vw=_sc?_sc.clientWidth:800;
        PPS=60; window.PPS=PPS;
        window._snapCache=null;
        renderCutTimeline();
        if(_sc) _sc.scrollLeft=Math.max(0,_ph*PPS-_vw*0.4);
      } },
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
    mediaId: c.mediaId,
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
          <button onclick="cutToggleFullscreen()" title="Fullscreen (F)" id="cut-fs-btn" style="background:none;border:none;color:rgba(255,255,255,0.5);cursor:pointer;padding:4px 6px;margin-left:6px;font-size:14px;line-height:1;border-radius:4px;transition:color .15s" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='rgba(255,255,255,0.5)'">&#x26F6;</button>
        </div>
        <!-- Resize handle between preview and timeline -->
        <div id="cut-pv-resize" style="height:5px;background:transparent;cursor:ns-resize;flex-shrink:0;position:relative;z-index:20" onmouseenter="this.style.background='rgba(232,89,12,0.4)'" onmouseleave="this.style.background='transparent'"></div>
        <div class="cut-screen" id="cut-screen">
          <div id="cut-viewport-frame">
            <canvas id="cut-cvs"></canvas>
            <canvas id="cut-trans-cvs"></canvas>
            <!-- video element injected here by syncCutVid -->
          </div>
          <div class="pv-timecode" id="cut-pv-tc">00:00:00:00</div>
        </div>
        <!-- Scrub bar below viewport -->
        <div id="cut-scrub-bar" style="flex-shrink:0;height:28px;background:#0a0a0a;border-top:0.5px solid rgba(255,255,255,0.07);display:flex;align-items:center;padding:0 12px;gap:8px;user-select:none;">
          <span id="cut-scrub-tc" style="font-family:'DM Mono',monospace;font-size:10px;color:rgba(255,255,255,0.45);min-width:58px;flex-shrink:0">00:00:00</span>
          <div id="cut-scrub-track" style="flex:1;height:4px;background:rgba(255,255,255,0.08);border-radius:2px;position:relative;cursor:pointer;">
            <div id="cut-scrub-fill"  style="position:absolute;left:0;top:0;height:100%;background:rgba(232,89,12,0.6);border-radius:2px;pointer-events:none;"></div>
            <div id="cut-scrub-knob"  style="position:absolute;top:50%;width:12px;height:12px;border-radius:50%;background:#E8590C;border:2px solid #fff;transform:translate(-50%,-50%);cursor:grab;box-shadow:0 1px 4px rgba(0,0,0,0.5);transition:transform .1s;"></div>
          </div>
          <span id="cut-scrub-dur" style="font-family:'DM Mono',monospace;font-size:10px;color:rgba(255,255,255,0.3);min-width:40px;text-align:right;flex-shrink:0">0:00</span>
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
  setTimeout(setupMarqueeSelection, 200);
  setTimeout(setupScrubBar, 300);
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
        // Find ALL overlays hit at this point
        const allHits=active.slice().reverse().filter(o=>{
          if(o.x!==undefined){
            const ox=o.x-(o.w||0.3)/2, oy=o.y-(o.h||0.2)/2;
            return nx>=ox&&nx<=ox+(o.w||0.3)&&ny>=oy&&ny<=oy+(o.h||0.2);
          }
          return o.type==='freeze'||o.type==='image_bg';
        });
        // Cycle through stacked overlays on repeated clicks at same spot
        let hit=null;
        if(allHits.length>1){
          const _lastId=window._activeEditId;
          const _lastIdx=allHits.findIndex(o=>o.id===_lastId);
          // If we already have one selected here, move to the next one
          if(_lastIdx>=0){
            hit=allHits[(_lastIdx+1)%allHits.length];
          } else {
            hit=allHits[0];
          }
          // Show cycle badge hint
          const _badge=document.getElementById('ov-cycle-badge')||document.createElement('div');
          _badge.id='ov-cycle-badge';
          _badge.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.75);color:#fff;font-size:11px;padding:4px 10px;border-radius:20px;pointer-events:none;z-index:9999;font-family:DM Sans,sans-serif;';
          _badge.textContent='Click again to select next layer (' + allHits.length + ' overlays here)';
          document.body.appendChild(_badge);
          clearTimeout(window._badgeTimer);
          window._badgeTimer=setTimeout(()=>_badge.remove(),2000);
        } else {
          hit=allHits[0]||null;
        }
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
    setupMarqueeSelect();
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

  // ── Helper: toggle effect on a single clip index ──
  function _applyEffectToClip(tci){
    if(!S.cut.effects[tci]) S.cut.effects[tci]=[];
    const existing=S.cut.effects[tci].findIndex(e=>e.i===i);
    const eff=CUT_EFFECTS[i];
    if(existing>=0){
      S.cut.effects[tci].splice(existing,1);
    } else {
      const clip=S.cut.clips[tci];
      const clipDur = clip?.dur || 2;
      const defaultStartOffset = eff.type==='transition'
        ? Math.max(0, S.cut.ph - clip.start)
        : 0;
      S.cut.effects[tci].push({
        i,
        v: eff.default||0,
        startOffset: defaultStartOffset,
        effectDur: eff.type==='transition' ? Math.min(eff.dur||1, clipDur*0.5) : clipDur,
        visible: true,
      });
    }
  }

  // Apply to all selected clips if multi-select active
  if(window._selectedClips?.size > 1){
    window._selectedClips.forEach(tci => _applyEffectToClip(tci));
    notify(CUT_EFFECTS[i].name + ' applied to ' + window._selectedClips.size + ' clips', '#3fb950');
  } else {
    _applyEffectToClip(ci);
    const eff=CUT_EFFECTS[i];
    const clip=S.cut.clips[ci];
    const offsetInClip=Math.max(0,S.cut.ph-clip.start);
    const hasNow = (S.cut.effects[ci]||[]).some(e=>e.i===i);
    notify(hasNow ? eff.name+' applied at '+fmtTC(offsetInClip)+' into clip' : eff.name+' removed', hasNow?'#3fb950':undefined);
  }

  applyVideoEffects();
  showEffectIndicator(i, !!(S.cut.effects[ci]||[]).some(e=>e.i===i));
  const p=$('cut-p-effects'); if(p) p.innerHTML=cutEffectsHTML();
  renderCutTimeline();
  syncCutVid();
  if(ci !== null && ci !== undefined) updatePropsPanel(ci);
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

// ── buildColorFilterStr: Lumetri-style color correction via CSS filters ──
// Reads c.colorGrade and returns a CSS filter string that stacks on top
// of buildFilterStr (effects). Called wherever buildFilterStr is called.
// All values are at their neutral/identity when not set.
function buildColorFilterStr(c){
  if(!c || !c.colorGrade) return 'none';
  const g = c.colorGrade;
  const parts = [];

  // Basic Correction
  const brightness = ((g.exposure   || 0) / 100) + 1;    // -100..+100 → 0..2
  const contrast   =  (g.contrast   || 0) + 100;          // -100..+100 → 0..200
  const saturate   =  (g.saturation || 0) + 100;          // -100..+100 → 0..200
  const hueRot     =   g.temperature || 0;                 // degrees
  const tintRot    =   g.tint        || 0;
  // Highlights/Shadows/Whites/Blacks approximate via brightness+contrast combo
  const highAdj    =  1 + (g.highlights || 0) / 200;
  const shadAdj    =  1 - (g.shadows    || 0) / 200;
  const whtAdj     =  1 + (g.whites     || 0) / 200;
  const blkAdj     =  1 - (g.blacks     || 0) / 200;
  const compBrightness = brightness * highAdj * shadAdj * whtAdj * blkAdj;

  if(Math.abs(compBrightness - 1) > 0.001)  parts.push(`brightness(${compBrightness.toFixed(3)})`);
  if(Math.abs(contrast - 100) > 0.5)        parts.push(`contrast(${contrast.toFixed(1)}%)`);
  if(Math.abs(saturate - 100) > 0.5)        parts.push(`saturate(${saturate.toFixed(1)}%)`);
  if(Math.abs(hueRot)         > 0.5)        parts.push(`hue-rotate(${hueRot.toFixed(1)}deg)`);
  if(Math.abs(tintRot)        > 0.5)        parts.push(`hue-rotate(${(tintRot * 0.5).toFixed(1)}deg)`);

  // Creative
  if(g.fadedFilm  > 0)  parts.push(`opacity(${(1 - g.fadedFilm/200).toFixed(3)})`,`brightness(${(1+g.fadedFilm/300).toFixed(3)})`);
  if(g.sharpen    > 0)  parts.push(`contrast(${(1+g.sharpen/200).toFixed(3)})`,`saturate(${(1+g.sharpen/300).toFixed(3)})`);
  if(g.vibrance   > 0)  parts.push(`saturate(${(1+g.vibrance/150).toFixed(3)})`);
  if(g.vibrance   < 0)  parts.push(`saturate(${(1+g.vibrance/300).toFixed(3)})`);

  return parts.length ? parts.join(' ') : 'none';
}
window.buildColorFilterStr = buildColorFilterStr;


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
      + '<div class="vt-btn" id="vt-text" data-tool="text" title="Text (T)" onclick="if(window.cutAddTextClip){cutAddTextClip();}else if(window.showTextDialog){showTextDialog();}setCutTool(\'select\')"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M2 4h20v3h-8v13h-4V7H2z"/></svg></div>'
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
  // F2: folder directory import
  let fiFolder = document.getElementById('cut-fi-folder');
  if(!fiFolder){
    fiFolder = document.createElement('input');
    fiFolder.type='file'; fiFolder.id='cut-fi-folder'; fiFolder.style.display='none';
    fiFolder.setAttribute('webkitdirectory',''); fiFolder.setAttribute('directory','');
    fiFolder.multiple=true;
    document.body.appendChild(fiFolder);
    fiFolder.addEventListener('change', ()=>{
      if(!fiFolder.files?.length) return;
      const folderName = fiFolder.files[0].webkitRelativePath?.split('/')[0] || 'Folder';
      // Create folder in bin
      if(!S.cut.bins) S.cut.bins=[{id:'root',name:'All Media',open:true}];
      const folderId = 'bin_'+Date.now();
      S.cut.bins.push({id:folderId, name:folderName, open:true});
      // Import all files and assign to folder
      const prevLen = S.cut.media.length;
      handleCutFiles(fiFolder.files);
      // Assign new media items to the folder
      setTimeout(()=>{
        if(!S.cut.mediaBins) S.cut.mediaBins={};
        for(let k=prevLen; k<S.cut.media.length; k++){
          const _m = S.cut.media[k];
          if(_m?.id) S.cut.mediaBins[_m.id]=folderId;
        }
        buildBinList(); scheduleSave();
      }, 500);
      fiFolder.value='';
    });
  }
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
    // Generate permanent UUID4 — never derived from filename
    const _uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
    const item = { name:f.name, id:_uuid, mediaId:_uuid, type:isVid?'video':isAud?'audio':'image', file:f, url, duration:isImg?5:0, thumbnail:null };
    if (isVid) {
      const v = document.createElement('video'); v.src = url;
      v.onloadedmetadata = () => {
        item.duration = v.duration;
        item.width    = v.videoWidth;
        item.height   = v.videoHeight;
        // Auto-inherit resolution from first video if project was created with "Auto" preset
        if(S.proj.autoRes && v.videoWidth > 0 && v.videoHeight > 0){
          const _isFirstVid = S.cut.media.filter(m => m.type==='video' && m.width).length <= 1;
          if(_isFirstVid){
            S.proj.w = v.videoWidth;
            S.proj.h = v.videoHeight;
            S.proj.autoRes = false; // only inherit once
            applyCanvasAspectRatio(S.proj.w, S.proj.h);
            // Persist updated resolution
            if(S.currentProject){ S.currentProject.width=S.proj.w; S.currentProject.height=S.proj.h; }
            if(typeof scheduleSave==='function') scheduleSave();
            notify(`Canvas set to ${S.proj.w}×${S.proj.h} from video`, '#3fb950');
          }
        }
        item.hasAudio = true;
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
      saveMediaFile(S.currentProject.id, f, item.mediaId).catch(e => console.warn('MediaStore save failed:', e));
    }
  });
  if (added) notify(added+' file'+(added>1?'s':'')+' imported','#3fb950');
  buildBinList();
}

function buildBinList() {
  const el=$('cut-bin'); if(!el) return;

  // Initialize bins/folders state
  if(!S.cut.bins) S.cut.bins = [{id:'root',name:'All Media',open:true}];
  if(!S.cut.mediaBins) S.cut.mediaBins = {};

  if (!S.cut.media.length) {
    el.innerHTML='<div style="padding:24px 12px;text-align:center"><div style="font-size:22px;opacity:0.25;margin-bottom:8px">📂</div><div style="font-size:11px;color:rgba(255,255,255,0.25);font-weight:500">No media yet</div><div style="font-size:10px;color:rgba(255,255,255,0.15);margin-top:3px">Drop files or click above</div></div>';
    return;
  }

  // Group media by bin
  const binItems = {};
  S.cut.media.forEach((item,i) => {
    const binId = S.cut.mediaBins?.[item.id] || 'root';
    if(!binItems[binId]) binItems[binId] = [];
    binItems[binId].push({item,i});
  });

  // Bin toolbar
  let html = `<div style="display:flex;align-items:center;gap:4px;padding:4px 6px 2px;border-bottom:0.5px solid rgba(255,255,255,0.06)">
    <span style="font-size:10px;color:rgba(255,255,255,0.3);flex:1">${S.cut.media.length} file(s)</span>
    <button onclick="cutMediaNewBin()" title="New folder" style="background:none;border:none;color:rgba(255,255,255,0.4);cursor:pointer;font-size:12px;padding:2px 5px;line-height:1;border-radius:4px;border:0.5px solid rgba(255,255,255,0.1)" onmouseover="this.style.color='#E8590C'" onmouseout="this.style.color='rgba(255,255,255,0.4)'">+ Folder</button>
    <button onclick="document.getElementById('cut-fi-folder')?.click()" title="Import folder from disk" style="background:none;border:none;color:rgba(255,255,255,0.4);cursor:pointer;font-size:12px;padding:2px 5px;line-height:1;border-radius:4px;border:0.5px solid rgba(255,255,255,0.1)" onmouseover="this.style.color='#E8590C'" onmouseout="this.style.color='rgba(255,255,255,0.4)'">📁</button>
  </div>`;

  // Render each bin
  S.cut.bins.forEach(bin => {
    const items = binItems[bin.id] || [];
    const isRoot = bin.id === 'root';
    if(!isRoot){
      html += `<div style="display:flex;align-items:center;gap:4px;padding:4px 8px;cursor:pointer;user-select:none;background:rgba(255,255,255,0.03);border-bottom:0.5px solid rgba(255,255,255,0.04)"
        onclick="cutMediaToggleBin('${bin.id}')">
        <span style="font-size:10px;color:rgba(255,255,255,0.4)">${bin.open!==false?'▼':'▶'}</span>
        <span style="font-size:10px;font-weight:600;color:rgba(255,255,255,0.6);flex:1">📁 ${bin.name} (${items.length})</span>
        <button onclick="event.stopPropagation();cutMediaDeleteBin('${bin.id}')" style="background:none;border:none;color:rgba(255,69,58,0.5);cursor:pointer;font-size:10px;padding:0" title="Delete folder">✕</button>
      </div>`;
    }
    if(bin.open !== false || isRoot){
      items.forEach(({item,i}) => {
        const icon = item.type==='video'?'🎬':item.type==='audio'?'🎵':'🖼️';
        const indent = isRoot ? '' : 'padding-left:16px;';
        html += `<div class="mbin-item${S.cut.selMedia===i?' sel':''}" id="mbi-${i}" draggable="true"
          ondragstart="cutBinDragStart(event,${i})" onclick="cutSelMedia(${i})" ondblclick="cutAddToTL(${i})"
          oncontextmenu="cutMediaContextMenu(event,${i})"
          title="Double-click to add · Right-click for options" style="${indent}position:relative">
          <div class="mbin-thumb">${item.thumbnail?`<img src="${item.thumbnail}">`:(item.type==='image'&&item.url?`<img src="${item.url}">`:icon)}</div>
          <div style="flex:1;min-width:0"><div class="mbin-name">${item.name}</div>
          <div class="mbin-dur">${item.duration>0?fmtTC(item.duration):'--'}</div></div>
          <button onclick="event.stopPropagation();cutMediaDelete(${i})" title="Delete" style="background:none;border:none;color:rgba(255,69,58,0.6);cursor:pointer;font-size:13px;padding:2px 4px;opacity:0;transition:opacity .15s;position:absolute;right:4px;top:50%;transform:translateY(-50%)" class="mbin-del">🗑</button>
        </div>`;
      });
    }
  });

  el.innerHTML = html;

  // Show delete button on hover
  el.querySelectorAll('.mbin-item').forEach(el2 => {
    const del = el2.querySelector('.mbin-del');
    if(!del) return;
    el2.addEventListener('mouseenter', ()=>{ del.style.opacity='1'; });
    el2.addEventListener('mouseleave', ()=>{ del.style.opacity='0'; });
  });

  const inf=$('cut-info'); if(inf) inf.textContent=S.cut.media.length+' file(s) — drag to timeline or double-click';
}

function cutMediaContextMenu(e, i){
  e.preventDefault(); e.stopPropagation();
  cutSelMedia(i);
  const bins = (S.cut.bins||[]).filter(b=>b.id!=='root');
  showContextMenu(e, [
    {icon:'🗑️', label:'Delete from project', danger:true, fn:()=>cutMediaDelete(i)},
    {sep:true},
    ...bins.map(b=>({icon:'📁', label:'Move to: '+b.name, fn:()=>{ if(!S.cut.mediaBins)S.cut.mediaBins={}; S.cut.mediaBins[item.id]=b.id; buildBinList(); }})),
    ...(bins.length?[{icon:'📂', label:'Move to: All Media', fn:()=>{ if(S.cut.mediaBins)delete S.cut.mediaBins[item.id]; buildBinList(); }}]:[]),
    {sep:true},
    {icon:'📁', label:'New folder', fn:()=>cutMediaNewBin()},
  ]);
}
window.cutMediaContextMenu = cutMediaContextMenu;

function cutMediaDelete(i){
  // i can be array index (from bin click) or mediaId string — resolve both
  const item = typeof i === 'string'
    ? S.cut.media.find(m=>m.id===i)
    : S.cut.media[i];
  if(!item) return;
  const mediaId = item.id;
  const usedClips = S.cut.clips.filter(c=>c.mediaId===mediaId);
  if(usedClips.length){
    if(!confirm(`"${item.name}" is used in ${usedClips.length} timeline clip(s).\nDelete anyway? Those clips will be removed.`)) return;
  }
  cutSaveHistory('delete_media');
  // Remove clips that reference this mediaId — no index shifting needed with UUID system
  S.cut.clips = S.cut.clips.filter(c=>c.mediaId!==mediaId);
  // Remove from media array
  const arrIdx = S.cut.media.indexOf(item);
  if(arrIdx >= 0) S.cut.media.splice(arrIdx, 1);
  // Remove from bins — keyed by mediaId, no re-index needed
  if(S.cut.mediaBins) delete S.cut.mediaBins[mediaId];
  if(S.cut.selMedia===mediaId) S.cut.selMedia=null;
  buildBinList(); renderCutTimeline(); scheduleSave();
  notify('Media deleted','#3fb950');
}
window.cutMediaDelete = cutMediaDelete;

function cutMediaNewBin(){
  const name = prompt('Folder name:','New Folder');
  if(!name||!name.trim()) return;
  if(!S.cut.bins) S.cut.bins=[{id:'root',name:'All Media',open:true}];
  S.cut.bins.push({id:'bin_'+Date.now(), name:name.trim(), open:true});
  buildBinList(); scheduleSave();
}
window.cutMediaNewBin = cutMediaNewBin;

function cutMediaToggleBin(id){
  const bin = (S.cut.bins||[]).find(b=>b.id===id);
  if(bin) bin.open = !bin.open;
  buildBinList();
}
window.cutMediaToggleBin = cutMediaToggleBin;

function cutMediaDeleteBin(id){
  S.cut.bins = (S.cut.bins||[]).filter(b=>b.id!==id);
  if(S.cut.mediaBins){
    Object.keys(S.cut.mediaBins).forEach(k=>{ if(S.cut.mediaBins[k]===id) delete S.cut.mediaBins[k]; });
  }
  buildBinList(); scheduleSave();
}
window.cutMediaDeleteBin = cutMediaDeleteBin;


function updatePropsPanel(ci){
  const body=$('cut-props-body'); if(!body) return;
  if(ci===null||ci===undefined){
    body.innerHTML='<div style="padding:20px 8px;text-align:center;color:var(--mu2);font-size:11px">Select a clip or overlay</div>';
    const oldBox=document.getElementById('cut-bbox'); if(oldBox) oldBox.remove();
    return;
  }
  const c=S.cut.clips[ci]; if(!c){body.innerHTML='';return;}
  const item=getMediaById(c.mediaId)||{};
  const fmtN=n=>Math.round(n*100)/100;
  const speed=c.speed||1;
  const inp=(id,val,step,min,onch)=>`<input type="number" id="${id}" value="${val}" step="${step}" min="${min||0}" style="width:62px;background:#161616;border:0.5px solid rgba(255,255,255,0.1);border-radius:5px;color:var(--tx);font-size:11px;padding:2px 5px;outline:none" onchange="${onch}">`;

  const fadeIn  = c.fadeIn  || 0;
  const fadeOut = c.fadeOut || 0;
  const vol     = c.volume  !== undefined ? c.volume : 1;
  const fx = c.audioFx || {};
  const audioSection = c.type==='audio'||c.linkedToVideo ? `
    <div style="border:0.5px solid rgba(210,153,34,0.25);border-radius:8px;margin:4px 0;overflow:hidden;background:rgba(210,153,34,0.04)">
      <div style="display:flex;align-items:center;padding:8px 10px;cursor:pointer;user-select:none;gap:8px"
        onclick="const el=document.getElementById('acc-au-${ci}');el.hidden=!el.hidden;this.querySelector('.acc-chv').style.transform=el.hidden?'rotate(-90deg)':'rotate(0deg)'">
        <div style="width:3px;height:28px;border-radius:2px;background:linear-gradient(180deg,#d29922,#e3b341);flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;font-weight:700;color:#fff;letter-spacing:0.3px">🔊 Audio</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:1px">Vol: ${Math.round(vol*100)}%${fadeIn||fadeOut?' · Fade '+fadeIn.toFixed(1)+'s / '+fadeOut.toFixed(1)+'s':''}</div>
        </div>
        <span class="acc-chv" style="font-size:9px;color:rgba(255,255,255,0.3);transition:transform 0.2s">▼</span>
      </div>
      <div id="acc-au-${ci}" style="padding:0 6px 8px">

    <div class="prop-row"><span class="prop-label">Volume</span>
      <input type="range" id="vol-val-${ci}-input" min="0" max="200" value="${Math.round(vol*100)}" style="flex:1;accent-color:#E8590C"
        oninput="S.cut.clips[${ci}].volume=this.value/100;if(!S.cut.clips[${ci}].audioFx)S.cut.clips[${ci}].audioFx={};S.cut.clips[${ci}].audioFx.volume=parseInt(this.value);document.getElementById('vol-pct-${ci}').textContent=this.value+'%';document.getElementById('vol-db-${ci}').textContent=(this.value>0?(20*Math.log10(this.value/100)).toFixed(1):'\u2212\u221e')+' dB';_applyPropToSelected('volume',this.value/100,${ci})">
      <span id="vol-pct-${ci}" style="font-size:10px;color:var(--mu);min-width:32px;text-align:right">${Math.round(vol*100)}%</span>
    </div>
    <div class="prop-row">
      <span class="prop-label" style="color:rgba(255,255,255,0.4)">Level</span>
      <span id="vol-db-${ci}" style="font-size:10px;color:var(--mu);font-family:'DM Mono',monospace">${vol>0?(20*Math.log10(vol)).toFixed(1):'-∞'} dB</span>
      <span style="flex:1"></span>
      <label style="display:flex;align-items:center;gap:5px;cursor:pointer">
        <input type="checkbox" id="clip-mute-${ci}" ${c.muted?'checked':''} style="accent-color:#E31837;width:13px;height:13px"
          onchange="S.cut.clips[${ci}].muted=this.checked;syncCutVid();">
        <span style="font-size:10px;color:${c.muted?'#ff453a':'var(--mu)'}">Mute</span>
      </label>
    </div>
    <div class="prop-row"><span class="prop-label">Channel</span>
      <select style="flex:1;background:#161616;border:0.5px solid rgba(255,255,255,0.1);border-radius:5px;color:var(--tx);font-size:10px;padding:2px 4px;outline:none"
        onchange="S.cut.clips[${ci}].audioChannel=this.value;syncCutVid();">
        ${['stereo','left','right','mono'].map(ch=>`<option value="${ch}" ${(c.audioChannel||'stereo')===ch?'selected':''}>${ch.charAt(0).toUpperCase()+ch.slice(1)}</option>`).join('')}
      </select>
    </div>

    <div class="prop-section" style="padding-top:6px" style="color:rgba(255,220,80,0.9)">🎚 Fade</div>
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
    <div class="prop-section" style="padding-top:6px" style="color:rgba(255,180,50,0.85)">🎛 EQ (applied)</div>
    <div class="prop-row"><span class="prop-label">Bass</span><span class="prop-val">${fx.bass||0} dB</span></div>
    <div class="prop-row"><span class="prop-label">Mid</span><span class="prop-val">${fx.mid||0} dB</span></div>
    <div class="prop-row"><span class="prop-label">Treble</span><span class="prop-val">${fx.treble||0} dB</span></div>
    ${fx.preset&&fx.preset!=='none'?'<div class="prop-row"><span class="prop-label">Preset</span><span class="prop-val">'+fx.preset+'</span></div>':''}
    ` : ''}
    <div class="prop-row" style="padding:4px 0">
      <button onclick="showAudioEnhanceDialog(${ci})" style="width:100%;padding:6px;background:rgba(232,89,12,0.12);border:0.5px solid rgba(232,89,12,0.35);border-radius:6px;color:#E8590C;font-size:11px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif">🎵 Audio Enhancement…</button>
    </div>
      </div>
    </div>` : '';


  // Ensure clip has transform object
  if(!c.transform) c.transform = {x:0, y:0, scaleX:100, scaleY:100, rotation:0};
  const tf = c.transform;

  body.innerHTML=`
    <div style="padding:6px 8px 2px;display:flex;align-items:center;gap:6px">
      <div style="width:3px;height:18px;border-radius:2px;background:linear-gradient(180deg,#E8590C,#ff8c42)"></div>
      <span style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.85)">${c.type==='video'?'Video Clip':c.type==='image'?'Image Clip':c.type==='audio'?'Audio Clip':'Clip'}</span>
      <span style="font-size:10px;color:rgba(255,255,255,0.25);flex:1;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${item.name||''}</span>
    </div>

    <div class="prop-row">
      <span class="prop-label">Opacity</span>
      <input type="range" id="op-val-${ci}" min="0" max="100" value="${Math.round((c.opacity !== undefined ? c.opacity : 1) * 100)}"
        style="flex:1;accent-color:#E8590C"
        oninput="S.cut.clips[${ci}].opacity=this.value/100;document.getElementById('op-pct-${ci}').textContent=this.value+'%';if(window.syncCutVid)syncCutVid();_applyPropToSelected('opacity',this.value/100,${ci})">
      <span id="op-pct-${ci}" style="font-size:10px;color:var(--mu);min-width:32px;text-align:right">${Math.round((c.opacity !== undefined ? c.opacity : 1) * 100)}%</span>
    </div>

    ${(c.type==='video'||c.type==='image') ? `
    <div style="border:0.5px solid rgba(232,89,12,0.25);border-radius:8px;margin:4px 0;overflow:hidden;background:rgba(232,89,12,0.04)">
      <div style="display:flex;align-items:center;padding:8px 10px;cursor:pointer;user-select:none;gap:8px"
        onclick="const el=document.getElementById('acc-tf-${ci}');el.hidden=!el.hidden;this.querySelector('.acc-chv').style.transform=el.hidden?'rotate(-90deg)':'rotate(0deg)'">
        <div style="width:3px;height:28px;border-radius:2px;background:linear-gradient(180deg,#E8590C,#ff8c42);flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;font-weight:700;color:#fff;letter-spacing:0.3px">⊞ Transform</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:1px">${(tf.x||tf.y||(tf.scaleX&&tf.scaleX!==100)||(tf.scaleY&&tf.scaleY!==100)||tf.rotation)?`x:${(tf.x||0).toFixed(0)}% y:${(tf.y||0).toFixed(0)}% s:${tf.scaleX||100}%`:'No transform applied'}</div>
        </div>
        <span class="acc-chv" style="font-size:9px;color:rgba(255,255,255,0.3);transition:transform 0.2s">▼</span>
      </div>
      <div id="acc-tf-${ci}" style="padding:0 6px 8px">
        <div class="prop-row"><span class="prop-label">X</span>
          <input type="range" min="-100" max="100" step="0.5" value="${tf.x||0}" style="flex:1;accent-color:#E8590C"
            oninput="const c2=S.cut.clips[${ci}];if(!c2.transform)c2.transform={x:0,y:0,scaleX:100,scaleY:100,rotation:0,anchorX:50,anchorY:50,antiFlicker:false,uniformScale:true};c2.transform.x=parseFloat(this.value);this.nextElementSibling.textContent=parseFloat(this.value).toFixed(1)+'%';syncCutVid();renderBoundingBox(${ci});">
          <span style="font-size:10px;color:var(--mu);min-width:36px;text-align:right">${(tf.x||0).toFixed(1)}%</span>
        </div>
        <div class="prop-row"><span class="prop-label">Y</span>
          <input type="range" min="-100" max="100" step="0.5" value="${tf.y||0}" style="flex:1;accent-color:#E8590C"
            oninput="const c2=S.cut.clips[${ci}];if(!c2.transform)c2.transform={x:0,y:0,scaleX:100,scaleY:100,rotation:0,anchorX:50,anchorY:50,antiFlicker:false,uniformScale:true};c2.transform.y=parseFloat(this.value);this.nextElementSibling.textContent=parseFloat(this.value).toFixed(1)+'%';syncCutVid();renderBoundingBox(${ci});">
          <span style="font-size:10px;color:var(--mu);min-width:36px;text-align:right">${(tf.y||0).toFixed(1)}%</span>
        </div>
        <div class="prop-row"><span class="prop-label">Scale X</span>
          <input type="range" min="0" max="500" step="1" value="${tf.scaleX||100}" style="flex:1;accent-color:#E8590C"
            oninput="const c2=S.cut.clips[${ci}];if(!c2.transform)c2.transform={x:0,y:0,scaleX:100,scaleY:100,rotation:0,anchorX:50,anchorY:50,antiFlicker:false,uniformScale:true};c2.transform.scaleX=parseInt(this.value);if(c2.transform.uniformScale!==false){c2.transform.scaleY=c2.transform.scaleX;const syEl=document.getElementById('tf-sy-${ci}');if(syEl)syEl.value=this.value;}this.nextElementSibling.textContent=this.value+'%';syncCutVid();renderBoundingBox(${ci});">
          <span style="font-size:10px;color:var(--mu);min-width:36px;text-align:right">${tf.scaleX||100}%</span>
        </div>
        <div class="prop-row"><span class="prop-label">Scale Y</span>
          <input type="range" id="tf-sy-${ci}" min="0" max="500" step="1" value="${tf.uniformScale!==false?(tf.scaleX||100):(tf.scaleY||100)}" style="flex:1;accent-color:#E8590C"
            oninput="const c2=S.cut.clips[${ci}];if(!c2.transform)c2.transform={x:0,y:0,scaleX:100,scaleY:100,rotation:0,anchorX:50,anchorY:50,antiFlicker:false,uniformScale:true};c2.transform.scaleY=parseInt(this.value);this.nextElementSibling.textContent=this.value+'%';syncCutVid();renderBoundingBox(${ci});">
          <span style="font-size:10px;color:var(--mu);min-width:36px;text-align:right">${tf.scaleY||100}%</span>
        </div>
        <div class="prop-row"><span class="prop-label">Rotation</span>
          <input type="range" min="-180" max="180" step="1" value="${tf.rotation||0}" style="flex:1;accent-color:#E8590C"
            oninput="const c2=S.cut.clips[${ci}];if(!c2.transform)c2.transform={x:0,y:0,scaleX:100,scaleY:100,rotation:0,anchorX:50,anchorY:50,antiFlicker:false,uniformScale:true};c2.transform.rotation=parseInt(this.value);this.nextElementSibling.textContent=this.value+'°';syncCutVid();renderBoundingBox(${ci});">
          <span style="font-size:10px;color:var(--mu);min-width:36px;text-align:right">${tf.rotation||0}°</span>
        </div>
        <div class="prop-row">
          <span class="prop-label">Uniform Scale</span>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="checkbox" id="tf-uni-${ci}" ${(tf.uniformScale!==false)?'checked':''} style="accent-color:#E8590C;width:14px;height:14px"
              onchange="const c2=S.cut.clips[${ci}];if(!c2.transform)c2.transform={x:0,y:0,scaleX:100,scaleY:100,rotation:0,anchorX:50,anchorY:50,antiFlicker:false,uniformScale:true};c2.transform.uniformScale=this.checked;if(this.checked){c2.transform.scaleY=c2.transform.scaleX;}updatePropsPanel(${ci});syncCutVid();">
            <span style="font-size:10px;color:var(--mu)">Lock X=Y</span>
          </label>
        </div>
        <div class="prop-row"><span class="prop-label">Anchor X</span>
          <input type="range" min="0" max="100" step="0.5" value="${tf.anchorX!==undefined?tf.anchorX:50}" style="flex:1;accent-color:#E8590C"
            oninput="const c2=S.cut.clips[${ci}];if(!c2.transform)c2.transform={x:0,y:0,scaleX:100,scaleY:100,rotation:0,anchorX:50,anchorY:50,antiFlicker:false,uniformScale:true};c2.transform.anchorX=parseFloat(this.value);this.nextElementSibling.textContent=parseFloat(this.value).toFixed(1)+'%';syncCutVid();">
          <span style="font-size:10px;color:var(--mu);min-width:36px;text-align:right">${(tf.anchorX!==undefined?tf.anchorX:50).toFixed(1)}%</span>
        </div>
        <div class="prop-row"><span class="prop-label">Anchor Y</span>
          <input type="range" min="0" max="100" step="0.5" value="${tf.anchorY!==undefined?tf.anchorY:50}" style="flex:1;accent-color:#E8590C"
            oninput="const c2=S.cut.clips[${ci}];if(!c2.transform)c2.transform={x:0,y:0,scaleX:100,scaleY:100,rotation:0,anchorX:50,anchorY:50,antiFlicker:false,uniformScale:true};c2.transform.anchorY=parseFloat(this.value);this.nextElementSibling.textContent=parseFloat(this.value).toFixed(1)+'%';syncCutVid();">
          <span style="font-size:10px;color:var(--mu);min-width:36px;text-align:right">${(tf.anchorY!==undefined?tf.anchorY:50).toFixed(1)}%</span>
        </div>
        <div class="prop-row">
          <span class="prop-label">Anti-flicker</span>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="checkbox" id="tf-af-${ci}" ${tf.antiFlicker?'checked':''} style="accent-color:#E8590C;width:14px;height:14px"
              onchange="const c2=S.cut.clips[${ci}];if(!c2.transform)c2.transform={x:0,y:0,scaleX:100,scaleY:100,rotation:0,anchorX:50,anchorY:50,antiFlicker:false,uniformScale:true};c2.transform.antiFlicker=this.checked;syncCutVid();">
            <span style="font-size:10px;color:var(--mu)">Blur 0.3px</span>
          </label>
        </div>
        <div class="prop-row"><span class="prop-label">Blend Mode</span>
          <select style="flex:1;background:#161616;border:0.5px solid rgba(255,255,255,0.1);border-radius:5px;color:var(--tx);font-size:10px;padding:2px 4px;outline:none"
            onchange="S.cut.clips[${ci}].blendMode=this.value;syncCutVid();">
            ${['source-over','multiply','screen','overlay','darken','lighten','color-dodge','color-burn','hard-light','soft-light','difference','exclusion','hue','saturation','color','luminosity'].map(m=>`<option value="${m}" ${(c.blendMode||'source-over')===m?'selected':''}>${m.replace(/-/g,' ').replace(/\b\w/g,l=>l.toUpperCase())}</option>`).join('')}
          </select>
        </div>
        <div class="prop-row" style="padding-top:4px">
          <button onclick="const c2=S.cut.clips[${ci}];c2.transform={x:0,y:0,scaleX:100,scaleY:100,rotation:0,anchorX:50,anchorY:50,antiFlicker:false,uniformScale:true};c2.blendMode='source-over';updatePropsPanel(${ci});syncCutVid();renderBoundingBox(${ci});"
            style="flex:1;padding:4px;background:rgba(255,255,255,0.04);border:0.5px solid rgba(255,255,255,0.08);border-radius:5px;color:rgba(255,255,255,0.4);font-size:10px;cursor:pointer;font-family:'DM Sans',sans-serif">
            Reset Transform
          </button>
        </div>
      </div>
    </div>` : ''}

    <div style="border:0.5px solid rgba(88,166,255,0.2);border-radius:8px;margin:4px 0;overflow:hidden;background:rgba(88,166,255,0.03)">
      <div style="display:flex;align-items:center;padding:8px 10px;cursor:pointer;user-select:none;gap:8px"
        onclick="const el=document.getElementById('acc-tm-${ci}');el.hidden=!el.hidden;this.querySelector('.acc-chv').style.transform=el.hidden?'rotate(-90deg)':'rotate(0deg)'">
        <div style="width:3px;height:28px;border-radius:2px;background:linear-gradient(180deg,#58a6ff,#79c0ff);flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;font-weight:700;color:#fff;letter-spacing:0.3px">⏱ Timing</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:1px">${fmtN(c.start)}s → ${fmtN(c.start+c.dur)}s · ${fmtN(c.dur)}s</div>
        </div>
        <span class="acc-chv" style="font-size:9px;color:rgba(255,255,255,0.3);transition:transform 0.2s">▼</span>
      </div>
      <div id="acc-tm-${ci}" style="padding:0 6px 8px">
        <div class="prop-row"><span class="prop-label">Start</span>
          ${inp('ps-start',fmtN(c.start),0.1,0,`S.cut.clips[${ci}].start=parseFloat(this.value)||0;renderCutTimeline();cutSaveHistory('prop_edit')`)}
          <span style="font-size:10px;color:var(--mu)">s</span>
        </div>
        <div class="prop-row"><span class="prop-label">Duration</span>
          ${inp('ps-dur',fmtN(c.dur),0.1,0.1,`S.cut.clips[${ci}].dur=Math.max(0.1,parseFloat(this.value)||0.1);renderCutTimeline();cutSaveHistory('prop_edit')`)}
          <span style="font-size:10px;color:var(--mu)">s</span>
        </div>
        <div class="prop-row"><span class="prop-label">End</span><span class="prop-val">${fmtN(c.start+c.dur)}s</span></div>
        <div class="prop-row"><span class="prop-label">Track</span><span class="prop-val">${c.type==='video'?'V':'A'}${c.track+1}</span></div>
      </div>
    </div>

    <div style="border:0.5px solid rgba(232,89,12,0.2);border-radius:8px;margin:4px 0;overflow:hidden;background:rgba(232,89,12,0.03)">
      <div style="display:flex;align-items:center;padding:8px 10px;cursor:pointer;user-select:none;gap:8px"
        onclick="const el=document.getElementById('acc-sp-${ci}');el.hidden=!el.hidden;this.querySelector('.acc-chv').style.transform=el.hidden?'rotate(-90deg)':'rotate(0deg)'">
        <div style="width:3px;height:28px;border-radius:2px;background:linear-gradient(180deg,#E8590C,#ff8c42);flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;font-weight:700;color:#fff;letter-spacing:0.3px">⚡ Speed</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:1px">${Math.round(speed*100)}% · ${fmtN(c.dur)}s</div>
        </div>
        <span class="acc-chv" style="font-size:9px;color:rgba(255,255,255,0.3);transition:transform 0.2s">▼</span>
      </div>
      <div id="acc-sp-${ci}" style="padding:0 6px 8px">
        <div class="prop-row">
          <span class="prop-label">Speed %</span>
          <input type="number" id="spd-pct-panel-${ci}" value="${Math.round(speed*100)}" min="10" max="800" step="1"
            style="width:58px;background:#161616;border:0.5px solid rgba(255,255,255,0.1);border-radius:5px;color:var(--tx);font-size:11px;font-family:'DM Sans',sans-serif;padding:3px 6px;outline:none"
            onchange="applyClipSpeed(${ci},parseFloat(this.value)||100,false);updatePropsPanel(${ci})">
          <span style="font-size:10px;color:var(--mu)">%</span>
        </div>
        <div class="prop-row">
          <span class="prop-label">Reverse</span>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="checkbox" id="spd-rev-${ci}" ${c.reverse?'checked':''} style="accent-color:#E8590C;width:14px;height:14px"
              onchange="S.cut.clips[${ci}].reverse=this.checked;syncCutVid();cutSaveHistory('reverse');">
            <span style="font-size:10px;color:var(--mu)">Play backwards</span>
          </label>
        </div>
        <div class="prop-row" style="gap:4px">
          <button onclick="showSpeedDialog(${ci})" style="flex:1;padding:5px;background:rgba(232,89,12,0.08);border:0.5px solid rgba(232,89,12,0.2);border-radius:6px;color:#E8590C;font-size:10px;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:600">
            ⚡ Speed / Duration…
          </button>
          ${c.type==='video'?`<button onclick="insertFrameHold(${ci})" title="Insert frame-hold at playhead" style="padding:5px 7px;background:rgba(88,166,255,0.08);border:0.5px solid rgba(88,166,255,0.2);border-radius:6px;color:#58a6ff;font-size:10px;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:600">🖼 Frame Hold</button>`:''}
        </div>
      </div>
    </div>

    ${audioSection}

    ${(()=>{
      const efArr = S.cut.effects[ci]||[];
      const trIdxs = efArr.map((e,i)=>i).filter(i=>CUT_EFFECTS[efArr[i].i]?.type==='transition');
      if(!trIdxs.length) return '';
      return trIdxs.map(efIdx2=>{
      const ef2 = efArr[efIdx2];
      const trName = CUT_EFFECTS[ef2.i]?.name||'Transition';
      const accordionId = 'tr-acc-'+ci+'-'+efIdx2;
      const isOpen = window._trAccordion?.[accordionId] !== false;
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
          <div id="${accordionId}" ${isOpen?'':'hidden'} style="padding:0 6px 8px">
          <div style="display:flex;justify-content:flex-end;padding:0 0 4px">
            <button onclick="event.stopPropagation();const e=S.cut.effects[${ci}][${efIdx2}];e&&(S.cut.effects[${ci}].splice(${efIdx2},1),renderCutTimeline(),updatePropsPanel(${ci}),syncCutVid(),scheduleSave())" style="font-size:9px;padding:2px 6px;border-radius:4px;border:0.5px solid rgba(255,69,58,0.3);background:rgba(255,69,58,0.08);color:#ff453a;cursor:pointer">✕ Remove</button>
          </div>
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

    <div style="border:0.5px solid rgba(163,113,247,0.2);border-radius:8px;margin:4px 0;overflow:hidden;background:rgba(163,113,247,0.03)">
      <div style="display:flex;align-items:center;padding:8px 10px;cursor:pointer;user-select:none;gap:8px"
        onclick="const el=document.getElementById('acc-ac-${ci}');el.hidden=!el.hidden;this.querySelector('.acc-chv').style.transform=el.hidden?'rotate(-90deg)':'rotate(0deg)'">
        <div style="width:3px;height:28px;border-radius:2px;background:linear-gradient(180deg,#a371f7,#bc8cff);flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;font-weight:700;color:#fff;letter-spacing:0.3px">🎬 Actions</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:1px">Delete · Split · Duplicate</div>
        </div>
        <span class="acc-chv" style="font-size:9px;color:rgba(255,255,255,0.3);transition:transform 0.2s">▼</span>
      </div>
      <div id="acc-ac-${ci}" style="padding:0 6px 8px">
        <div style="display:flex;gap:4px;flex-wrap:wrap;padding:2px 0">
          <button onclick="deleteSelected()" style="flex:1;padding:5px;background:rgba(255,69,58,0.08);border:0.5px solid rgba(255,69,58,0.2);border-radius:6px;color:#ff453a;font-size:10px;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:600">🗑 Delete</button>
          <button onclick="cutSplit()" style="flex:1;padding:5px;background:rgba(255,255,255,0.04);border:0.5px solid rgba(255,255,255,0.08);border-radius:6px;color:var(--tx);font-size:10px;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:600">✂️ Split</button>
          <button onclick="cutDuplicate(${ci})" style="flex:1;padding:5px;background:rgba(255,255,255,0.04);border:0.5px solid rgba(255,255,255,0.08);border-radius:6px;color:var(--tx);font-size:10px;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:600">⧉ Dupe</button>
        </div>
      </div>
    </div>

    ${(S.cut.effects[ci]||[]).length>0?`
    <div style="border:0.5px solid rgba(163,113,247,0.2);border-radius:8px;margin:4px 0;overflow:hidden;background:rgba(163,113,247,0.03)">
      <div style="display:flex;align-items:center;padding:8px 10px;cursor:pointer;user-select:none;gap:8px"
        onclick="const el=document.getElementById('acc-ef-${ci}');el.hidden=!el.hidden;this.querySelector('.acc-chv').style.transform=el.hidden?'rotate(-90deg)':'rotate(0deg)'">
        <div style="width:3px;height:28px;border-radius:2px;background:linear-gradient(180deg,#a371f7,#bc8cff);flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;font-weight:700;color:#fff;letter-spacing:0.3px">🎛 Effects</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:1px">${(S.cut.effects[ci]||[]).length} applied</div>
        </div>
        <span class="acc-chv" style="font-size:9px;color:rgba(255,255,255,0.3);transition:transform 0.2s">▼</span>
      </div>
      <div id="acc-ef-${ci}" style="padding:0 6px 8px">
        <div style="display:flex;flex-direction:column;gap:3px">
          ${(S.cut.effects[ci]||[]).map((ef,efIdx)=>{
            const eff=CUT_EFFECTS[ef.i]||{name:'Effect',color:'#888'};
            const isVisible=ef.visible!==false;
            return '<div style="display:flex;align-items:center;gap:4px;padding:4px 6px;background:'+(isVisible?'rgba(255,255,255,0.03)':'rgba(255,255,255,0.01)')+';border-radius:5px;border:0.5px solid rgba(255,255,255,0.05)">'
              +'<div style="width:8px;height:8px;border-radius:50%;background:'+eff.color+';flex-shrink:0"></div>'
              +'<span style="flex:1;font-size:10px;color:'+(isVisible?'var(--tx)':'var(--mu2)')+';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+eff.name+'</span>'
              +'<button onclick="S.cut.effects['+ci+']['+efIdx+'].visible=S.cut.effects['+ci+']['+efIdx+'].visible===false?true:false;applyVideoEffects();updatePropsPanel('+ci+')" style="font-size:9px;padding:1px 5px;border-radius:3px;border:0.5px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:var(--mu);cursor:pointer">'+(isVisible?'Hide':'Show')+'</button>'
              +'<button onclick="cutSaveHistory();S.cut.effects['+ci+'].splice('+efIdx+',1);applyVideoEffects();updatePropsPanel('+ci+')" style="font-size:9px;padding:1px 5px;border-radius:3px;border:0.5px solid rgba(255,69,58,0.2);background:rgba(255,69,58,0.06);color:#ff453a;cursor:pointer">✕</button>'
              +'</div>';
          }).join('')}
        </div>
      </div>
    </div>
    ${(c.type==='video'||c.type==='image') ? `
    <div style="border:0.5px solid rgba(255,200,50,0.2);border-radius:8px;margin:4px 0;overflow:hidden;background:rgba(255,200,50,0.03)">
      <div style="display:flex;align-items:center;padding:8px 10px;cursor:pointer;user-select:none;gap:8px"
        onclick="const el=document.getElementById('acc-col-${ci}');el.hidden=!el.hidden;this.querySelector('.acc-chv').style.transform=el.hidden?'rotate(-90deg)':'rotate(0deg)'">
        <div style="width:3px;height:28px;border-radius:2px;background:linear-gradient(180deg,#ffd43b,#ff922b);flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;font-weight:700;color:#fff;letter-spacing:0.3px">🎨 Color</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:1px">${(c.colorGrade&&Object.keys(c.colorGrade).some(k=>c.colorGrade[k]!==0))?'Grading active':'No grading applied'}</div>
        </div>
        <span class="acc-chv" style="font-size:9px;color:rgba(255,255,255,0.3);transition:transform 0.2s">▼</span>
      </div>
      <div id="acc-col-${ci}" hidden style="padding:0 6px 8px">

        <div class="prop-section" style="color:rgba(255,220,50,0.9)">⚡ Basic Correction</div>
        ${[
          ['Exposure',    'exposure',    -100,100,0],
          ['Contrast',    'contrast',    -100,100,0],
          ['Highlights',  'highlights',  -100,100,0],
          ['Shadows',     'shadows',     -100,100,0],
          ['Whites',      'whites',      -100,100,0],
          ['Blacks',      'blacks',      -100,100,0],
          ['Saturation',  'saturation',  -100,100,0],
          ['Temperature', 'temperature', -100,100,0],
          ['Tint',        'tint',        -100,100,0],
        ].map(([lbl,key,mn,mx,def])=>`
          <div class="prop-row"><span class="prop-label">${lbl}</span>
            <input type="range" min="${mn}" max="${mx}" step="1"
              value="${(c.colorGrade&&c.colorGrade[key])||0}"
              style="flex:1;accent-color:#ffd43b"
              oninput="const _c=S.cut.clips[${ci}];if(!_c.colorGrade)_c.colorGrade={};_c.colorGrade['${key}']=parseFloat(this.value);this.nextElementSibling.textContent=this.value;if(window.syncCutVid)syncCutVid();">
            <span style="font-size:10px;color:var(--mu);min-width:28px;text-align:right">${(c.colorGrade&&c.colorGrade[key])||0}</span>
          </div>`).join('')}

        <div class="prop-section" style="color:rgba(255,180,80,0.9);padding-top:6px">✨ Creative</div>
        ${[
          ['Faded Film','fadedFilm',0,100,0],
          ['Sharpen',   'sharpen',  0,100,0],
          ['Vibrance',  'vibrance',-100,100,0],
        ].map(([lbl,key,mn,mx,def])=>`
          <div class="prop-row"><span class="prop-label">${lbl}</span>
            <input type="range" min="${mn}" max="${mx}" step="1"
              value="${(c.colorGrade&&c.colorGrade[key])||0}"
              style="flex:1;accent-color:#ff922b"
              oninput="const _c=S.cut.clips[${ci}];if(!_c.colorGrade)_c.colorGrade={};_c.colorGrade['${key}']=parseFloat(this.value);this.nextElementSibling.textContent=this.value;if(window.syncCutVid)syncCutVid();">
            <span style="font-size:10px;color:var(--mu);min-width:28px;text-align:right">${(c.colorGrade&&c.colorGrade[key])||0}</span>
          </div>`).join('')}

        <div class="prop-section" style="color:rgba(200,180,255,0.9);padding-top:6px">🌈 HSL</div>
        <div style="font-size:10px;color:rgba(255,255,255,0.3);padding:2px 4px 4px">Hue shift per channel (°)</div>
        ${['Reds','Oranges','Yellows','Greens','Cyans','Blues','Magentas'].map((ch,i)=>{
          const key='hsl_h_'+i;
          return `<div class="prop-row"><span class="prop-label" style="min-width:56px;font-size:10px">${ch}</span>
            <input type="range" min="-180" max="180" step="1"
              value="${(c.colorGrade&&c.colorGrade[key])||0}"
              style="flex:1;accent-color:#da77f2"
              oninput="const _c=S.cut.clips[${ci}];if(!_c.colorGrade)_c.colorGrade={};_c.colorGrade['${key}']=parseFloat(this.value);this.nextElementSibling.textContent=this.value+'°';if(window.syncCutVid)syncCutVid();">
            <span style="font-size:10px;color:var(--mu);min-width:32px;text-align:right">${(c.colorGrade&&c.colorGrade['hsl_h_'+i])||0}°</span>
          </div>`;}).join('')}

        <div class="prop-row" style="padding-top:2px">
          <button onclick="const _c=S.cut.clips[${ci}];_c.colorGrade={};updatePropsPanel(${ci});if(window.syncCutVid)syncCutVid();"
            style="flex:1;padding:4px;background:rgba(255,255,255,0.04);border:0.5px solid rgba(255,255,255,0.08);border-radius:5px;color:rgba(255,255,255,0.4);font-size:10px;cursor:pointer;font-family:'DM Sans',sans-serif">
            Reset Color
          </button>
        </div>

      </div>
    </div>` : ''}
`:''}
  `;

  // _origDur is set in applyClipSpeed, not here
}

// ── SPEED / TIME REMAPPING ENGINE ──────────────────────────

// Apply speed to a clip with optional ripple edit
// ripple=true: shift all clips that start AFTER this clip's original end
function applyClipSpeed(ci, newSpeedPct, ripple){
  const c = S.cut.clips[ci];
  if(!c) return;

  const newSpeed = Math.max(0.1, Math.min(16, newSpeedPct / 100));
  
  // _origDur = available source content from fileStart to end of file
  // Use media item duration minus fileStart for true available duration
  if(c._origDur === undefined || c._origDur === null){
    const _item = getMediaById(c.mediaId);
    const _srcTotal = _item?.duration || (c.dur * (c.speed||1));
    c._origDur = Math.max(c.dur * (c.speed||1), _srcTotal - (c.fileStart||0));
  }
  
  const oldDur  = c.dur;
  // Available source = total from fileStart (never exceed file end)
  const _item2 = getMediaById(c.mediaId);
  const _srcAvail = _item2?.duration
    ? Math.max(0, _item2.duration - (c.fileStart||0))
    : c._origDur;
  // Timeline duration = available source / speed, capped to actual source
  const newDur  = Math.min(c._origDur / newSpeed, _srcAvail / newSpeed);
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

// ── Apply a property change to ALL selected clips ──────────────────────────
// Called after any single-clip property change when multi-select is active.
// prop: string key (e.g. 'volume', 'speed'), val: new value
function _applyPropToSelected(prop, val, sourceCi){
  if(!window._selectedClips || window._selectedClips.size <= 1) return;
  window._selectedClips.forEach(ci => {
    if(ci === sourceCi) return; // already applied to source
    const c = S.cut.clips[ci];
    if(!c) return;
    if(prop === 'speed'){
      applyClipSpeed(ci, val * 100, false);
    } else {
      c[prop] = val;
    }
  });
  renderCutTimeline();
}
window._applyPropToSelected = _applyPropToSelected;


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
    const item=getMediaById(c.mediaId);
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
function cutBinDragStart(e,i){S.cut._drag=i;e.dataTransfer.setData('text/plain',''+i);e.dataTransfer.effectAllowed='copy';}
function cutSelMedia(i){S.cut.selMedia=i;document.querySelectorAll('.mbin-item').forEach((el,idx)=>el.classList.toggle('sel',idx===i));}
function cutAddToTL(i) {
  const item=S.cut.media[i]; if(!item) return;
  // Progressive bottom-up placement: scan from V1 (trackIdx=0) upward
  // Place in lowest track that has space at its end, or lowest empty track
  let track, startSec;
  if(item.type==='audio'){
    track = S.cut.videoTracks; // first audio track
    const ends = S.cut.clips.filter(c=>c.track===track).map(c=>c.start+c.dur);
    startSec = ends.length ? Math.max(...ends)+0.01 : 0;
  } else {
    // If user has a selected clip on a video track, append to that same track
    if(S.cut.sel !== null && S.cut.sel !== undefined && S.cut.clips[S.cut.sel]?.type==='video'){
      track = S.cut.clips[S.cut.sel].track;
      const ends = S.cut.clips.filter(c=>c.track===track).map(c=>c.start+c.dur);
      startSec = ends.length ? Math.max(...ends)+0.01 : 0;
    } else {
      // Progressive scan: find the lowest track (starting V1=0) that has clips,
      // and append after its last clip. If a track is completely empty, use it.
      // This ensures V1 fills first, then V2, then V3 (bottom-up stacking).
      let bestTrack = 0;
      let bestEnd = -1;
      let emptyTrack = -1;
      for(let vt=0; vt<S.cut.videoTracks; vt++){
        const trackClips = S.cut.clips.filter(c=>(c.type==='video'||c.type==='frame_hold')&&c.track===vt);
        if(trackClips.length === 0){
          if(emptyTrack === -1) emptyTrack = vt; // lowest empty track
        } else {
          const trackEnd = Math.max(...trackClips.map(c=>c.start+c.dur));
          if(bestEnd === -1){ bestTrack=vt; bestEnd=trackEnd; } // first occupied track wins
        }
      }
      if(bestEnd >= 0){
        // Append after last clip on lowest occupied track
        track = bestTrack;
        startSec = bestEnd + 0.01;
      } else if(emptyTrack >= 0){
        // All tracks empty — use V1
        track = emptyTrack;
        startSec = 0;
      } else {
        track = 0; startSec = 0;
      }
    }
    window._lastActiveVideoTrack = track;
  }
  S.cut.clips.push({mediaId:item.id,name:item.name,type:item.type,track,start:startSec,dur:Math.max(item.duration||5,0.5),fileStart:0,
    transform:{x:0,y:0,scaleX:100,scaleY:100,rotation:0,anchorX:50,anchorY:50,antiFlicker:false,uniformScale:true},
    color:item.type==='video'?'rgba(88,166,255,0.8)':item.type==='audio'?'rgba(210,153,34,0.8)':'rgba(63,185,80,0.8)'});
  // If video file, also add linked audio clip on first audio track
  if(item.type==='video'&&item.hasAudio!==false){
    const audioTrackIdx=S.cut.videoTracks; // first audio track
    S.cut.clips.push({
      mediaId:item.id,
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
  // Auto-scroll timeline so the new clip's end is visible
  setTimeout(() => {
    const _scroll = document.getElementById('tl-scroll');
    if(!_scroll) return;
    const _newClip = S.cut.clips[S.cut.clips.length - 1];
    if(!_newClip) return;
    const _clipEndPx = (_newClip.start + _newClip.dur) * (window.PPS || 60);
    const _viewW = _scroll.clientWidth;
    // Scroll so the clip end is at 80% of the viewport (some margin on right)
    const _targetScroll = Math.max(0, _clipEndPx - _viewW * 0.8);
    _scroll.scrollTo({ left: _targetScroll, behavior: 'smooth' });
    // Also move playhead to start of new clip
    S.cut.ph = startSec;
    updateCutPH();
    // Re-sync audio after playhead moved — keeps voiceover playing at new position if applicable
    if(S.cut.playing) startAudioPlayback();
    else syncAudioPlayback();
  }, 80);
  // Ensure viewport frame has correct dimensions, then initialize video
  applyCanvasAspectRatio(S.proj.w||1920, S.proj.h||1080);
  // Ensure placeholder canvas is visible immediately (CSS default is block, but be explicit)
  const _placeholderCvs = document.getElementById('cut-cvs');
  if(_placeholderCvs) _placeholderCvs.style.display = 'block';
  const _startInit = (attempts) => {
    const delay = attempts === 5 ? 80 : 250;
    setTimeout(() => {
      setupPlayheadDrag();
      // Ensure canvas is visible before syncCutVid runs
      const _cvs = document.getElementById('cut-trans-cvs');
      const _fr  = document.getElementById('cut-viewport-frame');
      if(_cvs){ _cvs.style.display = 'block'; _cvs.style.zIndex = '2'; }
      if(_fr)  applyCanvasAspectRatio(S.proj.w||1920, S.proj.h||1080);
      syncCutVid();
      const mv2 = document.getElementById('cut-main-vid');
      if(mv2 && mv2.readyState < 2 && attempts > 0){
        _startInit(attempts - 1);
      }
    }, delay);
  };
  _startInit(5);
  // Extra sync calls at longer delays to handle slow video decode / cold loads
  setTimeout(() => { if(!S.cut.playing) syncCutVid(); }, 600);
  setTimeout(() => { if(!S.cut.playing) syncCutVid(); }, 1500);
}

function renderCutTimeline() {
  const totalTk=S.cut.videoTracks+S.cut.audioTracks;
  // Update timeline shell height
  const shell=$('cut-tl');
  if(shell) shell.style.height=Math.max(120,(38+18+totalTk*30+4))+'px';

  // Compute actual project duration: max of proj.dur, all clip ends, all overlay ends
  // This is the elastic canvas width - grows automatically as content is added
  const _clipEnd = S.cut.clips.length ? Math.max(...S.cut.clips.map(c=>c.start+c.dur)) : 0;
  const _ovEnd   = (window._overlays||[]).length ? Math.max(...window._overlays.map(o=>o.endTime||0)) : 0;
  const _actualDur = Math.max(S.proj.dur||10, _clipEnd, _ovEnd) + 5; // +5s breathing room
  const _tlW = Math.round(_actualDur * PPS);

  // Update ruler width and marks dynamically
  const ruler = document.getElementById('tl-ruler');
  if(ruler){
    ruler.style.width = _tlW + 'px';
    const _step = _actualDur<=30?2:_actualDur<=120?5:_actualDur<=600?10:30;
    ruler.innerHTML = Array.from({length:Math.floor(_actualDur/_step)+1},(_,i)=>i*_step)
      .map(s=>'<div class="ruler-mark" style="left:'+Math.round(s*PPS)+'px"><span>'+fmtTC(s)+'</span></div>')
      .join('');
    // Re-apply scroll offset immediately so ruler stays in sync after re-render
    const _sc2 = document.getElementById('tl-scroll');
    if(_sc2) ruler.style.transform = `translateX(-${_sc2.scrollLeft}px)`;
  }

  // Update tl-rows container width
  const rows=$('tl-rows');
  if(rows) rows.style.width = _tlW + 'px';

  // Rebuild track rows
  if(rows){
    const ph=document.getElementById('cut-ph');
    rows.querySelectorAll('.clip-track-row').forEach(r=>r.remove());
    // Video rows: descending (highest trackIdx first = visually on top)
    for(let v=S.cut.videoTracks; v>=1; v--){
      const t = v-1;
      const row=document.createElement('div');
      row.id='tl-row-'+t;
      row.className='clip-track-row video-row';
      row.setAttribute('data-track',t);
      row.style.width = _tlW + 'px';
      if(ph) rows.insertBefore(row,ph); else rows.appendChild(row);
    }
    // Audio rows: ascending
    for(let a=1; a<=S.cut.audioTracks; a++){
      const t = S.cut.videoTracks+(a-1);
      const row=document.createElement('div');
      row.id='tl-row-'+t;
      row.className='clip-track-row audio-row';
      row.setAttribute('data-track',t);
      row.style.width = _tlW + 'px';
      if(ph) rows.insertBefore(row,ph); else rows.appendChild(row);
    }
  }

  for (let t=0; t<totalTk; t++) {
    const row=$('tl-row-'+t); if(!row) continue;
    // Use _tlW computed at top of function (includes overlays, +5s breathing room)
    row.style.width = _tlW + 'px';
    // setup drop
    row.ondragover=e=>{e.preventDefault();row.classList.add('drag-over');};
    row.ondragleave=()=>row.classList.remove('drag-over');
    row.ondrop=e=>{
      e.preventDefault();row.classList.remove('drag-over');
      const i=parseInt(e.dataTransfer.getData('text/plain'));
      if(isNaN(i)||i<0||i>=S.cut.media.length)return;
      const item=S.cut.media[i];
      // Type enforcement: visual assets (video/image) on video tracks; audio on audio tracks only
      const isVideoTrack = t < S.cut.videoTracks;
      const isAudioTrack = t >= S.cut.videoTracks;
      const isVisualAsset = item.type === 'video' || item.type === 'image';
      const isAudioAsset = item.type === 'audio';
      if(isVideoTrack && isAudioAsset){ notify('Audio assets must go on Audio tracks (A1, A2...)','#E31837'); return; }
      if(isAudioTrack && isVisualAsset){ notify('Video/image assets must go on Video tracks (V1, V2...)','#E31837'); return; }
      const rect=row.getBoundingClientRect();
      const start=Math.max(0,(e.clientX-rect.left+document.getElementById('tl-scroll')?.scrollLeft||0)/PPS);
      S.cut.clips.push({mediaId:item.id,name:item.name,type:item.type,track:t,start,dur:Math.max(item.duration||5,0.5),fileStart:0,
        transform:{x:0,y:0,scaleX:100,scaleY:100,rotation:0,anchorX:50,anchorY:50,antiFlicker:false,uniformScale:true},
        color:item.type==='video'?'rgba(88,166,255,0.8)':item.type==='audio'?'rgba(210,153,34,0.8)':'rgba(63,185,80,0.8)'});
      // Auto-add audio track for video clips
      if(item.type==='video'&&item.hasAudio!==false){
        const audioTrackIdx=S.cut.videoTracks;
        S.cut.clips.push({mediaId:item.id,name:item.name+' [Audio]',type:'audio',track:audioTrackIdx,start,dur:Math.max(item.duration||5,0.5),fileStart:0,linkedToVideo:true,color:'rgba(210,153,34,0.6)'});
      }
      renderCutTimeline();notify(item.name+' added','#3fb950');scheduleSave();
    };
    // remove old clips
    Array.from(row.querySelectorAll('.tl-clip')).forEach(el=>el.remove());
    S.cut.clips.filter(c=>c.track===t).forEach((c,_,arr)=>{
      const ci=S.cut.clips.indexOf(c);
      const el=document.createElement('div');
      el.className='tl-clip'+((S.cut.sel===ci || window._selectedClips?.has(ci))?' selected':'');
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
        // Ignore single click if it's the second click of a dblclick (within 300ms)
        const _now = Date.now();
        if(el._lastClickTime && _now - el._lastClickTime < 300){ el._lastClickTime = 0; return; }
        el._lastClickTime = _now;
        _selectClip(ci);
      }, true); // capture:true — fires before children
      el.addEventListener('contextmenu',e=>{e.stopPropagation();clipContextMenu(e,ci);});
      // Double-click → jump playhead to first frame of this clip
      // Use mousedown-based detection (capture) to avoid click handler interference
      el.addEventListener('mousedown', e => {
        if(e.button !== 0) return;
        if(e.target.classList.contains('clip-resize-l')) return;
        if(e.target.classList.contains('clip-resize-r')) return;
        const _now2 = Date.now();
        if(el._lastMdTime && _now2 - el._lastMdTime < 300){
          // Double mousedown = double-click
          e.stopPropagation();
          el._lastMdTime = 0;
          el._lastClickTime = 0;
          const c2 = S.cut.clips[ci];
          if(!c2) return;
          S.cut.ph = c2.start;
          updateCutPH();
          syncCutVid();
          return;
        }
        el._lastMdTime = _now2;
      }, true);
      el.addEventListener('mousedown', e => {
        if(e.target.classList.contains('clip-resize-l')||e.target.classList.contains('clip-resize-r')) return;
        // Select immediately on mousedown (before any drag), capture phase
        _selectClip(ci);
        clipMoveStart(e, ci);
      }, true); // capture:true
      el.querySelector('.clip-resize-l').addEventListener('mousedown',e=>{e.stopPropagation();clipResizeStart(e,ci,'l');});
      el.querySelector('.clip-resize-r').addEventListener('mousedown',e=>{e.stopPropagation();clipResizeStart(e,ci,'r');});
      // Waveform for audio clips (with fileStart offset for split clips)
      if(c.type==='audio'&&getMediaById(c.mediaId)?.url&&window.generateWaveformForClip){
        const _url=getMediaById(c.mediaId).url;
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
  if(window._selectedClips?.size>1&&window._highlightSelected)window._highlightSelected();
  // Always redraw overlays after timeline rebuild so they never disappear
  if(window.renderOverlayTimeline) window.renderOverlayTimeline();
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
  // Show bounding box handles
  if(typeof renderBoundingBox === 'function') renderBoundingBox(ci);
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
  // Store all selected clip origins for group move
  const _multiOrigins = {};
  const _multiOriginTracks = {};
  if(window._selectedClips?.size > 1){
    window._selectedClips.forEach(_idx => {
      if(S.cut.clips[_idx]){
        _multiOrigins[_idx]      = S.cut.clips[_idx].start;
        _multiOriginTracks[_idx] = S.cut.clips[_idx].track; // save original track too
      }
    });
  }
  window._snapCache = null;
  // Store origins for all selected overlays at drag start (for cross-type group move)
  const _multiOverlayOrigins = {};
  if(window._selectedOverlays?.size > 0){
    (window._overlays||[]).forEach(o => {
      if(window._selectedOverlays.has(o.id)) _multiOverlayOrigins[o.id] = o.startTime;
    });
  }
  _mv = {
    ci,
    sx:       e.clientX,
    sy:       e.clientY,
    origStart:S.cut.clips[ci].start,
    origTrack:S.cut.clips[ci].track,
    el:       el,
    _multiOrigins,
    _multiOriginTracks,
    _multiOverlayOrigins,
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
  // Vertical: change track (each row is 30px)
  // Timeline renders Vn at top → V1 at bottom. Dragging UP (dy<0) = higher track number.
  const totalTracks=S.cut.videoTracks+S.cut.audioTracks;
  const trackDelta=-Math.round(dy/30);
  const grabbedClip=S.cut.clips[_mv.ci];
  const grabbedIsVideo=grabbedClip.type==='video'||grabbedClip.type==='image'||grabbedClip.type==='frame_hold';
  // Type-safe track bounds: video clips stay in video rows, audio stays in audio rows
  const _minTrack = grabbedIsVideo ? 0 : S.cut.videoTracks;
  const _maxTrack = grabbedIsVideo ? S.cut.videoTracks-1 : totalTracks-1;
  const newTrack=Math.max(_minTrack, Math.min(_maxTrack, _mv.origTrack+trackDelta));
  S.cut.clips[_mv.ci].track=newTrack;
  if(newTrack !== _mv.origTrack) console.log('[Drag] clip track:', _mv.origTrack,'→',newTrack,'(dy='+Math.round(dy)+')');
  // No color mutation during drag - preserve original colors
  // GROUP MOVE: apply BOTH horizontal AND vertical delta to all selected clips
  if(window._selectedClips?.size > 1 && _mv._multiOrigins){
    const _hDelta = newStart - (_mv._multiOrigins[_mv.ci] ?? _mv.origStart);
    const _vDelta = newTrack - _mv.origTrack; // same track shift for all
    window._selectedClips.forEach(_sidx => {
      if(_sidx === _mv.ci) return;
      const _sc = S.cut.clips[_sidx];
      if(!_sc || _mv._multiOrigins[_sidx] === undefined) return;
      // Horizontal
      _sc.start = Math.max(0, _mv._multiOrigins[_sidx] + _hDelta);
      // Vertical: apply same delta, clamped to correct type boundaries
      const _scIsVideo = _sc.type==='video'||_sc.type==='image'||_sc.type==='frame_hold';
      const _scMin = _scIsVideo ? 0 : S.cut.videoTracks;
      const _scMax = _scIsVideo ? S.cut.videoTracks-1 : totalTracks-1;
      const _origTrack = _mv._multiOriginTracks?.[_sidx] ?? _sc.track;
      _sc.track = Math.max(_scMin, Math.min(_scMax, _origTrack + _vDelta));
    });
  }
  renderCutTimeline();
  if(window._selectedClips?.size > 1) _highlightSelected();

  // Cross-type group move: also move any selected overlays by the same horizontal delta
  if(window._selectedOverlays?.size > 0 && _mv._multiOverlayOrigins){
    const _hDelta = newStart - (_mv._multiOrigins?.[_mv.ci] ?? _mv.origStart);
    (window._overlays||[]).forEach(o => {
      if(!window._selectedOverlays.has(o.id)) return;
      if(_mv._multiOverlayOrigins[o.id] === undefined) return;
      const _oDur = o.endTime - o.startTime;
      o.startTime = Math.max(0, _mv._multiOverlayOrigins[o.id] + _hDelta);
      o.endTime   = o.startTime + _oDur;
      // Update DOM position directly — no renderOverlayTimeline to avoid listener rebuild
      const _ovEl = document.querySelector('[data-ov-id="'+o.id+'"]');
      if(_ovEl){
        _ovEl.style.left  = Math.round(o.startTime * PPS) + 'px';
        _ovEl.style.width = Math.max(4, Math.round((o.endTime - o.startTime) * PPS)) + 'px';
      }
    });
  }
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
  S.cut._isResizing = true;
  window._snapCache = null;
  _rz={ci,edge,sx:e.clientX,origDur:S.cut.clips[ci].dur,origStart:S.cut.clips[ci].start,origFileStart:S.cut.clips[ci].fileStart||0};
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
    const _trimDelta = newStart - _rz.origStart; // how much was trimmed from left
    const _spd = c.speed || 1;
    // Advance fileStart by trimDelta/speed so we read further into source
    // Clamp: fileStart cannot exceed (sourceDur - minDur*speed)
    const _newFs = (_rz.origFileStart||0) + _trimDelta / _spd;
    c.fileStart = Math.max(0, _newFs);
    c.start = newStart;
    c.dur   = nd;
  }
  renderCutTimeline();
}
function clipRzUp(){
  S.cut._isResizing=false;
  // Overlay sync: if clip was trimmed from right edge, shift overlays
  // that were inside the trimmed area back to the new clip end
  if(_rz && _rz.edge==='r'){
    const c = S.cut.clips[_rz.ci];
    if(c && window._overlays){
      const newClipEnd = c.start + c.dur;
      const oldClipEnd = _rz.origStart + _rz.origDur;
      const delta = newClipEnd - oldClipEnd; // negative = trim, positive = extend
      // Shift overlays that started after oldClipEnd by the same delta
      window._overlays.forEach(o=>{
        if(o.startTime >= oldClipEnd - 0.05){
          o.startTime = Math.max(0, o.startTime + delta);
          o.endTime   = Math.max(o.startTime + 0.1, o.endTime + delta);
        }
      });
      if(window.renderOverlayTimeline) renderOverlayTimeline();
    }
  }
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
  const ph=S.cut.ph;

  // ── Multi-select: split all selected clips that span the playhead ──
  if(window._selectedClips?.size > 1){
    const toSplit = [...window._selectedClips].filter(ci=>{
      const c = S.cut.clips[ci];
      return c && ph > c.start && ph < c.start + c.dur;
    });
    if(!toSplit.length){notify('Playhead not on any selected clip','#E31837');return;}
    cutSaveHistory('split_multi');
    toSplit.forEach(ci=>{
      const c = S.cut.clips[ci];
      const origEnd = c.start + c.dur;
      const splitOffset = ph - c.start;
      const c2 = {...c, start:ph, dur:origEnd-ph, fileStart:(c.fileStart||0)+splitOffset, effects:{}};
      c.dur = ph - c.start;
      S.cut.clips.push(c2);
    });
    window._selectedClips = new Set();
    S.cut.sel = null;
    rebuildTrackLabels(); renderCutTimeline(); setupPlayheadDrag();
    notify('Split ' + toSplit.length + ' clips at '+fmtTC(ph),'#3fb950');
    return;
  }

  // ── Single clip split ──
  let ci=S.cut.sel;
  const clipAtPH=S.cut.clips.findIndex(c=>ph>c.start&&ph<c.start+c.dur);

  if(clipAtPH<0){notify('Place playhead on a clip to split','#E31837');return;}

  if(ci===null||ci===undefined||!(ph>S.cut.clips[ci]?.start&&ph<S.cut.clips[ci]?.start+S.cut.clips[ci]?.dur)){
    ci=clipAtPH;
    S.cut.sel=ci;
  }

  const c=S.cut.clips[ci];
  if(!c||ph<=c.start||ph>=c.start+c.dur){notify('Playhead must be on a clip','#E31837');return;}
  cutSaveHistory('split');

  const origStart = c.start;
  const origEnd   = origStart + c.dur;
  const splitFileOffset = ph - origStart;

  c.dur = ph - origStart;

  const c2 = {
    ...c,
    start: ph,
    dur:   origEnd - ph,
    fileStart: (c.fileStart||0) + splitFileOffset,
    effects: {}
  };
  S.cut.clips.push(c2);

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
    // Delete track button (only show if more than 1 video track)
    if(S.cut.videoTracks > 1){
      const del=document.createElement('button');
      del.textContent='×'; del.title='Delete track';
      del.style.cssText='background:none;border:none;color:var(--mu2);cursor:pointer;font-size:11px;padding:1px 3px;opacity:0.5;line-height:1';
      del.onmouseenter=()=>del.style.opacity='1';
      del.onmouseleave=()=>del.style.opacity='0.5';
      del.onclick=e=>{e.stopPropagation();cutDeleteTrack('video',trackIdx);};
      d.appendChild(del);
    }
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
    // Delete track button (only show if more than 1 audio track)
    if(S.cut.audioTracks > 1){
      const del=document.createElement('button');
      del.textContent='×'; del.title='Delete track';
      del.style.cssText='background:none;border:none;color:var(--mu2);cursor:pointer;font-size:11px;padding:1px 3px;opacity:0.5;line-height:1';
      del.onmouseenter=()=>del.style.opacity='1';
      del.onmouseleave=()=>del.style.opacity='0.5';
      del.onclick=e=>{e.stopPropagation();cutDeleteTrack('audio',trackIdx);};
      d.appendChild(del);
    }
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
  // ── Multi-select: duplicate all selected clips ──
  if(ciOverride === undefined && window._selectedClips?.size > 1){
    cutSaveHistory('duplicate_multi');
    const indices = [...window._selectedClips].sort((a,b)=>a-b);
    indices.forEach(ci => {
      const c = S.cut.clips[ci];
      if(!c) return;
      const dup = JSON.parse(JSON.stringify(c));
      dup.start = c.start + c.dur;
      const newCi = S.cut.clips.length;
      if(S.cut.effects[ci]?.length > 0){
        S.cut.effects[newCi] = JSON.parse(JSON.stringify(S.cut.effects[ci]));
      }
      S.cut.clips.push(dup);
    });
    window._selectedClips = new Set();
    S.cut.sel = null;
    renderCutTimeline();
    notify('Duplicated ' + indices.length + ' clips', '#3fb950');
    scheduleSave();
    return;
  }

  // ── Single clip duplicate ──
  const ci = (ciOverride !== undefined && ciOverride !== null) ? ciOverride : S.cut.sel;
  if(ci === null || ci === undefined || !S.cut.clips[ci]){
    notify('Select a clip first', '#E31837');
    return;
  }
  cutSaveHistory('duplicate');
  const c = S.cut.clips[ci];
  const dup = JSON.parse(JSON.stringify(c));
  dup.start = c.start + c.dur;
  const newCi = S.cut.clips.length;
  if(S.cut.effects[ci] && S.cut.effects[ci].length > 0){
    S.cut.effects[newCi] = JSON.parse(JSON.stringify(S.cut.effects[ci]));
  }
  S.cut.clips.push(dup);
  S.cut.sel = newCi;
  renderCutTimeline();
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
  } else if(window._selectedClips?.size > 1){
    // Multi-select — delegate to cutDelete which handles it
    cutDelete();
  } else if(S.cut.sel !== null && S.cut.sel !== undefined){
    // Single clip selected — delete it
    cutDelete();
  } else {
    notify('Select a clip or overlay first', '#E31837');
  }
}
window.deleteSelected = deleteSelected;

function cutDelete(){
  // ── Multi-select: delete all selected clips ──
  if(window._selectedClips?.size > 1){
    cutSaveHistory('delete_clips');
    const indices = [...window._selectedClips].sort((a,b)=>b-a); // descending so splice doesn't shift
    indices.forEach(ci => {
      const c = S.cut.clips[ci];
      if(!c) return;
      if(c.type==='video'){
        const li = S.cut.clips.findIndex((a,i)=>i!==ci&&a.linkedToVideo&&a.mediaId===c.mediaId&&Math.abs(a.start-c.start)<0.5);
        if(li>=0){ S.cut.clips[li].linkedToVideo=false; S.cut.clips[li].name=S.cut.clips[li].name.replace(' [Audio]','')+' (Audio)'; }
      } else if(c.linkedToVideo || c.type==='audio'){
        const pv = S.cut.clips.find((v,i)=>i!==ci&&v.type==='video'&&v.mediaId===c.mediaId&&Math.abs(v.start-c.start)<1.0);
        if(pv) pv.nativeAudioMuted = true;
      }
      S.cut.clips.splice(ci,1);
    });
    window._selectedClips = new Set();
    S.cut.sel = null;
    stopAudioPlayback();
    renderCutTimeline();
    setTimeout(()=>{ _syncVideoMute(); if(S.cut.playing) startAudioPlayback(); else syncAudioPlayback(); }, 60);
    notify('Deleted ' + indices.length + ' clips');
    scheduleSave();
    return;
  }
  // ── Single clip delete ──
  const ci=S.cut.sel;
  if(ci===null||ci===undefined){notify('Select a clip first','#E31837');return;}
  const c=S.cut.clips[ci];
  cutSaveHistory('delete_clip'); // snapshot before delete
  S.cut.clips.splice(ci,1);
  // Handle linked audio relationships
  if(c.type==='video'){
    // Video deleted — unlink any linked audio clip (keep audio, detach from video)
    const li=S.cut.clips.findIndex(a=>a.linkedToVideo&&a.mediaId===c.mediaId&&Math.abs(a.start-c.start)<0.5);
    if(li>=0){
      const linkedAudio = S.cut.clips[li];
      const isSamePosition = Math.abs(linkedAudio.start - c.start) < 0.1 && Math.abs(linkedAudio.dur - c.dur) < 0.1;
      if(isSamePosition){
        linkedAudio.linkedToVideo = false;
        linkedAudio.name = linkedAudio.name.replace(' [Audio]','') + ' (Audio)';
      }
    }
  } else if(c.linkedToVideo || c.type==='audio'){
    // Audio clip deleted — find its parent video and mark native audio as muted
    // so video tag doesn't suddenly play raw audio
    const parentVideo = S.cut.clips.find(
      v => v.type==='video' && v.mediaId===c.mediaId && Math.abs(v.start-c.start)<1.0
    );
    if(parentVideo) parentVideo.nativeAudioMuted = true;
  }
  S.cut.sel=null;
  stopAudioPlayback();
  renderCutTimeline();
  // Re-sync mute state and audio after deletion
  setTimeout(()=>{
    _syncVideoMute();
    if(S.cut.playing) startAudioPlayback();
    else syncAudioPlayback();
  }, 60);
  notify('Clip deleted');
  scheduleSave();
}
function cutNewSeq(){S.cut={...S.cut,clips:[],ph:0,playing:false,sel:null};buildCut();notify('New sequence');}

function cutDeleteTrack(type, trackIdx){
  // Remove all clips on this track
  const clipsOnTrack = S.cut.clips.filter(c => c.track === trackIdx);
  if(clipsOnTrack.length > 0){
    if(!confirm('Delete track and its '+clipsOnTrack.length+' clip(s)?')) return;
  }
  S.cut.clips = S.cut.clips.filter(c => c.track !== trackIdx);
  // Re-index clips on higher tracks of the SAME type only (no cross-boundary shift)
  if(type === 'video'){
    if(S.cut.videoTracks <= 1){ notify('Cannot delete last video track','#E31837'); return; }
    S.cut.clips.forEach(c => {
      if(c.type === 'video' && c.track > trackIdx) c.track--;
    });
    S.cut.videoTracks--;
    // When video track deleted, audio rows move down by 1
    S.cut.clips.forEach(c => { if(c.type === 'audio') c.track--; });
  } else {
    if(S.cut.audioTracks <= 1){ notify('Cannot delete last audio track','#E31837'); return; }
    S.cut.clips.forEach(c => {
      if(c.type === 'audio' && c.track > trackIdx) c.track--; // shift down only audio clips
    });
    S.cut.audioTracks--;
  }
  cutSaveHistory('delete_track');
  rebuildTrackLabels();
  renderCutTimeline();
  if(window.renderOverlayTimeline) renderOverlayTimeline();
  notify((type==='video'?'Video':'Audio')+' track deleted','#3fb950');
}
window.cutDeleteTrack = cutDeleteTrack;

function cutAddTrack(type){
  type=type||'video';
  if(type==='video'){
    // Adding video track increases videoTracks count
    // Audio clips start at index=videoTracks, so they must shift up by 1
    S.cut.videoTracks++;
    S.cut.clips.forEach(c => { if(c.type==='audio') c.track++; });
  } else {
    // Adding audio track - no effect on video clips
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
  // Reset frame_hold clock when ph changes (scrub/click) so no time-jump
  if(!S.cut.playing) window._fhLastTime = null;
  const ph=$('cut-ph');
  if(!ph) return;
  const leftPx = Math.round(S.cut.ph * PPS);
  ph.style.left = leftPx + 'px';
  // Sync scrub bar
  if(window.updateScrubBar) updateScrubBar();
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
    window._fhLastTime = null; // always reset frame_hold clock on play start
    // Start playback: video element is master clock
    const startPh=S.cut.ph;
    // Find the clip at or nearest-after the current playhead
    const activeClip = S.cut.clips.find(c=>c.type==='video'&&startPh>=c.start&&startPh<c.start+c.dur)
      || S.cut.clips.filter(c=>c.type==='video'&&c.start>=startPh).sort((a,b)=>a.start-b.start)[0];
    const mv=$('cut-main-vid')||document.querySelector('#cut-screen video');

    if(activeClip&&mv){
      const item=getMediaById(activeClip.mediaId);
      if(item?.url){
        const clipIdx=S.cut.clips.indexOf(activeClip);
        // Set source if different
        if(!mv.src||!mv.src.includes(item.url.split('blob:')[1]||item.url)){
          mv.src=item.url;
        }
        mv.dataset.clipIdx=String(clipIdx);
        // Seek to correct file position: if ph is before clip.start, start from clip's beginning
        const fileOffset = (activeClip.fileStart||0) + Math.max(0, startPh - activeClip.start);
        mv.currentTime = fileOffset;
        mv.play().catch(e=>console.log('play err',e));
        mv.style.display='block';
        // Keep canvas visible if overlays present (syncCutVid manages this per-frame)
        const placeholder=$('cut-cvs');
        if(placeholder) placeholder.style.display='none';
      }
    }

    // RAF loop: read position FROM video (don't increment S.cut.ph directly)
    function playFrame(){
      if(!S.cut.playing) return;
      // Redraw canvas overlays every frame
      const phNow=S.cut.ph;
      // frame_hold takes priority over video at same time position
      const _allNow=S.cut.clips.filter(c=>(c.type==='video'||c.type==='frame_hold'||c.type==='image')&&phNow>=c.start&&phNow<c.start+c.dur);
      const activeNow=_allNow.find(c=>c.type==='frame_hold')||_allNow.find(c=>c.type==='video')||_allNow[0]||null;
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
        // Force canvas during playback for multi-track or image clips
        const _needsCanvas = hasOverlays || _allNow.length > 1 || (activeNow && activeNow.type==='image');
        if(activeNow.type === 'frame_hold'){
          // ── FRAME HOLD ACTIVE ──
          // Pause the underlying video so ph doesn't get overridden by video time
          // Restore _img from _imgData if needed
          if(activeNow._imgData && (!activeNow._img || !activeNow._img.complete)){
            activeNow._img = new Image();
            activeNow._img.src = activeNow._imgData;
          }
          const mvFH = $('cut-main-vid');
          if(mvFH && !mvFH.paused) mvFH.pause();
          // Advance ph by wall clock (like freeze)
          if(!window._fhLastTime) window._fhLastTime = performance.now();
          const _fhNow = performance.now();
          const _fhDt = Math.min((_fhNow - window._fhLastTime) / 1000, 0.05);
          window._fhLastTime = _fhNow;
          S.cut.ph = Math.min(phNow + _fhDt, activeNow.start + activeNow.dur);
          updateCutPH();
          syncCutVid(); // draws the frame_hold _img via canvas
          // If frame_hold ended, resume video from the right position
          if(S.cut.ph >= activeNow.start + activeNow.dur - 0.02){
            window._fhLastTime = null;
            const _fhEndPh = activeNow.start + activeNow.dur;
            const _nextVidClip =
              S.cut.clips.find(c => c.type==='video' && _fhEndPh>=c.start && _fhEndPh<c.start+c.dur) ||
              S.cut.clips.filter(c => c.type==='video' && c.start>=_fhEndPh).sort((a,b)=>a.start-b.start)[0];
            if(_nextVidClip){
              const _targetPh = Math.max(_fhEndPh, _nextVidClip.start);
              const _resumeFileT = (_nextVidClip.fileStart||0)+Math.max(0,_targetPh-_nextVidClip.start)*(_nextVidClip.speed||1);
              S.cut.ph = _targetPh;
              updateCutPH();
              syncCutVid();
              const _mvFinal = mvFH || document.getElementById('cut-main-vid');
              if(_mvFinal){
                _mvFinal.dataset.clipIdx = String(S.cut.clips.indexOf(_nextVidClip));
                _mvFinal.currentTime = Math.max(0, _resumeFileT);
                _mvFinal.muted = false; // will be corrected by _syncVideoMute below
                _mvFinal.play().catch(()=>{});
                setTimeout(_syncVideoMute, 30);
              }
              if(S.cut.playing) startAudioPlayback();
            } else {
              stopCutPlay();
            }
          }
        } else if(activeFreezeNow){
          // ── FREEZE ACTIVE ──
          const mv2=$('cut-main-vid');
          if(!_freezeActive){
            _freezeActive=true;
            _freezeLastTime=performance.now();
            _freezeStartPh=phNow;
            _freezeSavedVideoTime=(mv2&&mv2.currentTime)||0;
            const _fMode = activeFreezeNow.freezeMode || 'both';
            // Freeze video frame: pause video unless audio-only mode
            if(_fMode !== 'audio'){
              if(mv2&&!mv2.paused) mv2.pause();
            }
            // Freeze audio: stop audio unless video-only mode
            if(_fMode !== 'video'){
              stopAudioPlayback();
            }
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
          // Keep S.cut.ph at freeze END time — do NOT reset back to freeze start
          // _freezeStartPh is only used to restore the video file position
          _freezeStartPh=null;
          _freezeExitTime=performance.now();
          // S.cut.ph already = freeze end time — just update the UI
          updateCutPH();
          const mv2=$('cut-main-vid');
          const c2e=document.getElementById('cut-trans-cvs');
          if(mv2){mv2.style.opacity='1';mv2.style.display='block';}
          if(c2e){c2e.style.display='none';}
          // Seek video to the file position corresponding to ph AFTER freeze (freeze end time)
          // This ensures line-113 ph-from-video calculation gives the correct post-freeze ph
          // NOT _freezeSavedVideoTime (freeze start) — that would make ph jump back to freeze start
          const _phAfterFreeze = S.cut.ph; // = freeze end time
          const _clipAfterFreeze = S.cut.clips.find(c=>c.type==='video'&&_phAfterFreeze>=c.start&&_phAfterFreeze<c.start+c.dur);
          if(mv2 && _clipAfterFreeze){
            const _ftAfterFreeze = (_clipAfterFreeze.fileStart||0) + (_phAfterFreeze - _clipAfterFreeze.start) * (_clipAfterFreeze.speed||1);
            mv2.currentTime = _ftAfterFreeze;
          } else if(mv2 && _freezeSavedVideoTime > 0){
            mv2.currentTime = _freezeSavedVideoTime; // fallback
          }
          _freezeSavedVideoTime = 0;
          startAudioPlayback();
          if(mv2&&S.cut.playing){
            let _a=0;
            const _p=()=>{if(!S.cut.playing||_a>3)return;_a++;mv2.play().catch(e=>{if(e.name==='AbortError'&&_a<=3)setTimeout(_p,150*_a);});};
            setTimeout(_p,80);
          }
        } else if(trActive||hasEffNow||hasOverlays||_needsCanvas){
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
      // Stutter fix: reset decode-wait flag when switching to canvas mode
      window._lastDrawTime = window._lastDrawTime || 0;
      const vidEl=$('cut-main-vid');
      const ciNow=vidEl?parseInt(vidEl.dataset.clipIdx):NaN;
      const clipNow=!isNaN(ciNow)?S.cut.clips[ciNow]:null;
      if(S.cut._scrubbing) { _cutTick=requestAnimationFrame(playFrame); return; }
      // Audio-only mode: no video clip at playhead — advance ph via real clock
      const hasVideoAtPh = S.cut.clips.some(c=>(c.type==='video'||c.type==='frame_hold')&&S.cut.ph>=c.start&&S.cut.ph<c.start+c.dur);
      if(!hasVideoAtPh&&S.cut.playing&&!_freezeActive){
        const _now3=performance.now();
        const _dt3=Math.min((_audioOnlyLastTime?(_now3-_audioOnlyLastTime)/1000:1/60),0.1);
        _audioOnlyLastTime=_now3;
        const maxPh=S.cut.clips.length?Math.max(...S.cut.clips.map(c=>c.start+c.dur)):S.proj.dur;
        S.cut.ph=Math.min(S.cut.ph+_dt3,maxPh);
        updateCutPH();
        if(S.cut.ph>=maxPh){ stopCutPlay(); return; }
      } else { _audioOnlyLastTime=null; }
      // Also skip video-driving when a frame_hold is active at current ph
      const _fhActiveNow = S.cut.clips.some(c => c.type==='frame_hold' && S.cut.ph>=c.start && S.cut.ph<c.start+c.dur);
      if(!_fhActiveNow) window._fhLastTime = null; // reset clock when not in frame_hold
      if(clipNow&&clipNow.type!=='frame_hold'&&!_fhActiveNow&&vidEl&&!vidEl.paused&&!_freezeActive){
        // Video is driving — read current position (not during freeze — ph is driven by clock then)
        // ph = clip timeline start + (currentTime - fileStart)
        // Only update ph from video if not scrubbing and seek lock expired
        if(!S.cut._scrubbing && !(window._seekLockUntil && Date.now()<window._seekLockUntil)){
          S.cut.ph=clipNow.start+(vidEl.currentTime-(clipNow.fileStart||0))/(clipNow.speed||1);
        }
        // Ensure playbackRate matches clip speed
        const targetRate=Math.max(0.1,clipNow.speed||1);
        if(Math.abs(vidEl.playbackRate-targetRate)>0.01) vidEl.playbackRate=targetRate;
        // Apply video fade
        const vidGain = getClipGainAtPh(clipNow, S.cut.ph);
        if(!_freezeActive) vidEl.volume = Math.min(1, vidGain);
        updateCutPH();
        // Check if we've reached end of THIS CLIP (fileStart + dur = end position in file)
        // clipEndInFile = file position when this clip's content ends
        // = fileStart + (timelineDur / speed) because slow clips play fewer source frames
        // clipEndInFile = file time when clip's content ends
        // timelineDur = sourceDur / speed, so sourceDur = timelineDur * speed
        // With playbackRate=speed, video currentTime advances at rate=speed
        // so video reaches fileStart + timelineDur*speed after timelineDur real-seconds
        const _cspd = clipNow.speed || 1;
        const clipEndInFile = (clipNow.fileStart||0) + clipNow.dur * _cspd;
        if(vidEl.currentTime >= clipEndInFile - 0.05){
          const currentEnd = clipNow.start + clipNow.dur;
          // If a frame_hold immediately follows this clip, jump to it instead of skipping
          const fhNext = S.cut.clips.find(c =>
            c.type==='frame_hold' && c.track===clipNow.track &&
            Math.abs(c.start - currentEnd) < 0.12
          );
          if(fhNext){
            vidEl.pause();
            S.cut.ph = fhNext.start;
            window._fhLastTime = null;
            updateCutPH();
            _cutTick = requestAnimationFrame(playFrame);
            return;
          }
          // nextClip: must start strictly AFTER currentEnd
          const nextClip = S.cut.clips
            .filter(c => c.type==='video'
              && c !== clipNow
              && c.start > currentEnd - 0.03
              && c.start < currentEnd + 300)
            .sort((a,b)=>a.start-b.start)[0];
          if(nextClip){
            const item=getMediaById(nextClip.mediaId);
            if(item?.url){
              // Switch to next clip — seek to its fileStart position
              if(vidEl.dataset.mediaId !== nextClip.mediaId){
                vidEl.dataset.mediaId = nextClip.mediaId;
                vidEl.src = item.url;
              }
              vidEl.dataset.clipIdx = String(S.cut.clips.indexOf(nextClip));
              vidEl.currentTime = nextClip.fileStart||0;
              vidEl.play().catch(()=>{});
              S.cut.ph = nextClip.start;
              updateCutPH();
            }
          } else {
            // No next video clip - pause video, let audio-only mode continue if needed
            vidEl.pause();
            S.cut.ph = clipNow.start + clipNow.dur + 0.01;
            updateCutPH();
            const _maxPh = S.cut.clips.length
              ? Math.max(...S.cut.clips.map(c=>c.start+c.dur))
              : S.proj.dur;
            if(S.cut.ph >= _maxPh){ stopCutPlay(); S.cut.ph=_maxPh; updateCutPH(); }
            return;
          }
        }
      } else if(clipNow&&vidEl&&vidEl.paused&&S.cut.playing&&!S.cut._scrubbing&&!_freezeActive){
        const _cspd2 = clipNow.speed || 1;
        const clipEndFile2=(clipNow.fileStart||0)+clipNow.dur*_cspd2;
        const _phInClip = S.cut.ph>=clipNow.start && S.cut.ph<clipNow.start+clipNow.dur-0.1;
        const _vidNotEnd = vidEl.currentTime < clipEndFile2-0.1;
        if(_phInClip && _vidNotEnd){
          vidEl.playbackRate=clipNow.speed||1;
          vidEl.play().catch(()=>{});
        }
      }
      if(!_freezeActive || _freezeMode==='video') syncAudioPlayback(); // sync audio unless fully frozen
      _syncVideoMute();
      _cutTick=requestAnimationFrame(playFrame);
    }
    // Ensure mv exists with correct src/clipIdx before RAF loop starts
    syncCutVid();
    _cutTick=requestAnimationFrame(playFrame);
    startAudioPlayback();
    _syncVideoMute();
  } else stopCutPlay();
}
// Mute/unmute the main video — only mute if user explicitly muted the track
// or if nativeAudioMuted is set. Never mute just because a linked audio clip exists.
function _syncVideoMute(){
  const mv = document.getElementById('cut-main-vid');
  if (!mv) return;
  const ci = parseInt(mv.dataset.clipIdx);
  const clip = !isNaN(ci) ? S.cut.clips[ci] : null;
  const trackMuted = clip ? !!(S.cut.mutedTracks?.[clip.track]) : false;
  const nativeMuted = clip ? !!(clip.nativeAudioMuted) : false;
  const clipMuted = clip ? !!(clip.muted) : false;
  mv.muted = trackMuted || nativeMuted || clipMuted;
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
    const item = getMediaById(c.mediaId);
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
      .map(c => getMediaById(c.mediaId)?.url)
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
      getMediaById(c.mediaId)?.url === url &&
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
      a.muted = !!(activeClip.muted);
    }
  });
  // Start audio for clips not yet in cache
  standaloneCips.forEach(c => {
    const item = getMediaById(c.mediaId);
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
// ── Media Library: lookup by permanent UUID ─────────────────────────────
// Matches on either m.id or m.mediaId — both fields carry the same UUID
// (mediaId kept for backwards compat with clips saved before id field existed).
function getMediaById(mediaId){
  if(!mediaId) return null;
  return (S.cut.media || []).find(m => m.id === mediaId || m.mediaId === mediaId) || null;
}
window.getMediaById = getMediaById;

function getPoolVid(url){
  if(!_vidPool[url]){
    const v=document.createElement('video');
    v.src=url; v.muted=true; v.preload='auto'; // ALWAYS muted — only main vid has audio
    v.style.display='none'; document.body.appendChild(v);
    _vidPool[url]=v;
  }
  return _vidPool[url];
}

// Image pool — pre-loaded <img> elements for image clips (PNG/JPG/etc.)
const _imgPool = {};
function getPoolImg(url){
  if(!_imgPool[url]){
    const img = new Image();
    img.onload = () => { if(typeof syncCutVid === 'function') syncCutVid(); };
    img.src = url;
    _imgPool[url] = img;
  }
  return _imgPool[url];
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

  // Find ALL active video/image clips at playhead, sorted by track index (V1=0 bottom, V(n) top)
  const videoClips = S.cut.clips.filter(c => c.type === 'video' || c.type === 'frame_hold' || c.type === 'image');
  const _allAtPh = videoClips
    .filter(c => ph >= c.start && ph < c.start + Math.max(c.dur, 0.1) && !S.cut.hiddenTracks?.[c.track])
    .sort((a,b) => (a.track||0) - (b.track||0)); // lower track index = drawn first (underneath)
  const active = _allAtPh.find(c => c.type === 'frame_hold') ||
                 _allAtPh[0] || null;

  // Ensure pool elements exist for all clips
  videoClips.forEach(c => {
    const item = getMediaById(c.mediaId);
    if(item?.url){
      if(c.type === 'image') getPoolImg(item.url);
      else getPoolVid(item.url);
    }
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
      // Block ph update during scrubbing or within 300ms of a seek
      if(S.cut.playing) return;
      if(S.cut._scrubbing) return;
      if(window._seekLockUntil && Date.now() < window._seekLockUntil) return;
      const ci = parseInt(mv.dataset.clipIdx);
      if(isNaN(ci)) return;
      const clip = S.cut.clips[ci];
      if(!clip) return;
      // Divide by speed: file time / speed = timeline time
      S.cut.ph = clip.start + (mv.currentTime - (clip.fileStart||0)) / (clip.speed||1);
      updateCutPH();
    });
    frame.appendChild(mv);
    // When video becomes ready, trigger a canvas update (handles initial load)
    mv.addEventListener('canplay', () => {
      if(!S.cut.playing) setTimeout(syncCutVid, 16);
    });
    mv.addEventListener('loadeddata', () => {
      if(!S.cut.playing) setTimeout(syncCutVid, 16);
    });
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

    // No clip at exact playhead — try to show nearest video clip as poster frame
    const _nearestVid = S.cut.clips
      .filter(c => (c.type==='video'||c.type==='image') && getMediaById(c.mediaId)?.url)
      .sort((a,b) => Math.abs(a.start+a.dur/2-ph) - Math.abs(b.start+b.dur/2-ph))[0];

    if(_nearestVid && !hasActiveOverlays){
      // Show nearest clip via mv so user sees something instead of black
      const _ni = getMediaById(_nearestVid.mediaId);
      if(_nearestVid.type==='video' && _ni?.url){
        if(mv.dataset.mediaId !== _nearestVid.mediaId){
          mv.dataset.mediaId = _nearestVid.mediaId;
          mv.src = _ni.url;
        }
        mv.style.opacity='1'; mv.style.display='block';
        canvas.style.display='none';
        if(placeholder) placeholder.style.display='none';
        return;
      }
    }

    mv.style.opacity = '0';
    if(hasActiveOverlays){
      canvas.style.display = 'block';
      if(placeholder) placeholder.style.display = 'none';
      if(canvas.width !== (S.proj.w||1280)){
        canvas.width  = S.proj.w||1280;
        canvas.height = S.proj.h||720;
      }
      const ctx0 = canvas.getContext('2d');
      ctx0.clearRect(0,0,canvas.width,canvas.height);
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
  // Frame hold clip: draw the captured still image
  if(active.type === 'frame_hold'){
    if(active._imgData && (!active._img || !active._img.complete)){
      active._img = new Image();
      active._img.src = active._imgData;
    }
    // Always use canvas for frame_hold so overlays/effects can composite on top
    canvas.style.display = 'block';
    canvas.style.zIndex  = '2';
    mv.style.opacity = '0';
    if(placeholder) placeholder.style.display = 'none';
    const projWfh = S.proj.w||1280, projHfh = S.proj.h||720;
    if(canvas.width!==projWfh){ canvas.width=projWfh; canvas.height=projHfh; }
    const ctxFH = canvas.getContext('2d');
    ctxFH.clearRect(0,0,canvas.width,canvas.height);
    // 1. Draw frozen frame
    if(active._img && active._img.complete){
      ctxFH.drawImage(active._img, 0, 0, canvas.width, canvas.height);
    } else {
      // _imgData not yet regenerated — try to grab last frame from the video element
      // (the video is paused at the correct position right before the frame_hold starts)
      const _mvFallback = document.getElementById('cut-main-vid');
      let _drewFallback = false;
      if(_mvFallback && _mvFallback.readyState >= 2 && _mvFallback.videoWidth){
        try{
          ctxFH.drawImage(_mvFallback, 0, 0, canvas.width, canvas.height);
          _drewFallback = true;
          // Cache the result so we don't redraw every frame
          if(!active._imgData){
            active._imgData = canvas.toDataURL('image/jpeg', 0.85);
            active._img = new Image(); active._img.src = active._imgData;
          }
        }catch(e){}
      }
      if(!_drewFallback){
        ctxFH.fillStyle='#111'; ctxFH.fillRect(0,0,canvas.width,canvas.height);
        // Trigger async regeneration if not already running
        if(!window._fhRegenPending){ window._fhRegenPending=true; setTimeout(()=>{ window._fhRegenPending=false; if(window._regenerateFrameHolds) _regenerateFrameHolds(); }, 200); }
      }
    }
    // 2. Apply effects (color grade, filters) on top of frozen frame
    const fhFilterStr = buildFilterStr(activeCI);
    canvas.style.filter = fhFilterStr !== 'none' ? fhFilterStr : '';
    // 3. Render overlays on top of frozen frame (text, shapes, freeze overlays)
    if(window.renderOverlaysOnCanvas)
      window.renderOverlaysOnCanvas(ctxFH, canvas.width, canvas.height, ph, _playedFreezes);
    return;
  }

  // ── UNIFIED COMPOSITOR ──────────────────────────────────────────────────────
  // ALL items (video clips, image clips, overlays) sorted by track ascending.
  // Track number = ONLY priority. Type has zero influence on draw order.
  // Painter's Algorithm: V1 first (background) → Vn last (foreground).

  // 1. Build the master render list: every clip + every overlay active at ph
  const _masterList = [];

  // Add all clips active at playhead (video, image, frame_hold)
  _allAtPh.forEach(c => {
    _masterList.push({ kind: 'clip', track: c.track || 0, clip: c });
  });

  // Add all overlays active at playhead
  (window._overlays || []).forEach(o => {
    if(ph >= o.startTime && ph < o.endTime &&
       !(o.type==='freeze' && _playedFreezes && _playedFreezes.has(o.id))){
      _masterList.push({ kind: 'overlay', track: o.track || 0, overlay: o });
    }
  });

  // Nothing to render
  if(_masterList.length === 0){
    mv.style.opacity = '0';
    canvas.style.display = 'none';
    if(placeholder) placeholder.style.display = 'block';
    return;
  }

  // Sort: track ascending. On same track: clips before overlays, then insertion order.
  _masterList.sort((a, b) => {
    const td = a.track - b.track;
    if(td !== 0) return td;
    if(a.kind !== b.kind) return a.kind === 'clip' ? -1 : 1;
    if(a.kind === 'overlay' && b.kind === 'overlay'){
      return (window._overlays||[]).indexOf(a.overlay) - (window._overlays||[]).indexOf(b.overlay);
    }
    return 0;
  });

  // Debug trace — visible in browser console (F12 → Console)
  if(_masterList.length > 1 && !window._dbgLastLog || window._dbgPh !== ph){
    window._dbgPh = ph;
    const _dbgStr = _masterList.map(e =>
      e.kind==='clip'
        ? `V${(e.track||0)+1}:[${e.clip.type}:${e.clip.name||'clip'}]`
        : `V${(e.track||0)+1}:[overlay:${e.overlay.type}]`
    ).join(' → ');
    console.log('[Compositor] draw order:', _dbgStr);
  }

  // 2. Decide render mode:
  //    - Single plain video clip with no overlays → use <video> element directly (best perf)
  //    - Everything else → canvas compositor
  const _onlyOneClip   = _masterList.length === 1 && _masterList[0].kind === 'clip';
  const _clipIsVideo   = _onlyOneClip && _masterList[0].clip.type === 'video';
  const _singleVideoClip = (() => {
    const _cv = _masterList.filter(e => e.kind==='clip' && e.clip.type==='video');
    return _cv.length === 1 ? _cv[0].clip : null;
  })();
  const _hasTransition = _singleVideoClip && (()=>{
    const _ci = S.cut.clips.indexOf(_singleVideoClip);
    const _tr = getClipTransition(_ci);
    if(!_tr) return false;
    const _ts = _singleVideoClip.start + (_tr.startOffset||0);
    const _te = _ts + (_tr.effectDur||_tr.dur||1);
    return ph >= _ts && ph < _te;
  })();
  const _hasEffects = _singleVideoClip && (()=>{
    const _ci = S.cut.clips.indexOf(_singleVideoClip);
    return (S.cut.effects[_ci]||[]).filter(e => {
      if(CUT_EFFECTS[e.i]?.type === 'transition') return false;
      if(e.visible===false) return false;
      const es = _singleVideoClip.start + (e.startOffset||0);
      const ee = es + (e.effectDur||_singleVideoClip.dur);
      return ph >= es && ph < ee;
    }).length > 0;
  })();

  // Use plain video path for single video clip (with or without overlays)
  // mv shows the video; canvas draws overlays on top if any exist
  // Recheck active overlays directly from _overlays (not _masterList which may be stale)
  // This prevents race conditions where masterList was built before latest ph update
  const _hasActiveOverlaysNow = (window._overlays||[]).some(o =>
    ph >= o.startTime && ph < o.endTime &&
    !(o.type==='freeze' && _playedFreezes && _playedFreezes.has(o.id))
  );
  // Count just the clip entries (not overlays)
  const _clipEntries = _masterList.filter(e => e.kind === 'clip');
  const _onlyOneVideoClip = _clipEntries.length === 1 && _clipEntries[0].clip.type === 'video';
  // _usePlainVideo: single video clip, no transition/effects → mv shows video, canvas overlays on top
  const _usePlainVideo = _onlyOneVideoClip && !_hasTransition && !_hasEffects &&
                         (performance.now() - (_freezeExitTime||0)) > 500;

  if(_usePlainVideo){
    // ── PLAIN VIDEO PATH — single video clip, overlays drawn on transparent canvas on top ──
    const _c  = _singleVideoClip;
    const _ci = S.cut.clips.indexOf(_c);
    const _it = getMediaById(_c.mediaId);
    if(!_it?.url) return;

    if(placeholder) placeholder.style.display = 'none';
    if(mv.dataset.mediaId !== _c.mediaId || !mv.src || mv.src === window.location.href){
      mv.dataset.mediaId = _c.mediaId;
      mv.src = _it.url;
    }
    mv.dataset.clipIdx = String(_ci);
    if(!S.cut.playing){
      const _t = (_c.fileStart||0) + Math.max(0, (ph - _c.start) * (_c.speed||1));
      if(Math.abs(mv.currentTime - _t) > 0.02) mv.currentTime = _t;
      if(!mv.paused) mv.pause();
    }
    mv.style.opacity = String(_c.opacity !== undefined ? _c.opacity : 1);
    mv.style.display = 'block';
    const _fs = buildFilterStr(_ci);
    mv.style.filter = _fs !== 'none' ? _fs : '';
    const _tr2 = _c.transform;
    if(_tr2 && (_tr2.x||_tr2.y||_tr2.scaleX!==100||_tr2.scaleY!==100||_tr2.rotation)){
      const sx=_tr2.scaleX/100,sy=_tr2.scaleY/100,rot=_tr2.rotation||0,tx=_tr2.x||0,ty=_tr2.y||0;
      mv.style.transform=`translate(${tx}%,${ty}%) rotate(${rot}deg) scale(${sx},${sy})`;
      mv.style.transformOrigin='center center';
    } else { mv.style.transform=''; }
    S.cut._vid = mv;

    // Draw overlays on top of video using canvas (canvas is transparent except for overlays)
    if(_hasActiveOverlaysNow){
      const projW2 = S.proj.w||1280, projH2 = S.proj.h||720;
      if(canvas.width !== projW2 || canvas.height !== projH2){ canvas.width=projW2; canvas.height=projH2; }
      const ctx2 = canvas.getContext('2d');
      ctx2.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.display = 'block';
      canvas.style.zIndex  = '2';
      if(placeholder) placeholder.style.display = 'none';
      _masterList.filter(e=>e.kind==='overlay').forEach(entry => {
        if(window.renderSingleOverlayOnCanvas)
          window.renderSingleOverlayOnCanvas(ctx2, canvas.width, canvas.height, ph, entry.overlay, _playedFreezes);
      });
    } else {
      canvas.style.display = 'none';
      if(placeholder) placeholder.style.display = 'none';
    }

  } else {
    // ── CANVAS COMPOSITOR PATH: image clips, multi-video, transitions/effects ──
    mv.style.opacity = '0';
    mv.style.filter  = '';
    mv.style.transform = '';
    canvas.style.display = 'block';
    canvas.style.zIndex  = '2';
    if(placeholder) placeholder.style.display = 'none';

    const projW = S.proj.w||1280, projH = S.proj.h||720;
    if(canvas.width !== projW || canvas.height !== projH){
      canvas.width = projW; canvas.height = projH;
    }
    const ctx = canvas.getContext('2d');

    // Set up mv for audio and seeking (even though we draw video via canvas)
    const _primaryClip = _masterList.find(e => e.kind==='clip' && e.clip.type==='video');
    if(_primaryClip){
      const _pc = _primaryClip.clip;
      const _pi = getMediaById(_pc.mediaId);
      if(_pi?.url){
        getPoolVid(_pi.url);
        if(mv.dataset.mediaId !== _pc.mediaId || !mv.src || mv.src.includes('undefined')){
          mv.dataset.mediaId = _pc.mediaId;
          mv.src = _pi.url;
        }
        mv.dataset.clipIdx = String(S.cut.clips.indexOf(_pc));
        const _spd = _pc.speed || 1;
        const _t = (_pc.fileStart||0) + Math.max(0, (ph - _pc.start) * _spd);
        if(!S.cut.playing && Math.abs(mv.currentTime - _t) > 0.05) mv.currentTime = _t;
        if(!_freezeActive && S.cut.playing && mv.paused) mv.play().catch(()=>{});
      }
    }



    // Center-crop draw helper — works for both <video> and <img>
    function _drawFrame(src, ctx, cW, cH){
      if(!src) return false;
      if(src.tagName==='VIDEO' && src.readyState < 2) return false;
      if(src.tagName==='IMG'   && !src.complete)      return false;
      const vW = src.videoWidth||src.naturalWidth||cW;
      const vH = src.videoHeight||src.naturalHeight||cH;
      if(!vW||!vH) return false;
      const cAR=cW/cH, vAR=vW/vH;
      let sx=0,sy=0,sw=vW,sh=vH;
      if(vAR>cAR){ sw=Math.round(vH*cAR); sx=Math.round((vW-sw)/2); }
      else if(vAR<cAR){ sh=Math.round(vW/cAR); sy=Math.round((vH-sh)/2); }
      try{ ctx.drawImage(src,sx,sy,sw,sh,0,0,cW,cH); return true; }catch(e){ return false; }
    }

    // Clear canvas once — track if any visual content was actually drawn
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let _anythingDrawn = false;

    // Draw every item in track-sorted order
    _masterList.forEach(entry => {
      if(entry.kind === 'clip'){
        const c  = entry.clip;
        const ci = S.cut.clips.indexOf(c);
        const it = getMediaById(c.mediaId);
        if(!it?.url) return;

        if(c.type === 'frame_hold'){
          // Frame hold — draw captured still
          if(c._imgData && (!c._img || !c._img.complete)){
            c._img = new Image(); c._img.src = c._imgData;
          }
          if(c._img && c._img.complete){
            ctx.save();
            const _fhF = buildFilterStr(ci);
            if(_fhF !== 'none') ctx.filter = _fhF;
            ctx.globalAlpha = (c.opacity !== undefined) ? Math.max(0, Math.min(1, c.opacity)) : 1;
            ctx.drawImage(c._img, 0, 0, canvas.width, canvas.height);
            _anythingDrawn = true;
            ctx.globalAlpha = 1;
            ctx.filter = 'none';
            ctx.restore();
          }
          return;
        }

        if(c.type === 'image'){
          // Image clip — draw via pool <img> with full transform+opacity support
          const imgSrc = getPoolImg(it.url);
          if(!imgSrc.complete) return;
          const flt = buildFilterStr(ci);
          const tf = c.transform || {x:0,y:0,scaleX:100,scaleY:100,rotation:0,anchorX:50,anchorY:50,antiFlicker:false,uniformScale:true};
          const _uniScale = tf.uniformScale !== false;
          const sx = (_uniScale ? (tf.scaleX||100) : (tf.scaleX||100))/100;
          const sy = (_uniScale ? (tf.scaleX||100) : (tf.scaleY||100))/100;
          const tx = ((tf.x||0)/100) * canvas.width;
          const ty = ((tf.y||0)/100) * canvas.height;
          const rot = (tf.rotation||0) * Math.PI / 180;
          const axOff = (((tf.anchorX||50)-50)/100) * canvas.width;
          const ayOff = (((tf.anchorY||50)-50)/100) * canvas.height;
          const opacity = (c.opacity !== undefined) ? Math.max(0,Math.min(1,c.opacity)) : 1;
          const blendMode = c.blendMode || 'source-over';
          // Fit image to canvas maintaining AR, then apply scale
          const iW = imgSrc.naturalWidth  || canvas.width;
          const iH = imgSrc.naturalHeight || canvas.height;
          const iAR = iW/iH, cAR = canvas.width/canvas.height;
          let dw, dh;
          if(iAR > cAR){ dw = canvas.width * sx; dh = (canvas.width/iAR) * sy; }
          else          { dh = canvas.height * sy; dw = (canvas.height*iAR) * sx; }
          ctx.save();
          const _colorFlt = window.buildColorFilterStr ? window.buildColorFilterStr(c) : 'none';
          const _fullFlt = [flt, _colorFlt].filter(f=>f&&f!=='none').join(' ') || 'none';
          if(tf.antiFlicker){ ctx.filter = (_fullFlt !== 'none' ? _fullFlt + ' ' : '') + 'blur(0.3px)'; }
          else if(_fullFlt !== 'none') ctx.filter = _fullFlt;
          ctx.globalAlpha = opacity;
          ctx.globalCompositeOperation = blendMode;
          ctx.translate(canvas.width/2 + tx - axOff, canvas.height/2 + ty - ayOff);
          if(rot) ctx.rotate(rot);
          try{ ctx.drawImage(imgSrc, -dw/2, -dh/2, dw, dh); _anythingDrawn = true; }catch(e){}
          ctx.filter = 'none'; ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.restore();
          return;
        }

        if(c.type === 'video'){
          // Video clip — use pool vid for non-primary, mv for primary
          const isFirst = _primaryClip && c === _primaryClip.clip;
          let vSrc;
          if(isFirst){
            // Primary: prefer mv; fall back to pool vid if mv not ready yet
            if(mv.readyState >= 2){
              vSrc = mv;
            } else {
              const _pvFb = getPoolVid(it.url);
              if(_pvFb && _pvFb.readyState >= 2){
                vSrc = _pvFb;
              } else {
                // Neither ready — retry on canplay
                const _onRdy = () => { if(typeof syncCutVid==='function') syncCutVid(); };
                mv.addEventListener('canplay', _onRdy, {once:true});
                if(_pvFb) _pvFb.addEventListener('canplay', _onRdy, {once:true});
                return;
              }
            }
          } else {
            vSrc = getPoolVid(it.url);
            if(vSrc){
              const spd = c.speed||1;
              const ft  = (c.fileStart||0)+Math.max(0,(ph-c.start)*spd);
              if(!S.cut.playing && Math.abs(vSrc.currentTime-ft)>0.05) vSrc.currentTime=ft;
              if(S.cut.playing && vSrc.paused) vSrc.play().catch(()=>{});
            }
            if(!vSrc || vSrc.readyState < 2) return;
          }

          // Check for transition on this clip
          const tr3 = getClipTransition(ci);
          const trW3 = (()=>{
            if(!tr3) return null;
            const ts3=c.start+(tr3.startOffset||0);
            const te3=ts3+(tr3.effectDur||tr3.dur||1);
            return (ph>=ts3&&ph<te3)?tr3:null;
          })();

          const flt3 = buildFilterStr(ci);
          ctx.save();
          const _clrFlt3 = window.buildColorFilterStr ? window.buildColorFilterStr(c) : 'none';
          const _fullFlt3 = [flt3, _clrFlt3].filter(f=>f&&f!=='none').join(' ') || 'none';
          if(_fullFlt3 !== 'none') ctx.filter = _fullFlt3;
          ctx.globalCompositeOperation = c.blendMode || 'source-over';
          ctx.globalAlpha = (c.opacity !== undefined) ? Math.max(0, Math.min(1, c.opacity)) : 1;
          // Anti-flicker: very slight blur suppresses interlace artifacts
          if(c.transform?.antiFlicker && ctx.filter === 'none') ctx.filter = 'blur(0.3px)';

          if(!trW3){
            if(_drawFrame(vSrc, ctx, canvas.width, canvas.height)) _anythingDrawn = true;
          } else {
            // Apply transition effect inline
            const elapsed3 = ph - c.start - (tr3.startOffset||0);
            const rawP3 = Math.max(0,Math.min(1,elapsed3/(tr3.effectDur||tr3.dur||1)));
            const cap3  = (tr3.completion!==undefined?tr3.completion:100)/100;
            const prog3 = _applyEasing(rawP3,tr3.easing)*cap3;
            ctx.save();
            if(tr3.mode==='fadein'){ ctx.globalAlpha=prog3; _drawFrame(vSrc,ctx,canvas.width,canvas.height); ctx.globalAlpha=1; }
            else if(tr3.mode==='fadeout'){ _drawFrame(vSrc,ctx,canvas.width,canvas.height); ctx.save(); ctx.globalAlpha=prog3; ctx.fillStyle='#000'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.restore(); }
            else if(tr3.mode==='dissolve'){ ctx.globalAlpha=1-prog3; _drawFrame(vSrc,ctx,canvas.width,canvas.height); ctx.globalAlpha=1; }
            else { _drawFrame(vSrc,ctx,canvas.width,canvas.height); }
            ctx.restore();
          }
          ctx.filter='none'; ctx.restore();
          return;
        }
      } else {
        // Overlay entry
        if(window.renderSingleOverlayOnCanvas)
          window.renderSingleOverlayOnCanvas(ctx, canvas.width, canvas.height, ph, entry.overlay, _playedFreezes);
      }
    });
    // If nothing was drawn this frame (video not ready), preserve last good frame
    if(!_anythingDrawn && canvas._lastGoodFrame){
      try{ ctx.putImageData(canvas._lastGoodFrame, 0, 0); }catch(e){}
    } else if(_anythingDrawn){
      try{ canvas._lastGoodFrame = ctx.getImageData(0, 0, Math.min(canvas.width,2560), Math.min(canvas.height,1440)); }catch(e){}
    }
    S.cut._vid = mv;
  }

  S.cut._vid = mv;
  // Refresh bounding box handles
  if(typeof renderBoundingBox==="function"&&S.cut.sel!==null&&S.cut.sel!==undefined){
    requestAnimationFrame(()=>renderBoundingBox(S.cut.sel));
  }
}


// Make playhead draggable
// ── SCRUB BAR ─────────────────────────────────────────────────
function updateScrubBar(){
  const track = document.getElementById('cut-scrub-track');
  const fill  = document.getElementById('cut-scrub-fill');
  const knob  = document.getElementById('cut-scrub-knob');
  const tc    = document.getElementById('cut-scrub-tc');
  const dur   = document.getElementById('cut-scrub-dur');
  if(!track || !fill || !knob) return;
  // Use actual content length (max clip end) as the scrub bar total duration
  const _contentEnd = S.cut?.clips?.length
    ? Math.max(...S.cut.clips.map(c => c.start + (c.dur||0)))
    : 0;
  const _ovEnd = (window._overlays||[]).length
    ? Math.max(...(window._overlays||[]).map(o => o.endTime||0))
    : 0;
  const totalDur = Math.max(_contentEnd, _ovEnd, 10); // at least 10s
  const ph = S.cut.ph || 0;
  const pct = Math.max(0, Math.min(1, ph / totalDur)) * 100;
  fill.style.width  = pct + '%';
  knob.style.left   = pct + '%';
  if(tc) tc.textContent = fmtTC(ph);
  if(dur) dur.textContent = fmtTC(totalDur);
}
window.updateScrubBar = updateScrubBar;

function setupScrubBar(){
  const track = document.getElementById('cut-scrub-track');
  if(!track || track._scrubAttached) return;
  track._scrubAttached = true;

  let _scrubbing = false;

  const seek = (e) => {
    const r = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const _cEnd = S.cut?.clips?.length ? Math.max(...S.cut.clips.map(c=>c.start+(c.dur||0))) : 0;
    const _oEnd = (window._overlays||[]).length ? Math.max(...(window._overlays||[]).map(o=>o.endTime||0)) : 0;
    const totalDur = Math.max(_cEnd, _oEnd, 10);
    S.cut.ph = pct * totalDur;
    updateCutPH();
    syncCutVid();
  };

  track.addEventListener('mousedown', e => {
    _scrubbing = true;
    seek(e);
    const knob = document.getElementById('cut-scrub-knob');
    if(knob) knob.style.transform = 'translate(-50%,-50%) scale(1.3)';
  });
  window.addEventListener('mousemove', e => { if(_scrubbing) seek(e); });
  window.addEventListener('mouseup', () => {
    if(_scrubbing){
      _scrubbing = false;
      const knob = document.getElementById('cut-scrub-knob');
      if(knob) knob.style.transform = 'translate(-50%,-50%)';
    }
  });
}
window.setupScrubBar = setupScrubBar;

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
    const _rawTime = x/PPS;
    const _maxPh = Math.max(S.proj.dur, S.cut.clips.length?Math.max(...S.cut.clips.map(c=>c.start+c.dur)):0);
    // ── Snap to clip edges during scrub ────────────────────────────────
    // Uses the existing snap engine (getSnapPoint) — excludeIdx=-1 means
    // snap to ALL clip/overlay edges, including the playhead's own position.
    // This is additive: it doesn't change how clip snapping works.
    let _snappedTime = _rawTime;
    if(window._snapEnabled !== false && window.getSnapPoint){
      const _snap = window.getSnapPoint(x, -1, 'start');
      if(_snap !== null){
        _snappedTime = _snap;
        window.showSnapLine && window.showSnapLine(_snap);
      } else {
        window.hideSnapLine && window.hideSnapLine();
      }
    }
    S.cut.ph=Math.max(0,Math.min(_maxPh, _snappedTime));
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
        const item=getMediaById(newClip.mediaId);
        if(item?.url){
          const newCI=S.cut.clips.indexOf(newClip);
          if(mv.dataset.mediaId!==newClip.mediaId){
            mv.dataset.mediaId=newClip.mediaId;
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
    window._seekLockUntil = Date.now() + 800;
    S.cut._scrubbing=false;
    window.hideSnapLine && window.hideSnapLine(); // clear snap indicator on release
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
        PPS=Math.max(8,Math.min(600,PPS*(e.deltaY<0?1.18:0.85))); window.PPS=PPS;
        window._snapCache=null;
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
    function _getRulerTime(ev){ const _sr=scroll.getBoundingClientRect(); return (ev.clientX-_sr.left+scroll.scrollLeft)/PPS; }
    ruler.addEventListener('mousedown',function(e){
      const _maxPh = Math.max(S.proj.dur, S.cut.clips.length?Math.max(...S.cut.clips.map(c=>c.start+c.dur)):0);
      S.cut.ph = Math.max(0, Math.min(_maxPh, _getRulerTime(e)));
      window._seekLockUntil = Date.now() + 800;
      // Direct seek with speed compensation — same formula as drag handler
      const _mv_click = $('cut-main-vid');
      if(_mv_click){
        const nc = S.cut.clips.find(c => (c.type==='video'||c.type==='image') && S.cut.ph >= c.start && S.cut.ph < c.start + Math.max(c.dur, 0.1));
        if(nc){
          const _it = getMediaById(nc.mediaId);
          if(_it?.url){
            if(_mv_click.dataset.mediaId !== nc.mediaId){ _mv_click.dataset.mediaId = nc.mediaId; _mv_click.src = _it.url; }
            _mv_click.dataset.clipIdx = String(S.cut.clips.indexOf(nc));
            _mv_click.currentTime = (nc.fileStart||0) + Math.max(0, (S.cut.ph - nc.start) * (nc.speed||1));
          }
        }
      }
      updateCutPH(); syncCutVid();
      dragging=true;
      S.cut._scrubbing=true;
      const mv2=$('cut-main-vid');
      if(mv2&&!mv2.paused) mv2.pause();
      document.addEventListener('mousemove',function moveRuler(e){
        if(!dragging)return;
        const _rawRulerTime = _getRulerTime(e);
        const _maxRulerPh = Math.max(S.proj.dur, S.cut.clips.length?Math.max(...S.cut.clips.map(c=>c.start+c.dur)):0);
        // ── Snap to clip edges during ruler scrub ──────────────────────────
        let _snappedRulerTime = _rawRulerTime;
        if(window._snapEnabled !== false && window.getSnapPoint){
          const _rulerX = _rawRulerTime * (window.PPS||60);
          const _rulerSnap = window.getSnapPoint(_rulerX, -1, 'start');
          if(_rulerSnap !== null){
            _snappedRulerTime = _rulerSnap;
            window.showSnapLine && window.showSnapLine(_rulerSnap);
          } else {
            window.hideSnapLine && window.hideSnapLine();
          }
        }
        S.cut.ph=Math.max(0,Math.min(_maxRulerPh, _snappedRulerTime));
        const phEl=$('cut-ph');if(phEl)phEl.style.left=Math.round(S.cut.ph*PPS)+'px';
        const tc2=fmtFull(S.cut.ph,S.proj.fps);
        const a2=$('cut-pv-tc');if(a2)a2.textContent=tc2;
        const b2=$('cut-tl-tc');if(b2)b2.textContent=tc2;
        const mv3=$('cut-main-vid');
        if(mv3){
          const nc=S.cut.clips.find(c=>c.type==='video'&&S.cut.ph>=c.start&&S.cut.ph<c.start+c.dur);
          if(nc){const item3=getMediaById(nc.mediaId);if(item3?.url){if(mv3.dataset.mediaId!==nc.mediaId){mv3.dataset.mediaId=nc.mediaId;mv3.src=item3.url;}mv3.dataset.clipIdx=String(S.cut.clips.indexOf(nc));mv3.currentTime=(nc.fileStart||0)+Math.max(0,(S.cut.ph-nc.start)*(nc.speed||1));mv3.style.display='block';}}
        }
      });
      document.addEventListener('mouseup',function(){dragging=false;S.cut._scrubbing=false;window.hideSnapLine&&window.hideSnapLine();},{once:true});
    });
  }
}

// ── SCROLL SYNC: ruler + sidebar labels sync with tl-scroll ──
function setupTimelineScrollSync(){
  const scroll = $('tl-scroll');
  if(!scroll || scroll._syncAttached) return;
  scroll._syncAttached = true;
  scroll.addEventListener('scroll', () => {
    // Ruler: shift the inner content left by scrollLeft so marks stay aligned
    const rulerInner = document.getElementById('tl-ruler-inner') || $('tl-ruler');
    if(rulerInner) rulerInner.style.transform = `translateX(-${scroll.scrollLeft}px)`;
    // Also update the ruler container's scrollLeft if it's a scroll container
    const ruler = $('tl-ruler');
    if(ruler && ruler !== rulerInner) ruler.scrollLeft = scroll.scrollLeft;
    // Sync sidebar labels vertical position
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
  // S.ae.media mirrors S.cut.media; clips use mediaId
  const item = S.ae.media.find(m=>m.id===c.mediaId) || S.ae.media[c.mediaIdx];
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
    // = / - keys: zoom viewport (if mouse over preview) or timeline (otherwise)
    if(e.code==='Equal'||e.code==='NumpadAdd'){e.preventDefault();
      if(window._mouseOverViewport){
        window._vpZoom = Math.min(4, (window._vpZoom||1) * 1.2);
        _applyVpZoom();
      } else {
        const sc=$('tl-scroll');if(sc){
          const phPx=S.cut.ph*PPS-sc.scrollLeft;
          PPS=Math.min(600,PPS*1.25); window.PPS=PPS;
          window._snapCache=null;
          sc.scrollLeft=Math.max(0,S.cut.ph*PPS-phPx);
          renderCutTimeline();
        }
      }
    }
    if(e.code==='Minus'||e.code==='NumpadSubtract'){e.preventDefault();
      if(window._mouseOverViewport){
        window._vpZoom = Math.max(0.25, (window._vpZoom||1) / 1.2);
        _applyVpZoom();
      } else {
        const sc=$('tl-scroll');if(sc){
          const phPx=S.cut.ph*PPS-sc.scrollLeft;
          PPS=Math.max(8,PPS*0.8); window.PPS=PPS;
          window._snapCache=null;
          sc.scrollLeft=Math.max(0,S.cut.ph*PPS-phPx);
          renderCutTimeline();
        }
      }
    }
    // Ctrl+0: reset viewport zoom (hover=preview) or timeline zoom (hover=elsewhere)
    if((e.ctrlKey||e.metaKey)&&(e.code==='Digit0'||e.code==='Numpad0')){e.preventDefault();
      if(window._mouseOverViewport){
        window._vpZoom=1; _applyVpZoom();
      } else {
        const _sc=$('tl-scroll'),_ph=S.cut.ph||0,_vw=_sc?_sc.clientWidth:800;
        PPS=60; window.PPS=PPS; window._snapCache=null;
        renderCutTimeline();
        if(_sc) _sc.scrollLeft=Math.max(0,_ph*PPS-_vw*0.4);
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
        const linkedA=S.cut.clips.find(a=>a.linkedToVideo&&a.mediaId===c.mediaId&&Math.abs(a.start-(c.start-trimAmt))<0.2);
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
        const linkedA=S.cut.clips.find(a=>a.linkedToVideo&&a.mediaId===c.mediaId&&Math.abs(a.start-c.start)<0.2);
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
      const linkedIdx=S.cut.clips.findIndex(a=>a.linkedToVideo&&a.mediaId===c.mediaId&&Math.abs(a.start-c.start)<0.5);
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
    {sep:true},
    {sep:true},
    {icon:'🖼', label:'Insert Frame Hold at Playhead', fn:()=>insertFrameHold(ci)},
    {icon:'🖼', label:'Insert Frame Hold at Clip End', fn:()=>insertFrameHoldAtEnd(ci)},
  ]);
}

function mergeWithNext(ci){
  const c=S.cut.clips[ci];
  const next=S.cut.clips.find((c2,i2)=>i2!==ci&&c2.track===c.track&&Math.abs(c2.start-(c.start+c.dur))<0.5&&c2.mediaId===c.mediaId);
  if(!next){notify('No adjacent clip to merge on same track','#E31837');return;}
  c.dur=next.start+next.dur-c.start;
  const ni=S.cut.clips.indexOf(next);
  // Also merge linked audio
  const audioLinked=S.cut.clips.find(a=>a.linkedToVideo&&a.mediaId===c.mediaId&&Math.abs(a.start-next.start)<0.2);
  const audioBase=S.cut.clips.find(a=>a.linkedToVideo&&a.mediaId===c.mediaId&&Math.abs(a.start-c.start)<0.2&&a!==audioLinked);
  if(audioBase&&audioLinked){audioBase.dur=c.dur;S.cut.clips.splice(S.cut.clips.indexOf(audioLinked),1);}
  S.cut.clips.splice(ni,1);
  renderCutTimeline();notify('Clips merged ✓','#3fb950');scheduleSave();
}

function mergeWithPrev(ci){
  const c=S.cut.clips[ci];
  const prev=S.cut.clips.find((c2,i2)=>i2!==ci&&c2.track===c.track&&Math.abs((c2.start+c2.dur)-c.start)<0.5&&c2.mediaId===c.mediaId);
  if(!prev){notify('No adjacent clip before this one','#E31837');return;}
  // Extend prev to cover both
  prev.dur=c.start+c.dur-prev.start;
  // Also merge linked audio
  const audioC=S.cut.clips.find(a=>a.linkedToVideo&&a.mediaId===c.mediaId&&Math.abs(a.start-c.start)<0.2);
  const audioPrev=S.cut.clips.find(a=>a.linkedToVideo&&a.mediaId===c.mediaId&&Math.abs(a.start-prev.start)<0.2&&a!==audioC);
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

// ── BOUNDING BOX / TRANSFORM HANDLES ──────────────────────────
// Shows interactive handles on the selected clip in the preview

function renderBoundingBox(ci){
  // Cleanup previous bbox listeners before removing element
  const old = document.getElementById('cut-bbox');
  if(old){ if(old._cleanup) old._cleanup(); old._cleanup = null; old.remove(); }

  const frame = document.getElementById('cut-viewport-frame');
  if(!frame) return;

  const clip = (ci !== null && ci !== undefined) ? S.cut.clips[ci] : null;
  if(!clip || (clip.type !== 'video' && clip.type !== 'image')) return;

  const ph = S.cut.ph;
  if(ph < clip.start || ph >= clip.start + clip.dur) return;

  if(!clip.transform) clip.transform = {x:0, y:0, scaleX:100, scaleY:100, rotation:0};
  const tf = clip.transform;
  const fW = frame.offsetWidth;
  const fH = frame.offsetHeight;

  // Compute actual rendered image base dimensions (contain-fit inside frame)
  let baseW = fW, baseH = fH;
  if(clip.type === 'image'){
    const item = getMediaById(clip.mediaId);
    const imgEl = item && item.url ? getPoolImg(item.url) : null;
    if(imgEl && imgEl.naturalWidth && imgEl.naturalHeight){
      const iAR = imgEl.naturalWidth / imgEl.naturalHeight;
      const cAR = fW / fH;
      if(iAR > cAR){ baseW = fW; baseH = fW / iAR; }
      else          { baseH = fH; baseW = fH * iAR; }
    }
  }

  const sx  = (tf.scaleX||100) / 100;
  const sy  = (tf.scaleY||100) / 100;
  const rot = tf.rotation || 0;
  const tx  = (tf.x||0) / 100 * fW;
  const ty  = (tf.y||0) / 100 * fH;
  const bW  = baseW * sx;
  const bH  = baseH * sy;
  const cx  = fW/2 + tx;
  const cy  = fH/2 + ty;

  const box = document.createElement('div');
  box.id = 'cut-bbox';
  box.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:10;overflow:visible;';

  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;';

  // Dashed border
  const borderRect = document.createElementNS('http://www.w3.org/2000/svg','rect');
  borderRect.setAttribute('x', cx - bW/2);
  borderRect.setAttribute('y', cy - bH/2);
  borderRect.setAttribute('width',  bW);
  borderRect.setAttribute('height', bH);
  borderRect.setAttribute('fill',   'none');
  borderRect.setAttribute('stroke', 'rgba(232,89,12,0.9)');
  borderRect.setAttribute('stroke-width', '1.5');
  borderRect.setAttribute('stroke-dasharray','6,3');
  borderRect.setAttribute('transform', 'rotate('+rot+','+cx+','+cy+')');
  svg.appendChild(borderRect);

  // Corner handles — [x, y, cursor, name, scaleSignX]
  // scaleSignX: +1 means drag-right grows width, -1 means drag-right shrinks width
  const corners = [
    [cx-bW/2, cy-bH/2, 'nw-resize', 'nw', -1],
    [cx+bW/2, cy-bH/2, 'ne-resize', 'ne', +1],
    [cx+bW/2, cy+bH/2, 'se-resize', 'se', +1],
    [cx-bW/2, cy+bH/2, 'sw-resize', 'sw', -1],
  ];
  corners.forEach(function(corner){
    var hx=corner[0],hy=corner[1],cur=corner[2],name=corner[3];
    var g = document.createElementNS('http://www.w3.org/2000/svg','g');
    g.setAttribute('transform','rotate('+rot+','+cx+','+cy+')');
    g.setAttribute('data-handle', name);
    g.setAttribute('data-sign',   corner[4]);
    g.style.cssText = 'cursor:'+cur+';pointer-events:all;';
    var r = document.createElementNS('http://www.w3.org/2000/svg','rect');
    r.setAttribute('x',hx-6); r.setAttribute('y',hy-6);
    r.setAttribute('width',12); r.setAttribute('height',12);
    r.setAttribute('rx',2);
    r.setAttribute('fill','#fff'); r.setAttribute('stroke','#E8590C'); r.setAttribute('stroke-width','1.5');
    g.appendChild(r); svg.appendChild(g);
  });

  // Midpoint handles
  [[cx,cy-bH/2],[cx+bW/2,cy],[cx,cy+bH/2],[cx-bW/2,cy]].forEach(function(m){
    var g = document.createElementNS('http://www.w3.org/2000/svg','g');
    g.setAttribute('transform','rotate('+rot+','+cx+','+cy+')');
    var c2 = document.createElementNS('http://www.w3.org/2000/svg','circle');
    c2.setAttribute('cx',m[0]); c2.setAttribute('cy',m[1]); c2.setAttribute('r',4);
    c2.setAttribute('fill','#fff'); c2.setAttribute('stroke','#E8590C'); c2.setAttribute('stroke-width','1.5');
    g.appendChild(c2); svg.appendChild(g);
  });

  // Center crosshair
  [[cx-8,cy,cx+8,cy],[cx,cy-8,cx,cy+8]].forEach(function(l){
    var line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1',l[0]); line.setAttribute('y1',l[1]);
    line.setAttribute('x2',l[2]); line.setAttribute('y2',l[3]);
    line.setAttribute('stroke','rgba(232,89,12,0.9)'); line.setAttribute('stroke-width','1.5');
    svg.appendChild(line);
  });

  // Transparent interior hit-rect for move
  var hitRect = document.createElementNS('http://www.w3.org/2000/svg','rect');
  hitRect.setAttribute('x', cx-bW/2+8); hitRect.setAttribute('y', cy-bH/2+8);
  hitRect.setAttribute('width',  Math.max(0,bW-16));
  hitRect.setAttribute('height', Math.max(0,bH-16));
  hitRect.setAttribute('fill',   'rgba(0,0,0,0.001)');
  hitRect.setAttribute('transform','rotate('+rot+','+cx+','+cy+')');
  hitRect.style.cssText = 'cursor:move;pointer-events:all;';
  svg.appendChild(hitRect);

  box.appendChild(svg);
  frame.appendChild(box);

  // ── Interaction ───────────────────────────────────────────────────────────
  var _mode=null, _startX=0, _startY=0;
  var _origTX=0, _origTY=0, _origSX=100, _origSY=100, _scaleSign=1;
  var _rafPending=false;

  // Corner mousedown → scale
  box.querySelectorAll('[data-handle]').forEach(function(h){
    h.addEventListener('mousedown', function(e){
      e.stopPropagation(); e.preventDefault();
      var cl = S.cut.clips[S.cut.sel];
      if(!cl) return;
      if(!cl.transform) cl.transform={x:0,y:0,scaleX:100,scaleY:100,rotation:0,anchorX:50,anchorY:50,antiFlicker:false,uniformScale:true};
      _mode='scale';
      _startX=e.clientX; _startY=e.clientY;
      _origSX=cl.transform.scaleX||100;
      _origSY=cl.transform.scaleY||100;
      _scaleSign = parseInt(h.getAttribute('data-sign')||'1');
    });
  });

  // Interior hit-rect mousedown → move
  hitRect.addEventListener('mousedown', function(e){
    e.stopPropagation(); e.preventDefault();
    var cl = S.cut.clips[S.cut.sel];
    if(!cl) return;
    if(!cl.transform) cl.transform={x:0,y:0,scaleX:100,scaleY:100,rotation:0,anchorX:50,anchorY:50,antiFlicker:false,uniformScale:true};
    _mode='move';
    _startX=e.clientX; _startY=e.clientY;
    _origTX=cl.transform.x||0;
    _origTY=cl.transform.y||0;
  });

  function _onMove(e){
    if(!_mode || _rafPending) return;
    _rafPending=true;
    requestAnimationFrame(function(){
      _rafPending=false;
      var cl2=S.cut.clips[S.cut.sel];
      if(!cl2||!cl2.transform) return;
      var fr2=document.getElementById('cut-viewport-frame');
      if(!fr2) return;
      var dx=(e.clientX-_startX)/fr2.offsetWidth*100;
      var dy=(e.clientY-_startY)/fr2.offsetHeight*100;
      if(_mode==='move'){
        cl2.transform.x=Math.max(-200,Math.min(200,_origTX+dx));
        cl2.transform.y=Math.max(-200,Math.min(200,_origTY+dy));
      } else {
        var delta=(Math.abs(dx)>=Math.abs(dy)?dx:dy)*_scaleSign;
        cl2.transform.scaleX=Math.max(1,Math.round(_origSX+delta));
        cl2.transform.scaleY=Math.max(1,Math.round(_origSY+delta));
      }
      syncCutVid();
      renderBoundingBox(S.cut.sel);
      var xSl=document.querySelector('#cut-props-body input[oninput*=".x="]');
      var ySl=document.querySelector('#cut-props-body input[oninput*=".y="]');
      var sxSl=document.querySelector('#cut-props-body input[oninput*=".scaleX="]');
      var sySl=document.querySelector('#cut-props-body input[oninput*=".scaleY="]');
      if(xSl){xSl.value=cl2.transform.x.toFixed(1);xSl.nextElementSibling.textContent=cl2.transform.x.toFixed(1)+'%';}
      if(ySl){ySl.value=cl2.transform.y.toFixed(1);ySl.nextElementSibling.textContent=cl2.transform.y.toFixed(1)+'%';}
      if(sxSl){sxSl.value=cl2.transform.scaleX;sxSl.nextElementSibling.textContent=cl2.transform.scaleX+'%';}
      if(sySl){sySl.value=cl2.transform.scaleY;sySl.nextElementSibling.textContent=cl2.transform.scaleY+'%';}
    });
  }

  function _onUp(){
    if(_mode){ if(window.cutSaveHistory) cutSaveHistory('transform'); if(window.scheduleSave) scheduleSave(); }
    _mode=null;
  }

  window.addEventListener('mousemove', _onMove);
  window.addEventListener('mouseup',   _onUp);

  // Store cleanup so it runs exactly once when box is replaced
  box._cleanup = function(){
    window.removeEventListener('mousemove', _onMove);
    window.removeEventListener('mouseup',   _onUp);
  };
  var _origRemove = box.remove.bind(box);
  box.remove = function(){ if(box._cleanup){box._cleanup();box._cleanup=null;} _origRemove(); };
}
window.renderBoundingBox = renderBoundingBox;

// Auto-show/hide bounding box when selection changes
const _origCutSelectClip = window.cutSelectClip;
// Hook into updatePropsPanel to render bbox after panel updates
const _origUpdateProps = window.updatePropsPanel;

// ── FRAME HOLD ────────────────────────────────────────────────
// Inserts a still frame clip at the current playhead position

function insertFrameHold(ci){
  const ph = S.cut.ph;
  const clip = S.cut.clips[ci];
  if(!clip || clip.type !== 'video'){
    notify('Select a video clip first', '#E31837');
    return;
  }
  // Playhead must be on the clip
  if(ph <= clip.start || ph >= clip.start + clip.dur){
    notify('Move the playhead inside the clip first', '#E31837');
    return;
  }

  // ── Step 1: Capture the frozen frame ──
  let dataURL = null;
  const transCvs = document.getElementById('cut-trans-cvs');
  if(transCvs && transCvs.style.display !== 'none' && transCvs.width > 0){
    try{ dataURL = transCvs.toDataURL('image/jpeg',0.95); }catch(e){}
  }
  if(!dataURL){
    const mv = document.getElementById('cut-main-vid');
    const fc = document.createElement('canvas');
    fc.width = S.proj.w||1920; fc.height = S.proj.h||1080;
    try{
      fc.getContext('2d').drawImage(mv,0,0,fc.width,fc.height);
      dataURL = fc.toDataURL('image/jpeg',0.95);
    }catch(e){
      notify('Could not capture frame - pause the video first','#E31837');
      return;
    }
  }

  const holdDur = 3; // default hold duration in seconds

  // ── Step 2: Premiere-style "Insert Frame Hold Segment" ──
  // Split clip at playhead: left part stays, right part shifts right by holdDur
  // Insert frame_hold clip in the gap — same track as original clip
  if(window.cutSaveHistory) cutSaveHistory('insert_frame_hold');

  const origStart  = clip.start;
  const origDur    = clip.dur;
  const origTrack  = clip.track;
  const origMedia  = clip.mediaId;
  const origFS     = clip.fileStart || 0;
  const origSpeed  = clip.speed || 1;

  // Left part: clip.start → ph (keep clip, just shorten dur)
  clip.dur      = ph - origStart;
  clip.name     = clip.name; // keep original name

  // Right part: ph → origEnd, shifted right by holdDur
  const rightDur    = origDur - clip.dur;
  const rightFileStart = origFS + (ph - origStart) * origSpeed;
  const rightClip = {
    type: 'video',
    start: ph + holdDur,         // shifted right by holdDur
    dur: rightDur,
    track: origTrack,
    name: clip.name,
    mediaIdx: origMedia,
    fileStart: rightFileStart,
    speed: origSpeed,
    volume: clip.volume,
    color: clip.color,
  };

  // Frame hold clip fills the gap between left and right parts
  const img = new Image();
  img.src = dataURL;
  const holdClip = {
    type: 'frame_hold',
    start: ph,                    // immediately after left part
    dur: holdDur,
    track: origTrack,             // SAME track as original clip
    name: 'Frame Hold',
    color: 'linear-gradient(135deg,#3d1a5a,#6b2fa0)',
    _imgData: dataURL,
    _img: img,
  };

  // Shift ALL clips that start at or after ph (on same and other tracks) right by holdDur
  // This makes room for the hold segment — true ripple insert
  S.cut.clips.forEach(c => {
    if(c !== clip && c.start >= ph){
      c.start += holdDur;
    }
  });
  // Also shift overlays
  if(window._overlays){
    window._overlays.forEach(o => {
      if(o.startTime >= ph){ o.startTime += holdDur; o.endTime += holdDur; }
    });
  }

  // Insert hold clip and right part
  S.cut.clips.push(holdClip);
  if(rightDur > 0.05) S.cut.clips.push(rightClip);

  // Update vidEl clip index after modification
  const vidElFH = document.getElementById('cut-main-vid');
  if(vidElFH) vidElFH.dataset.clipIdx = String(S.cut.clips.indexOf(clip));
  S.cut.sel = S.cut.clips.indexOf(holdClip);

  // Pause the video immediately so it doesn't override ph during frame_hold
  const mvInsert = document.getElementById('cut-main-vid');
  if(mvInsert && !mvInsert.paused) mvInsert.pause();
  window._fhLastTime = null; // reset clock so frame_hold starts fresh

  renderCutTimeline();
  syncCutVid();
  scheduleSave();
  notify('Frame Hold inserted (' + holdDur + 's) - drag edges to resize', '#3fb950');
}
window.insertFrameHold = insertFrameHold;


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

// ── Insert Frame Hold at Clip End (extends the clip) ──
function insertFrameHoldAtEnd(ci){
  const clip = S.cut.clips[ci];
  if(!clip || clip.type !== 'video'){ notify('Select a video clip first','#E31837'); return; }

  // Seek to last frame of clip for capture
  const mv = document.getElementById('cut-main-vid');
  let dataURL = null;
  const fc = document.createElement('canvas');
  fc.width = S.proj.w||1920; fc.height = S.proj.h||1080;
  try{
    fc.getContext('2d').drawImage(mv,0,0,fc.width,fc.height);
    dataURL = fc.toDataURL('image/jpeg',0.95);
  }catch(e){
    notify('Could not capture frame - pause near clip end first','#E31837');
    return;
  }

  const holdDur = 3;
  const clipEnd = clip.start + clip.dur;
  const img = new Image(); img.src = dataURL;

  if(window.cutSaveHistory) cutSaveHistory('insert_frame_hold_end');

  // Shift all clips starting at or after clipEnd right by holdDur
  S.cut.clips.forEach(c => { if(c !== clip && c.start >= clipEnd) c.start += holdDur; });
  if(window._overlays){
    window._overlays.forEach(o => { if(o.startTime >= clipEnd){ o.startTime += holdDur; o.endTime += holdDur; } });
  }

  const holdClip = {
    type:'frame_hold', start:clipEnd, dur:holdDur, track:clip.track,
    name:'Frame Hold', color:'linear-gradient(135deg,#3d1a5a,#6b2fa0)',
    _imgData:dataURL, _img:img,
    mediaId: clip.mediaId,
    _sourceTime: (clip.fileStart||0) + clip.dur,
  };
  S.cut.clips.push(holdClip);
  S.cut.sel = S.cut.clips.indexOf(holdClip);
  renderCutTimeline(); syncCutVid(); scheduleSave();
  notify('Frame Hold added at clip end ('+holdDur+'s)','#3fb950');
}
window.insertFrameHoldAtEnd = insertFrameHoldAtEnd;

// ── Regenerate _imgData for all frame_hold clips after project load ──
// _imgData is stripped before Firestore save; must be rebuilt from the source video.
async function _regenerateFrameHolds(){
  const fhClips = S.cut.clips.filter(c => c.type === 'frame_hold' && !c._imgData);
  if(!fhClips.length) return;
  const off = document.createElement('canvas');
  off.width = S.proj?.w || 1920;
  off.height = S.proj?.h || 1080;
  const ctx = off.getContext('2d');
  for(const clip of fhClips){
    const item = getMediaById(clip.mediaId);
    if(!item?.url) continue; // media not yet re-imported, skip
    await new Promise(resolve => {
      const v = document.createElement('video');
      v.src = item.url;
      v.muted = true;
      v.preload = 'metadata';
      // frame_hold sits at the end of the previous clip, so capture the last frame
      // of the source: use fileStart + dur of the preceding clip as approximate seek point
      const _prevClip = clip._sourceTime !== undefined ? null :
                    S.cut.clips.find(c => c.type==='video' && c.mediaId===clip.mediaId && c.start < clip.start);
      const seekT = clip._sourceTime !== undefined ? clip._sourceTime :
                    (_prevClip ? ((_prevClip.fileStart||0) + _prevClip.dur) : 0);
      v.addEventListener('seeked', () => {
        try{
          ctx.clearRect(0,0,off.width,off.height);
          ctx.drawImage(v, 0, 0, off.width, off.height);
          clip._imgData = off.toDataURL('image/jpeg', 0.85);
          clip._img = new Image();
          clip._img.src = clip._imgData;
        }catch(e){ console.warn('frame_hold regen failed', e); }
        v.src = '';
        resolve();
      }, {once:true});
      v.addEventListener('error', () => { v.src=''; resolve(); }, {once:true});
      v.load();
      v.currentTime = Math.max(0, seekT - 0.05);
    });
  }
  if(fhClips.some(c=>c._imgData)) syncCutVid();
}
window._regenerateFrameHolds = _regenerateFrameHolds;

// ══════════════════════════════════════════════════════════════════════
// MONITOR OVERLAY SYSTEM — Safe Zones, Guides, Metadata, Timecode
// Non-destructive: renders ABOVE video on a separate canvas, never exports
// ══════════════════════════════════════════════════════════════════════

window._monitorOverlays = {
  safeZones:  false,   // title+action safe
  guides:     [],      // [{type:'h'|'v', pos:0.5, color:'#00ff00'}]
  metadata:   false,   // timecode + clip name
  grid:       false,   // rule of thirds
  socialZone: null,    // 'tiktok'|'reels'|'shorts'|null
};

// ── Create the monitor overlay canvas (sits above everything) ──
function initMonitorCanvas(){
  const frame = document.getElementById('cut-viewport-frame');
  if(!frame || document.getElementById('cut-monitor-cvs')) return;
  const mc = document.createElement('canvas');
  mc.id = 'cut-monitor-cvs';
  mc.style.cssText = [
    'position:absolute','inset:0','width:100%','height:100%',
    'pointer-events:none',   // clicks pass through to video/handles below
    'z-index:10',            // above cut-trans-cvs (z-index:2) always
    'border-radius:4px',
  ].join(';');
  frame.appendChild(mc);
  // Guide dragging — monitor canvas is pointer-events:none but we need
  // to intercept guide drags via the frame itself
  frame.addEventListener('mousedown', _guideMouseDown);
  window.addEventListener('mousemove', _guideMouseMove);
  window.addEventListener('mouseup',   _guideMouseUp);
}

// ── Draw all monitor overlays ──
function drawMonitorOverlays(){
  const mc = document.getElementById('cut-monitor-cvs');
  const frame = document.getElementById('cut-viewport-frame');
  if(!mc || !frame) return;

  // Match canvas resolution to frame display size
  const W = frame.offsetWidth  || 1280;
  const H = frame.offsetHeight || 720;
  if(mc.width !== W || mc.height !== H){ mc.width = W; mc.height = H; }

  const ctx = mc.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const mo = window._monitorOverlays;

  // 1. Safe Zones
  if(mo.safeZones){
    _drawSafeZones(ctx, W, H);
  }

  // 2. Social Media Safe Zone
  if(mo.socialZone){
    _drawSocialZone(ctx, W, H, mo.socialZone);
  }

  // 3. Rule of Thirds Grid
  if(mo.grid){
    _drawGrid(ctx, W, H);
  }

  // 4. Guides
  mo.guides.forEach(g => _drawGuide(ctx, W, H, g));

  // 5. Metadata Overlay
  if(mo.metadata){
    _drawMetadata(ctx, W, H);
  }
}
window.drawMonitorOverlays = drawMonitorOverlays;

// ── Safe Zones ──
function _drawSafeZones(ctx, W, H){
  // Action Safe: 93% (3.5% each side)
  // Title Safe:  80% (10% each side)
  const zones = [
    {pct:0.93, color:'rgba(255,255,100,0.6)', label:'Action Safe'},
    {pct:0.80, color:'rgba(100,200,255,0.6)', label:'Title Safe'},
  ];
  zones.forEach(z => {
    const x = W*(1-z.pct)/2, y = H*(1-z.pct)/2;
    const w = W*z.pct,       h = H*z.pct;
    ctx.save();
    ctx.strokeStyle = z.color;
    ctx.lineWidth   = 1;
    ctx.setLineDash([4,4]);
    ctx.strokeRect(x, y, w, h);
    ctx.font = 'bold 9px DM Sans, sans-serif';
    ctx.fillStyle = z.color;
    ctx.fillText(z.label, x+4, y+11);
    ctx.restore();
  });
  // Center crosshair
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.setLineDash([2,4]);
  ctx.beginPath(); ctx.moveTo(W/2-12,H/2); ctx.lineTo(W/2+12,H/2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W/2,H/2-12); ctx.lineTo(W/2,H/2+12); ctx.stroke();
  ctx.restore();
}

// ── Social Media Safe Zones ──
function _drawSocialZone(ctx, W, H, platform){
  const configs = {
    tiktok:   {top:0.12, bottom:0.22, label:'TikTok Safe', color:'rgba(255,80,80,0.7)'},
    reels:    {top:0.15, bottom:0.20, label:'Instagram Reels Safe', color:'rgba(200,100,255,0.7)'},
    shorts:   {top:0.10, bottom:0.20, label:'YouTube Shorts Safe', color:'rgba(255,50,50,0.7)'},
    facebook: {top:0.10, bottom:0.15, label:'Facebook Safe', color:'rgba(100,150,255,0.7)'},
  };
  const cfg = configs[platform]; if(!cfg) return;
  ctx.save();
  // Danger zones (top/bottom UI areas)
  ctx.fillStyle = 'rgba(255,0,0,0.12)';
  ctx.fillRect(0, 0, W, H*cfg.top);
  ctx.fillRect(0, H*(1-cfg.bottom), W, H*cfg.bottom);
  // Safe area border
  ctx.strokeStyle = cfg.color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5,3]);
  const sy = H*cfg.top, sh = H*(1-cfg.top-cfg.bottom);
  ctx.strokeRect(W*0.05, sy, W*0.90, sh);
  ctx.font = 'bold 10px DM Sans, sans-serif';
  ctx.fillStyle = cfg.color;
  ctx.fillText(cfg.label + ' zone', W*0.05+4, sy+14);
  ctx.restore();
}

// ── Rule of Thirds ──
function _drawGrid(ctx, W, H){
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  for(let i=1; i<3; i++){
    ctx.beginPath(); ctx.moveTo(W*i/3,0); ctx.lineTo(W*i/3,H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,H*i/3); ctx.lineTo(W,H*i/3); ctx.stroke();
  }
  ctx.restore();
}

// ── Individual Guide ──
function _drawGuide(ctx, W, H, g){
  ctx.save();
  ctx.strokeStyle = g.color || '#00ff88';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  const pos = g.pos || 0.5;
  if(g.type === 'h'){
    const y = H * pos;
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
    ctx.font = '9px DM Mono, monospace';
    ctx.fillStyle = g.color || '#00ff88';
    ctx.fillText(Math.round(pos*100)+'%', 3, y-2);
  } else {
    const x = W * pos;
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke();
    ctx.font = '9px DM Mono, monospace';
    ctx.fillStyle = g.color || '#00ff88';
    ctx.fillText(Math.round(pos*100)+'%', x+2, 11);
  }
  ctx.restore();
}

// ── Metadata Overlay ──
function _drawMetadata(ctx, W, H){
  const ph = S?.cut?.ph || 0;
  const fps = S?.proj?.fps || 30;
  // Format timecode
  const totalF = Math.round(ph * fps);
  const ff = totalF % fps;
  const ss = Math.floor(totalF/fps) % 60;
  const mm = Math.floor(totalF/fps/60) % 60;
  const hh = Math.floor(totalF/fps/3600);
  const tc = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}:${String(ff).padStart(2,'0')}`;

  // Active clip name
  const activeClip = S?.cut?.clips?.find(c => (c.type==='video'||c.type==='frame_hold') && ph>=c.start && ph<c.start+c.dur);
  const clipName = activeClip?.name || '';

  ctx.save();
  ctx.font = 'bold 11px DM Mono, monospace';

  // Timecode — bottom left
  ctx.fillStyle='rgba(0,0,0,0.5)';
  ctx.fillRect(6, H-22, ctx.measureText(tc).width+8, 16);
  ctx.fillStyle='#ffdd44';
  ctx.fillText(tc, 10, H-10);

  // Clip name — bottom right
  if(clipName){
    const tw = ctx.measureText(clipName).width;
    ctx.fillStyle='rgba(0,0,0,0.5)';
    ctx.fillRect(W-tw-14, H-22, tw+8, 16);
    ctx.fillStyle='#88ddff';
    ctx.fillText(clipName, W-tw-10, H-10);
  }

  ctx.restore();
}

// ── Guide dragging ──
let _guideDrag = null;
function _guideMouseDown(e){
  const mc = document.getElementById('cut-monitor-cvs');
  if(!mc) return;
  const rect = mc.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const W = mc.offsetWidth, H = mc.offsetHeight;
  // Check if click is on an existing guide (within 5px)
  const mo = window._monitorOverlays;
  for(let i=0; i<mo.guides.length; i++){
    const g = mo.guides[i];
    if(g.type==='h'){
      if(Math.abs(y - g.pos*H) < 6){ _guideDrag={idx:i,type:'h'}; e.preventDefault(); return; }
    } else {
      if(Math.abs(x - g.pos*W) < 6){ _guideDrag={idx:i,type:'v'}; e.preventDefault(); return; }
    }
  }
}
function _guideMouseMove(e){
  if(!_guideDrag) return;
  const mc = document.getElementById('cut-monitor-cvs');
  if(!mc) return;
  const rect = mc.getBoundingClientRect();
  const W = mc.offsetWidth, H = mc.offsetHeight;
  const g = window._monitorOverlays.guides[_guideDrag.idx];
  if(!g) return;
  if(g.type==='h') g.pos = Math.max(0, Math.min(1, (e.clientY-rect.top)/H));
  else             g.pos = Math.max(0, Math.min(1, (e.clientX-rect.left)/W));
  drawMonitorOverlays();
}
function _guideMouseUp(){ _guideDrag = null; }

// ── Monitor Overlay Settings Panel ──
function showMonitorOverlayPanel(){
  document.querySelectorAll('#monitor-overlay-panel').forEach(e=>e.remove());
  const mo = window._monitorOverlays;

  const panel = document.createElement('div');
  panel.id = 'monitor-overlay-panel';
  panel.style.cssText = [
    'position:fixed','top:60px','right:20px','width:260px',
    'background:#1a2130','border:1px solid rgba(255,255,255,0.12)',
    'border-radius:12px','padding:16px','z-index:9999',
    'font-family:DM Sans,sans-serif','color:#f0f2f5',
    'box-shadow:0 8px 32px rgba(0,0,0,0.5)',
  ].join(';');

  const tog = (id, label, key, icon) => `
    <label style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);cursor:pointer">
      <span style="font-size:12px;display:flex;align-items:center;gap:6px"><span>${icon}</span>${label}</span>
      <input type="checkbox" id="${id}" ${mo[key]?'checked':''} style="accent-color:#E8590C;width:14px;height:14px"
        onchange="window._monitorOverlays.${key}=this.checked; drawMonitorOverlays(); if(this.checked) initMonitorCanvas();">
    </label>`;

  panel.innerHTML = `
    <div style="font-size:13px;font-weight:700;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between">
      <span>⊞ Monitor Overlays</span>
      <button onclick="document.getElementById('monitor-overlay-panel').remove()" 
        style="background:none;border:none;color:#8b949e;cursor:pointer;font-size:16px;padding:0">✕</button>
    </div>
    ${tog('mo-safe','Safe Zones (Title + Action)','safeZones','⊡')}
    ${tog('mo-grid','Rule of Thirds','grid','⊞')}
    ${tog('mo-meta','Timecode + Clip Name','metadata','🕐')}
    <div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
      <div style="font-size:12px;margin-bottom:6px;display:flex;align-items:center;gap:6px"><span>📱</span>Social Media Safe Zone</div>
      <select onchange="window._monitorOverlays.socialZone=this.value||null;drawMonitorOverlays();initMonitorCanvas();"
        style="width:100%;padding:5px 8px;background:#252d3d;border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#f0f2f5;font-size:11px;outline:none">
        <option value="">— None —</option>
        <option value="tiktok" ${mo.socialZone==='tiktok'?'selected':''}>TikTok Safe Area</option>
        <option value="reels"  ${mo.socialZone==='reels'?'selected':''}>Instagram Reels</option>
        <option value="shorts" ${mo.socialZone==='shorts'?'selected':''}>YouTube Shorts</option>
        <option value="facebook" ${mo.socialZone==='facebook'?'selected':''}>Facebook</option>
      </select>
    </div>
    <div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
      <div style="font-size:12px;margin-bottom:6px;display:flex;align-items:center;gap:6px"><span>📏</span>Guides</div>
      <div style="display:flex;gap:6px;margin-bottom:6px">
        <button onclick="window._addGuide('h')" style="flex:1;padding:5px;background:#252d3d;border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#f0f2f5;font-size:11px;cursor:pointer">+ Horizontal</button>
        <button onclick="window._addGuide('v')" style="flex:1;padding:5px;background:#252d3d;border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#f0f2f5;font-size:11px;cursor:pointer">+ Vertical</button>
        <button onclick="window._monitorOverlays.guides=[];drawMonitorOverlays();showMonitorOverlayPanel()" 
          style="padding:5px 8px;background:#E31837;border:none;border-radius:6px;color:#fff;font-size:11px;cursor:pointer">✕</button>
      </div>
      <div id="mo-guide-list" style="font-size:10px;color:#8b949e">
        ${mo.guides.length ? mo.guides.map((g,i)=>`
          <div style="display:flex;align-items:center;justify-content:space-between;padding:2px 0">
            <span>${g.type==='h'?'H':'V'} — ${Math.round(g.pos*100)}%</span>
            <button onclick="window._monitorOverlays.guides.splice(${i},1);drawMonitorOverlays();showMonitorOverlayPanel()"
              style="background:none;border:none;color:#E31837;cursor:pointer;font-size:11px;padding:0">✕</button>
          </div>`).join('') : '<span>No guides — click + to add</span>'}
      </div>
    </div>
    <div style="padding-top:8px;font-size:10px;color:#8b949e">
      💡 Monitor overlays are non-destructive — they appear in preview only, not in exports.
      Drag guides to reposition them.
    </div>`;

  document.body.appendChild(panel);
  initMonitorCanvas();
}
window.showMonitorOverlayPanel = showMonitorOverlayPanel;

window._addGuide = function(type){
  window._monitorOverlays.guides.push({type, pos:0.5, color:'#00ff88'});
  initMonitorCanvas();
  drawMonitorOverlays();
  showMonitorOverlayPanel();
};

// ── Hook into the RAF loop so metadata updates every frame ──
const _origUpdateCutPH = window.updateCutPH;
// We hook it after app loads
setTimeout(() => {
  const orig = window.updateCutPH;
  if(orig && !orig._moHooked){
    window.updateCutPH = function(){
      orig.apply(this, arguments);
      if(window._monitorOverlays?.metadata || window._monitorOverlays?.guides?.length > 0 ||
         window._monitorOverlays?.safeZones || window._monitorOverlays?.grid || window._monitorOverlays?.socialZone){
        drawMonitorOverlays();
      }
    };
    window.updateCutPH._moHooked = true;
  }
}, 2000);

// Auto-init canvas when cut editor loads
setTimeout(initMonitorCanvas, 1500);



// ════════════════════════════════════════════════════════════════
// FEATURE 1: MARQUEE MULTI-SELECT
// Drag on empty timeline area to draw selection box
// Selects all clips inside the box — move them together
// ════════════════════════════════════════════════════════════════

window._selectedClips = new Set(); // indices of selected clips

function setupMarqueeSelect(){
  const scroll = document.getElementById('tl-scroll');
  if(!scroll || scroll._marqueeSetup) return;
  scroll._marqueeSetup = true;

  let marqueeEl = null;
  let startX = 0, startY = 0;
  let dragging = false;

  scroll.addEventListener('mousedown', e => {
    // Only activate on empty timeline area (not on clips or handles)
    const target = e.target;
    if(target.closest('.tl-clip') || target.closest('.tl-overlay-clip') ||
       target.closest('.playhead') || target.closest('.effect-bar') ||
       target.closest('.clip-resize-l') || target.closest('.clip-resize-r')) return;
    if(e.button !== 0) return;

    const rect = scroll.getBoundingClientRect();
    startX = e.clientX - rect.left + scroll.scrollLeft;
    startY = e.clientY - rect.top  + scroll.scrollTop;
    dragging = true;
    e.preventDefault();

    // Create marquee box
    marqueeEl = document.createElement('div');
    marqueeEl.id = 'tl-marquee';
    marqueeEl.style.cssText = [
      'position:absolute',
      `left:${startX}px`, `top:${startY}px`,
      'width:0', 'height:0',
      'border:1.5px dashed rgba(232,89,12,0.9)',
      'background:rgba(232,89,12,0.08)',
      'pointer-events:none',
      'z-index:50',
      'border-radius:2px',
    ].join(';');
    document.getElementById('tl-rows')?.appendChild(marqueeEl);

    document.addEventListener('mousemove', onMarqueeMove);
    document.addEventListener('mouseup', onMarqueeUp);
  });

  function onMarqueeMove(e){
    if(!dragging || !marqueeEl) return;
    const rect = scroll.getBoundingClientRect();
    const curX = e.clientX - rect.left + scroll.scrollLeft;
    const curY = e.clientY - rect.top  + scroll.scrollTop;
    const x = Math.min(startX, curX);
    const y = Math.min(startY, curY);
    const w = Math.abs(curX - startX);
    const h = Math.abs(curY - startY);
    marqueeEl.style.left   = x + 'px';
    marqueeEl.style.top    = y + 'px';
    marqueeEl.style.width  = w + 'px';
    marqueeEl.style.height = h + 'px';

    // Live highlight clips inside box
    const secStart = x / PPS;
    const secEnd   = (x + w) / PPS;
    const rowH = 30;
    const trackStart = Math.floor(y / rowH);
    const trackEnd   = Math.floor((y + h) / rowH);

    window._selectedClips = new Set();
    S.cut.clips.forEach((c, i) => {
      const cEnd = c.start + c.dur;
      const inTime  = c.start < secEnd && cEnd > secStart;
      const inTrack = c.track >= trackStart && c.track <= trackEnd;
      if(inTime && inTrack) window._selectedClips.add(i);
    });
    _highlightSelected();
  }

  function onMarqueeUp(){
    dragging = false;
    document.removeEventListener('mousemove', onMarqueeMove);
    document.removeEventListener('mouseup', onMarqueeUp);
    if(marqueeEl){ marqueeEl.remove(); marqueeEl = null; }
    // If only one clip selected, use normal sel
    if(window._selectedClips.size === 1){
      const [ci] = window._selectedClips;
      window._selectedClips.clear();
      if(window._selectClip) _selectClip(ci);
    } else if(window._selectedClips.size > 1){
      S.cut.sel = null; // no single selection when multi
      _highlightSelected();
      const n = window._selectedClips.size;
      notify(`${n} clips selected — drag any to move all`, '#E8590C');
    }
  }
}
window.setupMarqueeSelect = setupMarqueeSelect;

function _highlightSelected(){
  document.querySelectorAll('.tl-clip').forEach(el => {
    const ci = parseInt(el.dataset.ci);
    const isSelected = window._selectedClips?.has(ci) || S.cut.sel === ci;
    el.classList.toggle('selected', isSelected);
  });
}
window._highlightSelected = _highlightSelected;

// Clear multi-select when clicking empty area — but NOT after a marquee drag
let _lastMarqueeEnd = 0; // timestamp of last marquee mouseup
document.addEventListener('click', e => {
  if(!e.target.closest('#tl-scroll') && !e.target.closest('#tl-rows')) return;
  if(e.target.closest('.tl-clip') || e.target.closest('.tl-overlay-clip')) return;
  // Don't clear if this click is the tail-end of a marquee drag (within 100ms)
  if(Date.now() - _lastMarqueeEnd < 100) return;
  if(window._selectedClips?.size > 0){
    window._selectedClips.clear();
    document.querySelectorAll('.tl-clip.selected').forEach(el => el.classList.remove('selected'));
  }
});

// ════════════════════════════════════════════════════════════════
// FEATURE 2: RESIZABLE PREVIEW — drag handle between preview & timeline
// ════════════════════════════════════════════════════════════════

function setupPreviewResize(){
  const handle = document.getElementById('cut-pv-resize');
  const preview = document.querySelector('.cut-preview');
  const tl = document.getElementById('cut-tl');
  if(!handle || !preview || !tl || handle._resizeSetup) return;
  handle._resizeSetup = true;

  let resizing = false, startY = 0, startPvH = 0;

  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    resizing = true;
    startY = e.clientY;
    startPvH = preview.offsetHeight;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';

    const onMove = mv => {
      if(!resizing) return;
      const dy = mv.clientY - startY;
      const newH = Math.max(120, Math.min(window.innerHeight * 0.75, startPvH + dy));
      preview.style.height = newH + 'px';
      preview.style.flex = 'none';
      // Trigger canvas resize
      if(window.applyCanvasAspectRatio) applyCanvasAspectRatio(S.proj.w||1920, S.proj.h||1080);
      if(window.drawMonitorOverlays) drawMonitorOverlays();
    };
    const onUp = () => {
      resizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Double-click handle = reset to default
  handle.addEventListener('dblclick', () => {
    preview.style.height = '';
    preview.style.flex = '1';
    if(window.applyCanvasAspectRatio) applyCanvasAspectRatio(S.proj.w||1920, S.proj.h||1080);
  });
}
window.setupPreviewResize = setupPreviewResize;
setTimeout(setupPreviewResize, 600);

// ════════════════════════════════════════════════════════════════
// FEATURE 3: FULLSCREEN PREVIEW MODE
// F key or button — shows only the preview, hides everything else
// ════════════════════════════════════════════════════════════════

let _cutFsActive = false;

function cutToggleFullscreen(){
  const cutApp = document.getElementById('cut-app');
  const screen = document.getElementById('cut-screen');
  if(!cutApp || !screen) return;

  _cutFsActive = !_cutFsActive;

  if(_cutFsActive){
    _cutEnterSoftFullscreen();
  } else {
    if(document.fullscreenElement) document.exitFullscreen().catch(()=>{});
    _cutExitSoftFullscreen();
  }

  const btn = document.getElementById('cut-fs-btn');
  if(btn) btn.innerHTML = _cutFsActive ? '&#x2715;' : '&#x26F6;';
  btn?.setAttribute('title', _cutFsActive ? 'Exit Fullscreen (F or Esc)' : 'Fullscreen (F)');
}
window.cutToggleFullscreen = cutToggleFullscreen;

function _cutEnterSoftFullscreen(){
  const preview = document.querySelector('.cut-preview');
  const lpanel  = document.querySelector('.cut-lpanel');
  const rpanel  = document.querySelector('.cut-rpanel');
  const tl      = document.getElementById('cut-tl');
  if(preview){ preview.dataset.fsStyle = preview.style.cssText; preview.style.cssText='position:fixed;inset:0;z-index:1500;background:#000;display:flex;align-items:center;justify-content:center;flex-direction:column'; }
  const _fsFrame = document.getElementById('cut-viewport-frame');
  if(_fsFrame){ _fsFrame.dataset.fsFrStyle = _fsFrame.style.cssText; _fsFrame.style.cssText='position:relative;width:auto;height:auto;max-width:100vw;max-height:100vh;display:flex;align-items:center;justify-content:center;'; }
  const _fsMv = document.getElementById('cut-main-vid');
  if(_fsMv){ _fsMv.dataset.fsMvStyle = _fsMv.style.cssText; _fsMv.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;'; }
  // Keep canvas visible and sized if in canvas mode
  const _fsCvs = document.getElementById('cut-trans-cvs');
  if(_fsCvs){ _fsCvs.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2;'; if(_fsCvs.style.display==='none') _fsCvs.style.display='none'; }
  if(lpanel){ lpanel.dataset.fsDis=lpanel.style.display; lpanel.style.display='none'; }
  if(rpanel){ rpanel.dataset.fsDis=rpanel.style.display; rpanel.style.display='none'; }
  if(tl)    { tl.dataset.fsDis=tl.style.display;         tl.style.display='none'; }
  // Apply correct aspect ratio after layout settles
  setTimeout(()=>{
    const W=S.proj.w||1920, H=S.proj.h||1080;
    const ar=W/H;
    const vw=window.innerWidth, vh=window.innerHeight;
    let fw=vw, fh=vw/ar;
    if(fh>vh){ fh=vh; fw=vh*ar; }
    const _fr=document.getElementById('cut-viewport-frame');
    if(_fr){ _fr.style.width=Math.round(fw)+'px'; _fr.style.height=Math.round(fh)+'px'; }
    syncCutVid();
  }, 80);
}

function _cutExitSoftFullscreen(){
  const preview = document.querySelector('.cut-preview');
  const lpanel  = document.querySelector('.cut-lpanel');
  const rpanel  = document.querySelector('.cut-rpanel');
  const tl      = document.getElementById('cut-tl');
  if(preview && preview.dataset.fsStyle !== undefined){ preview.style.cssText = preview.dataset.fsStyle; delete preview.dataset.fsStyle; }
  const _fsFrameE = document.getElementById('cut-viewport-frame');
  if(_fsFrameE && _fsFrameE.dataset.fsFrStyle !== undefined){ _fsFrameE.style.cssText = _fsFrameE.dataset.fsFrStyle; delete _fsFrameE.dataset.fsFrStyle; }
  const _fsMvE = document.getElementById('cut-main-vid');
  if(_fsMvE && _fsMvE.dataset.fsMvStyle !== undefined){ _fsMvE.style.cssText = _fsMvE.dataset.fsMvStyle; delete _fsMvE.dataset.fsMvStyle; }
  if(lpanel && lpanel.dataset.fsDis !== undefined){ lpanel.style.display = lpanel.dataset.fsDis; delete lpanel.dataset.fsDis; }
  if(rpanel && rpanel.dataset.fsDis !== undefined){ rpanel.style.display = rpanel.dataset.fsDis; delete rpanel.dataset.fsDis; }
  if(tl     && tl.dataset.fsDis    !== undefined){ tl.style.display     = tl.dataset.fsDis;     delete tl.dataset.fsDis; }
  setTimeout(()=>{ if(window.applyCanvasAspectRatio) applyCanvasAspectRatio(S.proj.w||1920,S.proj.h||1080); if(window.drawMonitorOverlays) drawMonitorOverlays(); },100);
  _cutFsActive = false;
  const btn = document.getElementById('cut-fs-btn');
  if(btn){ btn.innerHTML='&#x26F6;'; btn.title='Fullscreen (F)'; }
}

// Exit soft fullscreen when native fullscreen exits
document.addEventListener('fullscreenchange', () => {
  if(!document.fullscreenElement && _cutFsActive){
    _cutExitSoftFullscreen();
  }
});

// Keyboard: F = toggle fullscreen, Esc = exit
document.addEventListener('keydown', e => {
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
  if(S?.app !== 'cut') return;
  if(e.code==='KeyF' && !e.ctrlKey && !e.metaKey && !e.shiftKey){
    e.preventDefault();
    cutToggleFullscreen();
  }
  if(e.code==='Escape' && _cutFsActive){
    if(!document.fullscreenElement) _cutExitSoftFullscreen();
  }
}, true);
