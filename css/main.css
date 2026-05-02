@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap');

:root {
  --red: #E31837;
  --red-dk: #a81128;
  --red-dim: rgba(227,24,55,0.15);
  --navy: #0a0c10;
  --n2: #0f1218;
  --n3: #161b24;
  --n4: #1e2533;
  --n5: #252d3d;
  --b1: rgba(255,255,255,0.06);
  --b2: rgba(255,255,255,0.11);
  --b3: rgba(255,255,255,0.18);
  --tx: #f0f2f5;
  --mu: #8b949e;
  --mu2: #6a737d;
  --grn: #3fb950;
  --blu: #58a6ff;
  --amb: #d29922;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; font-family: 'DM Sans', sans-serif; background: var(--navy); color: var(--tx); }

/* ── SCROLLBARS ── */
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--b2); border-radius: 2px; }

/* ── UTILITIES ── */
.hidden { display: none !important; }
.flex { display: flex; }
.col { flex-direction: column; }
.f1 { flex: 1; }
.ai-c { align-items: center; }
.jc-sb { justify-content: space-between; }

/* ── PAGES ── */
.page { display: none; width: 100vw; height: 100vh; }
.page.active { display: flex; flex-direction: column; }

/* ── AUTH PAGE ── */
#page-auth {
  background: var(--navy);
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}
#page-auth::before {
  content: '';
  position: absolute;
  top: -200px; left: -200px;
  width: 700px; height: 700px;
  background: radial-gradient(circle, rgba(227,24,55,0.08) 0%, transparent 65%);
  border-radius: 50%;
}
#page-auth::after {
  content: '';
  position: absolute;
  bottom: -150px; right: -150px;
  width: 500px; height: 500px;
  background: radial-gradient(circle, rgba(88,166,255,0.05) 0%, transparent 65%);
  border-radius: 50%;
}
.auth-box {
  background: var(--n3);
  border: 1px solid var(--b2);
  border-radius: 18px;
  padding: 42px 40px;
  width: 400px;
  position: relative;
  z-index: 1;
  box-shadow: 0 24px 80px rgba(0,0,0,0.5);
}
.auth-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 28px;
}
.auth-logo-mark {
  width: 36px; height: 36px;
  background: var(--red);
  border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
}
.auth-logo-text { font-size: 20px; font-weight: 700; letter-spacing: -0.3px; }
.auth-logo-text span { color: var(--red); }
.auth-title { font-size: 22px; font-weight: 700; margin-bottom: 6px; letter-spacing: -0.3px; }
.auth-sub { font-size: 14px; color: var(--mu); margin-bottom: 28px; line-height: 1.5; }
.auth-tabs {
  display: flex;
  background: var(--n4);
  border-radius: 9px;
  padding: 3px;
  margin-bottom: 24px;
}
.auth-tab {
  flex: 1; padding: 8px; text-align: center;
  font-size: 13px; font-weight: 500; border-radius: 7px;
  cursor: pointer; transition: all 0.2s; color: var(--mu);
}
.auth-tab.on { background: var(--n3); color: var(--tx); box-shadow: 0 1px 4px rgba(0,0,0,0.3); }
.auth-field { margin-bottom: 14px; }
.auth-field label { display: block; font-size: 11px; font-weight: 600; color: var(--mu); text-transform: uppercase; letter-spacing: 0.7px; margin-bottom: 6px; }
.auth-field input {
  width: 100%; padding: 10px 13px;
  background: var(--n4); border: 1px solid var(--b2); border-radius: 8px;
  color: var(--tx); font-size: 14px; font-family: 'DM Sans', sans-serif; outline: none;
  transition: border-color 0.15s;
}
.auth-field input:focus { border-color: var(--red); }
.auth-err { font-size: 12px; color: #ff6b6b; margin-bottom: 12px; padding: 8px 12px; background: rgba(255,107,107,0.1); border-radius: 6px; display: none; }
.auth-err.show { display: block; }
.btn-auth {
  width: 100%; padding: 11px;
  background: var(--red); border: none; border-radius: 9px;
  color: #fff; font-size: 14px; font-weight: 600; font-family: 'DM Sans', sans-serif;
  cursor: pointer; transition: background 0.15s; margin-bottom: 12px;
}
.btn-auth:hover { background: var(--red-dk); }
.btn-auth:disabled { opacity: 0.5; cursor: not-allowed; }
.auth-divider { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.auth-divider span { font-size: 12px; color: var(--mu2); }
.auth-divider::before, .auth-divider::after { content: ''; flex: 1; height: 1px; background: var(--b1); }
.btn-google {
  width: 100%; padding: 10px;
  background: var(--n4); border: 1px solid var(--b2); border-radius: 9px;
  color: var(--tx); font-size: 13px; font-weight: 500; font-family: 'DM Sans', sans-serif;
  cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
  transition: all 0.15s;
}
.btn-google:hover { border-color: var(--b3); background: var(--n5); }

/* ── LAUNCHER ── */
#page-launcher { background: var(--navy); overflow: hidden; position: relative; }
.l-bg {
  position: absolute; inset: 0; pointer-events: none; overflow: hidden;
}
.l-bg::before { content: ''; position: absolute; top: -200px; left: -200px; width: 600px; height: 600px; background: radial-gradient(circle, rgba(227,24,55,0.07) 0%, transparent 70%); border-radius: 50%; }
.l-bg::after { content: ''; position: absolute; bottom: -100px; right: -100px; width: 400px; height: 400px; background: radial-gradient(circle, rgba(88,166,255,0.04) 0%, transparent 70%); border-radius: 50%; }
.l-topbar {
  flex-shrink: 0; display: flex; align-items: center; justify-content: space-between;
  padding: 14px 28px; border-bottom: 1px solid var(--b1); background: var(--n2);
  position: relative; z-index: 10;
}
.l-logo { display: flex; align-items: center; gap: 10px; }
.l-logo-mark { width: 32px; height: 32px; background: var(--red); border-radius: 8px; display: flex; align-items: center; justify-content: center; }
.l-logo-text { font-size: 17px; font-weight: 700; letter-spacing: -0.3px; }
.l-logo-text span { color: var(--red); }
.l-topbar-right { display: flex; align-items: center; gap: 10px; }
.user-pill {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 12px 5px 5px;
  background: var(--n3); border: 1px solid var(--b1); border-radius: 20px;
  font-size: 13px; color: var(--mu);
}
.user-avatar {
  width: 24px; height: 24px; border-radius: 50%;
  background: var(--red); display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700; color: #fff;
}
.btn-ghost {
  padding: 7px 16px; background: transparent;
  border: 1px solid var(--b2); border-radius: 8px;
  color: var(--mu); font-size: 13px; font-weight: 500;
  font-family: 'DM Sans', sans-serif; cursor: pointer; transition: all 0.15s;
}
.btn-ghost:hover { color: var(--tx); border-color: var(--b3); }
.btn-primary {
  padding: 7px 16px; background: var(--red);
  border: none; border-radius: 8px;
  color: #fff; font-size: 13px; font-weight: 600;
  font-family: 'DM Sans', sans-serif; cursor: pointer; transition: background 0.15s;
}
.btn-primary:hover { background: var(--red-dk); }
.l-body {
  flex: 1; overflow-y: auto; padding: 36px 38px 20px;
  position: relative; z-index: 1;
}
.sec-label { font-size: 10px; font-weight: 700; letter-spacing: 1.3px; text-transform: uppercase; color: var(--mu2); margin-bottom: 14px; }
.apps-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 14px; margin-bottom: 34px; }
.app-card {
  background: var(--n3); border: 1px solid var(--b1); border-radius: 14px; padding: 22px;
  cursor: pointer; transition: all 0.2s; position: relative; overflow: hidden;
}
.app-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; background: var(--ca, var(--red)); transform: scaleX(0); transform-origin: left; transition: transform 0.3s; }
.app-card:hover::before { transform: scaleX(1); }
.app-card:hover { border-color: var(--b2); background: var(--n4); transform: translateY(-2px); }
.app-icon { width: 44px; height: 44px; border-radius: 10px; display: flex; align-items: center; justify-content: center; margin-bottom: 14px; }
.app-name { font-size: 16px; font-weight: 700; margin-bottom: 3px; }
.app-tag { font-size: 12px; color: var(--mu); margin-bottom: 13px; line-height: 1.5; }
.app-feats { display: flex; flex-direction: column; gap: 4px; margin-bottom: 13px; }
.app-feat { font-size: 11px; color: var(--mu); display: flex; align-items: center; gap: 5px; }
.app-feat::before { content: ''; width: 3px; height: 3px; border-radius: 50%; background: var(--ca, var(--red)); flex-shrink: 0; }
.app-foot { display: flex; align-items: center; justify-content: space-between; }
.app-badge { font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 4px; background: rgba(63,185,80,0.15); color: var(--grn); }
.projects-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 30px; }
.project-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px; background: var(--n3); border: 1px solid var(--b1);
  border-radius: 10px; cursor: pointer; transition: all 0.15s;
}
.project-item:hover { border-color: var(--b2); background: var(--n4); }
.project-thumb { width: 34px; height: 34px; border-radius: 7px; background: var(--n4); flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 15px; }
.project-name { font-size: 13px; font-weight: 500; margin-bottom: 2px; }
.project-meta { font-size: 11px; color: var(--mu); }
.project-tag { font-size: 11px; font-weight: 500; padding: 2px 8px; border-radius: 4px; }
.empty-projects { padding: 24px; text-align: center; color: var(--mu); font-size: 13px; }

/* ── APP SHELL ── */
#page-app { background: var(--navy); }
.titlebar {
  flex-shrink: 0; display: flex; align-items: center; height: 38px;
  background: var(--n2); border-bottom: 1px solid var(--b1); padding: 0 10px; gap: 6px;
}
.tl-logo { width: 22px; height: 22px; background: var(--red); border-radius: 4px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.tl-app-name { font-size: 13px; font-weight: 700; }
.tl-file { font-size: 11px; color: var(--mu); font-family: 'DM Mono', monospace; }
.tl-sp { flex: 1; }
.tl-btn {
  padding: 4px 11px; font-size: 12px; background: transparent;
  border: 1px solid var(--b1); border-radius: 5px; color: var(--mu);
  cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.15s;
}
.tl-btn:hover { color: var(--tx); border-color: var(--b2); }
.tl-btn.acc { background: var(--red); color: #fff; border-color: var(--red); }
.tl-btn.acc:hover { background: var(--red-dk); }
.tl-save-indicator { font-size: 11px; color: var(--grn); font-family: 'DM Mono', monospace; opacity: 0; transition: opacity 0.3s; }
.tl-save-indicator.show { opacity: 1; }
.menubar {
  flex-shrink: 0; display: flex; align-items: center; height: 27px;
  background: var(--n2); border-bottom: 1px solid var(--b1); padding: 0 5px; gap: 1px;
  position: relative; z-index: 200;
}
.mb-item { padding: 3px 8px; font-size: 12px; color: var(--mu); border-radius: 4px; cursor: pointer; transition: all 0.1s; white-space: nowrap; user-select: none; }
.mb-item:hover, .mb-item.open { background: var(--n4); color: var(--tx); }

/* ── DROPDOWN ── */
.dd-overlay { position: fixed; inset: 0; z-index: 299; }
.dropdown {
  position: fixed; background: #1a1f2c; border: 1px solid rgba(255,255,255,0.13);
  border-radius: 9px; padding: 4px; z-index: 300; min-width: 210px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.6);
  animation: ddIn 0.1s ease;
}
@keyframes ddIn { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:translateY(0); } }
.dd-item { padding: 6px 13px; font-size: 12px; border-radius: 5px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 18px; color: var(--tx); white-space: nowrap; }
.dd-item:hover { background: rgba(255,255,255,0.07); }
.dd-sep { height: 1px; background: rgba(255,255,255,0.07); margin: 3px 6px; }
.dd-key { font-size: 10px; color: var(--mu2); font-family: 'DM Mono', monospace; flex-shrink: 0; }

/* ── NEW PROJECT MODAL ── */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.72);
  z-index: 1000; display: none; align-items: center; justify-content: center;
}
.modal-overlay.show { display: flex; }
.modal-box {
  background: var(--n3); border: 1px solid var(--b2); border-radius: 16px;
  padding: 28px; width: 480px; max-width: 95vw;
  box-shadow: 0 24px 80px rgba(0,0,0,0.5);
}
.modal-title { font-size: 18px; font-weight: 700; margin-bottom: 5px; }
.modal-sub { font-size: 13px; color: var(--mu); margin-bottom: 22px; }
.modal-field { margin-bottom: 14px; }
.modal-field label { display: block; font-size: 10px; font-weight: 700; color: var(--mu); text-transform: uppercase; letter-spacing: 0.7px; margin-bottom: 6px; }
.modal-field input, .modal-field select {
  width: 100%; padding: 9px 11px;
  background: var(--n4); border: 1px solid var(--b2); border-radius: 8px;
  color: var(--tx); font-size: 13px; font-family: 'DM Sans', sans-serif; outline: none;
}
.modal-field input:focus, .modal-field select:focus { border-color: var(--red); }
.modal-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.modal-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.modal-footer .btn-cancel { padding: 8px 18px; border-radius: 8px; font-size: 13px; font-weight: 600; font-family: 'DM Sans', sans-serif; cursor: pointer; background: transparent; border: 1px solid var(--b2); color: var(--mu); }
.modal-footer .btn-cancel:hover { color: var(--tx); }
.modal-footer .btn-create { padding: 8px 18px; border-radius: 8px; font-size: 13px; font-weight: 700; font-family: 'DM Sans', sans-serif; cursor: pointer; background: var(--red); border: none; color: #fff; }
.modal-footer .btn-create:hover { background: var(--red-dk); }

/* ── NOTIFICATION ── */
.notif {
  position: fixed; bottom: 20px; right: 20px;
  background: var(--n3); border: 1px solid var(--b2); border-radius: 10px;
  padding: 10px 15px; font-size: 13px; display: flex; align-items: center; gap: 8px;
  z-index: 2000; transform: translateX(140%); transition: transform 0.3s;
  box-shadow: 0 4px 20px rgba(0,0,0,0.4); max-width: 320px;
}
.notif.show { transform: translateX(0); }
.notif-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }

/* ── CANVAS APP ── */
#cv-app { flex: 1; display: flex; flex-direction: row; overflow: hidden; }
.cv-tools { width: 40px; min-width: 40px; background: var(--n2); border-right: 1px solid var(--b1); display: flex; flex-direction: column; align-items: center; padding: 6px 0; gap: 1px; }
.cv-tool { width: 30px; height: 30px; border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--mu); transition: all 0.12s; }
.cv-tool:hover { background: var(--n4); color: var(--tx); }
.cv-tool.on { background: var(--red-dim); color: var(--red); }
.cv-tool svg { width: 14px; height: 14px; }
.cv-sep { width: 20px; height: 1px; background: var(--b1); margin: 3px 0; }
.cv-mid { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.cv-ctx { flex-shrink: 0; height: 32px; background: var(--n3); border-bottom: 1px solid var(--b1); display: flex; align-items: center; padding: 0 9px; gap: 5px; }
.cx-lbl { font-size: 11px; color: var(--mu2); }
.cx-inp { width: 48px; height: 21px; padding: 0 5px; background: var(--n4); border: 1px solid var(--b1); border-radius: 4px; color: var(--tx); font-size: 11px; font-family: 'DM Mono', monospace; outline: none; }
.cx-inp:focus { border-color: var(--red); }
.cx-btn { padding: 2px 8px; font-size: 11px; background: var(--n4); border: 1px solid var(--b1); border-radius: 4px; color: var(--tx); cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.12s; }
.cx-btn:hover { border-color: var(--b2); }
.cx-div { width: 1px; height: 17px; background: var(--b1); margin: 0 2px; }
.cv-viewport { flex: 1; overflow: hidden; display: flex; align-items: center; justify-content: center; background: repeating-conic-gradient(#212838 0% 25%, #1c2230 0% 50%) 0 0/22px 22px; position: relative; }
.cv-viewport.drag-over { outline: 2px dashed var(--red); outline-offset: -3px; }
.cv-statusbar { flex-shrink: 0; height: 20px; background: var(--n2); border-top: 1px solid var(--b1); display: flex; align-items: center; padding: 0 9px; gap: 12px; }
.cv-stat { font-size: 10px; color: var(--mu2); font-family: 'DM Mono', monospace; }
.cv-stat span { color: var(--mu); }
.cv-rpanel { width: 234px; min-width: 234px; background: var(--n2); border-left: 1px solid var(--b1); display: flex; flex-direction: column; overflow: hidden; }
.panel-tabs { display: flex; border-bottom: 1px solid var(--b1); flex-shrink: 0; }
.ptab { flex: 1; padding: 7px 0; text-align: center; font-size: 11px; font-weight: 500; color: var(--mu2); cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.15s; }
.ptab.on { color: var(--red); border-bottom-color: var(--red); }
.ptab:hover:not(.on) { color: var(--mu); }
.panel-body { flex: 1; overflow-y: auto; }
.psec { padding: 9px 11px; border-bottom: 1px solid var(--b1); }
.psec-label { font-size: 10px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: var(--mu2); margin-bottom: 7px; display: flex; align-items: center; justify-content: space-between; }
.ps-add { background: none; border: none; color: var(--mu2); font-size: 16px; cursor: pointer; line-height: 1; padding: 0 2px; }
.ps-add:hover { color: var(--tx); }
.layer-row { display: flex; align-items: center; gap: 5px; padding: 4px 6px; border-radius: 5px; cursor: pointer; margin-bottom: 2px; transition: all 0.12s; }
.layer-row:hover { background: var(--n4); }
.layer-row.on { background: var(--red-dim); }
.layer-thumb { width: 24px; height: 17px; border-radius: 3px; background: var(--n4); border: 1px solid var(--b1); flex-shrink: 0; }
.layer-name { font-size: 11px; flex: 1; }
.layer-eye { width: 13px; height: 13px; color: var(--mu2); cursor: pointer; }
.prop-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.prop-row label { font-size: 11px; color: var(--mu); }
.prop-row input { width: 64px; height: 20px; padding: 0 4px; background: var(--n4); border: 1px solid var(--b1); border-radius: 4px; color: var(--tx); font-size: 11px; font-family: 'DM Mono', monospace; outline: none; text-align: right; }
.prop-row select { width: 95px; height: 20px; padding: 0 4px; background: var(--n4); border: 1px solid var(--b1); border-radius: 4px; color: var(--tx); font-size: 11px; outline: none; }
.slider-row { margin-bottom: 8px; }
.slider-row .sl-lbl { display: flex; justify-content: space-between; font-size: 11px; color: var(--mu); margin-bottom: 4px; }
.slider-row .sl-lbl span { color: var(--tx); font-family: 'DM Mono', monospace; }
input[type=range] { width: 100%; height: 3px; -webkit-appearance: none; background: var(--n4); border-radius: 2px; outline: none; }
input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 11px; height: 11px; border-radius: 50%; background: var(--red); cursor: pointer; border: 2px solid var(--n2); }
.color-swatches { display: grid; grid-template-columns: repeat(8,1fr); gap: 3px; margin-bottom: 8px; }
.swatch { aspect-ratio: 1; border-radius: 3px; cursor: pointer; border: 1px solid rgba(255,255,255,0.08); transition: transform 0.1s; }
.swatch:hover { transform: scale(1.2); }
.swatch.on { outline: 2px solid var(--tx); outline-offset: 1px; }
.fg-bg-row { display: flex; align-items: flex-end; gap: 5px; margin-bottom: 8px; }
.fg-sw { width: 32px; height: 32px; border-radius: 5px; border: 1px solid var(--b2); cursor: pointer; }
.bg-sw { width: 20px; height: 20px; border-radius: 4px; border: 1px solid var(--b2); cursor: pointer; }

/* ── CUT APP ── */
#cut-app { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.cut-top { display: flex; flex: 1; overflow: hidden; min-height: 0; }
.cut-preview { flex: 1; background: #000; display: flex; flex-direction: column; overflow: hidden; }
.cut-pv-header { flex-shrink: 0; height: 28px; background: var(--n3); border-bottom: 1px solid var(--b1); display: flex; align-items: center; padding: 0 11px; gap: 8px; font-size: 11px; color: var(--mu); }
.cut-screen { flex: 1; display: flex; align-items: center; justify-content: center; position: relative; overflow: hidden; }
.cut-screen video, .cut-screen canvas { max-width: 90%; max-height: 90%; display: block; border: 1px solid var(--b2); }
.pv-play-btn { position: absolute; width: 52px; height: 52px; border-radius: 50%; background: rgba(227,24,55,0.85); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s; }
.pv-play-btn:hover { background: var(--red); transform: scale(1.06); }
.pv-timecode { position: absolute; bottom: 8px; right: 10px; font-size: 11px; font-family: 'DM Mono', monospace; color: rgba(255,255,255,0.6); background: rgba(0,0,0,0.5); padding: 2px 6px; border-radius: 3px; }
.cut-rpanel { width: 256px; min-width: 256px; background: var(--n2); border-left: 1px solid var(--b1); display: flex; flex-direction: column; overflow: hidden; }
.media-dropzone { border: 1.5px dashed rgba(255,255,255,0.15); border-radius: 8px; margin: 9px; padding: 16px 10px; text-align: center; cursor: pointer; transition: all 0.2s; }
.media-dropzone:hover, .media-dropzone.drag-over { border-color: var(--red); background: rgba(227,24,55,0.07); }
.media-dropzone p { font-size: 12px; color: var(--mu); margin-top: 6px; }
.media-dropzone span { font-size: 10px; color: var(--mu2); }
.mbin-item { display: flex; align-items: center; gap: 7px; padding: 5px 9px; border-radius: 6px; cursor: grab; margin-bottom: 2px; transition: background 0.12s; user-select: none; }
.mbin-item:hover { background: var(--n4); }
.mbin-item.sel { background: rgba(227,24,55,0.15); }
.mbin-thumb { width: 32px; height: 22px; border-radius: 3px; background: var(--n4); border: 1px solid var(--b1); flex-shrink: 0; overflow: hidden; display: flex; align-items: center; justify-content: center; font-size: 11px; }
.mbin-thumb img, .mbin-thumb video { width: 100%; height: 100%; object-fit: cover; }
.mbin-name { font-size: 11px; font-weight: 500; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mbin-dur { font-size: 10px; color: var(--mu2); font-family: 'DM Mono', monospace; flex-shrink: 0; }

/* ── TIMELINE ── */
.timeline-shell { flex-shrink: 0; display: flex; flex-direction: column; border-top: 1px solid var(--b1); }
.tl-header { flex-shrink: 0; height: 30px; background: var(--n3); border-bottom: 1px solid var(--b1); display: flex; align-items: center; padding: 0 10px; gap: 6px; }
.tl-ibtn { width: 22px; height: 22px; border-radius: 4px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--mu); background: transparent; border: none; transition: all 0.12s; }
.tl-ibtn:hover { background: var(--n4); color: var(--tx); }
.tl-timecode { font-family: 'DM Mono', monospace; font-size: 11px; color: var(--tx); padding: 2px 7px; background: var(--n4); border: 1px solid var(--b1); border-radius: 4px; }
.tl-body { flex: 1; display: flex; overflow: hidden; min-height: 0; }
.tl-track-labels { flex-shrink: 0; width: 88px; border-right: 1px solid var(--b1); display: flex; flex-direction: column; }
.track-label { height: 30px; display: flex; align-items: center; padding: 0 8px; font-size: 10px; color: var(--mu); border-bottom: 1px solid var(--b1); flex-shrink: 0; }
.tl-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; position: relative; }
.tl-ruler { flex-shrink: 0; height: 18px; background: var(--n4); position: relative; overflow: hidden; border-bottom: 1px solid var(--b1); }
.ruler-mark { position: absolute; top: 0; height: 100%; border-left: 1px solid rgba(255,255,255,0.1); display: flex; align-items: flex-end; padding-bottom: 2px; }
.ruler-mark span { font-size: 9px; font-family: 'DM Mono', monospace; color: var(--mu2); padding-left: 2px; }
.tl-clips-scroll { flex: 1; overflow-x: auto; overflow-y: hidden; position: relative; }
.tl-rows { position: relative; }
.clip-track-row { height: 30px; border-bottom: 1px solid var(--b1); position: relative; overflow: visible; }
.clip-track-row.drag-over { background: rgba(88,166,255,0.07); }
.tl-clip { position: absolute; top: 2px; height: 26px; border-radius: 4px; display: flex; align-items: center; padding: 0 6px; font-size: 10px; font-weight: 500; cursor: grab; white-space: nowrap; overflow: hidden; user-select: none; border: 1px solid rgba(255,255,255,0.1); transition: filter 0.1s, box-shadow 0.1s; }
.tl-clip:hover { filter: brightness(1.2); }
.tl-clip.selected { box-shadow: 0 0 0 2px #fff; }
.tl-clip:active { cursor: grabbing; }
.clip-resize-l, .clip-resize-r { position: absolute; top: 0; bottom: 0; width: 6px; cursor: ew-resize; background: rgba(255,255,255,0.12); }
.clip-resize-l { left: 0; border-radius: 4px 0 0 4px; }
.clip-resize-r { right: 0; border-radius: 0 4px 4px 0; }
.clip-resize-l:hover, .clip-resize-r:hover { background: rgba(255,255,255,0.3); }
.playhead { position: absolute; top: 0; bottom: 0; pointer-events: none; z-index: 20; }
.playhead-line { position: absolute; top: 0; bottom: 0; left: 0; width: 2px; background: var(--red); }
.playhead-head { position: absolute; top: -1px; left: -5px; width: 12px; height: 12px; background: var(--red); clip-path: polygon(0 0, 100% 0, 50% 100%); }

/* ── MOTION APP ── */
#ae-app { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.ae-top { display: flex; flex: 1; overflow: hidden; min-height: 0; }
.ae-comp-panel { flex: 1; background: #060810; display: flex; flex-direction: column; overflow: hidden; }
.ae-comp-header { flex-shrink: 0; height: 28px; background: var(--n3); border-bottom: 1px solid var(--b1); display: flex; align-items: center; padding: 0 10px; gap: 8px; font-size: 11px; color: var(--mu); }
.ae-view { flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; position: relative; }
.ae-canvas-wrap { background: #000; border: 1px solid var(--b2); }
.ae-canvas-wrap canvas { display: block; }
.ae-rpanel { width: 224px; min-width: 224px; background: var(--n2); border-left: 1px solid var(--b1); display: flex; flex-direction: column; overflow: hidden; }
.ae-tabs { display: flex; border-bottom: 1px solid var(--b1); }
.ae-tab { flex: 1; padding: 6px 0; text-align: center; font-size: 10px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: var(--mu2); cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.12s; }
.ae-tab.on { color: var(--red); border-bottom-color: var(--red); }
.ae-effect-list { flex: 1; overflow-y: auto; padding: 5px; }
.ae-effect-item { padding: 6px 9px; border-radius: 5px; cursor: pointer; margin-bottom: 1px; display: flex; align-items: center; gap: 6px; transition: all 0.12s; }
.ae-effect-item:hover { background: var(--n4); }
.ae-effect-item.on { background: var(--red-dim); }
.ae-effect-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.ae-timeline { flex-shrink: 0; display: flex; flex-direction: column; border-top: 1px solid var(--b1); }
.ae-tl-header { flex-shrink: 0; height: 28px; background: var(--n3); border-bottom: 1px solid var(--b1); display: flex; align-items: center; padding: 0 10px; gap: 5px; font-size: 11px; color: var(--mu); }
.ae-tl-body { flex: 1; display: flex; overflow-y: auto; min-height: 0; }
.ae-layers-col { width: 178px; min-width: 178px; border-right: 1px solid var(--b1); }
.ae-layer-row { height: 26px; border-bottom: 1px solid var(--b1); display: flex; align-items: center; padding: 0 7px; gap: 5px; font-size: 11px; cursor: pointer; transition: all 0.12s; }
.ae-layer-row:hover { background: var(--n3); }
.ae-layer-row.on { background: var(--red-dim); }
.ae-layer-color { width: 9px; height: 9px; border-radius: 2px; flex-shrink: 0; }
.ae-layer-name { flex: 1; color: var(--tx); }
.ae-layer-type { font-size: 9px; color: var(--mu2); }
.ae-kf-area { flex: 1; overflow-x: auto; position: relative; }
.ae-kf-row { height: 26px; border-bottom: 1px solid var(--b1); position: relative; }
.ae-kf { position: absolute; top: 50%; transform: translateY(-50%) rotate(45deg); width: 9px; height: 9px; background: var(--amb); cursor: pointer; transition: transform 0.1s; }
.ae-kf:hover { transform: translateY(-50%) rotate(45deg) scale(1.3); }
.ae-kf.on { background: #fff; }
.ae-playhead { position: absolute; top: 0; bottom: 0; pointer-events: none; z-index: 20; }
.ae-playhead-line { position: absolute; top: 0; bottom: 0; left: 0; width: 1px; background: var(--red); }
