/* === Debug overlay (append-only; non-destructive) === */
(function(){
  const MAX_LINES = 500;
  const STORAGE_KEY = 'debugEnabled';
  const QP_DEBUG = (()=>{
    try{ return new URLSearchParams(location.search).get('debug') === '1'; }catch(e){ return false; }
  })();

  function now(){ try{ return new Date().toISOString().slice(11,19);}catch(e){return '';} }
  function createOverlay(){
    let r = document.getElementById('dbg-overlay-root');
    if (r) return r;
    r = document.createElement('div');
    r.id = 'dbg-overlay-root';
    Object.assign(r.style, {
      position:'fixed', right:'8px', bottom:'8px', zIndex:'2147483000',
      maxWidth:'92vw', width:'min(520px,92vw)', maxHeight:'55vh',
      background:'rgba(0,0,0,0.85)', color:'#e6e6e6',
      fontFamily:'ui-monospace,Menlo,Consolas,monospace', fontSize:'12px', lineHeight:'1.35',
      borderRadius:'10px', border:'1px solid rgba(255,255,255,.15)', boxShadow:'0 6px 16px rgba(0,0,0,.45)',
      display:'none'
    });
    const head = document.createElement('div');
    Object.assign(head.style,{display:'flex',alignItems:'center',gap:'8px',padding:'8px 10px',background:'rgba(255,255,255,.06)',borderTopLeftRadius:'10px',borderTopRightRadius:'10px'});
    const dot = document.createElement('span'); dot.textContent='●'; dot.style.color='#5cff7a'; head.appendChild(dot);
    const ttl = document.createElement('div'); ttl.textContent='Debug Log'; ttl.style.flex='1'; ttl.style.fontWeight='600'; head.appendChild(ttl);
    const bClear = document.createElement('button'); bClear.textContent='Clear'; Object.assign(bClear.style,{background:'transparent',color:'#ddd',border:'1px solid rgba(255,255,255,.25)',borderRadius:'6px',fontSize:'12px',padding:'4px 8px',cursor:'pointer'});
    bClear.addEventListener('click',()=>{ DBG.clear(); });
    head.appendChild(bClear);
    const bClose = document.createElement('button'); bClose.textContent='×'; Object.assign(bClose.style,{background:'transparent',color:'#ddd',border:'1px solid rgba(255,255,255,.25)',borderRadius:'6px',fontSize:'14px',padding:'2px 8px',cursor:'pointer'});
    bClose.title='Hide overlay (debug stays ON)'; bClose.addEventListener('click',()=>{ r.style.display='none'; });
    head.appendChild(bClose);
    const pre = document.createElement('pre'); pre.id='dbg-overlay-pre'; Object.assign(pre.style,{margin:'0',padding:'10px',overflow:'auto',whiteSpace:'pre-wrap',wordBreak:'break-word',maxHeight:'calc(55vh - 40px)'});
    r.appendChild(head); r.appendChild(pre); document.body.appendChild(r);
    return r;
  }
  function safe(x){
    try{
      if (x instanceof Error) return x.stack || (x.name+': '+x.message);
      if (typeof x === 'object') return JSON.stringify(x, (_,v)=>{
        if (v instanceof Node) return '[DOM Node]';
        if (v instanceof Window) return '[Window]';
        return v;
      });
      return String(x);
    }catch(e){ try{ return String(x);}catch(_){ return '[Unserializable]';}}
  }

  const DBG = {
    enabled:false, _overlay:null, _pre:null, _buf:[], _orig:null, _onErr:null, _onRej:null,
    ensure(){ if(!this._overlay){ this._overlay=createOverlay(); this._pre=this._overlay.querySelector('#dbg-overlay-pre'); } return this._overlay; },
    show(){ this.ensure(); this._overlay.style.display='block'; },
    hide(){ if(this._overlay) this._overlay.style.display='none'; },
    line(){ const msg = `[${now()}] ` + Array.from(arguments).map(safe).join(' ');
      this._buf.push(msg); if(this._buf.length>500) this._buf.splice(0, this._buf.length-500);
      this.ensure(); if(this._pre){ this._pre.textContent=this._buf.join('\\n'); this._pre.scrollTop=this._pre.scrollHeight; }
      try{ const mirror=document.getElementById('debugPre'); if(mirror){ mirror.textContent=this._buf.join('\\n'); mirror.scrollTop=mirror.scrollHeight; } }catch(e){}
    },
    clear(){ this._buf.length=0; if(this._pre) this._pre.textContent=''; try{ const m=document.getElementById('debugPre'); if(m) m.textContent=''; }catch(e){} },
    init(){
      if(this.enabled) return; this.enabled=true;
      if(!this._orig){ this._orig={ log:console.log.bind(console), warn:console.warn.bind(console), error:console.error.bind(console) }; }
      console.log=(...a)=>{ try{DBG.line('LOG:',...a);}catch(e){}; DBG._orig.log(...a); };
      console.warn=(...a)=>{ try{DBG.line('WARN:',...a);}catch(e){}; DBG._orig.warn(...a); };
      console.error=(...a)=>{ try{DBG.line('ERROR:',...a);}catch(e){}; DBG._orig.error(...a); };
      this._onErr=(msg,src,lin,col,err)=>{ DBG.line('onerror:', msg, src+':'+lin+':'+col, err&&err.stack?err.stack:''); };
      this._onRej=(ev)=>{ try{ const reason=ev&&(ev.reason||ev); DBG.line('unhandledrejection:',safe(reason)); }catch(e){} };
      window.addEventListener('error', this._onErr);
      window.addEventListener('unhandledrejection', this._onRej);
      this.show(); this.line('✅ Debug overlay enabled');
    },
    teardown(){
      if(!this.enabled) return; this.enabled=false;
      if(this._orig){ console.log=this._orig.log; console.warn=this._orig.warn; console.error=this._orig.error; }
      if(this._onErr) window.removeEventListener('error', this._onErr);
      if(this._onRej) window.removeEventListener('unhandledrejection', this._onRej);
      this._onErr=null; this._onRej=null; this.hide(); this.line('🛑 Debug overlay disabled');
    }
  };
  window.OCRDBG = DBG;

  function readSaved(){ try{ const v=localStorage.getItem('debugEnabled'); if(v==='1')return true; if(v==='0')return false; }catch(e){} return null; }
  function saveState(on){ try{ localStorage.setItem('debugEnabled', on?'1':'0'); }catch(e){} }

  function syncFromToggle(){
    const el = document.getElementById('debugToggle');
    if(!el) return;
    const on = !!el.checked;
    if (on){ DBG.init(); } else { DBG.teardown(); }
    if (typeof OCR !== 'undefined') OCR.debug = on;
    if (typeof setDebugLines === 'function'){ if (!on) setDebugLines(''); else setDebugLines('(ON)'); }
    saveState(on);
  }

  document.addEventListener('DOMContentLoaded', ()=>{
    const t = document.getElementById('debugToggle');
    if (t && !t.__ocrdbg_bound){ t.__ocrdbg_bound = true; t.addEventListener('change', syncFromToggle); }
    let initial = readSaved();
    if (new URLSearchParams(location.search).get('debug') === '1') initial = true;
    if (t){
      if (typeof initial === 'boolean'){ t.checked = initial; }
      syncFromToggle();
    }else{
      if (initial === true){ DBG.init(); if (typeof OCR !== 'undefined') OCR.debug = true; }
    }
  });
})();

// --- デバッグオーバーレイ制御（?debug=1 の時のみ有効）---
window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(location.search);
  const debugMode = params.get('debug') === '1';

  if (!debugMode) {
    // 非デバッグ時はオーバーレイを完全非表示・無効化
    const style = document.createElement('style');
    style.textContent = '#dbg-overlay-root { display: none !important; }';
    document.head.appendChild(style);

    if (window.OCRDBG) {
      window.OCRDBG.show = () => {};
      window.OCRDBG.init = () => {};
    }

    const el = document.getElementById('debugToggle');
    if (el) el.checked = false;
    localStorage.setItem('debugEnabled', '0');
  }
});