
// ── TIMELINE SNAPPING ─────────────────────────────────────────
window._snapEnabled = true;
const SNAP_PX = 15; // magnetic pull radius in pixels

// Returns snapped time (seconds) if within SNAP_PX, else null
// dragPx: current drag position in pixels
// excludeClipIdx: clip being dragged (skip its own edges)
// edgeType: 'start' or 'end' — which edge of the dragged clip
window.getSnapPoint = function(dragPx, excludeClipIdx, edgeType){
  if(!window._snapEnabled) return null;
  const PPS = window.PPS || 60;
  const S   = window.S;
  if(!S?.cut) return null;

  // Rebuild cache when excludeClipIdx or PPS changes (zoom invalidates pixel positions)
  if(!window._snapCache || window._snapCache.excludeIdx !== excludeClipIdx || window._snapCache.pps !== PPS){
    const pts = [];
    pts.push({ px: 0, label: 'start' });
    pts.push({ px: S.cut.ph * PPS, label: 'playhead' });
    S.cut.clips.forEach((c, i) => {
      if(i === excludeClipIdx) return;
      pts.push({ px: c.start * PPS,           label: 'clip start' });
      pts.push({ px: (c.start+c.dur) * PPS,   label: 'clip end'   });
    });
    // Add overlay start/end points as snap anchors
    (window._overlays||[]).forEach(o => {
      pts.push({ px: (o.startTime||0) * PPS, label: 'overlay start' });
      pts.push({ px: (o.endTime||0)   * PPS, label: 'overlay end'   });
    });
    // Sort ascending so binary search works
    pts.sort((a,b)=>a.px-b.px);
    window._snapCache = { excludeIdx: excludeClipIdx, pps: PPS, pts };
  }

  // Binary search: find closest point
  const pts = window._snapCache.pts;
  let lo=0, hi=pts.length-1, closest=null, minDist=SNAP_PX+1, snapLabel='';
  while(lo<=hi){
    const mid=(lo+hi)>>1;
    const d=Math.abs(pts[mid].px-dragPx);
    if(d<minDist){ minDist=d; closest=pts[mid].px; snapLabel=pts[mid].label; }
    if(pts[mid].px<dragPx) lo=mid+1; else hi=mid-1;
  }
  // Also check neighbours (binary search may miss adjacent equal-distance points)
  [lo, hi, lo-1, hi+1].forEach(k=>{
    if(k<0||k>=pts.length) return;
    const d=Math.abs(pts[k].px-dragPx);
    if(d<minDist){ minDist=d; closest=pts[k].px; snapLabel=pts[k].label; }
  });

  if(closest!==null){
    window._lastSnapLabel = snapLabel;
    return closest / PPS;
  }
  return null;
};

// Invalidate snap cache when timeline changes
window._invalidateSnapCache = function(){ window._snapCache = null; };

// Show snap indicator — bright cyan vertical line spanning full timeline height
window.showSnapLine = function(timeSec){
  const scroll = document.getElementById('tl-scroll');
  if(!scroll) return;
  let line = document.getElementById('tl-snap-line');
  if(!line){
    line = document.createElement('div');
    line.id = 'tl-snap-line';
    line.style.cssText = [
      'position:absolute',
      'top:0',
      'bottom:0',
      'width:2px',
      'background:rgba(0,255,220,0.9)',
      'pointer-events:none',
      'z-index:60',
      'box-shadow:0 0 6px rgba(0,255,220,0.8), 0 0 12px rgba(0,255,220,0.4)',
      'display:none',
      'transition:left 0.03s linear',
    ].join(';');
    scroll.style.position = 'relative'; // needed for absolute child
    scroll.appendChild(line);
  }
  const px = Math.round(timeSec * (window.PPS || 60));
  line.style.left    = px + 'px';
  line.style.display = 'block';
};

window.hideSnapLine = function(){
  const line = document.getElementById('tl-snap-line');
  if(line) line.style.display = 'none';
};

// Snap helper for trim handles (returns snapped time or original)
window.snapOrOriginal = function(timeSec, excludeClipIdx){
  const px = timeSec * (window.PPS || 60);
  const snapped = window.getSnapPoint(px, excludeClipIdx);
  if(snapped !== null){
    window.showSnapLine(snapped);
    return snapped;
  }
  window.hideSnapLine();
  return timeSec;
};
// ═══════════════════════════════════════════════════════════════════
// CUT FEATURES MODULE
// Freeze, Text Overlays, Image/BG replacement, Shapes, Sport Patterns,
// Scale/Rotation, Audio FX, Effects/Transitions with duration control
// ═══════════════════════════════════════════════════════════════════

// ── OVERLAY SYSTEM ──
// All overlays (text, shapes, freeze, images) stored as:
// { id, type, track (visual only), startTime, endTime, ...typeSpecificProps }
if(!window._overlays) window._overlays = [];
if(!window._overlayIdCounter) window._overlayIdCounter = 0;

function newOverlayId(){ return 'ov_'+(++window._overlayIdCounter); }

// ── FEATURE 1: FREEZE FRAME ──
function showFreezeDialog(){
  const ph = S.cut.ph;
  const modal = createModal('Freeze Frame', `
    <div style="margin-bottom:14px">
      <label class="modal-field-label">Freeze starts at</label>
      <div style="display:flex;align-items:center;gap:8px">
        <input id="frz-start" type="number" step="0.1" value="${ph.toFixed(2)}" style="${inputStyle()}">
        <button onclick="document.getElementById('frz-start').value=S.cut.ph.toFixed(2)" style="${smallBtnStyle()}">Use Playhead</button>
      </div>
    </div>
    <div style="margin-bottom:14px">
      <label class="modal-field-label">Freeze ends at</label>
      <div style="display:flex;align-items:center;gap:8px">
        <input id="frz-end" type="number" step="0.1" value="${(ph+2).toFixed(2)}" style="${inputStyle()}">
        <button onclick="document.getElementById('frz-end').value=S.cut.ph.toFixed(2)" style="${smallBtnStyle()}">Use Playhead</button>
      </div>
    </div>
    <div style="margin-bottom:14px">
      <label class="modal-field-label">What to freeze</label>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:var(--tx)">
          <input type="radio" name="frz-mode" value="both" checked style="accent-color:#E8590C"> Video &amp; Audio (freeze everything)
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:var(--tx)">
          <input type="radio" name="frz-mode" value="video"> Video only (audio keeps playing)
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:var(--tx)">
          <input type="radio" name="frz-mode" value="audio"> Audio only (video keeps playing)
        </label>
      </div>
    </div>
    <div style="font-size:11px;color:var(--mu);background:rgba(88,166,255,0.08);border-radius:6px;padding:8px">
      💡 Move playhead to start position → click "Use Playhead", then move to end → click "Use Playhead" again
    </div>
  `, ()=>{
    const start = parseFloat(document.getElementById('frz-start').value);
    const end = parseFloat(document.getElementById('frz-end').value);
    const freezeMode = document.querySelector('input[name="frz-mode"]:checked')?.value || 'both';
    if(isNaN(start)||isNaN(end)||end<=start){ notify('Invalid time range','#E31837'); return; }
    // Find video frame at freeze start
    const clip = S.cut.clips.find(c=>c.type==='video'&&start>=c.start&&start<c.start+c.dur);
    if(!clip){ notify('No video at freeze start time','#E31837'); return; }
    const freezeFileTime = (clip.fileStart||0) + (start - clip.start);
    const ovId = newOverlayId();
    
    // Capture the freeze frame by seeking a hidden video to the exact time
    const captureVid = document.createElement('video');
    captureVid.src = S.cut.media[clip.mediaIdx].url;
    captureVid.muted = true;
    captureVid.style.display = 'none';
    document.body.appendChild(captureVid);
    
    const doCapture = () => {
      const fc = document.createElement('canvas');
      fc.width = 1920; fc.height = 1080;
      try { fc.getContext('2d').drawImage(captureVid, 0, 0, fc.width, fc.height); } catch(e){}
      // Convert to image for fast drawing
      const img = new Image();
      img.src = fc.toDataURL('image/jpeg', 0.92);
      if(window.cutSaveHistory) cutSaveHistory('add_overlay');
      window._overlays.push({
        id: ovId, type:'freeze',
        track: (window.S?.cut?.videoTracks||2)-1,
        startTime: start, endTime: end,
        clipMediaIdx: clip.mediaIdx, freezeFileTime,
        freezeMode: freezeMode || 'both',
        _img: img
      });
      document.body.removeChild(captureVid);
      notify('Freeze frame captured: '+start.toFixed(1)+'s → '+end.toFixed(1)+'s ✓','#4dabf7');
      renderOverlayTimeline();
    };

    captureVid.addEventListener('seeked', doCapture, {once:true});
    captureVid.addEventListener('error', ()=>{
      document.body.removeChild(captureVid);
      notify('Could not capture frame','#E31837');
    }, {once:true});
    
    // Start loading and seek
    captureVid.load();
    captureVid.addEventListener('loadeddata', ()=>{
      captureVid.currentTime = freezeFileTime;
    }, {once:true});
    
    notify('Capturing freeze frame...','#4dabf7');
    closeModal();
  });
}

function showFreezeEditDialog(id){
  const ov = window._overlays.find(o=>o.id===id);
  if(!ov) return;
  const modal = createModal('Edit Freeze Frame', `
    <div style="margin-bottom:14px">
      <label class="modal-field-label">Freeze starts at (s)</label>
      <div style="display:flex;align-items:center;gap:8px">
        <input id="frz-start" type="number" step="0.1" value="${ov.startTime.toFixed(2)}" style="${inputStyle()}">
        <button onclick="document.getElementById('frz-start').value=S.cut.ph.toFixed(2)" style="${smallBtnStyle()}">Use Playhead</button>
      </div>
    </div>
    <div style="margin-bottom:14px">
      <label class="modal-field-label">Freeze ends at (s)</label>
      <div style="display:flex;align-items:center;gap:8px">
        <input id="frz-end" type="number" step="0.1" value="${ov.endTime.toFixed(2)}" style="${inputStyle()}">
        <button onclick="document.getElementById('frz-end').value=S.cut.ph.toFixed(2)" style="${smallBtnStyle()}">Use Playhead</button>
      </div>
    </div>
    <div style="margin-bottom:14px">
      <label class="modal-field-label">What to freeze</label>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:var(--tx)">
          <input type="radio" name="frz-mode" value="both" ${(ov.freezeMode||'both')==='both'?'checked':''} style="accent-color:#E8590C"> Video &amp; Audio
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:var(--tx)">
          <input type="radio" name="frz-mode" value="video" ${ov.freezeMode==='video'?'checked':''} style="accent-color:#E8590C"> Video only
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:var(--tx)">
          <input type="radio" name="frz-mode" value="audio" ${ov.freezeMode==='audio'?'checked':''} style="accent-color:#E8590C"> Audio only
        </label>
      </div>
    </div>
    <div style="margin-bottom:14px">
      <label class="modal-field-label">Re-capture frame at new time?</label>
      <div style="display:flex;align-items:center;gap:8px">
        <input id="frz-recapture" type="number" step="0.1" value="${ov.freezeFileTime.toFixed(2)}" style="${inputStyle()}">
        <button onclick="document.getElementById('frz-recapture').value=S.cut.ph.toFixed(2)" style="${smallBtnStyle()}">Use Playhead</button>
      </div>
      <div style="font-size:11px;color:var(--mu);margin-top:4px">Leave unchanged to keep current frozen frame</div>
    </div>
    ${ov._img ? `<div style="margin-bottom:10px"><img src="${ov._img.src}" style="width:100%;border-radius:6px;border:1px solid rgba(255,255,255,0.1)"></div>` : ''}
  `, ()=>{
    const start = parseFloat(document.getElementById('frz-start').value);
    const end = parseFloat(document.getElementById('frz-end').value);
    const newCapTime = parseFloat(document.getElementById('frz-recapture').value);
    ov.freezeMode = document.querySelector('input[name="frz-mode"]:checked')?.value || 'both';
    if(isNaN(start)||isNaN(end)||end<=start){ notify('Invalid time range','#E31837'); return; }
    
    ov.startTime = start;
    ov.endTime = end;
    
    // Re-capture if time changed
    if(Math.abs(newCapTime - ov.freezeFileTime) > 0.05){
      const clip = S.cut.clips.find(c=>c.type==='video'&&c.mediaIdx===ov.clipMediaIdx);
      if(clip){
        const captureVid = document.createElement('video');
        captureVid.src = S.cut.media[clip.mediaIdx].url;
        captureVid.muted = true;
        captureVid.style.display = 'none';
        document.body.appendChild(captureVid);
        captureVid.addEventListener('seeked', ()=>{
          const fc = document.createElement('canvas');
          fc.width=1920; fc.height=1080;
          try{ fc.getContext('2d').drawImage(captureVid,0,0,fc.width,fc.height); }catch(e){}
          const img = new Image();
          img.src = fc.toDataURL('image/jpeg', 0.92);
          ov._img = img;
          ov.freezeFileTime = newCapTime;
          document.body.removeChild(captureVid);
          renderOverlayTimeline();
          notify('Freeze frame updated ✓','#4dabf7');
        },{once:true});
        captureVid.load();
        captureVid.addEventListener('loadeddata', ()=>{ captureVid.currentTime=newCapTime; },{once:true});
      }
    } else {
      notify('Freeze frame timing updated ✓','#4dabf7');
    }
    renderOverlayTimeline();
    closeModal();
  });
}

// ── FEATURE 2: TEXT OVERLAYS ──
const TEXT_EFFECTS = [
  {id:'none', label:'Static'},
  {id:'typewriter', label:'Typewriter'},
  {id:'fadein', label:'Fade In'},
  {id:'fadeout', label:'Fade Out'},
  {id:'slideup', label:'Slide Up'},
  {id:'slidedown', label:'Slide Down'},
  {id:'slideleft', label:'Slide Left'},
  {id:'slideright', label:'Slide Right'},
  {id:'wordbyw', label:'Word by Word'},
  {id:'zoom', label:'Zoom In'},
  {id:'handwrite', label:'Handwritten'},
  {id:'bounce', label:'Bounce'},
  {id:'glitch', label:'Glitch'},
];

function showTextDialog(editId){
  const existing = editId ? window._overlays.find(o=>o.id===editId) : null;
  const ph = S.cut.ph;
  const modal = createModal('Add Text Overlay', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      <div>
        <label class="modal-field-label">Start Time (s)</label>
        <div style="display:flex;gap:6px">
          <input id="txt-start" type="number" step="0.1" value="${existing?existing.startTime.toFixed(2):ph.toFixed(2)}" style="${inputStyle()}">
          <button onclick="document.getElementById('txt-start').value=S.cut.ph.toFixed(2)" style="${smallBtnStyle()}">⏱</button>
        </div>
      </div>
      <div>
        <label class="modal-field-label">End Time (s)</label>
        <div style="display:flex;gap:6px">
          <input id="txt-end" type="number" step="0.1" value="${existing?existing.endTime.toFixed(2):(ph+3).toFixed(2)}" style="${inputStyle()}">
          <button onclick="document.getElementById('txt-end').value=S.cut.ph.toFixed(2)" style="${smallBtnStyle()}">⏱</button>
        </div>
      </div>
    </div>
    <div style="margin-bottom:12px">
      <label class="modal-field-label">Text Content</label>
      <textarea id="txt-content" rows="2" style="${inputStyle()};resize:vertical">${existing?existing.text:''}</textarea>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px">
      <div>
        <label class="modal-field-label">Font</label>
        <select id="txt-font" style="${inputStyle()}">
          ${['DM Sans','Arial','Georgia','Impact','Courier New','Times New Roman','Verdana','Trebuchet MS','Futura','Bebas Neue'].map(f=>`<option value="${f}"${(existing?.font||'DM Sans')===f?' selected':''}>${f}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="modal-field-label">Size (px)</label>
        <input id="txt-size" type="number" value="${existing?.size||48}" min="10" max="300" style="${inputStyle()}">
      </div>
      <div>
        <label class="modal-field-label">Color</label>
        <input id="txt-color" type="color" value="${existing?.color||'#ffffff'}" style="${inputStyle()};padding:4px;height:36px">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <div>
        <label class="modal-field-label">Animation Effect</label>
        <select id="txt-effect" style="${inputStyle()}">
          ${TEXT_EFFECTS.map(e=>`<option value="${e.id}"${(existing?.effect||'none')===e.id?' selected':''}>${e.label}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="modal-field-label">Position</label>
        <select id="txt-pos" style="${inputStyle()}">
          ${['center','top','bottom','top-left','top-right','bottom-left','bottom-right'].map(p=>`<option value="${p}"${(existing?.position||'center')===p?' selected':''}>${p}</option>`).join('')}
        </select>
      </div>
    </div>
    <div style="margin-bottom:12px">
      <label class="modal-field-label">Text Background</label>
      <select id="txt-bg" style="${inputStyle()}">
        <option value="none">None</option>
        <option value="black">Black box</option>
        <option value="white">White box</option>
        <option value="semi">Semi-transparent</option>
      </select>
    </div>
    <div style="margin-bottom:12px">
      <label class="modal-field-label">Stroke / Outline Color</label>
      <div style="display:flex;gap:8px;align-items:center">
        <input id="txt-stroke" type="color" value="${existing?.stroke||'#000000'}" style="${inputStyle()};padding:4px;height:36px;width:60px">
        <input id="txt-stroke-w" type="number" value="${existing?.strokeW||2}" min="0" max="20" style="${inputStyle()};width:80px" placeholder="Width">
      </div>
    </div>
  `, ()=>{
    const start=parseFloat(document.getElementById('txt-start').value);
    const end=parseFloat(document.getElementById('txt-end').value);
    const text=document.getElementById('txt-content').value.trim();
    if(!text||isNaN(start)||isNaN(end)||end<=start){notify('Fill all fields correctly','#E31837');return;}
    const ov = {
      track: (window.S?.cut?.videoTracks||2)-1,
      id: editId||newOverlayId(), type:'text',
      startTime:start, endTime:end,
      text, font:document.getElementById('txt-font').value,
      size:parseInt(document.getElementById('txt-size').value)||48,
      color:document.getElementById('txt-color').value,
      effect:document.getElementById('txt-effect').value,
      position:document.getElementById('txt-pos').value,
      bg:document.getElementById('txt-bg').value,
      stroke:document.getElementById('txt-stroke').value,
      strokeW:parseInt(document.getElementById('txt-stroke-w').value)||0,
    };
    if(editId){
      if(window.cutSaveHistory) cutSaveHistory('edit_overlay');
      const i=window._overlays.findIndex(o=>o.id===editId);
      if(i>=0) window._overlays[i]=ov;
    } else {
      if(window.cutSaveHistory) cutSaveHistory('add_overlay');
      window._overlays.push(ov);
    }
    notify('Text overlay '+(editId?'updated':'added'),'#3fb950');
    closeModal();
    renderOverlayTimeline();
  });
}

// ── FEATURE 3: IMAGE / BACKGROUND REPLACEMENT ──
function showImageBgDialog(){
  const ph = S.cut.ph;
  const modal = createModal('Image / Background Overlay', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      <div>
        <label class="modal-field-label">Start Time (s)</label>
        <div style="display:flex;gap:6px">
          <input id="img-start" type="number" step="0.1" value="${ph.toFixed(2)}" style="${inputStyle()}">
          <button onclick="document.getElementById('img-start').value=S.cut.ph.toFixed(2)" style="${smallBtnStyle()}">⏱</button>
        </div>
      </div>
      <div>
        <label class="modal-field-label">End Time (s)</label>
        <div style="display:flex;gap:6px">
          <input id="img-end" type="number" step="0.1" value="${(ph+3).toFixed(2)}" style="${inputStyle()}">
          <button onclick="document.getElementById('img-end').value=S.cut.ph.toFixed(2)" style="${smallBtnStyle()}">⏱</button>
        </div>
      </div>
    </div>
    <div style="margin-bottom:14px">
      <label class="modal-field-label">Type</label>
      <select id="img-type" onchange="toggleImgType()" style="${inputStyle()}">
        <option value="image">Image File</option>
        <option value="color">Solid Color</option>
        <option value="gradient">Gradient</option>
      </select>
    </div>
    <div id="img-file-row" style="margin-bottom:14px">
      <label class="modal-field-label">Image File</label>
      <input type="file" id="img-file" accept="image/*" style="${inputStyle()}">
      <div style="margin-top:10px;font-size:11px;color:var(--mu,#8b949e)">After adding, click the overlay in the strip to drag & resize it on the video</div>
    </div>
    <div id="img-color-row" style="display:none;margin-bottom:14px">
      <label class="modal-field-label">Background Color</label>
      <input type="color" id="img-color" value="#000000" style="${inputStyle()};padding:4px;height:36px">
    </div>
    <div id="img-grad-row" style="display:none;margin-bottom:14px;display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div><label class="modal-field-label">Color 1</label><input type="color" id="img-grad1" value="#E31837" style="${inputStyle()};padding:4px;height:36px"></div>
      <div><label class="modal-field-label">Color 2</label><input type="color" id="img-grad2" value="#0a0c10" style="${inputStyle()};padding:4px;height:36px"></div>
    </div>
  `, ()=>{
    const start=parseFloat(document.getElementById('img-start').value);
    const end=parseFloat(document.getElementById('img-end').value);
    const type=document.getElementById('img-type').value;
    if(isNaN(start)||isNaN(end)||end<=start){notify('Invalid time range','#E31837');return;}
    // Default: full screen for color/gradient, half-size for image
    const _defW = type==='image' ? 0.5 : 1.0;
    const _defH = type==='image' ? 0.5 : 1.0;
    const ov={id:newOverlayId(),type:'image_bg',track:(window.S?.cut?.videoTracks||2)-1,startTime:start,endTime:end,bgType:type,
      x:0.5,y:0.5,w:_defW,h:_defH,rotation:0};
    if(type==='image'){
      const file=document.getElementById('img-file').files[0];
      if(!file){notify('Select an image file','#E31837');return;}
      ov.url=URL.createObjectURL(file);
      ov.name=file.name;
    } else if(type==='color'){
      ov.color=document.getElementById('img-color').value;
    } else {
      ov.grad1=document.getElementById('img-grad1').value;
      ov.grad2=document.getElementById('img-grad2').value;
    }
    if(window.cutSaveHistory) cutSaveHistory('add_overlay');
    window._overlays.push(ov);
    if(window.cutSaveHistory) cutSaveHistory();
    notify('Background overlay added','#3fb950');
    closeModal();
    renderOverlayTimeline();
  });
}
window.toggleImgType=function(){
  const t=document.getElementById('img-type').value;
  document.getElementById('img-file-row').style.display=t==='image'?'block':'none';
  document.getElementById('img-color-row').style.display=t==='color'?'block':'none';
  document.getElementById('img-grad-row').style.display=t==='gradient'?'grid':'none';
};

// ── FEATURE 6+7: SHAPES & SPORT PATTERNS ──
const SHAPES = [
  {id:'circle',label:'Circle ●'},
  {id:'rect',label:'Rectangle ▬'},
  {id:'triangle',label:'Triangle ▲'},
  {id:'arrow',label:'Arrow →'},
  {id:'spotlight',label:'Spotlight ☀'},
  {id:'line',label:'Line —'},
  {id:'dashed',label:'Dashed Line'},
  {id:'polygon',label:'Polygon'},
  {id:'star',label:'Star ★'},
  {id:'cross',label:'Cross +'},
  // Sport patterns
  {id:'field_zone',label:'⚽ Field Zone'},
  {id:'player_marker',label:'⚽ Player Marker'},
  {id:'movement_arrow',label:'⚽ Movement Arrow'},
  {id:'formation_lines',label:'⚽ Formation Lines'},
  {id:'heatmap',label:'⚽ Heat Map'},
  {id:'offside_line',label:'⚽ Offside Line'},
  {id:'distance_ruler',label:'📏 Distance Ruler'},
  {id:'angle_arc',label:'📐 Angle Arc'},
];

function showShapeDialog(){
  const ph = S.cut.ph;
  const modal = createModal('Add Shape / Pattern', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      <div>
        <label class="modal-field-label">Start Time (s)</label>
        <div style="display:flex;gap:6px">
          <input id="shp-start" type="number" step="0.1" value="${ph.toFixed(2)}" style="${inputStyle()}">
          <button onclick="document.getElementById('shp-start').value=S.cut.ph.toFixed(2)" style="${smallBtnStyle()}">⏱</button>
        </div>
      </div>
      <div>
        <label class="modal-field-label">End Time (s)</label>
        <div style="display:flex;gap:6px">
          <input id="shp-end" type="number" step="0.1" value="${(ph+3).toFixed(2)}" style="${inputStyle()}">
          <button onclick="document.getElementById('shp-end').value=S.cut.ph.toFixed(2)" style="${smallBtnStyle()}">⏱</button>
        </div>
      </div>
    </div>
    <div style="margin-bottom:12px">
      <label class="modal-field-label">Shape Type</label>
      <select id="shp-type" style="${inputStyle()}">
        ${SHAPES.map(s=>`<option value="${s.id}">${s.label}</option>`).join('')}
      </select>
    </div>
    <div style="margin-bottom:12px">
      <label class="modal-field-label">Fill Mode</label>
      <div style="display:flex;gap:10px;align-items:center">
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--tx,#f0f2f5);cursor:pointer">
          <input type="radio" name="shp-fill-mode" id="shp-fill-yes" value="fill" checked style="accent-color:#E31837"> Filled
        </label>
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--tx,#f0f2f5);cursor:pointer">
          <input type="radio" name="shp-fill-mode" id="shp-fill-no" value="outline" style="accent-color:#E31837"> Outline Only
        </label>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:12px">
      <div>
        <label class="modal-field-label">Fill Color</label>
        <input type="color" id="shp-color" value="#E31837" style="${inputStyle()};padding:4px;height:36px">
      </div>
      <div>
        <label class="modal-field-label">Outline Color</label>
        <input type="color" id="shp-stroke-color" value="#E31837" style="${inputStyle()};padding:4px;height:36px">
      </div>
      <div>
        <label class="modal-field-label">Opacity %</label>
        <input id="shp-opacity" type="number" value="80" min="0" max="100" style="${inputStyle()}">
      </div>
      <div>
        <label class="modal-field-label">Outline Width</label>
        <input id="shp-stroke" type="number" value="2" min="0" max="20" style="${inputStyle()}">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:12px">
      <div><label class="modal-field-label">X %</label><input id="shp-x" type="number" value="50" min="0" max="100" style="${inputStyle()}"></div>
      <div><label class="modal-field-label">Y %</label><input id="shp-y" type="number" value="50" min="0" max="100" style="${inputStyle()}"></div>
      <div><label class="modal-field-label">Width %</label><input id="shp-w" type="number" value="20" min="1" max="100" style="${inputStyle()}"></div>
      <div><label class="modal-field-label">Height %</label><input id="shp-h" type="number" value="20" min="1" max="100" style="${inputStyle()}"></div>
    </div>
    <div style="margin-bottom:12px">
      <label class="modal-field-label">Label Text (optional)</label>
      <input id="shp-label" type="text" placeholder="e.g. Zone A, Player 7..." style="${inputStyle()}">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <div>
        <label class="modal-field-label">Animation</label>
        <select id="shp-anim" style="${inputStyle()}">
          <option value="none">Static</option>
          <option value="pulse">Pulse</option>
          <option value="fadein">Fade In</option>
          <option value="draw">Draw In</option>
          <option value="blink">Blink</option>
        </select>
      </div>
      <div>
        <label class="modal-field-label">Rotation (°)</label>
        <input id="shp-rotation" type="range" min="-180" max="180" value="0" oninput="this.nextElementSibling.textContent=this.value+'°'" style="width:100%;margin-top:8px">
        <span style="font-size:12px;color:var(--tx,#f0f2f5)">0°</span>
      </div>
    </div>
  `, ()=>{
    const start=parseFloat(document.getElementById('shp-start').value);
    const end=parseFloat(document.getElementById('shp-end').value);
    if(isNaN(start)||isNaN(end)||end<=start){notify('Invalid time range','#E31837');return;}
    const fillMode = document.querySelector('input[name="shp-fill-mode"]:checked')?.value || 'fill';
    if(window.cutSaveHistory) cutSaveHistory('add_overlay');
    window._overlays.push({
      id:newOverlayId(), type:'shape',
      track: (window.S?.cut?.videoTracks||2)-1,
      startTime:start, endTime:end,
      shape:document.getElementById('shp-type').value,
      color:document.getElementById('shp-color').value,
      strokeColor:document.getElementById('shp-stroke-color').value,
      fillMode,
      opacity:parseInt(document.getElementById('shp-opacity').value)/100,
      strokeW:parseInt(document.getElementById('shp-stroke').value),
      x:parseInt(document.getElementById('shp-x').value)/100,
      y:parseInt(document.getElementById('shp-y').value)/100,
      w:parseInt(document.getElementById('shp-w').value)/100,
      h:parseInt(document.getElementById('shp-h').value)/100,
      label:document.getElementById('shp-label').value,
      anim:document.getElementById('shp-anim').value,
      rotation:parseInt(document.getElementById('shp-rotation').value)||0,
    });
    notify('Shape added','#3fb950');
    closeModal();
    renderOverlayTimeline();
  });
}

// ── FEATURE 8+9: SCALE & ROTATION ──
function showTransformDialog(ci){
  const clip = S.cut.clips[ci];
  if(!clip){notify('Select a clip first','#E31837');return;}
  const t = clip.transform||{scaleX:100,scaleY:100,rotation:0,x:0,y:0};
  const modal = createModal('Scale & Rotation — '+clip.name, `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      <div>
        <label class="modal-field-label">Scale Width %</label>
        <input id="tr-sx" type="range" min="0" max="500" value="${t.scaleX}" oninput="this.nextElementSibling.textContent=this.value+'%'">
        <span style="font-size:12px;color:var(--tx)">${t.scaleX}%</span>
      </div>
      <div>
        <label class="modal-field-label">Scale Height %</label>
        <input id="tr-sy" type="range" min="0" max="500" value="${t.scaleY}" oninput="this.nextElementSibling.textContent=this.value+'%'">
        <span style="font-size:12px;color:var(--tx)">${t.scaleY}%</span>
      </div>
    </div>
    <div style="margin-bottom:14px">
      <label class="modal-field-label">Rotation (degrees)</label>
      <input id="tr-rot" type="range" min="-180" max="180" value="${t.rotation}" oninput="this.nextElementSibling.textContent=this.value+'°'">
      <span style="font-size:12px;color:var(--tx)">${t.rotation}°</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      <div>
        <label class="modal-field-label">Position X (offset %)</label>
        <input id="tr-x" type="range" min="-50" max="50" value="${t.x}" oninput="this.nextElementSibling.textContent=this.value+'%'">
        <span style="font-size:12px;color:var(--tx)">${t.x}%</span>
      </div>
      <div>
        <label class="modal-field-label">Position Y (offset %)</label>
        <input id="tr-y" type="range" min="-50" max="50" value="${t.y}" oninput="this.nextElementSibling.textContent=this.value+'%'">
        <span style="font-size:12px;color:var(--tx)">${t.y}%</span>
      </div>
    </div>
    <div style="font-size:11px;color:var(--mu);padding:8px;background:rgba(255,255,255,0.04);border-radius:6px">
      Changes apply to this clip. Use 100% / 0° to reset.
    </div>
  `, ()=>{
    S.cut.clips[ci].transform = {
      scaleX: parseInt(document.getElementById('tr-sx').value),
      scaleY: parseInt(document.getElementById('tr-sy').value),
      rotation: parseInt(document.getElementById('tr-rot').value),
      x: parseInt(document.getElementById('tr-x').value),
      y: parseInt(document.getElementById('tr-y').value),
    };
    notify('Transform applied to '+clip.name,'#3fb950');
    closeModal();
    scheduleSave();
  });
}

// ── AUDIO ENHANCEMENT DIALOG (per-clip) ──────────────────
// Exposed as both showAudioEnhanceDialog (called from props/context menu)
// and showAudioFxDialog (legacy alias)
function showAudioEnhanceDialog(ci){
  const c = S.cut.clips[ci];
  if(!c){ notify('Select an audio clip first','#E31837'); return; }

  // Init per-clip audio FX state if not present
  if(!c.audioFx) c.audioFx = {
    bass:0, treble:0, mid:0, noiseReduction:0,
    preset:'none', volume: Math.round((c.volume||1)*100)
  };
  const fx = c.audioFx;

  const slRow = (id, label, min, max, val, unit) => {
    const u = unit||'';
    return '<div style="margin-bottom:14px">'
      + '<label style="display:flex;justify-content:space-between;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#6e6e73;margin-bottom:6px">'
      + label + ' <span id="' + id + '-v" style="color:#f0f2f5;font-weight:600">' + val + u + '</span></label>'
      + '<input id="' + id + '" type="range" min="' + min + '" max="' + max + '" value="' + val + '" style="width:100%;accent-color:#E8590C"'
      + ' oninput="document.getElementById(&quot;' + id + '-v&quot;).textContent=this.value+&quot;' + u + '&quot;">'
      + '</div>';
  };

  const iS = 'width:100%;padding:8px 10px;background:#0f0f0f;border:0.5px solid rgba(255,255,255,0.12);border-radius:8px;color:#f0f2f5;font-family:DM Sans,sans-serif;font-size:13px;box-sizing:border-box;outline:none';

  createModal('🎵 Audio Enhancement — ' + c.name.substring(0,20), `
    <div style="font-family:'DM Sans',sans-serif">
      ${slRow('afx-vol',  'Volume',           0, 200, fx.volume||100, '%')}
      ${slRow('afx-bass', 'Bass Boost (dB)',  -20, 20, fx.bass||0,   'dB')}
      ${slRow('afx-mid',  'Mid Boost (dB)',   -20, 20, fx.mid||0,    'dB')}
      ${slRow('afx-treble','Treble Boost (dB)',-20,20, fx.treble||0, 'dB')}
      ${slRow('afx-nr',   'Noise Reduction',  0, 100, fx.noiseReduction||0, '%')}
      <div style="margin-bottom:14px">
        <label style="display:block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#6e6e73;margin-bottom:6px">Voice Preset</label>
        <select id="afx-preset" style="${iS}">
          ${['none','podcast','deep','bright','radio','stadium']
            .map(p=>'<option value="'+p+'"'+(fx.preset===p?' selected':'')+'>'+{none:'None',podcast:'Podcast Voice',deep:'Deep Voice',bright:'Bright / Clear',radio:'Radio Voice',stadium:'Stadium Echo'}[p]+'</option>').join('')}
        </select>
      </div>
    </div>
  `, () => {
    // Save per-clip FX state
    c.audioFx = {
      volume:         parseInt(document.getElementById('afx-vol').value),
      bass:           parseInt(document.getElementById('afx-bass').value),
      mid:            parseInt(document.getElementById('afx-mid').value),
      treble:         parseInt(document.getElementById('afx-treble').value),
      noiseReduction: parseInt(document.getElementById('afx-nr').value),
      preset:         document.getElementById('afx-preset').value,
    };
    // Also sync volume back to clip.volume (used by fade/gain engine)
    c.volume = c.audioFx.volume / 100;

    // Apply preset if selected
    if(c.audioFx.preset !== 'none') applyAudioPreset(c);

    // Apply EQ via Web Audio
    applyAudioFxForClip(ci);

    // ── Two-way sync: update props panel immediately ──
    if(window.updatePropsPanel && S.cut.sel === ci) window.updatePropsPanel(ci);
    if(window.renderCutTimeline) window.renderCutTimeline(); // refresh gain line

    if(window.cutSaveHistory) window.cutSaveHistory('audio_fx');
    if(window.scheduleSave) window.scheduleSave();
    notify('Audio FX applied to ' + c.name.substring(0,16), '#3fb950');
  });
}
window.showAudioEnhanceDialog = showAudioEnhanceDialog;
// Legacy alias
window.showAudioFxDialog = showAudioEnhanceDialog;

// Apply voice preset macros to EQ values
function applyAudioPreset(c){
  const presets = {
    podcast:  {bass:3,  mid:2,  treble:2,  noiseReduction:30},
    deep:     {bass:8,  mid:-2, treble:-4, noiseReduction:0},
    bright:   {bass:-2, mid:0,  treble:6,  noiseReduction:0},
    radio:    {bass:-4, mid:6,  treble:4,  noiseReduction:20},
    stadium:  {bass:5,  mid:-5, treble:3,  noiseReduction:0},
  };
  const p = presets[c.audioFx.preset];
  if(p) Object.assign(c.audioFx, p);
}

// Apply Web Audio EQ for a specific clip
function applyAudioFxForClip(ci){
  const c = S.cut.clips[ci];
  if(!c?.audioFx) return;
  const fx = c.audioFx;
  const mv = document.getElementById('cut-main-vid');
  if(!mv) return;

  // Volume applied directly
  mv.volume = Math.min(1, Math.max(0, (fx.volume||100)/100));

  // EQ via Web Audio API
  if(!window._audioCtxFx){
    try{
      const ctx = new(window.AudioContext||window.webkitAudioContext)();
      const src = ctx.createMediaElementSource(mv);
      const gainN = ctx.createGain();
      const bass = ctx.createBiquadFilter(); bass.type='lowshelf';  bass.frequency.value=200;
      const mid  = ctx.createBiquadFilter(); mid.type='peaking';    mid.frequency.value=1000; mid.Q.value=1;
      const treble = ctx.createBiquadFilter(); treble.type='highshelf'; treble.frequency.value=3000;
      src.connect(bass); bass.connect(mid); mid.connect(treble); treble.connect(gainN); gainN.connect(ctx.destination);
      window._audioCtxFx = {ctx, src, gainN, bass, mid, treble};
      ctx.resume().catch(()=>{});
    }catch(e){ return; }
  } else {
    if(window._audioCtxFx.ctx.state==='suspended') window._audioCtxFx.ctx.resume().catch(()=>{});
  }
  if(window._audioCtxFx){
    window._audioCtxFx.bass.gain.value   = fx.bass   || 0;
    window._audioCtxFx.mid.gain.value    = fx.mid    || 0;
    window._audioCtxFx.treble.gain.value = fx.treble || 0;
    window._audioCtxFx.gainN.gain.value  = (fx.volume||100) / 100;
  }
}
window.applyAudioFxForClip = applyAudioFxForClip;

// Legacy global FX (still applies to current selected clip)
function showAudioFxDialog(){
  const ci = S.cut.sel;
  showAudioEnhanceDialog(ci !== null && ci !== undefined ? ci : 0);
}

function applyAudioFx(){
  const fx = S.cut._audioFx;
  if(!fx) return;
  const mv = document.getElementById('cut-main-vid');
  if(!mv) return;
  // Volume
  mv.volume = Math.min(2, Math.max(0, fx.volume/100));
  // Web Audio for EQ (if not already set up)
  if(!window._audioCtxFx){
    try{
      const ctx = new (window.AudioContext||window.webkitAudioContext)();
      const src = ctx.createMediaElementSource(mv);
      const gain = ctx.createGain();
      const bass = ctx.createBiquadFilter(); bass.type='lowshelf'; bass.frequency.value=200;
      const treble = ctx.createBiquadFilter(); treble.type='highshelf'; treble.frequency.value=3000;
      const mid = ctx.createBiquadFilter(); mid.type='peaking'; mid.frequency.value=1000; mid.Q.value=1;
      src.connect(bass); bass.connect(mid); mid.connect(treble); treble.connect(gain); gain.connect(ctx.destination);
      window._audioCtxFx = {ctx,src,gain,bass,treble,mid};
      // Resume context immediately (needs user gesture — call it here since we are in one)
      ctx.resume().catch(()=>{});
    }catch(e){ console.warn('AudioFX setup failed:',e); }
  } else {
    // Resume if suspended
    if(window._audioCtxFx.ctx.state==='suspended') window._audioCtxFx.ctx.resume().catch(()=>{});
  }
  if(window._audioCtxFx){
    window._audioCtxFx.bass.gain.value = fx.bass||0;
    window._audioCtxFx.treble.gain.value = fx.treble||0;
    // Presets
    const presets = {
      podcast:{bass:2,treble:3,mid:4},
      deep:{bass:8,treble:-3,mid:-2},
      bright:{bass:-2,treble:6,mid:2},
      radio:{bass:-4,treble:4,mid:6},
      stadium:{bass:4,treble:1,mid:-2},
    };
    const p = presets[fx.preset];
    if(p){
      window._audioCtxFx.bass.gain.value=p.bass;
      window._audioCtxFx.treble.gain.value=p.treble;
      window._audioCtxFx.mid.gain.value=p.mid;
    }
  }
}

// ── OVERLAY RENDERING ENGINE ──
// ── Overlay transition engine ──
// Returns {alpha, scaleX, scaleY, tx, ty} given overlay + current time
function computeOverlayTransition(ov, currentTime, W, H){
  const dur      = ov.endTime - ov.startTime;
  const elapsed  = currentTime - ov.startTime;
  const remaining = ov.endTime - currentTime;

  const inDur  = Math.min(ov.inDuration  || 0, dur * 0.5);
  const outDur = Math.min(ov.outDuration || 0, dur * 0.5);
  const inMode  = ov.inTransition  || 'none';
  const outMode = ov.outTransition || 'none';

  let alpha=1, scaleX=1, scaleY=1, tx=0, ty=0, blurPx=0;

  // IN transition
  if(inMode !== 'none' && inDur > 0 && elapsed < inDur){
    const p = elapsed / inDur; // 0→1
    if(inMode==='fadein')  alpha = p;
    else if(inMode==='zoomin'){ alpha=p; scaleX=scaleY=0.6+0.4*p; }
    else if(inMode==='slideleft'){ tx = -(1-p); }   // fraction of W
    else if(inMode==='slideright'){ tx = (1-p); }
    else if(inMode==='slideup'){ ty = -(1-p); }
    else if(inMode==='slidedown'){ ty = (1-p); }
    else if(inMode==='blur'){ blurPx = (1-p)*16; alpha=p; }
    else if(inMode==='wipe'){ alpha = p; } // simple for overlays
    else if(inMode==='dissolve'){ alpha = p; }
  }

  // OUT transition
  if(outMode !== 'none' && outDur > 0 && remaining < outDur){
    const p = remaining / outDur; // 1→0
    if(outMode==='fadeout') alpha = Math.min(alpha, p);
    else if(outMode==='zoomout'){ alpha=Math.min(alpha,p); scaleX=scaleY=Math.min(scaleX,0.6+0.4*p); }
    else if(outMode==='slideleft'){ tx = -(1-p); }
    else if(outMode==='slideright'){ tx = (1-p); }
    else if(outMode==='slideup'){ ty = -(1-p); }
    else if(outMode==='slidedown'){ ty = (1-p); }
    else if(outMode==='blur'){ blurPx = Math.max(blurPx,(1-p)*16); alpha=Math.min(alpha,p); }
    else if(outMode==='dissolve'){ alpha=Math.min(alpha,p); }
  }

  return {alpha, scaleX, scaleY, tx: tx*W, ty: ty*H, blurPx};
}
window.computeOverlayTransition = computeOverlayTransition;

function renderOverlaysOnCanvas(ctx, W, H, currentTime, playedFreezes){
  if(!window._overlays || !window._overlays.length) return;
  const overlays = window._overlays
    .filter(o=>currentTime>=o.startTime&&currentTime<o.endTime&&!(o.type==='freeze'&&playedFreezes&&playedFreezes.has(o.id)))
    .sort((a,b)=>{
      const tDiff=(a.track||0)-(b.track||0);
      if(tDiff!==0) return tDiff; // lower track first (underneath), higher track painted last (on top)
      // stable: same track keeps insertion order
      return (window._overlays.indexOf(a))-(window._overlays.indexOf(b));
    });
  if(!overlays.length) return;

  overlays.forEach(ov=>{
    const progress = (currentTime-ov.startTime)/(ov.endTime-ov.startTime);
    const tr = computeOverlayTransition(ov, currentTime, W, H);

    // Skip invisible overlays early (saves all drawing work)
    if(tr.alpha < 0.01) return;

    ctx.save();
    // Apply transition transforms
    // Only set filter if blur is needed (ctx.filter is expensive even when set to 'none')
    if(tr.blurPx > 1) ctx.filter = 'blur('+Math.round(tr.blurPx)+'px)';
    if(tr.tx !== 0 || tr.ty !== 0) ctx.translate(tr.tx, tr.ty);
    if(tr.scaleX !== 1 || tr.scaleY !== 1){
      const cx=(ov.x||0.5)*W, cy=(ov.y||0.5)*H;
      ctx.translate(cx,cy); ctx.scale(tr.scaleX,tr.scaleY); ctx.translate(-cx,-cy);
    }
    ctx.globalAlpha = Math.max(0, Math.min(1, tr.alpha));
    if(ov.type==='freeze'){
      // Freeze: draw captured frame ON TOP of video (no clearRect — preserve video layer)
      if(ov._img && ov._img.complete){
        ctx.globalAlpha = 1;
        ctx.drawImage(ov._img, 0, 0, W, H);
      } else if(!ov._img){
        // Frame not captured yet — show translucent overlay with message
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#fff';
        ctx.font = '20px DM Sans,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Capturing freeze frame...', W/2, H/2);
      }
    } else if(ov.type==='text'){
      renderTextOverlay(ctx,W,H,ov,progress);
    } else if(ov.type==='image_bg'){
      renderImageBg(ctx,W,H,ov,progress);
    } else if(ov.type==='shape'){
      renderShape(ctx,W,H,ov,progress);
    }
    ctx.restore();
    // Always reset filter and alpha after each overlay (prevent bleed-through)
    if(ctx.filter !== 'none') ctx.filter = 'none';
    ctx.globalAlpha = 1;
  });
}

// Draw a single overlay — used by the unified global sort render loop in syncCutVid
// so overlays can be interleaved with clips by track order
function renderSingleOverlayOnCanvas(ctx, W, H, currentTime, ov, playedFreezes){
  if(!ov) return;
  if(currentTime < ov.startTime || currentTime >= ov.endTime) return;
  if(ov.type==='freeze' && playedFreezes && playedFreezes.has(ov.id)) return;
  const progress = (currentTime - ov.startTime) / (ov.endTime - ov.startTime);
  const tr = computeOverlayTransition(ov, currentTime, W, H);
  if(tr.alpha < 0.01) return;
  ctx.save();
  if(tr.blurPx > 1) ctx.filter = 'blur('+Math.round(tr.blurPx)+'px)';
  if(tr.tx !== 0 || tr.ty !== 0) ctx.translate(tr.tx, tr.ty);
  if(tr.scaleX !== 1 || tr.scaleY !== 1){
    const cx=(ov.x||0.5)*W, cy=(ov.y||0.5)*H;
    ctx.translate(cx,cy); ctx.scale(tr.scaleX,tr.scaleY); ctx.translate(-cx,-cy);
  }
  ctx.globalAlpha = Math.max(0, Math.min(1, tr.alpha));
  if(ov.type==='freeze'){
    if(ov._img && ov._img.complete){ ctx.globalAlpha=1; ctx.drawImage(ov._img,0,0,W,H); }
    else if(!ov._img){
      ctx.globalAlpha=1; ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(0,0,W,H);
      ctx.fillStyle='#fff'; ctx.font='20px DM Sans,sans-serif';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('Capturing freeze frame...',W/2,H/2);
    }
  } else if(ov.type==='text'){ renderTextOverlay(ctx,W,H,ov,progress); }
  else if(ov.type==='image_bg'){ renderImageBg(ctx,W,H,ov,progress); }
  else if(ov.type==='shape'){ renderShape(ctx,W,H,ov,progress); }
  ctx.restore();
  if(ctx.filter !== 'none') ctx.filter = 'none';
  ctx.globalAlpha = 1;
}
window.renderSingleOverlayOnCanvas = renderSingleOverlayOnCanvas;

// Offscreen cache for text overlays — reuse if nothing changed
const _textRenderCache = new Map();

function renderTextOverlay(ctx,W,H,ov,progress){
  const size=ov.size||48;
  ctx.font=`bold ${size}px "${ov.font||'DM Sans'}",sans-serif`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  // Position
  // Use dragged x/y if set, otherwise use position preset
  let bx, by;
  if(ov.x !== undefined && ov.y !== undefined){
    bx = ov.x * W;
    by = ov.y * H;
  } else {
    const positions={center:[W/2,H/2],'top':[W/2,H*0.12],'bottom':[W/2,H*0.88],
      'top-left':[W*0.15,H*0.1],'top-right':[W*0.85,H*0.1],
      'bottom-left':[W*0.15,H*0.9],'bottom-right':[W*0.85,H*0.9]};
    [bx,by]=positions[ov.position]||[W/2,H/2];
  }
  // Animation
  let alpha=1,tx=bx,ty=by,scale=1;
  const e=ov.effect||'none';
  if(e==='fadein') alpha=Math.min(1,progress*3);
  else if(e==='fadeout') alpha=Math.max(0,1-progress*3);
  else if(e==='slideup'){ty=by+(1-Math.min(1,progress*2))*80;alpha=Math.min(1,progress*3);}
  else if(e==='slidedown'){ty=by-(1-Math.min(1,progress*2))*80;alpha=Math.min(1,progress*3);}
  else if(e==='slideleft'){tx=bx+(1-Math.min(1,progress*2))*120;alpha=Math.min(1,progress*3);}
  else if(e==='slideright'){tx=bx-(1-Math.min(1,progress*2))*120;alpha=Math.min(1,progress*3);}
  else if(e==='zoom'){scale=0.3+Math.min(1,progress*2)*0.7;alpha=Math.min(1,progress*2);}
  else if(e==='bounce'){const b=Math.abs(Math.sin(progress*Math.PI*4));ty=by-b*20;}
  else if(e==='glitch'){tx=bx+(Math.random()-0.5)*8*(1-progress);ty=by+(Math.random()-0.5)*4*(1-progress);}

  ctx.globalAlpha=alpha;
  ctx.save();
  ctx.translate(tx,ty);
  if(scale!==1) ctx.scale(scale,scale);

  let displayText=ov.text;
  if(e==='typewriter'){
    const chars=Math.floor(ov.text.length*Math.min(1,progress*1.5));
    displayText=ov.text.substring(0,chars);
  } else if(e==='wordbyw'){
    const words=ov.text.split(' ');
    const count=Math.ceil(words.length*Math.min(1,progress*1.5));
    displayText=words.slice(0,count).join(' ');
  } else if(e==='handwrite'){
    const chars=Math.floor(ov.text.length*Math.min(1,progress*1.2));
    displayText=ov.text.substring(0,chars)+'|';
    ctx.font=`italic bold ${size}px "Courier New",monospace`;
  }

  // Background box
  const metrics=ctx.measureText(displayText);
  const tw=metrics.width;
  const th=size*1.3;
  if(ov.bg==='black'){ctx.fillStyle='rgba(0,0,0,0.85)';ctx.fillRect(-tw/2-12,-th/2,tw+24,th+8);}
  else if(ov.bg==='white'){ctx.fillStyle='rgba(255,255,255,0.9)';ctx.fillRect(-tw/2-12,-th/2,tw+24,th+8);}
  else if(ov.bg==='semi'){ctx.fillStyle='rgba(0,0,0,0.5)';ctx.fillRect(-tw/2-12,-th/2,tw+24,th+8);}

  // Stroke/outline
  if(ov.strokeW>0){ctx.strokeStyle=ov.stroke||'#000';ctx.lineWidth=ov.strokeW;ctx.strokeText(displayText,0,0);}
  ctx.fillStyle=ov.color||'#fff';
  ctx.fillText(displayText,0,0);
  ctx.restore();
  ctx.globalAlpha=1;
}

function renderImageBg(ctx,W,H,ov,progress){
  // All bg types use x,y,w,h bounding box (normalized 0-1)
  const _bx=(ov.x!==undefined?(ov.x-ov.w/2)*W:0);
  const _by=(ov.y!==undefined?(ov.y-ov.h/2)*H:0);
  const _bw=(ov.w!==undefined?ov.w*W:W);
  const _bh=(ov.h!==undefined?ov.h*H:H);
  const _rot=(ov.rotation||0)*Math.PI/180;
  if(ov.bgType==='color'){
    ctx.save();
    if(_rot){ctx.translate(_bx+_bw/2,_by+_bh/2);ctx.rotate(_rot);ctx.fillStyle=ov.color||'#000';ctx.fillRect(-_bw/2,-_bh/2,_bw,_bh);}
    else{ctx.fillStyle=ov.color||'#000';ctx.fillRect(_bx,_by,_bw,_bh);}
    ctx.restore();
  } else if(ov.bgType==='gradient'){
    ctx.save();
    if(_rot){ctx.translate(_bx+_bw/2,_by+_bh/2);ctx.rotate(_rot);const g=ctx.createLinearGradient(0,-_bh/2,0,_bh/2);g.addColorStop(0,ov.grad1||'#E31837');g.addColorStop(1,ov.grad2||'#0a0c10');ctx.fillStyle=g;ctx.fillRect(-_bw/2,-_bh/2,_bw,_bh);}
    else{const g=ctx.createLinearGradient(_bx,_by,_bx,_by+_bh);g.addColorStop(0,ov.grad1||'#E31837');g.addColorStop(1,ov.grad2||'#0a0c10');ctx.fillStyle=g;ctx.fillRect(_bx,_by,_bw,_bh);}
    ctx.restore();
  } else if(ov.bgType==='image'&&ov.url){
    if(!ov._img){ov._img=new Image();ov._img.src=ov.url;}
    if(ov._img.complete){
      try{
        ctx.save();
        if(_rot){ ctx.translate(_bx+_bw/2,_by+_bh/2); ctx.rotate(_rot); ctx.drawImage(ov._img,-_bw/2,-_bh/2,_bw,_bh); }
        else { ctx.drawImage(ov._img,_bx,_by,_bw,_bh); }
        ctx.restore();
      }catch(e){}
    }
  }
}

function renderShape(ctx,W,H,ov,progress){
  const x=ov.x*W, y=ov.y*H, w=ov.w*W, h=ov.h*H;
  const alpha=ov.anim==='fadein'?Math.min(1,progress*3):
              ov.anim==='blink'?(Math.sin(progress*Math.PI*8)>0?1:0):1;
  const pulse=ov.anim==='pulse'?1+Math.sin(progress*Math.PI*4)*0.1:1;
  const _drawMode = ov.anim==='draw';
  const drawProg  = _drawMode ? Math.min(1, progress*1.5) : 1;
  ctx.globalAlpha=(ov.opacity||0.8)*alpha;
  const fillMode=ov.fillMode||'fill';
  ctx.fillStyle=(_drawMode||fillMode==='outline')?'transparent':(ov.color||'#E31837');
  ctx.strokeStyle=ov.strokeColor||ov.color||'#E31837';
  ctx.lineWidth=Math.max(1,ov.strokeW||(_drawMode?3:2));
  ctx.save();
  ctx.translate(x,y);
  if(ov.rotation) ctx.rotate(ov.rotation * Math.PI / 180);
  ctx.scale(pulse,pulse);
  const s=ov.shape;
  const doFill=()=>{if(!_drawMode && fillMode!=='outline')ctx.fill();};
  const doStroke=()=>{if(ov.strokeW||fillMode==='outline'||_drawMode){ctx.lineWidth=Math.max(1,ov.strokeW||(_drawMode?3:(fillMode==='outline'?3:2)));ctx.stroke();}};
  // Draw-animation helper: use dash-offset to animate stroke progressively
  const _setDrawDash=(perim)=>{ if(_drawMode){ ctx.setLineDash([perim*drawProg, perim]); ctx.lineDashOffset=0; } };
  const _clrDash=()=>ctx.setLineDash([]);
  if(s==='circle'){
    const perim=Math.PI*(w/2+h/2); // approximate ellipse perimeter
    _setDrawDash(perim);
    ctx.beginPath();ctx.ellipse(0,0,w/2,h/2,0,0,Math.PI*2);
    doFill();doStroke();_clrDash();
  }
  else if(s==='rect'){
    const perim=2*(w+h);
    _setDrawDash(perim);
    ctx.beginPath();ctx.rect(-w/2,-h/2,w,h);
    doFill();doStroke();_clrDash();
  }
  else if(s==='triangle'){
    const perim=w+h+Math.sqrt(w*w+h*h);
    _setDrawDash(perim);
    ctx.beginPath();ctx.moveTo(0,-h/2);ctx.lineTo(w/2,h/2);ctx.lineTo(-w/2,h/2);ctx.closePath();
    doFill();doStroke();_clrDash();
  }
  else if(s==='arrow'){
    ctx.lineWidth=Math.max(3,ov.strokeW||4);
    ctx.beginPath();ctx.moveTo(-w/2,0);ctx.lineTo(w/2,0);ctx.stroke();
    ctx.beginPath();ctx.moveTo(w/2-12,-10);ctx.lineTo(w/2,0);ctx.lineTo(w/2-12,10);ctx.stroke();
  }
  else if(s==='spotlight'){
    const g=ctx.createRadialGradient(0,0,0,0,0,w/2);
    g.addColorStop(0,'rgba(255,255,200,0.6)');g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(0,0,w/2,h/2,0,0,Math.PI*2);ctx.fill();
  }
  else if(s==='line'||s==='dashed'){
    ctx.lineWidth=Math.max(2,ov.strokeW||3);
    if(s==='dashed') ctx.setLineDash([15,8]);
    ctx.beginPath();ctx.moveTo(-w/2,0);ctx.lineTo(w/2,0);ctx.stroke();
    ctx.setLineDash([]);
  }
  else if(s==='star'){
    const perim=10*(w/2+w/4)/2*2;
    _setDrawDash(perim);
    ctx.beginPath();
    for(let i=0;i<10;i++){
      const r=i%2===0?w/2:w/4;const a=Math.PI/5*i-Math.PI/2;
      ctx[i===0?'moveTo':'lineTo'](Math.cos(a)*r,Math.sin(a)*r);
    }
    ctx.closePath();doFill();doStroke();_clrDash();
  }
  else if(s==='cross'){
    ctx.lineWidth=Math.max(4,ov.strokeW||6);
    ctx.beginPath();ctx.moveTo(-w/2,0);ctx.lineTo(w/2,0);ctx.stroke();
    ctx.beginPath();ctx.moveTo(0,-h/2);ctx.lineTo(0,h/2);ctx.stroke();
  }
  // Sport patterns
  else if(s==='field_zone'){
    ctx.globalAlpha=(ov.opacity||0.4)*alpha;
    ctx.fillStyle=ov.color||'rgba(88,166,255,0.3)';
    ctx.fillRect(-w/2,-h/2,w,h);
    ctx.globalAlpha=(ov.opacity||0.9)*alpha;
    ctx.strokeRect(-w/2,-h/2,w,h);
  }
  else if(s==='player_marker'){
    ctx.beginPath();ctx.arc(0,-h/4,w/4,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(0,h/2);ctx.lineWidth=3;ctx.stroke();
  }
  else if(s==='movement_arrow'){
    ctx.lineWidth=4;
    const drawW=ov.anim==='draw'?w*Math.min(1,progress*2):w;
    ctx.beginPath();ctx.moveTo(-drawW/2,0);ctx.lineTo(drawW/2,0);ctx.stroke();
    if(drawW>20){ctx.beginPath();ctx.moveTo(drawW/2-15,-12);ctx.lineTo(drawW/2,0);ctx.lineTo(drawW/2-15,12);ctx.stroke();}
  }
  else if(s==='formation_lines'){
    ctx.lineWidth=2;ctx.setLineDash([8,4]);
    for(let i=1;i<4;i++){ctx.beginPath();ctx.moveTo(-w/2,(-h/2)+(h/4)*i);ctx.lineTo(w/2,(-h/2)+(h/4)*i);ctx.stroke();}
    ctx.setLineDash([]);
  }
  else if(s==='offside_line'){
    ctx.lineWidth=3;ctx.strokeStyle='#ff0';
    ctx.setLineDash([]);
    ctx.beginPath();ctx.moveTo(0,-h/2);ctx.lineTo(0,h/2);ctx.stroke();
    ctx.fillStyle='#ff0';ctx.font=`bold 14px sans-serif`;ctx.textAlign='center';
    ctx.fillText('OFFSIDE',-20,-h/2-8);
  }
  else if(s==='heatmap'){
    for(let i=0;i<6;i++){
      const g=ctx.createRadialGradient(0,0,0,0,0,w/2-i*8);
      const colors=['rgba(255,0,0,0.4)','rgba(255,100,0,0.3)','rgba(255,200,0,0.2)'];
      g.addColorStop(0,colors[i%3]);g.addColorStop(1,'transparent');
      ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(0,0,w/2-i*8,h/2-i*6,0,0,Math.PI*2);ctx.fill();
    }
  }
  else if(s==='distance_ruler'){
    ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(-w/2,0);ctx.lineTo(w/2,0);ctx.stroke();
    for(let i=0;i<=5;i++){const rx=-w/2+i*(w/5);ctx.beginPath();ctx.moveTo(rx,-8);ctx.lineTo(rx,8);ctx.stroke();}
    ctx.font=`12px sans-serif`;ctx.textAlign='center';ctx.fillText(ov.label||'10m',0,-14);
  }
  else if(s==='angle_arc'){
    ctx.beginPath();ctx.arc(0,h/4,w/3,-(Math.PI*0.7),-(Math.PI*0.3));ctx.stroke();
    ctx.font=`14px sans-serif`;ctx.textAlign='center';ctx.fillText(ov.label||'45°',0,h/4-w/3-10);
  }
  // Label
  if(ov.label&&!['distance_ruler','angle_arc','offside_line'].includes(s)){
    ctx.restore();ctx.save();ctx.translate(x,y);
    ctx.globalAlpha=(ov.opacity||0.9)*alpha;
    ctx.font=`bold 14px sans-serif`;ctx.textAlign='center';ctx.fillStyle='#fff';
    ctx.strokeStyle='#000';ctx.lineWidth=3;
    ctx.strokeText(ov.label,0,h/2+18);ctx.fillText(ov.label,0,h/2+18);
  }
  ctx.restore();
  ctx.globalAlpha=1;
}

// ── OVERLAY CLIPS ON TIMELINE ──
// Overlays render as coloured clips directly on V1 track row,
// above the video clips, so they can be dragged/trimmed/repositioned.
const OVERLAY_COLORS = {text:'rgba(88,166,255,0.75)', shape:'rgba(227,24,55,0.75)', freeze:'rgba(77,171,247,0.75)', image_bg:'rgba(63,185,80,0.75)'};
const OVERLAY_ICONS  = {text:'T', shape:'◆', freeze:'❄', image_bg:'🖼'};
// Helper to get icon/label for image_bg subtypes
function getOverlayIcon(ov){ return ov.type==='image_bg' ? (ov.bgType==='image'?'🖼':ov.bgType==='color'?'🎨':'🌈') : OVERLAY_ICONS[ov.type]||'?'; }
function getOverlayLabel(ov){
  if(ov.type==='text') return (ov.text||'text').substring(0,12);
  if(ov.type==='shape') return ov.shape||'shape';
  if(ov.type==='freeze') return 'freeze';
  if(ov.type==='image_bg') return ov.bgType==='image'?(ov.name||'image').substring(0,10):ov.bgType==='color'?'color bg':'gradient';
  return 'overlay';
}
const OVERLAY_TRACK  = 0; // legacy constant — overlays now default to highest video track (foreground)

function renderOverlayTimeline(){
  // Remove old overlay-strip if it exists (legacy)
  const old = document.getElementById('overlay-strip');
  if(old) old.remove();

  // Remove all existing overlay clip elements from timeline
  document.querySelectorAll('.tl-overlay-clip').forEach(el=>el.remove());

  if(!window._overlays || !window._overlays.length) return;

  const getPPS = () => window.PPS || 60;
  const PPS = getPPS();
  const _S = window.S;
  const _videoTracks = _S?.cut?.videoTracks || 1;

  window._overlays.forEach(ov => {
    if(ov.track === undefined || ov.track === null) ov.track = 0;
    // Clamp only for DOM row display — do NOT mutate ov.track, preserve the real value
    const displayTrack = Math.max(0, Math.min(_videoTracks - 1, ov.track));
    const row = document.getElementById('tl-row-' + displayTrack);
    if(!row) return;
    // per-overlay block
    const color = OVERLAY_COLORS[ov.type] || 'rgba(128,128,128,0.7)';
    const isActive = _activeEditId === ov.id;
    // label computed by getOverlayLabel(ov)

    const el = document.createElement('div');
    const _isMultiSel = window._selectedOverlays?.has(ov.id);
    el.className = 'tl-overlay-clip tl-clip' + (_isMultiSel ? ' selected' : '');
    el.dataset.ovId = ov.id;
    el.style.cssText = [
      `left:${Math.round(ov.startTime * PPS)}px`,
      `width:${Math.max(4, Math.round((ov.endTime - ov.startTime) * PPS))}px`,
      `top:2px`,
      `height:26px`,
      `background:${color}`,
      `border:${isActive ? '2px solid #fff' : '1px solid rgba(255,255,255,0.3)'}`,
      `border-radius:5px`,
      `position:absolute`,
      `z-index:3`,
      `cursor:pointer`,
      `display:flex`,
      `align-items:center`,
      `padding:0 6px`,
      `gap:4px`,
      `font-size:10px`,
      `font-weight:600`,
      `color:#fff`,
      `white-space:nowrap`,
      `overflow:hidden`,
      `user-select:none`,
      `box-shadow:0 1px 4px rgba(0,0,0,0.4)`,
      `box-sizing:border-box`,
    ].join(';');
    el.title = 'Click: select | Double-click: edit | Drag: move | Drag edge: trim | Right-click: delete';

    // Icon + label
    el.innerHTML = `<span style="opacity:0.9">${getOverlayIcon(ov)}</span><span style="overflow:hidden;text-overflow:ellipsis">${getOverlayLabel(ov)}</span><span style="margin-left:auto;font-size:8px;opacity:0.5;flex-shrink:0">V${(ov.track||0)+1}</span>`;

    // In transition bar (left edge, semi-transparent teal)
    if(ov.inTransition && ov.inTransition !== 'none' && ov.inDuration > 0){
      const inBar = document.createElement('div');
      const inW = Math.round(ov.inDuration * PPS);
      inBar.style.cssText = `position:absolute;left:0;top:0;bottom:0;width:${inW}px;background:rgba(0,220,200,0.35);border-right:1px solid rgba(0,220,200,0.8);border-radius:5px 0 0 5px;pointer-events:none;z-index:4`;
      inBar.title = 'In: '+ov.inTransition+' ('+ov.inDuration.toFixed(1)+'s)';
      el.appendChild(inBar);
    }
    // Out transition bar (right edge, semi-transparent purple)
    if(ov.outTransition && ov.outTransition !== 'none' && ov.outDuration > 0){
      const outBar = document.createElement('div');
      const outW = Math.round(ov.outDuration * PPS);
      outBar.style.cssText = `position:absolute;right:0;top:0;bottom:0;width:${outW}px;background:rgba(200,100,255,0.35);border-left:1px solid rgba(200,100,255,0.8);border-radius:0 5px 5px 0;pointer-events:none;z-index:4`;
      outBar.title = 'Out: '+ov.outTransition+' ('+ov.outDuration.toFixed(1)+'s)';
      el.appendChild(outBar);
    }

    // Left trim handle
    const lh = document.createElement('div');
    lh.style.cssText = 'position:absolute;left:0;top:0;bottom:0;width:6px;cursor:w-resize;background:rgba(255,255,255,0.2);border-radius:5px 0 0 5px;z-index:2';
    el.appendChild(lh);

    // Right trim handle
    const rh = document.createElement('div');
    rh.style.cssText = 'position:absolute;right:0;top:0;bottom:0;width:6px;cursor:e-resize;background:rgba(255,255,255,0.2);border-radius:0 5px 5px 0;z-index:2';
    el.appendChild(rh);

    // ── DRAG TO MOVE ──
    el.addEventListener('mousedown', e => {
      if(e.button !== 0) return;
      const target = e.target;
      const isLeftTrim  = target === lh;
      const isRightTrim = target === rh;
      e.preventDefault(); e.stopPropagation();

      // Select this overlay — update visual inline WITHOUT re-rendering
      // (re-render would remove the element we're currently dragging)
      setActiveEditId(ov.id);
      // Highlight visually
      document.querySelectorAll('.tl-overlay-clip').forEach(c => {
        c.style.border = c.dataset.ovId === ov.id
          ? '2px solid #fff'
          : '1px solid rgba(255,255,255,0.3)';
      });
      // Update properties panel
      if(window.updateOverlayProps) updateOverlayProps(ov.id);
      // Seek playhead to overlay start if not already there
      if(window.S && S.cut.ph < ov.startTime || S.cut.ph >= ov.endTime){
        S.cut.ph = ov.startTime + 0.01;
        if(window.updateCutPH) updateCutPH();
      }

      const startX    = e.clientX;
      const origStart = ov.startTime;
      const origEnd   = ov.endTime;
      // Reset drag origin for all selected overlays so each drag starts from current position
      (window._overlays||[]).forEach(o => { delete o._dragOrigStart; });
      let moved = false;

      // ── ALT + DRAG: duplicate overlay ──
      let dupOv = null;
      let targetEl = el;
      if(e.altKey && !isLeftTrim && !isRightTrim){
        // Clone the overlay
        const {_img, ...rest} = ov;
        dupOv = JSON.parse(JSON.stringify(rest));
        dupOv.id = 'ov_' + Date.now() + '_dup';
        window._overlays.push(dupOv);
        if(window.cutSaveHistory) cutSaveHistory('alt_dup_overlay');
        // Dim original
        el.style.opacity = '0.4';
        // Render to create new element
        renderOverlayTimeline();
        // Find new element
        targetEl = document.querySelector('[data-ov-id="'+dupOv.id+'"]') || el;
        document.body.style.cursor = 'copy';
      }

      const startY_ov = e.clientY;
      const origTrack_ov = ov.track || 0;
      const onMove = mv => {
        moved = true;
        const _curPPS = getPPS();
        const dx = (mv.clientX - startX) / _curPPS;
        const dy = mv.clientY - startY_ov;
        const workOv = dupOv || ov;
        if(isLeftTrim && !dupOv){
          let _ns = Math.max(0, Math.min(origStart + dx, origEnd - 0.1));
          const _ss = window.getSnapPoint ? window.getSnapPoint(_ns*_curPPS,-1,'start') : null;
          if(_ss!==null){_ns=_ss;window.showSnapLine&&window.showSnapLine(_ss);}
          else{window.hideSnapLine&&window.hideSnapLine();}
          workOv.startTime = _ns;
        } else if(isRightTrim && !dupOv){
          let _ne = Math.max(origEnd + dx, origStart + 0.1);
          const _se = window.getSnapPoint ? window.getSnapPoint(_ne*_curPPS,-1,'end') : null;
          if(_se!==null){_ne=_se;window.showSnapLine&&window.showSnapLine(_se);}
          else{window.hideSnapLine&&window.hideSnapLine();}
          workOv.endTime = _ne;
        } else {
          const dur = origEnd - origStart;
          let _rawStart = Math.max(0, origStart + dx);
          const _snap = window.getSnapPoint ? window.getSnapPoint(_rawStart*_curPPS,-1,'start') : null;
          if(_snap!==null){_rawStart=_snap;window.showSnapLine&&window.showSnapLine(_snap);}
          else{window.hideSnapLine&&window.hideSnapLine();}
          workOv.startTime = _rawStart;
          workOv.endTime   = _rawStart + (origEnd - origStart);

          // Multi-overlay move: if this overlay is part of _selectedOverlays, move all others too
          const _isMultiDrag = window._selectedOverlays?.has(ov.id) && window._selectedOverlays.size > 1;
          if(_isMultiDrag && !dupOv){
            (window._overlays||[]).forEach(o => {
              if(o.id === ov.id) return; // already moved above
              if(!window._selectedOverlays.has(o.id)) return;
              const _oDur = o.endTime - o.startTime;
              const _origOStart = o._dragOrigStart !== undefined ? o._dragOrigStart : o.startTime;
              o._dragOrigStart = o._dragOrigStart !== undefined ? o._dragOrigStart : o.startTime;
              o.startTime = Math.max(0, _origOStart + dx);
              o.endTime   = o.startTime + _oDur;
            });
          }
        }
        // Vertical drag: change track (only for main move, not trim)
        if(!isLeftTrim && !isRightTrim && !dupOv){
          const _S2 = window.S;
          const _maxTrack = Math.max(0, (_S2?.cut?.videoTracks || 1) - 1);
          const _rowH = 30;
          const _trackDelta = -Math.round(dy / _rowH);
          const _newTrack = Math.max(0, Math.min(_maxTrack, origTrack_ov + _trackDelta));
          if(workOv.track !== _newTrack){
            console.log('[OvDrag] overlay track:', origTrack_ov,'→',_newTrack,'(dy='+Math.round(dy)+')');
            workOv.track = _newTrack;
            renderOverlayTimeline();
          }
        }
        // Move the element directly
        const movEl = dupOv
          ? (document.querySelector('[data-ov-id="'+dupOv.id+'"]') || targetEl)
          : el;
        movEl.style.left  = Math.round(workOv.startTime * _curPPS) + 'px';
        movEl.style.width = Math.max(4, Math.round((workOv.endTime - workOv.startTime) * _curPPS)) + 'px';
        if(window.syncCutVid) syncCutVid();
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        if(dupOv){
          // Restore original opacity, select the dup
          el.style.opacity = '';
          setActiveEditId(dupOv.id);
        }
        if(window.cutSaveHistory) cutSaveHistory(dupOv ? 'alt_dup_placed' : 'move_overlay');
        renderOverlayTimeline();
        showOverlayHandles((dupOv||ov).id);
        if(window.syncCutVid) syncCutVid();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // Double-click = edit properties
    el.addEventListener('dblclick', e => {
      e.stopPropagation();
      openOverlayEditDialog(ov.id);
    });

    // Right-click = delete
    el.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      if(!confirm('Delete this overlay?')) return;
      window._overlays = window._overlays.filter(o => o.id !== ov.id);
      if(_activeEditId === ov.id){ setActiveEditId(null); removeOverlayHandles(); }
      renderOverlayTimeline();
      if(window.syncCutVid) syncCutVid();
      if(window.notify) notify('Overlay deleted');
    });

    row.appendChild(el);
  });
}
// OVERLAY PROPERTIES PANEL
window.updateOverlayProps = function(id){
  // Show/hide overlay transition hint in effects panel
  const hint=document.getElementById('cut-eff-overlay-hint');
  if(hint) hint.style.display = id ? 'block' : 'none';
  const ov = (window._overlays||[]).find(o=>o.id===id);
  const body = document.getElementById('cut-props-body');
  if(!body) return;
  if(!ov){
    body.innerHTML='<div style="padding:20px 8px;text-align:center;color:var(--mu2);font-size:11px">Select a clip or overlay</div>';
    return;
  }
  const fmtN = n => Math.round(n*100)/100;
  const typeLabel = {text:'📝 Text',shape:'◆ Shape',freeze:'❄ Freeze',image_bg:'🖼 Image/BG'}[ov.type]||'Overlay';

  const inp = (id,val,step,onch) =>
    `<input type="number" id="${id}" value="${val}" step="${step}" min="0"
      style="width:60px;background:#161616;border:0.5px solid rgba(255,255,255,0.1);border-radius:5px;color:var(--tx);font-size:11px;padding:2px 5px;outline:none"
      onchange="${onch}">`;

  const posSection = ov.x!==undefined ? `
    <div class="prop-section">📐 Position & Size</div>
    <div class="prop-row"><span class="prop-label">X</span>
      ${inp('op-x',fmtN(ov.x),0.01,`window._overlays.find(o=>o.id==='${ov.id}').x=parseFloat(this.value);if(window.syncCutVid)syncCutVid();`)}
    </div>
    <div class="prop-row"><span class="prop-label">Y</span>
      ${inp('op-y',fmtN(ov.y),0.01,`window._overlays.find(o=>o.id==='${ov.id}').y=parseFloat(this.value);if(window.syncCutVid)syncCutVid();`)}
    </div>
    <div class="prop-row"><span class="prop-label">Width</span>
      ${inp('op-w',fmtN(ov.w),0.01,`window._overlays.find(o=>o.id==='${ov.id}').w=Math.max(0,parseFloat(this.value)||0);if(window.syncCutVid)syncCutVid();`)}
    </div>
    <div class="prop-row"><span class="prop-label">Height</span>
      ${inp('op-h',fmtN(ov.h),0.01,`window._overlays.find(o=>o.id==='${ov.id}').h=Math.max(0,parseFloat(this.value)||0);if(window.syncCutVid)syncCutVid();`)}
    </div>
    <div class="prop-row"><span class="prop-label">Rotation</span>
      <input type="range" min="-180" max="180" value="${ov.rotation||0}"
        style="flex:1;accent-color:#E8590C"
        oninput="window._overlays.find(o=>o.id==='${ov.id}').rotation=parseFloat(this.value);document.getElementById('op-rot-val').textContent=this.value+'°';if(window.syncCutVid)syncCutVid();">
      <span id="op-rot-val" style="font-size:10px;color:var(--mu);min-width:32px;text-align:right">${ov.rotation||0}°</span>
    </div>` : '';

  const textSection = ov.type==='text' ? `
    <div class="prop-section">✏️ Text</div>
    <div class="prop-row"><span class="prop-label">Content</span>
      <input type="text" value="${(ov.text||'').replace(/"/g,'&quot;')}"
        style="flex:1;background:#161616;border:0.5px solid rgba(255,255,255,0.1);border-radius:5px;color:var(--tx);font-size:11px;padding:2px 5px;outline:none"
        onchange="window._overlays.find(o=>o.id==='${ov.id}').text=this.value;renderOverlayTimeline();if(window.syncCutVid)syncCutVid();">
    </div>
    <div class="prop-row"><span class="prop-label">Size</span>
      ${inp('op-fs',ov.fontSize||40,1,`window._overlays.find(o=>o.id==='${ov.id}').fontSize=parseInt(this.value);if(window.syncCutVid)syncCutVid();`)}
    </div>
    <div class="prop-row"><span class="prop-label">Color</span>
      <input type="color" value="${ov.color||'#ffffff'}"
        style="width:40px;height:24px;border:none;background:none;cursor:pointer;border-radius:4px;padding:0"
        onchange="window._overlays.find(o=>o.id==='${ov.id}').color=this.value;if(window.syncCutVid)syncCutVid();">
    </div>` : '';

  body.innerHTML = `
    <div class="prop-section">${typeLabel}</div>
    <div class="prop-section">⏱ Timing</div>
    <div class="prop-row"><span class="prop-label">Start</span>
      ${inp('op-st',fmtN(ov.startTime),0.1,`const o=window._overlays.find(o=>o.id==='${ov.id}');if(o)o.startTime=Math.max(0,parseFloat(this.value));renderOverlayTimeline();`)}
    </div>
    <div class="prop-row"><span class="prop-label">End</span>
      ${inp('op-en',fmtN(ov.endTime),0.1,`const o=window._overlays.find(o=>o.id==='${ov.id}');if(o)o.endTime=Math.max(o.startTime+0.1,parseFloat(this.value));renderOverlayTimeline();`)}
    </div>
    <div class="prop-row"><span class="prop-label">Duration</span>
      <span class="prop-val">${fmtN(ov.endTime-ov.startTime)}s</span>
    </div>
    <div class="prop-section" style="color:rgba(0,220,200,0.9)">🎬 Transitions</div>
    <div class="prop-row"><span class="prop-label" style="color:rgba(0,220,200,0.8)">In</span>
      <select style="flex:1;background:#161616;border:0.5px solid rgba(255,255,255,0.1);border-radius:5px;color:var(--tx);font-size:11px;padding:2px 4px;outline:none"
        onchange="const o=window._overlays.find(o=>o.id==='${ov.id}');if(o){o.inTransition=this.value;}renderOverlayTimeline();if(window.syncCutVid)syncCutVid();">
        ${['none','fadein','dissolve','zoomin','slideleft','slideright','slideup','slidedown','blur','wipe'].map(t=>`<option value="${t}" ${(ov.inTransition||'none')===t?'selected':''}>${t}</option>`).join('')}
      </select>
    </div>
    <div class="prop-row"><span class="prop-label" style="color:rgba(0,220,200,0.8)">In dur</span>
      ${inp('op-indur',fmtN(ov.inDuration||0.5),0.1,`const o=window._overlays.find(o=>o.id==='${ov.id}');if(o)o.inDuration=Math.max(0.1,parseFloat(this.value));renderOverlayTimeline();if(window.syncCutVid)syncCutVid();`)}
      <span style="font-size:10px;color:var(--mu)">s</span>
    </div>
    <div class="prop-row"><span class="prop-label" style="color:rgba(200,100,255,0.9)">Out</span>
      <select style="flex:1;background:#161616;border:0.5px solid rgba(255,255,255,0.1);border-radius:5px;color:var(--tx);font-size:11px;padding:2px 4px;outline:none"
        onchange="const o=window._overlays.find(o=>o.id==='${ov.id}');if(o){o.outTransition=this.value;}renderOverlayTimeline();if(window.syncCutVid)syncCutVid();">
        ${['none','fadeout','dissolve','zoomout','slideleft','slideright','slideup','slidedown','blur'].map(t=>`<option value="${t}" ${(ov.outTransition||'none')===t?'selected':''}>${t}</option>`).join('')}
      </select>
    </div>
    <div class="prop-row"><span class="prop-label" style="color:rgba(200,100,255,0.9)">Out dur</span>
      ${inp('op-outdur',fmtN(ov.outDuration||0.5),0.1,`const o=window._overlays.find(o=>o.id==='${ov.id}');if(o)o.outDuration=Math.max(0.1,parseFloat(this.value));renderOverlayTimeline();if(window.syncCutVid)syncCutVid();`)}
      <span style="font-size:10px;color:var(--mu)">s</span>
    </div>
    ${posSection}
    ${textSection}
    <div class="prop-section">🎬 Actions</div>
    <div style="display:flex;gap:4px;flex-wrap:wrap;padding:2px 0">
      <button onclick="window.setActiveEditId('${ov.id}');if(window.openOverlayEditDialog)openOverlayEditDialog('${ov.id}')"
        style="flex:1;padding:5px;background:rgba(255,255,255,0.04);border:0.5px solid rgba(255,255,255,0.1);border-radius:6px;color:var(--tx2);font-size:10px;cursor:pointer;font-family:'DM Sans',sans-serif">✏️ Edit</button>
      <button onclick="window._overlays=window._overlays.filter(o=>o.id!=='${ov.id}');window.setActiveEditId(null);if(window.removeOverlayHandles)removeOverlayHandles();renderOverlayTimeline();if(window.syncCutVid)syncCutVid();if(window.cutSaveHistory)cutSaveHistory();document.getElementById('cut-props-body').innerHTML='<div style=padding:20px 8px;text-align:center;color:var(--mu2);font-size:11px>Select a clip or overlay</div>'"
        style="flex:1;padding:5px;background:rgba(255,69,58,0.1);border:0.5px solid rgba(255,69,58,0.2);border-radius:6px;color:#ff453a;font-size:10px;cursor:pointer;font-family:'DM Sans',sans-serif">🗑 Delete</button>
    </div>`;
};
window.openOverlayEditDialog = openOverlayEditDialog; // forward declare

function openOverlayEditDialog(id){
  const ov = window._overlays.find(o=>o.id===id);
  if(!ov) return;
  if(ov.type==='text') showTextDialog(id);
  else if(ov.type==='shape') showShapeEditDialog(id);
  else if(ov.type==='freeze') showFreezeEditDialog(id);
  else if(ov.type==='image_bg') showImageBgEditDialog(id);
}


// ── VISUAL OVERLAY EDITOR ──
let _activeEditId = null;

// Keep window._activeEditId in sync so app.js keydown handler can read it
// setActiveEditId: keeps module _activeEditId and window._activeEditId in sync
function setActiveEditId(id){
  _activeEditId = id;
  window._activeEditId = id;
}
window.setActiveEditId = setActiveEditId;

function getVideoEl(screen){
  // Get the visible video/canvas inside cut-screen
  return screen.querySelector('#cut-main-vid[style*="block"]') ||
         screen.querySelector('#cut-trans-cvs[style*="block"]') ||
         screen.querySelector('#cut-cvs') ||
         screen.querySelector('video') ||
         screen.querySelector('canvas');
}

function getVideoRect(screen){
  const el = getVideoEl(screen);
  if(!el) return {left:0,top:0,width:screen.clientWidth,height:screen.clientHeight};
  const sr = screen.getBoundingClientRect();
  const er = el.getBoundingClientRect();
  return {left:er.left-sr.left, top:er.top-sr.top, width:er.width, height:er.height};
}

function removeOverlayHandles(){
  document.getElementById('overlay-editor')?.remove();
  document.getElementById('ov-drag-layer')?.remove();
}

function showOverlayHandles(id){
  removeOverlayHandles();
  const ov = window._overlays.find(o=>o.id===id);
  if(!ov) return;
  const screen = document.getElementById('cut-screen');
  if(!screen) return;

  // Ensure overlays default position/size
  if(ov.x === undefined) ov.x = 0.5;
  if(ov.y === undefined) ov.y = 0.5;
  if(ov.w === undefined) ov.w = ov.type==='text' ? 0.4 : 0.25;
  if(ov.h === undefined) ov.h = ov.type==='text' ? 0.12 : 0.2;

  const isFull = ov.type==='freeze'; // Only freeze is fullscreen — all image_bg types get transform handles
  if(isFull){
    // Full-screen overlay — show a floating edit badge
    const editor = document.createElement('div');
    editor.id = 'overlay-editor';
    editor.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;z-index:100;pointer-events:none';
    const badge = document.createElement('div');
    badge.style.cssText = 'position:absolute;top:12px;left:50%;transform:translateX(-50%);background:rgba(88,166,255,0.9);color:#fff;padding:6px 18px;border-radius:20px;font-size:12px;font-family:DM Sans,sans-serif;cursor:pointer;pointer-events:all;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.4)';
    badge.textContent = '✏️ Click to edit properties';
    badge.addEventListener('click', ()=>{ setActiveEditId(null); removeOverlayHandles(); openOverlayEditDialog(id); });
    editor.appendChild(badge);
    screen.appendChild(editor);
    return;
  }

  // Movable/resizable overlay
  const editor = document.createElement('div');
  editor.id = 'overlay-editor';
  editor.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;z-index:100;pointer-events:none';
  screen.appendChild(editor);

  function redraw(){
    // Clear old handles (keep editor div)
    Array.from(editor.children).forEach(c=>c.remove());
    const vr = getVideoRect(screen);
    const W=vr.width, H=vr.height, ox=vr.left, oy=vr.top;
    const bx = ox + ov.x*W - (ov.w*W)/2;
    const by = oy + ov.y*H - (ov.h*H)/2;
    const bw = ov.w*W, bh = ov.h*H;

    // Main bounding box
    const box = document.createElement('div');
    box.style.cssText = `position:absolute;left:${bx}px;top:${by}px;width:${bw}px;height:${bh}px;border:2px solid #58a6ff;border-radius:3px;box-sizing:border-box;pointer-events:all;cursor:move;background:rgba(88,166,255,0.06)`;
    editor.appendChild(box);

    // Action bar above box
    const bar = document.createElement('div');
    bar.style.cssText = `position:absolute;left:${bx}px;top:${by-26}px;display:flex;gap:4px;pointer-events:all`;
    const editBtn = document.createElement('div');
    editBtn.style.cssText = 'background:#58a6ff;color:#fff;font-size:10px;padding:3px 10px;border-radius:4px;cursor:pointer;font-family:DM Sans,sans-serif;white-space:nowrap';
    editBtn.textContent = '✏ Properties';
    editBtn.addEventListener('click', ()=>{ setActiveEditId(null); removeOverlayHandles(); openOverlayEditDialog(id); });
    const closeBtn = document.createElement('div');
    closeBtn.style.cssText = 'background:#444;color:#ccc;font-size:10px;padding:3px 8px;border-radius:4px;cursor:pointer;font-family:DM Sans,sans-serif';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', ()=>{ setActiveEditId(null); removeOverlayHandles(); renderOverlayTimeline(); });
    bar.appendChild(editBtn); bar.appendChild(closeBtn);
    editor.appendChild(bar);

    // ── 4 corner resize handles ──
    [[0,0,'nw-resize'],[1,0,'ne-resize'],[0,1,'sw-resize'],[1,1,'se-resize']].forEach(([cx,cy,cur])=>{
      const h = document.createElement('div');
      h.style.cssText = `position:absolute;left:${bx+cx*bw-6}px;top:${by+cy*bh-6}px;width:12px;height:12px;background:#58a6ff;border:2px solid #fff;border-radius:2px;cursor:${cur};pointer-events:all;z-index:2;box-sizing:border-box`;
      editor.appendChild(h);
      h.addEventListener('mousedown', e=>{
        e.preventDefault(); e.stopPropagation();
        const sx=e.clientX,sy=e.clientY,ox2=ov.x,oy2=ov.y,ow=ov.w,oh=ov.h;
        const mv=(e2)=>{
          const vr2=getVideoRect(screen);
          const dx=(e2.clientX-sx)/vr2.width, dy=(e2.clientY-sy)/vr2.height;
          if(cx===0){ov.x=ox2+dx/2;ov.w=Math.max(0,ow-dx);}
          else{ov.x=ox2+dx/2;ov.w=Math.max(0,ow+dx);}
          if(cy===0){ov.y=oy2+dy/2;ov.h=Math.max(0,oh-dy);}
          else{ov.y=oy2+dy/2;ov.h=Math.max(0,oh+dy);}
          redraw();
          if(window.syncCutVid) syncCutVid();
        };
        const up=()=>{
          document.removeEventListener('mousemove',mv);
          document.removeEventListener('mouseup',up);
          if(window.cutSaveHistory) cutSaveHistory('move_overlay');
        };
        document.addEventListener('mousemove',mv); document.addEventListener('mouseup',up);
      });
    });

    // ── Rotation handle — circle above the box ──
    // Only show for shape and image overlays (not text which has no rotation yet)
    if(ov.type==='shape' || ov.type==='image_bg'){
      const rot = ov.rotation || 0;

      // Center of the box in screen coords
      const cxPx = bx + bw/2;
      const cyPx = by + bh/2;

      // Rotation handle sits 36px above the top-center of the box
      // But if box is rotated, rotate this offset too
      const rotRad = rot * Math.PI / 180;
      const handleDist = bh/2 + 36;
      const rhx = cxPx + Math.sin(rotRad) * handleDist * -1; // offset perpendicular
      const rhy = cyPx - Math.cos(rotRad) * handleDist;

      // Line from top-center of box to rotation handle
      const lineSvg = document.createElementNS('http://www.w3.org/2000/svg','svg');
      lineSvg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible';
      lineSvg.innerHTML = `<line x1="${cxPx}" y1="${by}" x2="${rhx}" y2="${rhy}" stroke="#58a6ff" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.7"/>`;
      editor.appendChild(lineSvg);

      // The circular rotation handle
      const rh = document.createElement('div');
      rh.title = 'Drag to rotate';
      rh.style.cssText = `position:absolute;left:${rhx-10}px;top:${rhy-10}px;width:20px;height:20px;background:#fff;border:2px solid #58a6ff;border-radius:50%;cursor:grab;pointer-events:all;z-index:3;box-sizing:border-box;display:flex;align-items:center;justify-content:center;font-size:11px;user-select:none;box-shadow:0 2px 8px rgba(0,0,0,0.4)`;
      rh.textContent = '↻';
      editor.appendChild(rh);

      rh.addEventListener('mousedown', e=>{
        e.preventDefault(); e.stopPropagation();
        rh.style.cursor = 'grabbing';
        const vr2 = getVideoRect(screen);
        // Center of the overlay in screen absolute coords
        const centerX = vr2.left + ov.x * vr2.width;
        const centerY = vr2.top  + ov.y * vr2.height;
        // Starting angle from center to mouse
        const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180 / Math.PI;
        const startRot   = ov.rotation || 0;

        const mv = (e2)=>{
          const currentAngle = Math.atan2(e2.clientY - centerY, e2.clientX - centerX) * 180 / Math.PI;
          let delta = currentAngle - startAngle;
          // Normalise to -180..180
          ov.rotation = Math.round(((startRot + delta + 540) % 360) - 180);
          redraw();
          if(window.syncCutVid) syncCutVid();
        };
        const up = ()=>{
          rh.style.cursor = 'grab';
          document.removeEventListener('mousemove', mv);
          document.removeEventListener('mouseup', up);
          if(window.cutSaveHistory) cutSaveHistory('rotate_overlay');
        };
        document.addEventListener('mousemove', mv);
        document.addEventListener('mouseup', up);
      });
    }

    // Drag box to move
    box.addEventListener('mousedown', e=>{
      e.preventDefault(); e.stopPropagation();
      const sx=e.clientX,sy=e.clientY,ox3=ov.x,oy3=ov.y;
      const mv=(e2)=>{
        const vr3=getVideoRect(screen);
        ov.x=Math.max(0,Math.min(1,ox3+(e2.clientX-sx)/vr3.width));
        ov.y=Math.max(0,Math.min(1,oy3+(e2.clientY-sy)/vr3.height));
        redraw();
        if(window.syncCutVid) syncCutVid();
      };
      const up=()=>{document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);};
      document.addEventListener('mousemove',mv); document.addEventListener('mouseup',up);
    });
  }

  redraw();

  // Also add transparent drag layer over video for easier grabbing
  const vr = getVideoRect(screen);
  const layer = document.createElement('div');
  layer.id = 'ov-drag-layer';
  layer.style.cssText = `position:absolute;left:${vr.left}px;top:${vr.top}px;width:${vr.width}px;height:${vr.height}px;z-index:99;cursor:crosshair`;
  screen.appendChild(layer);
  layer.addEventListener('mousedown', e=>{
    e.preventDefault();
    const vr2=getVideoRect(screen);
    const sx=e.clientX,sy=e.clientY,ox4=ov.x,oy4=ov.y;
    layer.style.cursor='grabbing';
    const mv=(e2)=>{
      ov.x=Math.max(0,Math.min(1,ox4+(e2.clientX-sx)/vr2.width));
      ov.y=Math.max(0,Math.min(1,oy4+(e2.clientY-sy)/vr2.height));
      // Redraw handles
      const ed=document.getElementById('overlay-editor');
      if(ed) Array.from(ed.children).forEach(c=>c.remove());
      if(ed){
        // quick redraw via re-calling showOverlayHandles is slow; call redraw inline
        const vr3=getVideoRect(screen);
        const W2=vr3.width,H2=vr3.height,offx=vr3.left,offy=vr3.top;
        const bx2=offx+ov.x*W2-(ov.w*W2)/2,by2=offy+ov.y*H2-(ov.h*H2)/2,bw2=ov.w*W2,bh2=ov.h*H2;
        const b2=document.createElement('div');
        b2.style.cssText=`position:absolute;left:${bx2}px;top:${by2}px;width:${bw2}px;height:${bh2}px;border:2px solid #58a6ff;border-radius:3px;box-sizing:border-box;background:rgba(88,166,255,0.1)`;
        ed.appendChild(b2);
      }
      if(window.syncCutVid) syncCutVid();
    };
    const up=()=>{
      layer.style.cursor='crosshair';
      document.removeEventListener('mousemove',mv);
      document.removeEventListener('mouseup',up);
      // Full redraw on release
      showOverlayHandles(id);
    };
    document.addEventListener('mousemove',mv);
    document.addEventListener('mouseup',up);
  });
}

function openOverlayEditDialog(id){
  const ov = window._overlays.find(o=>o.id===id);
  if(!ov) return;
  if(ov.type==='text') showTextDialog(id);
  else if(ov.type==='shape') showShapeEditDialog(id);
  else if(ov.type==='freeze') showFreezeEditDialog(id);
  else if(ov.type==='image_bg') showImageBgEditDialog(id);
}

// Remove stale window.editOverlay - handled via pill click in renderOverlayTimeline
window.editOverlay = function(id){ /* handled by pill click events */ };

function setupVideoDragForOverlay(){ /* now handled inside showOverlayHandles */ }


// ── SHAPE EDIT DIALOG ──
function showShapeEditDialog(id){
  const ov = window._overlays.find(o=>o.id===id);
  if(!ov) return;
  const modal = createModal('Edit Shape', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      <div>
        <label class="modal-field-label">Start Time (s)</label>
        <div style="display:flex;gap:6px"><input id="eshp-start" type="number" step="0.1" value="${ov.startTime.toFixed(2)}" style="${inputStyle()}"><button onclick="document.getElementById('eshp-start').value=S.cut.ph.toFixed(2)" style="${smallBtnStyle()}">⏱</button></div>
      </div>
      <div>
        <label class="modal-field-label">End Time (s)</label>
        <div style="display:flex;gap:6px"><input id="eshp-end" type="number" step="0.1" value="${ov.endTime.toFixed(2)}" style="${inputStyle()}"><button onclick="document.getElementById('eshp-end').value=S.cut.ph.toFixed(2)" style="${smallBtnStyle()}">⏱</button></div>
      </div>
    </div>
    <div style="margin-bottom:12px">
      <label class="modal-field-label">Fill Mode</label>
      <div style="display:flex;gap:10px;align-items:center">
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--tx,#f0f2f5);cursor:pointer">
          <input type="radio" name="eshp-fill-mode" value="fill" ${(ov.fillMode||'fill')==='fill'?'checked':''} style="accent-color:#E31837"> Filled
        </label>
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--tx,#f0f2f5);cursor:pointer">
          <input type="radio" name="eshp-fill-mode" value="outline" ${ov.fillMode==='outline'?'checked':''} style="accent-color:#E31837"> Outline Only
        </label>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:12px">
      <div><label class="modal-field-label">Fill Color</label><input type="color" id="eshp-color" value="${ov.color||'#E31837'}" style="${inputStyle()};padding:4px;height:36px"></div>
      <div><label class="modal-field-label">Outline Color</label><input type="color" id="eshp-stroke-color" value="${ov.strokeColor||ov.color||'#E31837'}" style="${inputStyle()};padding:4px;height:36px"></div>
      <div><label class="modal-field-label">Opacity %</label><input id="eshp-opacity" type="number" value="${Math.round((ov.opacity||0.8)*100)}" min="0" max="100" style="${inputStyle()}"></div>
      <div><label class="modal-field-label">Outline Width</label><input id="eshp-stroke" type="number" value="${ov.strokeW||2}" min="0" max="20" style="${inputStyle()}"></div>
    </div>
    <div style="margin-bottom:12px">
      <label class="modal-field-label">Label Text</label>
      <input id="eshp-label" type="text" value="${ov.label||''}" style="${inputStyle()}">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <div><label class="modal-field-label">Animation</label>
        <select id="eshp-anim" style="${inputStyle()}">
          ${['none','pulse','fadein','draw','blink'].map(a=>`<option value="${a}"${ov.anim===a?' selected':''}>${a}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="modal-field-label">Rotation (°)</label>
        <input id="eshp-rotation" type="range" min="-180" max="180" value="${ov.rotation||0}" oninput="this.nextElementSibling.textContent=this.value+'°'" style="width:100%;margin-top:8px">
        <span style="font-size:12px;color:var(--tx,#f0f2f5)">${ov.rotation||0}°</span>
      </div>
      <div><label class="modal-field-label">Shape Type</label>
        <select id="eshp-shape" style="${inputStyle()}">
          ${SHAPES.map(s=>`<option value="${s.id}"${ov.shape===s.id?' selected':''}>${s.label}</option>`).join('')}
        </select>
      </div>
    </div>
    <div style="font-size:11px;color:var(--blu);padding:8px;background:rgba(88,166,255,0.08);border-radius:6px">
      💡 Drag the shape on the video preview to reposition and resize
    </div>
  `, ()=>{
    const start=parseFloat(document.getElementById('eshp-start').value);
    const end=parseFloat(document.getElementById('eshp-end').value);
    if(isNaN(start)||isNaN(end)||end<=start){notify('Invalid time range','#E31837');return;}
    ov.startTime=start; ov.endTime=end;
    ov.color=document.getElementById('eshp-color').value;
    ov.strokeColor=document.getElementById('eshp-stroke-color').value;
    ov.fillMode=document.querySelector('input[name="eshp-fill-mode"]:checked')?.value||'fill';
    ov.opacity=parseInt(document.getElementById('eshp-opacity').value)/100;
    ov.strokeW=parseInt(document.getElementById('eshp-stroke').value);
    ov.label=document.getElementById('eshp-label').value;
    ov.anim=document.getElementById('eshp-anim').value;
    ov.shape=document.getElementById('eshp-shape').value;
    ov.rotation=parseInt(document.getElementById('eshp-rotation').value)||0;
    renderOverlayTimeline();
    if(window.syncCutVid) syncCutVid();
    notify('Shape updated ✓','#3fb950');
    closeModal();
  });
}

// ── IMAGE/BG EDIT DIALOG ──
function showImageBgEditDialog(id){
  const ov = window._overlays.find(o=>o.id===id);
  if(!ov) return;
  const modal = createModal('Edit Background', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      <div>
        <label class="modal-field-label">Start Time (s)</label>
        <div style="display:flex;gap:6px"><input id="ebg-start" type="number" step="0.1" value="${ov.startTime.toFixed(2)}" style="${inputStyle()}"><button onclick="document.getElementById('ebg-start').value=S.cut.ph.toFixed(2)" style="${smallBtnStyle()}">⏱</button></div>
      </div>
      <div>
        <label class="modal-field-label">End Time (s)</label>
        <div style="display:flex;gap:6px"><input id="ebg-end" type="number" step="0.1" value="${ov.endTime.toFixed(2)}" style="${inputStyle()}"><button onclick="document.getElementById('ebg-end').value=S.cut.ph.toFixed(2)" style="${smallBtnStyle()}">⏱</button></div>
      </div>
    </div>
    ${ov.bgType==='color'?`<div style="margin-bottom:12px"><label class="modal-field-label">Color</label><input type="color" id="ebg-color" value="${ov.color||'#000000'}" style="${inputStyle()};padding:4px;height:36px"></div>`:''}
    ${ov.bgType==='gradient'?`<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px"><div><label class="modal-field-label">Color 1</label><input type="color" id="ebg-grad1" value="${ov.grad1||'#E31837'}" style="${inputStyle()};padding:4px;height:36px"></div><div><label class="modal-field-label">Color 2</label><input type="color" id="ebg-grad2" value="${ov.grad2||'#000'}" style="${inputStyle()};padding:4px;height:36px"></div></div>`:''}
    ${ov.bgType==='image'&&ov._img?`<div style="margin-bottom:12px"><img src="${ov.url}" style="width:100%;border-radius:6px;border:1px solid rgba(255,255,255,0.1)"></div>`:''}
    ${ov.bgType==='image'?`
    <div style="margin-top:12px">
      <label class="modal-field-label">Rotation (°)</label>
      <input id="ebg-rotation" type="range" min="-180" max="180" value="${ov.rotation||0}" oninput="this.nextElementSibling.textContent=this.value+'°'" style="width:100%">
      <span style="font-size:12px;color:var(--tx,#f0f2f5)">${ov.rotation||0}°</span>
    </div>`:''}
  `, ()=>{
    ov.startTime=parseFloat(document.getElementById('ebg-start').value);
    ov.endTime=parseFloat(document.getElementById('ebg-end').value);
    if(ov.bgType==='image'&&document.getElementById('ebg-rotation')) ov.rotation=parseInt(document.getElementById('ebg-rotation').value)||0;
    if(ov.bgType==='color') ov.color=document.getElementById('ebg-color')?.value||ov.color;
    if(ov.bgType==='gradient'){ov.grad1=document.getElementById('ebg-grad1')?.value||ov.grad1;ov.grad2=document.getElementById('ebg-grad2')?.value||ov.grad2;}
    renderOverlayTimeline();
    if(window.syncCutVid) syncCutVid();
    notify('Background updated ✓','#3fb950');
    closeModal();
  });
}

// Close overlay editor when clicking outside
document.addEventListener('click', e=>{
  if(_activeEditId && !e.target.closest('#overlay-editor') && !e.target.closest('#overlay-strip') && !e.target.closest('.feature-modal')){
    setActiveEditId(null);
    removeOverlayHandles();
  }
});
window.deleteOverlay=function(id){
  window._overlays=window._overlays.filter(o=>o.id!==id);
  renderOverlayTimeline();
  // Force video/canvas to refresh immediately
  if(window.syncCutVid) window.syncCutVid();
  notify('Overlay deleted');
};

// ── MODAL HELPERS ──
function inputStyle(){return 'width:100%;padding:8px 10px;background:#252d3d;border:1px solid rgba(255,255,255,0.11);border-radius:7px;color:#f0f2f5;font-size:13px;font-family:DM Sans,sans-serif;outline:none;box-sizing:border-box';}
function smallBtnStyle(){return 'padding:6px 10px;background:#1e2533;border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#8b949e;font-size:11px;font-family:DM Sans,sans-serif;cursor:pointer;white-space:nowrap;flex-shrink:0';}

function createModal(title, bodyHTML, onConfirm){
  document.querySelectorAll('.feature-modal').forEach(m=>m.remove());
  window._currentModalConfirm=onConfirm;
  const m=document.createElement('div');
  m.className='feature-modal';
  m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:3000;display:flex;align-items:center;justify-content:center;padding:20px';
  m.innerHTML=`<div style="background:#1e2533;border:1px solid rgba(255,255,255,0.13);border-radius:16px;padding:26px;width:520px;max-width:95vw;max-height:90vh;overflow-y:auto;box-shadow:0 24px 80px rgba(0,0,0,0.6)">
    <div style="font-size:17px;font-weight:700;margin-bottom:18px;display:flex;justify-content:space-between;align-items:center">
      <span>${title}</span>
      <button onclick="closeModal()" style="background:none;border:none;color:#8b949e;font-size:20px;cursor:pointer;padding:0 4px">×</button>
    </div>
    <div class="modal-body">${bodyHTML}</div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px">
      <button onclick="closeModal()" style="padding:8px 18px;border-radius:8px;font-size:13px;font-weight:600;font-family:DM Sans,sans-serif;cursor:pointer;background:transparent;border:1px solid rgba(255,255,255,0.15);color:#8b949e">Cancel</button>
      <button onclick="window._currentModalConfirm&&window._currentModalConfirm()" style="padding:8px 20px;border-radius:8px;font-size:13px;font-weight:700;font-family:DM Sans,sans-serif;cursor:pointer;background:#E31837;border:none;color:#fff">Apply</button>
    </div>
  </div>`;
  m.addEventListener('click',e=>{ if(e.target===m) closeModal(); });
  document.body.appendChild(m);
  return m;
}
window.closeModal=function(){ document.querySelectorAll('.feature-modal').forEach(m=>m.remove()); };
window.createModal=createModal; // expose for app.js usage
// _currentModalConfirm stored on window

// Expose all features
window.showFreezeDialog=showFreezeDialog;
window.showShapeEditDialog=showShapeEditDialog;
window.showImageBgEditDialog=showImageBgEditDialog;
window.showOverlayHandles=showOverlayHandles;
window.setupVideoDragForOverlay=setupVideoDragForOverlay;
window.removeOverlayHandles=removeOverlayHandles;
window.showTextDialog=showTextDialog;
window.showImageBgDialog=showImageBgDialog;
window.showShapeDialog=showShapeDialog;
window.showTransformDialog=showTransformDialog;
window.showAudioFxDialog=showAudioFxDialog;
window.renderOverlaysOnCanvas=renderOverlaysOnCanvas;
window.renderOverlayTimeline=renderOverlayTimeline;
window.applyAudioFx=applyAudioFx;

// ── AUDIO WAVEFORM ──
window.drawWaveform = function(canvas, audioBuffer, fileStartSec, clipDurSec){
  if(!canvas||!audioBuffer) return;
  const ctx=canvas.getContext('2d');
  const W=canvas.width, H=canvas.height;
  ctx.clearRect(0,0,W,H);
  const data=audioBuffer.getChannelData(0);
  const sampleRate=audioBuffer.sampleRate;
  const totalSamples=data.length;

  // Calculate which samples to render based on fileStart offset
  // fileStartSec: where in the source file this clip starts
  // clipDurSec:   how long this clip is
  const startSample = Math.round((fileStartSec||0) * sampleRate);
  const durSamples  = clipDurSec
    ? Math.round(clipDurSec * sampleRate)
    : (totalSamples - startSample);
  const endSample   = Math.min(totalSamples, startSample + durSamples);

  ctx.fillStyle='rgba(251,191,36,0.65)';
  const samplesPerPx = Math.max(1, (endSample - startSample) / W);
  for(let x=0;x<W;x++){
    const s0 = Math.round(startSample + x * samplesPerPx);
    const s1 = Math.min(endSample, Math.round(s0 + samplesPerPx));
    let min=1, max=-1;
    for(let s=s0;s<s1;s++){
      const v=data[s]||0;
      if(v<min)min=v; if(v>max)max=v;
    }
    if(min===1&&max===-1) continue; // no data
    const yMin=Math.round((1-max)/2*H);
    const yMax=Math.round((1-min)/2*H);
    ctx.fillRect(x,yMin,1,Math.max(1,yMax-yMin));
  }
};

window.generateWaveformForClip = function(clipEl, mediaUrl, fileStartSec, clipDurSec){
  if(!mediaUrl||!clipEl) return;
  const cacheKey='wf_'+mediaUrl.substring(mediaUrl.length-20);
  const fs = fileStartSec || 0;
  const dur = clipDurSec || 0;
  if(window._wfCache&&window._wfCache[cacheKey]){
    renderWaveformOnClip(clipEl, window._wfCache[cacheKey], fs, dur);
    return;
  }
  let actx;
  fetch(mediaUrl).then(r=>r.arrayBuffer()).then(buf=>{
    actx=new(window.AudioContext||window.webkitAudioContext)();
    return actx.decodeAudioData(buf);
  }).then(audioBuffer=>{
    if(!window._wfCache) window._wfCache={};
    window._wfCache[cacheKey]=audioBuffer;
    renderWaveformOnClip(clipEl, audioBuffer, fs, dur);
    if(actx&&actx.close) actx.close();
  }).catch(()=>{});
};

function renderWaveformOnClip(clipEl, audioBuffer, fileStartSec, clipDurSec){
  let cvs=clipEl.querySelector('.wf-canvas');
  if(!cvs){
    cvs=document.createElement('canvas');
    cvs.className='wf-canvas';
    cvs.style.cssText='position:absolute;inset:0;width:100%;height:100%;opacity:0.55;pointer-events:none;border-radius:4px';
    clipEl.appendChild(cvs);
  }
  cvs.width  = clipEl.offsetWidth  || 200;
  cvs.height = clipEl.offsetHeight || 26;
  // Pass fileStart and dur so waveform shows the correct segment
  window.drawWaveform(cvs, audioBuffer, fileStartSec||0, clipDurSec||0);
}
