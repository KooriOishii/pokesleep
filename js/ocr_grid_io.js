// =========================
// ocr_grid_io.js
// (Grid layout, sliders, image cache, thumbnails)
// =========================

// ---- Grid defaults ----
const DEFAULT_GRID = {
  cols: 4, rows: 4,
  left: 50, top: 510,
  tileW: 225, tileH: 340, // tileH 固定（将来拡張余地）
  gapX: 24, gapY: 38,
  scale: 2, yOffset: 0
};
const DEFAULT_BOTTOM = DEFAULT_GRID.top + (DEFAULT_GRID.rows - 1) * (DEFAULT_GRID.tileH + DEFAULT_GRID.gapY) + DEFAULT_GRID.tileH;

// 行数（UI連動・グローバル）
// 既に他所で定義済みなら再定義しない
if (typeof gridRowCount === 'undefined') {
  var gridRowCount = (typeof OCR_CONST !== 'undefined' && OCR_CONST.ROWS_DEF) ? OCR_CONST.ROWS_DEF : 4;
}

// ---- Helpers ----

// 行数から top を逆算（下端固定）
function computeTopFromBottom(rows){
  rows = Math.max(OCR_CONST.ROWS_MIN, Math.min(OCR_CONST.ROWS_MAX, Number(rows) || DEFAULT_GRID.rows));
  const tileH = DEFAULT_GRID.tileH;
  const gapY  = DEFAULT_GRID.gapY;
  const stepY = tileH + gapY;
  return Math.round(DEFAULT_BOTTOM - tileH - (rows - 1) * stepY);
}

// gapX のクランプ（画像幅に依存）
function getGapXClamp(imgWidth, p){
  let max;
  if (p.cols <= 1){
    max = Math.max(0, Math.floor(imgWidth - p.left - p.tileW));
  } else {
    const numer = imgWidth - p.left - p.tileW * p.cols;
    max = Math.floor(numer / Math.max(1, (p.cols - 1)));
    if (!Number.isFinite(max) || max < 0) max = 0;
  }
  return { min: 0, max };
}

// yOffset のクランプ（画像高さに依存）
function getYOffsetClamp(imgHeight, p){
  const baseTop = computeTopFromBottom(p.rows);
  const min = Math.max(-Math.floor(p.tileH*0.5), -baseTop);
  const bottom = baseTop + (p.rows-1)*(p.tileH+p.gapY) + p.tileH;
  const max = Math.min(Math.floor(p.tileH*0.5), Math.max(0, imgHeight - bottom));
  return { min, max };
}

// UI値 → パラメタ
function getGridParamsFromUI(){
  return {
    cols: DEFAULT_GRID.cols,
    rows: gridRowCount,
    left: DEFAULT_GRID.left,
    top: computeTopFromBottom(gridRowCount) + DEFAULT_GRID.yOffset + Number(document.getElementById('cameraSlider2')?.dataset.yofs||0),
    tileW: DEFAULT_GRID.tileW,
    tileH: DEFAULT_GRID.tileH,
    gapX: Number(document.getElementById('cameraSlider1')?.dataset.gapx||DEFAULT_GRID.gapX),
    gapY: DEFAULT_GRID.gapY,
    scale: DEFAULT_GRID.scale,
    yOffset: Number(document.getElementById('cameraSlider2')?.dataset.yofs||0)
  };
}

// スライダへ min/max を反映（0..100 を実値へ射影）
function applyGapXClampToUI(img, p){
  const el = document.getElementById('cameraSlider1'); if(!el) return;
  const clamp = getGapXClamp(img.width, p);
  el.min = '0'; el.max = '100';
  const cur = Number(el.value||'50');
  const mapped = Math.round(clamp.min + (clamp.max - clamp.min) * (cur/100));
  el.dataset.gapx = String(mapped);
  el.title = `gapX: ${mapped} (min:${clamp.min}, max:${clamp.max})`;
}
function applyYOffsetClampToUI(img, p){
  const el = document.getElementById('cameraSlider2'); if(!el) return;
  const clamp = getYOffsetClamp(img.height, p);
  el.min = '0'; el.max = '100';
  const cur = Number(el.value||'50');
  const mapped = Math.round(clamp.min + (clamp.max - clamp.min) * (cur/100));
  el.dataset.yofs = String(mapped);
  el.title = `yOffset: ${mapped} (min:${clamp.min}, max:${clamp.max})`;
}

// ---- Image cache (Android Chrome 二重デコード回避) ----
const __IMG_CACHE = new Map(); // key -> { url, img, fileSig }

function __fileKey(f){
  try{ return `name=${f.name}|size=${f.size}|lm=${f.lastModified}`; }catch(_){ return null; }
}
function __cacheGetByFile(f){
  const k = __fileKey(f);
  if (!k) return null;
  return __IMG_CACHE.get(k) || null;
}
function __cacheSetForFile(f, url, img){
  const k = __fileKey(f);
  if (!k) return;
  __IMG_CACHE.set(k, { url, img, fileSig: k });
}
function __cacheRevoke(url){
  try{ if (url && url.startsWith('blob:')) URL.revokeObjectURL(url); }catch(_){}
}
function clearImageCacheAll(){
  try{
    for (const v of __IMG_CACHE.values()){ __cacheRevoke(v?.url); }
    __IMG_CACHE.clear();
    console.log('[IMG] cache CLEARED (all)');
  }catch(e){}
}
function clearImageCacheForFile(f){
  try{
    const k = __fileKey(f);
    const v = k && __IMG_CACHE.get(k);
    if (v){
      __cacheRevoke(v.url);
      __IMG_CACHE.delete(k);
      console.log('[IMG] cache CLEARED key=', k);
    }
  }catch(e){}
}

// 画像ロード（File/URL 両対応）
function loadImageAny(fileOrUrl, opts){
  const caller = (opts && opts.caller) || '(unknown)';
  return new Promise((resolve,reject)=>{
    const isFile = (typeof File !== 'undefined' && fileOrUrl instanceof File);
    const meta = {};
    try{
      if (isFile){
        meta.kind = 'File';
        meta.name = fileOrUrl.name;
        meta.type = fileOrUrl.type || '(unknown)';
        meta.size = fileOrUrl.size;
        meta.lastModified = fileOrUrl.lastModified;
      } else {
        meta.kind = 'URL';
        const u = String(fileOrUrl);
        meta.scheme = (u.match(/^[a-zA-Z]+:/)||['(unknown)'])[0];
        meta.length = u.length;
        meta.preview = u.length > 120 ? (u.slice(0,117) + '...') : u;
      }
    }catch(e){ /* ignore */ }

    // cache HIT
    if (isFile){
      const hit = __cacheGetByFile(fileOrUrl);
      if (hit && hit.img && (hit.img.naturalWidth||hit.img.width)){
        try{ console.log('[IMG] cache HIT', { caller, key: __fileKey(fileOrUrl) }); }catch(e){}
        return resolve(hit.img);
      }
    }

    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    try{ console.log('[IMG] load start', { caller, ...meta }); }catch(e){}

    const img = new Image();
    img.onload = ()=>{
      const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const ms = Math.round(t1 - t0);
      const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      try{ console.log('[IMG] load success', { caller, w, h, ms }); }catch(e){}
      if (isFile){
        const k = __fileKey(fileOrUrl);
        const current = __IMG_CACHE.get(k);
        if (!current){
          __cacheSetForFile(fileOrUrl, img.src, img);
        }
      }
      resolve(img);
    };
    img.onerror = (ev)=>{
      const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const ms = Math.round(t1 - t0);
      const msg = isFile
        ? `image load error (File; name=${meta.name}, type=${meta.type}, size=${meta.size}, ms=${ms}, caller=${caller})`
        : `image load error (URL; scheme=${meta.scheme}, length=${meta.length}, ms=${ms}, caller=${caller})`;
      try{ console.error('[IMG] load error', msg, { meta, caller }); }catch(_){};
      if (isFile){ clearImageCacheForFile(fileOrUrl); }
      reject(new Error(msg));
    };
    if (isFile) {
      try {
        const existed = __cacheGetByFile(fileOrUrl);
        if (existed && existed.url){
          img.src = existed.url;
          console.log('[IMG] reuse URL from cache', { caller });
        }else{
          const u = URL.createObjectURL(fileOrUrl);
          img.src = u;
          __cacheSetForFile(fileOrUrl, u, img);
          console.log('[IMG] cache MISS (create objectURL)', { caller });
        }
      } catch(e){
        console.error('[IMG] objectURL failed', e);
        img.src = '';
      }
    } else {
      try{ img.crossOrigin = 'anonymous'; }catch(e){}
      try{ img.src = String(fileOrUrl); }catch(e){ console.error('[IMG] invalid URL', e); img.src = ''; }
    }
    try{
      if (typeof img.decode === 'function'){
        img.decode().catch(err => { try{ console.warn('[IMG] decode failed (non-fatal)', err); }catch(_){}; });
      }
    }catch(_){}
  });
}

// UI hooks to clear cache
document.addEventListener('DOMContentLoaded', ()=>{
  try{
    const refreshBtn = document.getElementById('cameraRefresh');
    if (refreshBtn && !refreshBtn.__imgcache_bound){
      refreshBtn.__imgcache_bound = true;
      refreshBtn.addEventListener('click', ()=>{ clearImageCacheAll(); });
    }
    const fileInput = document.getElementById('cameraFile');
    if (fileInput && !fileInput.__imgcache_bound){
      fileInput.__imgcache_bound = true;
      fileInput.addEventListener('change', ()=>{
        clearImageCacheAll();
      });
    }
  }catch(e){}
});

// ---- Canvas extract ----
function extractTileCanvas(img, p, r, c){
  const sx = p.left + c * (p.tileW + p.gapX);
  const sy = p.top  + r * (p.tileH + p.gapY);
  const canvas = document.createElement('canvas');
  canvas.width = p.tileW * p.scale; canvas.height = p.tileH * p.scale;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, sx, sy, p.tileW, p.tileH, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// ---- Thumbnail builder ----
let __lastFile = null;
async function buildTileThumbnails(file){
  if(!file) return;
  const p   = getGridParamsFromUI();
  const img = await loadImageAny(file, { caller: 'thumbs' });
  applyGapXClampToUI(img, p);
  applyYOffsetClampToUI(img, p);
  const pClamped = getGridParamsFromUI();

  const wrap = document.getElementById('tileThumbs');
  const best = document.getElementById('bestLine');
  if (wrap) wrap.innerHTML = '';
  if (best) best.textContent = '';

  const stepX = pClamped.tileW + pClamped.gapX;
  const stepY = pClamped.tileH + pClamped.gapY;
  const usableW = Math.max(0, img.width - pClamped.left + pClamped.gapX);
  const maxCols = Math.max(1, Math.floor(usableW / stepX));
  const effCols = Math.min(pClamped.cols, maxCols);

  const scale = Math.max(0.05, Math.min(1, (typeof OCR_CONST !== 'undefined' ? OCR_CONST.THUMB_W : 40) / pClamped.tileW));
  const tc = document.createElement('canvas');
  tc.width  = Math.round(pClamped.tileW * scale);
  tc.height = Math.round(pClamped.tileH * scale);
  const tctx = tc.getContext('2d'); tctx.imageSmoothingEnabled = true; tctx.imageSmoothingQuality='high';

  let tileIndex = 0;
  for (let r=0; r<pClamped.rows; r++){
    for (let c=0; c<effCols; c++){
      tctx.clearRect(0,0,tc.width,tc.height);
      const sx = pClamped.left + c * stepX;
      const sy = pClamped.top  + r * stepY;
      tctx.drawImage(img, sx, sy, pClamped.tileW, pClamped.tileH, 0, 0, tc.width, tc.height);
      const thumb = new Image(); thumb.src = tc.toDataURL('image/png');
      thumb.alt = `tile ${++tileIndex}`; thumb.title = `tile ${tileIndex} (row ${r+1}, col ${c+1})`;
      thumb.className = 'tile-thumb';
      wrap?.appendChild(thumb);
    }
  }
}
