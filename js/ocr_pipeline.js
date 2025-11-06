// =========================
// ocr_pipeline.js  (OCR main pipeline + UI glue)
// =========================

// ローカル util（依存を減らす）
function cssEscape(s){ return String(s||'').replace(/\"/g,'\\"'); }

// === 実行前スナップショット & ボタン制御（UNDO用） ===
let PRE_OCR_SNAPSHOT = null; // [{ ing, val }, ...] を保持

function getOcrRunButton(){
  return document.querySelector(
    '#btnOcrRun, [data-action="ocr-run"], button[data-ocr-run], #btnCameraRun, button#runOcr'
  );
}

function setRunButtonEnabled(enabled){
  const btn = getOcrRunButton();
  if (!btn) return;
  btn.disabled = !enabled;
  btn.classList.toggle('disabled', !enabled);
}

function captureStockSnapshot(){
  const snap = [];
  try{
    (DATASET.ingredients || []).forEach(rec => {
      const input = findStockInputByName(rec.name);
      if (input) {
        const val = parseInt(input.value || '0', 10) || 0;
        snap.push({ ing: rec.name, val });
      }
    });
  }catch(e){ /* ignore */ }
  return snap;
}

function applyStockSnapshot(snap){
  if (!Array.isArray(snap)) return 0;
  let cnt = 0;
  for (const it of snap){
    const input = findStockInputByName(it.ing);
    if (!input) continue;
    input.value = String(it.val);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    cnt++;
  }
  return cnt;
}

// === 実行後トースト（3秒表示・元に戻す=S1 強制復元） ===
let OCR_TOAST_TIMER = null;

function showUndoToastAfterRun(){
  let area = document.getElementById('toastArea');
  if (!area) {
    area = document.createElement('div');
    area.id = 'toastArea';
    area.className = 'position-fixed bottom-0 end-0 p-3';
    area.style.zIndex = '1080';
    document.body.appendChild(area);
  }
  area.innerHTML = '';

  const toast = document.createElement('div');
  toast.className = 'toast show border-0 shadow-sm';
  toast.setAttribute('role','status');
  toast.setAttribute('aria-live','polite');
  toast.setAttribute('aria-atomic','true');
  toast.innerHTML = `
    <div class="toast-body d-flex align-items-center gap-3">
      <span>上書きしました</span>
      <button type="button" class="btn btn-sm btn-outline-secondary ms-auto" id="undoAll">元に戻す</button>
    </div>`;
  area.appendChild(toast);

  const finish = () => {
    if (OCR_TOAST_TIMER) { clearTimeout(OCR_TOAST_TIMER); OCR_TOAST_TIMER = null; }
    toast.classList.remove('show'); toast.classList.add('hide');
    setTimeout(()=>{ toast.remove(); }, 200);
    setRunButtonEnabled(true);
  };

  toast.querySelector('#undoAll').addEventListener('click', () => {
    try {
      const n = applyStockSnapshot(PRE_OCR_SNAPSHOT);
      addHistoryLine(`元に戻す: 読取前の状態へ復元（${n}項目）`);
      const panel = document.getElementById('confirmPanel');
      if (panel){ panel.innerHTML=''; panel.classList.add('d-none'); }
    } catch(e){ console.warn(e); }
    finally {
      PRE_OCR_SNAPSHOT = null;
      finish();
    }
  });

  OCR_TOAST_TIMER = setTimeout(() => {
    PRE_OCR_SNAPSHOT = null;
    finish();
  }, 3000);
}

function addHistoryLine(msg){ try{ console.log('[HIST]', msg); }catch(_){} }

function findStockInputByName(name){
  const row = document.querySelector(`#totalTable tr[data-ing="${cssEscape(name)}"]`);
  return row ? row.querySelector('input[type=number]') : null;
}

/* ---------------------------------------------
 * 表示行が無い場合でも在庫を保存するフォールバック
 * --------------------------------------------- */
function persistStockFallback(ing, qty){
  try{
    if (!ing || !(Number.isFinite(qty) && qty > 0)) return false;
    if (typeof stock === 'undefined' || typeof saveStockToLS !== 'function') return false;
    stock.set(ing, qty);
    saveStockToLS();
    return true;
  }catch(e){ console.warn('persistStockFallback failed', e); return false; }
}

// 確認パネル（統合UI）
function renderConfirmPanelUnified(items){
  const root = document.getElementById('confirmPanel');
  if (!root) return;
  root.innerHTML = '';

  if (!items || !items.length) { root.classList.add('d-none'); return; }

  const card = document.createElement('div');
  card.className = 'card';

  const hd = document.createElement('div');
  hd.className = 'card-header d-flex align-items-center justify-content-between';
  const title = document.createElement('div');
  title.innerHTML = `<strong>確認（未自動適用）</strong> <small class="text-muted">${items.length}件</small>`;
  const discardAllBtn = document.createElement('button');
  discardAllBtn.className = 'btn btn-sm btn-outline-secondary';
  discardAllBtn.textContent = '全部破棄';
  discardAllBtn.addEventListener('click', () => { list.innerHTML = ''; root.classList.add('d-none'); });
  hd.appendChild(title); hd.appendChild(discardAllBtn);
  card.appendChild(hd);

  const body = document.createElement('div');
  body.className = 'card-body p-2';

  const list = document.createElement('div');
  list.className = 'list-group';

  const buildIngSelect = (defaultName) => {
    const sel = document.createElement('select');
    sel.className = 'form-select form-select-sm';
    const ph = document.createElement('option');
    ph.value = ''; ph.textContent = '— 食材を選択 —';
    sel.appendChild(ph);
    (DATASET.ingredients || []).forEach(rec => {
      const opt = document.createElement('option');
      opt.value = rec.name; opt.textContent = rec.name;
      if (defaultName && defaultName === rec.name) opt.selected = true;
      sel.appendChild(opt);
    });
    return sel;
  };

  items.forEach((t, idx) => {
    const row = document.createElement('div');
    row.className = 'list-group-item d-flex align-items-center gap-2';
    row.dataset.idx = String(idx);

    const thumb = new Image();
    thumb.src = t.thumb; thumb.alt = 'tile';
    thumb.className = 'tile-thumb';
    row.appendChild(thumb);

    let ingFixed = !!t.bestName && t.bestDist <= (OCR_CONST.AUTO_APPLY_DIST_MAX ?? 1);
    let ingName = t.bestName || '';

    let ingNode;
    if (ingFixed) {
      ingNode = document.createElement('span');
      ingNode.className = 'badge badge-soft';
      ingNode.textContent = ingName;
    } else {
      ingNode = buildIngSelect(ingName || '');
    }
    row.appendChild(ingNode);

    const qtyInput = document.createElement('input');
    qtyInput.type = 'number';
    qtyInput.className = 'form-control form-control-sm w-6ch';
    qtyInput.min = '0'; qtyInput.step = '1';
    qtyInput.value = String(Math.max(0, parseInt(t.qty || '0', 10) || 0));
    row.appendChild(qtyInput);

    const trash = document.createElement('button');
    trash.className = 'btn btn-sm btn-outline-secondary ms-auto';
    trash.textContent = '破棄';
    trash.addEventListener('click', () => { row.remove(); if (!list.querySelector('.list-group-item')) root.classList.add('d-none'); });
    row.appendChild(trash);

    row.__getResolved = () => {
      const ingResolved = (ingNode.tagName === 'SELECT') ? ingNode.value : ingName;
      const q = parseInt(qtyInput.value || '0', 10) || 0;
      return { ing: ingResolved, qty: q };
    };

    list.appendChild(row);
  });

  body.appendChild(list);
  card.appendChild(body);

  const ft = document.createElement('div');
  ft.className = 'card-footer text-end';
  const applyBtn = document.createElement('button');
  applyBtn.className = 'btn btn-sm btn-primary';
  applyBtn.textContent = '上書き（すべて）';
  applyBtn.addEventListener('click', () => {
    const rows = [...list.querySelectorAll('.list-group-item')];
    let applied = 0;
    for (const row of rows) {
      const { ing, qty } = row.__getResolved?.() || {};
      if (!ing || !(Number.isFinite(qty) && qty > 0)) continue;
      const input = findStockInputByName(ing);
      if (input) {
        const prev = parseInt(input.value || '0', 10) || 0;
        input.value = String(qty);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        applied++;
      } else {
        if (persistStockFallback(ing, qty)) applied++;
      }
    }
    if (applied > 0) addHistoryLine(`一括上書き: ${applied}件 (confirm unified)`);
    root.classList.add('d-none');
  });

  ft.appendChild(applyBtn);
  card.appendChild(ft);

  root.appendChild(card);
  root.classList.remove('d-none');
}

// OCRハイブリッド（倍率リトライ → 自動/確認 反映）
// 依存：ensureTesseract, loadImageAny, applyGapXClampToUI, applyYOffsetClampToUI,
//       getGridParamsFromUI, extractTileCanvas, buildTileThumbnails, recognizeTile
async function ocrHybridGrid(file, scaleOverride){
  await ensureTesseract();
  const status = (t)=>{ const s=document.getElementById('ocrStatus'); if(s) s.textContent=t||''; };

  setRunButtonEnabled(false);
  PRE_OCR_SNAPSHOT = captureStockSnapshot();

  try{
    status('読み取り準備…');
    const img = await loadImageAny(file, { caller: 'thumbs' });
    applyGapXClampToUI(img, getGridParamsFromUI());
    applyYOffsetClampToUI(img, getGridParamsFromUI());
    const p = getGridParamsFromUI();

    const grid = [];
    const stepX = p.tileW + p.gapX;
    const stepY = p.tileH + p.gapY;
    const usableW = Math.max(0, img.width - p.left + p.gapX);
    const maxCols = Math.max(1, Math.floor(usableW / stepX));
    const effCols = Math.min(p.cols, maxCols);
    for (let r=0; r<p.rows; r++){
      for (let c=0; c<effCols; c++){
        grid.push({ r, c });
      }
    }

    const thumbs = [];
    const tiles  = [];
    const sc = Math.max(0.05, Math.min(1, OCR_CONST.THUMB_W / p.tileW));
    const tc = document.createElement('canvas'); tc.width=Math.round(p.tileW*sc); tc.height=Math.round(p.tileH*sc);
    const tctx = tc.getContext('2d'); tctx.imageSmoothingEnabled=true; tctx.imageSmoothingQuality='high';

    for (const cell of grid){
      const tile = extractTileCanvas(img, p, cell.r, cell.c);
      tiles.push(tile);
      tctx.clearRect(0,0,tc.width,tc.height);
      tctx.drawImage(tile, 0, 0, p.tileW*p.scale, p.tileH*p.scale, 0, 0, tc.width, tc.height);
      thumbs.push(tc.toDataURL('image/png'));
    }

    const scales = (scaleOverride ? [scaleOverride] : [0.75]);
    const MAX_PAR = 2;

    status('読み取り中… 0/'+tiles.length);

    const results = new Array(tiles.length);
    let done = 0, nextIdx = 0;

    async function processOne(idx){
      const can = tiles[idx];
      let picked = null;
      for (const s of scales){
        const r = await recognizeTile(can, s);
        r.thumb = thumbs[idx];
        picked = r;
        if (r.best && r.best.id!=null && Number.isFinite(r.qty) && r.qty>0 && r.best.dist <= (OCR_CONST.AUTO_APPLY_DIST_MAX ?? 1)) break;
      }
      results[idx] = picked;
      status(`読み取り中… ${++done}/${tiles.length}`);
    }

    async function worker(){
      while(true){
        const i = nextIdx++;
        if (i >= tiles.length) break;
        await processOne(i);
      }
    }
    const workers = Array.from({length: Math.min(MAX_PAR, tiles.length)}, ()=>worker());
    await Promise.all(workers);

    const auto = [];
    const duplicates = new Map();
    const leftovers = [];

    for (let i=0;i<results.length;i++){
      const t = results[i];
      if (!(Number.isFinite(t.qty) && t.qty>0)) { leftovers.push(t); continue; }
      if (!t.best || t.best.id==null) { leftovers.push(t); continue; }
      const ing = DATASET.ingredients[t.best.id]?.name;
      if (!ing) { leftovers.push(t); continue; }
      t.bestName = ing;
      if (isAutoApplyCase(t)) { auto.push(t); continue; }
      if (!duplicates.has(ing)) duplicates.set(ing, []);
      duplicates.get(ing).push(t);
    }

    for (const t of auto){
      const input = findStockInputByName(t.bestName);
      if (input) {
        const prev = parseInt(input.value || '0', 10) || 0;
        input.value = String(t.qty);
        input.dispatchEvent(new Event('input', { bubbles:true }));
        addHistoryLine(`上書き: ${t.bestName} ← ${t.qty} (auto)`);
      } else {
        if (persistStockFallback(t.bestName, t.qty)) {
          addHistoryLine(`上書き: ${t.bestName} ← ${t.qty} (auto, saved off-screen)`);
        }
      }
    }

    const toConfirm = [];
    const included = new Set();

    for (const [ing, tilesArr] of duplicates.entries()){
      if (tilesArr.length > 1) {
        tilesArr.sort((a,b) => (a.best?.dist ?? 99) - (b.best?.dist ?? 99));
        const pick = tilesArr[0];
        if (pick && !included.has(pick)) { toConfirm.push(pick); included.add(pick); }
      } else if (tilesArr.length === 1) {
        const pick = tilesArr[0];
        if (pick && !included.has(pick)) { toConfirm.push(pick); included.add(pick); }
      }
    }

    results.forEach(t => {
      if (included.has(t)) return;
      if (t.best && Number.isFinite(t.qty) && t.qty >= (OCR_CONST.AUTO_CONFIRM_QTY_MIN ?? 300)) {
        toConfirm.push(t); included.add(t);
      }
    });

    results.forEach(t => {
      if (included.has(t)) return;
      const needConfirm =
        !t.best ||
        (t.best && t.best.dist > (OCR_CONST.AUTO_APPLY_DIST_MAX ?? 1)) ||
        !(Number.isFinite(t.qty) && t.qty > 0);

      if (!t.best && !(Number.isFinite(t.qty) && t.qty > 0)) return;
      if (needConfirm) { toConfirm.push(t); included.add(t); }
    });

    if (toConfirm.length){
      toConfirm.forEach(t => { t.bestDist = t.best?.dist ?? null; });
      renderConfirmPanelUnified(toConfirm);
    } else {
      document.getElementById('confirmPanel')?.classList.add('d-none');
    }

    document.getElementById('gridPreview')?.classList.remove('d-none');
    await buildTileThumbnails(file);

    status(results.length ? '読み取り完了' : '検出なし');

    showUndoToastAfterRun();
    return results.length;
  } catch (err){
    console.error(err); status('エラー');
    PRE_OCR_SNAPSHOT = null;
    setRunButtonEnabled(true);
    return 0;
  }
}

function isAutoApplyCase(t){
  if (!t || !t.best || t.best.id==null) return false;
  if (!(Number.isFinite(t.qty) && t.qty>0)) return false;
  if (t.qty >= OCR_CONST.AUTO_CONFIRM_QTY_MIN) return false;
  return (t.best.dist <= (OCR_CONST.AUTO_APPLY_DIST_MAX ?? 1));
}
