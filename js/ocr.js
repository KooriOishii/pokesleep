/* =========================================================================
 * ocr.js — グリッドOCR専用モジュール
 * 依存: data.js / utils.js / tesseract.js (v5)
 * 役割:
 *   - 在庫スクショのグリッドから「食材名 × 個数」を抽出
 *   - 抽出結果は在庫（inventory）へ直接反映（テーブルなどは描画しない）
 *   - 実行前に app.js 側で在庫バックアップ（↺復元対応）
 *
 * 公開関数/イベント:
 *   - onGridOcrClick(): #gridOcrBtn に click で接続（DOMContentLoaded内）
 *   - ocrHybridGrid(file, overrideScale?): 認識実行（UI倍率 or 指定倍率）
 *
 * 備考:
 *   - 認識ワーカーは「名前用（jpn+eng）」と「数字用（eng）」を使い分け（v5）
 *   - 画像は2値化 & 倍率調整で安定化。失敗時は倍率を上げて自動リトライ
 *   - あいまい一致は「トークン投票 + 部分距離」ハイブリッド
 * ========================================================================= */

/* ---- DOM参照 ---- */
const OCR = {
  elInput: document.getElementById('invImage'),
  status:  document.getElementById('ocrStatus'),
  out:     document.getElementById('ocrResult'),
};

// 出力領域が無ければ自動生成
(() => {
  if (!OCR.out) {
    const div = document.createElement('div');
    div.id = 'ocrResult';
    div.style.marginTop = '8px';
    const cards = document.querySelectorAll('.card');
    const ocrCard = cards[cards.length - 1];
    (ocrCard || document.body).appendChild(div);
    OCR.out = div;
  }
})();

/* ---- Tesseract ワーカーの用意（v5: 言語プリロード済み） ---- */
let W_NAME = null; // 食材名用（jpn+eng）
let W_DIG  = null; // 数字抽出用
let __workersLoading = null;

async function ensureWorkers(){
  if (W_NAME && W_DIG) return;
  if (__workersLoading) { await __workersLoading; return; }

  __workersLoading = (async ()=>{
    const { createWorker } = Tesseract;

    // v5 では createWorker に言語を渡すだけで OK（loadLanguage/initialize は不要）
    // 名前用（日本語含む）
    W_NAME = await createWorker('jpn+eng');
    await W_NAME.setParameters({
      // 文字分割を粗くしすぎない
      preserve_interword_spaces: '1',
      // 単一ブロック内のテキスト行の認識に強い
      tessedit_pageseg_mode: '6',
      // DPI を固定して安定化
      user_defined_dpi: '300',
    });

    // 数字専用
    W_DIG = await createWorker('eng');
    await W_DIG.setParameters({
      tessedit_char_whitelist: '0123456789xX×✕',
      preserve_interword_spaces: '1',
      tessedit_pageseg_mode: '6',
      user_defined_dpi: '300',
    });
  })();

  await __workersLoading;
}

/* ---- 画像読み込みユーティリティ ---- */
// 先頭付近に追加
const __imgCache = new Map(); // key -> HTMLImageElement
function keyOfBlob(b){ return `${b?.name||'blob'}:${b?.size||0}:${b?.lastModified||0}`; }

async function loadImageAny(input){
  if (input instanceof HTMLImageElement) {
    if (!input.complete) await new Promise((res, rej)=>{ input.onload=res; input.onerror=rej; });
    return input;
  }
  if (typeof input === 'string') {
    const im = new Image(); im.src = input;
    await new Promise((res, rej)=>{ im.onload=res; im.onerror=rej; });
    return im;
  }
  if (input instanceof Blob) {
    const key = keyOfBlob(input);
    const cached = __imgCache.get(key);
    if (cached && cached.complete) return cached;

    const url = URL.createObjectURL(input);
    try {
      const im = new Image(); im.src = url;
      await new Promise((res, rej)=>{ im.onload=res; im.onerror=rej; });
      __imgCache.set(key, im);      // ★ キャッシュに保持
      return im;
    } finally {
      // ここで revoke しない：キャッシュを使う間はURL保持
      // （ガベージ回収でイメージ破棄されるのを防ぐ）
    }
  }
  const im = new Image(); im.src = String(input);
  await new Promise((res, rej)=>{ im.onload=res; im.onerror=rej; });
  return im;
}
// ファイル先頭付近に追加（調整OK）
const MAX_CANVAS_PIXELS = 5_000_000; // 500万px目安（iOSでも安定しやすい）
const MAX_SCALE = 4;                 // 上限（既存と同等）
const MIN_SCALE = 1;                 // 下限

/* ---- 2値化（前処理）: BIN_GAIN / BIN_TH は utils.js の定数 ---- */
async function binarizeImageToCanvas(file, scale = 2){
  const img = await loadImageAny(file);

  // 元画像面積から許容スケールを自動算出
  const area = img.width * img.height;
  // 目標面積を超えないようにスケールを下げる
  const clampByArea = Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, area));
  const eff = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(scale, clampByArea)));

  const w = Math.max(1, Math.round(img.width  * eff));
  const h = Math.max(1, Math.round(img.height * eff));

  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;

  // createImageBitmap が使える環境では高速＆省メモリ
  try{
    if (window.createImageBitmap && img instanceof HTMLImageElement){
      const bmp = await createImageBitmap(img);
      ctx.drawImage(bmp, 0, 0, w, h);
      bmp.close?.();
    }else{
      ctx.drawImage(img, 0, 0, w, h);
    }
  }catch{
    // フォールバック
    ctx.drawImage(img, 0, 0, w, h);
  }

  const imgd = ctx.getImageData(0, 0, w, h);
  const d = imgd.data;
  const GAIN = (typeof BIN_GAIN === 'number') ? BIN_GAIN : 1.25;
  const TH   = (typeof BIN_TH   === 'number') ? BIN_TH   : 175;

  for (let i=0;i<d.length;i+=4){
    let g = (d[i]*0.3 + d[i+1]*0.59 + d[i+2]*0.11);
    g = (g - 128) * GAIN + 128;
    const t = g > TH ? 255 : 0;
    d[i]=d[i+1]=d[i+2]=t; d[i+3]=255;
  }
  ctx.putImageData(imgd, 0, 0);
  c.__effScale = eff; // 実効倍率を保持
  return c;
}

/* ---- OCR（前処理済みキャンバスからタイルを直接認識） ---- */
async function recognizeTileFromPreCanvas(srcCanvas, sx, sy, sw, sh, requestedScale){
  await ensureWorkers();

  const tile = document.createElement('canvas');
  tile.width = sw; tile.height = sh;
  const tctx = tile.getContext('2d');
  tctx.imageSmoothingEnabled = false;
  tctx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

  // --- 追加：タイル単位アップサンプリング -----------------------
  // preCanvas には 2値化時の実効倍率がメモされている想定（無ければ 1）
  const ES = Number(srcCanvas.__effScale || 1);
  const desired = Number(requestedScale || ES);
  const up = Math.max(1, desired / ES); // 例: req=3.5, ES=1.41 → up≈2.48

  let ocrInputCanvas = tile;
  if (up > 1.01) {
    // 上げすぎ抑制（端末保護）— 必要なら上限を調整
    const UP_CAP = 3.0;
    const f = Math.min(up, UP_CAP);
    const upW = Math.round(tile.width  * f);
    const upH = Math.round(tile.height * f);

    const upCanvas = document.createElement('canvas');
    upCanvas.width = upW; upCanvas.height = upH;
    const uctx = upCanvas.getContext('2d');
    uctx.imageSmoothingEnabled = false; // ドット保持
    uctx.drawImage(tile, 0, 0, tile.width, tile.height, 0, 0, upW, upH);
    ocrInputCanvas = upCanvas;
  }
 // --------------------------------------------------------------
 
  const dataURL = ocrInputCanvas.toDataURL('image/png');
  const r1 = await W_NAME.recognize(dataURL);
  const r2 = await W_DIG.recognize(dataURL);

  const rawNameText  = (r1.data.text || '');
  const rawDigitText = (r2.data.text || '');

  const nameNoSpace  = normalizeOcrText(rawNameText);
  const digitNoSpace = normalizeOcrText(rawDigitText);

  const nameTokens = rawNameText
    .replace(/[×✕xX]/g, ' ')
    .replace(/[^一-龠ぁ-ゔァ-ヴーa-zA-Z0-9]/g, ' ')
    .split(/\s+/)
    .map(s=>normalizeOcrText(s))
    .filter(s=>s.length>=2);

  const matchedId = matchIngredientByTokens(nameTokens, nameNoSpace);
  const matchedName = (matchedId!=null) ? ingredients[matchedId].name : null;

  let qty = 0;
  const merged = (nameNoSpace + 'x' + digitNoSpace).replace(/[×✕xX]/g,'x');
  let m = merged.match(/x([0-9]{1,3})(?![0-9])/);
  if (!m) m = merged.match(/([0-9]{1,3})(?![0-9])/);
  if (m && m[1]) qty = parseInt(m[1],10) || 0;

  return { matchedName, qty, rawNameText, rawDigitText, bestToken:(nameTokens[0]||''), dist: undefined };
}

/* ---- 正規化ユーティリティ（空白除去） ---- */
function normalizeOcrText(s){ return (!s) ? '' : String(s).replace(/\s+/g,'').trim(); }

/* ---- あいまい一致（トークン & 部分距離 ハイブリッド） ---- */
// インデックス: トークン -> 食材ID集合
const keywordIndex = new Map();
// 各食材の「正規化済みフルキー」
const ingredientFullKeys = ingredients.map(i=>normalizeKey(i.name));
// 許容距離（少し緩め）：必要なら 2 に戻してOK
const MAX_DIST = 3;

(function buildKeywordIndex(){
  const MIN_TOKEN_LEN = 2;
  const addKey = (key, ingId)=>{
    const k = normalizeKey(key||'');
    if (k.length < MIN_TOKEN_LEN) return;
    if(!keywordIndex.has(k)) keywordIndex.set(k, new Set());
    keywordIndex.get(k).add(ingId);
  };

  ingredients.forEach((ing, id)=>{
    for (const a of (ing.aliases||[])) addKey(a, id);

    const tokens = ing.name
      .replace(/[×✕xX]/g,' ')
      .replace(/[^一-龠ぁ-ゔァ-ヴーa-zA-Z0-9]/g,' ')
      .split(/\s+/).map(t=>t.trim()).filter(Boolean);

    for (const t of tokens){
      if (typeof STOPWORDS!=='undefined' && STOPWORDS?.has?.(t)) continue;
      addKey(t, id);
    }
    addKey(ing.name, id);
  });
})();

function matchIngredientByTokens(nameTokens, compactText){
  // 1) トークン投票
  const votes = new Map(); // id -> count
  for (const tok of nameTokens||[]){
    const k = normalizeKey(tok);
    const ids = keywordIndex.get(k);
    if (ids) for (const id of ids) votes.set(id, (votes.get(id)||0)+1);
  }
  if (votes.size){
    let bestId = null, bestVote = -1, bestDist = Infinity;
    for (const [id, v] of votes){
      const full = ingredientFullKeys[id] || '';
      const d = minSubstrDistance(compactText||'', full||''); // utils.js
      if (v > bestVote || (v===bestVote && d < bestDist)){
        bestId = id; bestVote = v; bestDist = d;
      }
    }
    if (bestDist <= MAX_DIST) return bestId;
  }
  // 2) 距離のみで全探索
  const text = compactText||'';
  let pickId=null, pickD=Infinity;
  for (let id=0; id<ingredientFullKeys.length; id++){
    const d = minSubstrDistance(text, ingredientFullKeys[id]);
    if (d < pickD){ pickD=d; pickId=id; if (d===0) break; }
  }
  return (pickD<=MAX_DIST) ? pickId : null;
}

/* ---- グリッドパラメータ ---- */
function valNum(id1, id2, def=0){
  const el = document.getElementById(id1) || document.getElementById(id2);
  const v = el ? Number(el.value) : NaN;
  return Number.isFinite(v) ? v : def;
}

const DEFAULT_GRID = {
  cols: 4, rows: 4,
  left: 50, top: 510,
  tileW: 225, tileH: 340,
  gapX: 24, gapY: 38,
  scale: 2, yOffset: 0
};
const DEFAULT_BOTTOM =
  DEFAULT_GRID.top
  + (DEFAULT_GRID.rows - 1) * (DEFAULT_GRID.tileH + DEFAULT_GRID.gapY)
  + DEFAULT_GRID.tileH;

function computeTopFromBottom(rows){
  rows = Math.max(1, Math.min(4, Number(rows) || DEFAULT_GRID.rows));
  const tileH = valNum('ocrTileH','gTileH', DEFAULT_GRID.tileH);
  const gapY  = valNum('ocrGapY','gGapY',  DEFAULT_GRID.gapY);
  const stepY = tileH + gapY;
  return Math.round(DEFAULT_BOTTOM - tileH - (rows - 1) * stepY);
}
// === gapX（列の間隔）クランプ ===================================
// 画像幅・列数・タイル幅・left から gapX の安全上限を計算
function getGapXClamp(imgWidth, p){
  const el = document.getElementById('ocrGapX');
  const minHTML = el ? Number(el.min || 0) : 0;  // HTML min を尊重
  const min = Number.isFinite(minHTML) ? minHTML : 0;

  // 右端まで収める条件:
  // left + (cols-1)*(tileW + gapX) + tileW <= imgWidth
  // → (cols-1)*gapX <= imgWidth - left - cols*tileW
  let max;
  if (p.cols <= 1){
    max = Math.max(0, Math.floor(imgWidth - p.left - p.tileW));
  } else {
    const numer = imgWidth - p.left - p.tileW * p.cols;
    max = Math.floor(numer / Math.max(1, (p.cols - 1)));
    if (!Number.isFinite(max) || max < 0) max = 0;
  }

  // HTML の max が小さければそれを優先（UI一貫性）
  const maxHTML = el ? Number(el.max || max) : max;
  if (Number.isFinite(maxHTML)) max = Math.min(max, maxHTML);

  // 極端なケース(min>max)は min=max に寄せる
  if (min > max) return { min: max, max: max };

  return { min, max };
}

// UIの #ocrGapX スライダーにクランプを適用（min/max/value と表示を更新）
function applyGapXClampToUI(img, p){
  const el  = document.getElementById('ocrGapX');
  const out = document.getElementById('ocrGapXVal');
  if (!el) return;

  const {min, max} = getGapXClamp(img.width, p);
  let v = Number(el.value || 0);
  if (v < min) v = min;
  if (v > max) v = max;

  el.min = String(min);
  el.max = String(max);
  el.value = String(v);

  // 表示は px 統一（既存 syncRangeOutputs と整合）
  if (out) out.textContent = `${v}px`;

  // 既存の保存処理を流用
  try{ if (typeof saveGridPrefs === 'function') saveGridPrefs(); }catch{}
}

// === yOffset クランプ用ヘルパー ================================
// 行数・タイル高・縦ギャップから「箱の総高さ」を算出
function getBoxHeight(p){
  return p.rows * p.tileH + (p.rows - 1) * p.gapY;
}

// 画像の高さと「下端固定の基準top」から、yOffsetの安全範囲[min,max]を返す
function getYOffsetClamp(imgHeight, p){
  const baseTop = computeTopFromBottom(p.rows); // 下端固定の基準top（yOffset未適用）
  const boxH = getBoxHeight(p);

  // top >= 0 && (top + boxH) <= imgHeight となる yOffset 範囲
  const minOffset = -baseTop;                         // 上方向（負）に行ける最大
  const maxOffset = imgHeight - (baseTop + boxH);     // 下方向（正）に行ける最大

  return {
    min: Math.ceil(minOffset),
    max: Math.floor(maxOffset)
  };
}

// UIスライダー(ocrYOffset)へクランプを適用し、min/max/valueと表示を更新
function applyYOffsetClampToUI(img, p){
  const el   = document.getElementById('ocrYOffset');
  const val  = document.getElementById('ocrYOffsetVal');
  const hint = document.getElementById('ocrYOffsetHint');
  if(!el) return;

  const clamp = getYOffsetClamp(img.height, p);
  let v = Number(el.value || 0);
  if (v < clamp.min) v = clamp.min;
  if (v > clamp.max) v = clamp.max;

  el.min = String(clamp.min);
  el.max = String(clamp.max);
  el.value = String(v);

  if (val)  val.textContent = String(v);
  if (hint) hint.textContent = `安全範囲: ${clamp.min} 〜 ${clamp.max} px`;

  // ローカル保存を使っている場合は上書き
  try{
    const prefs = (typeof loadGridPrefs === 'function') ? (loadGridPrefs() || {}) : {};
    prefs.yOffset = v;
    if (typeof saveGridPrefs === 'function') saveGridPrefs(prefs);
  }catch(_){}
}

function getGridParamsFromUI(){
  // rows は既存仕様の 1〜4 にクランプ
  let rows = valNum('ocrRows','gRows', DEFAULT_GRID.rows);
  rows = Math.max(1, Math.min(4, rows));

  // ★ 新規: 垂直オフセット（UIが無い/未設定でも 0 を既定）
  //   - UI id: "ocrYOffset"
  //   - localStorage key: "gYOffset"
  const yOffset = valNum('ocrYOffset', 'gYOffset', (DEFAULT_GRID.yOffset ?? 0)) || 0;

  // ★ 下端基準 top に yOffset を加算（正で下、負で上に平行移動）
  const top = computeTopFromBottom(rows) + yOffset;

  return {
    cols:  Math.max(1, valNum('ocrCols','gCols',  DEFAULT_GRID.cols)),
    left:  valNum('ocrLeft','gLeft',               DEFAULT_GRID.left),
    top,                                           // ★ ここだけ差し替え
    tileW: valNum('ocrTileW','gTileW',            DEFAULT_GRID.tileW),

    // ★ 高さスライダーは削除するため、UI/保存値を見ずに固定値を採用
    //    既存の localStorage が残っていても無視して常に DEFAULT を返す
    tileH: DEFAULT_GRID.tileH,

    gapX:  valNum('ocrGapX','gGapX',              DEFAULT_GRID.gapX),
    gapY:  valNum('ocrGapY','gGapY',              DEFAULT_GRID.gapY),
    rows,
    scale: Math.max(1, valNum('ocrScale','gScale', DEFAULT_GRID.scale)),

    // ★ 参照できるよう戻り値にも入れておく
    yOffset,
  };
}

// ---- グリッドOCR本体（overrideScale対応 & 件数返却 + デバッグ出力） ----
async function ocrHybridGrid(file, overrideScale){
  const p = getGridParamsFromUI();
  const S = (Number.isFinite(overrideScale) && overrideScale > 0) ? overrideScale : (Number(p.scale) || 2);
  
  // 前処理キャンバス（OCR用）と元画像（列数判定用）
  const preCanvas = await binarizeImageToCanvas(file, S);
  const ES = Number(preCanvas.__effScale || S); // Effective Scale
  console.log(`[grid] req=${S.toFixed(2)} ES=${ES.toFixed(2)} pre=${preCanvas.width}x${preCanvas.height}`);
  
  const img = await loadImageAny(file);
  // gapX を画像幅に合わせてクランプ → 最新値で再取得
  applyGapXClampToUI(img, p);
  let pClamped = getGridParamsFromUI();

  // ▼ 追記: 認識実行直前にもクランプを適用
  applyYOffsetClampToUI(img, getGridParamsFromUI());
  pClamped = getGridParamsFromUI();
  // 以降、p を使っているなら pClamped に置き換え

  // 実効列数を画像幅から決定（はみ出し防止）
  const stepX = pClamped.tileW + pClamped.gapX;
  const stepY = pClamped.tileH + pClamped.gapY;
  const usableW = Math.max(0, img.width - pClamped.left + pClamped.gapX);
  const maxCols = Math.max(1, Math.floor(usableW / stepX));
  const effCols = Math.min(pClamped.cols, maxCols);

  const found = [];
  const debugRows = [];
  let tileIndex = 0;

  for(let r=0; r<pClamped.rows; r++){
    for(let c=0; c<effCols; c++){
      const sx0 = pClamped.left + c*stepX;
      const sy0 = pClamped.top  + r*stepY;
      if (sx0 + pClamped.tileW > img.width)  continue;
      if (sy0 + pClamped.tileH > img.height) continue;

      const sx = Math.round(sx0 * ES);
      const sy = Math.round(sy0 * ES);
      const sw = Math.round(pClamped.tileW * ES);
      const sh = Math.round(pClamped.tileH * ES);

      // ★ 既存のタイル認識APIを利用（未定義関数は使わない）
      const res = await recognizeTileFromPreCanvas(preCanvas, sx, sy, sw, sh, S);
      const index = ++tileIndex;

      debugRows.push({
        index, row:r+1, col:c+1,
        matchedName: res.matchedName || '',
        qty: res.qty || 0,
        bestToken: res.bestToken || '',
        dist: (res.dist ?? ''),
        rawNameText: res.rawNameText,
        rawDigitText: res.rawDigitText
      });

      if (res.matchedName && Number.isInteger(res.qty) && res.qty>0){
        found.push({name: res.matchedName, qty: res.qty});
      }
    }
  }

  // 集計 → 在庫反映
  const agg = new Map();
  for (const { name, qty } of found) agg.set(name, (agg.get(name)||0) + qty);
  for (const [name, qty] of agg) setStock(name, qty);
  renderTotals();

  // ★ デバッグ表示（テーブルは出さず、生ログを <pre> に出力）
  if (OCR && OCR.out) {
    const esc = s => String(s ?? '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const lines = debugRows.map(r => {
      const name1 = r.matchedName || '-';
      const qty1  = Number.isFinite(r.qty) ? r.qty : '';
      const tok   = esc((r.bestToken || '').replace(/\s+/g,' ').trim());
      const rawN  = esc((r.rawNameText || '').replace(/\s+/g,' ').trim());
      const rawD  = esc((r.rawDigitText|| '').replace(/\s+/g,' ').trim());
      return `#${r.index} r${r.row}c${r.col}  [${name1} x${qty1}]  tok="${tok}"  name="${rawN}"  num="${rawD}"`;
    }).join('\n');

//     OCR.out.innerHTML = `
//       <div class="small" style="color:#666">
//         デバッグ出力（倍率=${ES.toFixed(2)} / 要求=${S.toFixed(2)}） 各タイルのOCR生文字列／マッチ結果
//       </div>
//       <pre style="white-space:pre-wrap;font-size:12px;background:#f7f7f7;
//         padding:6px;border:1px solid #ddd;max-height:260px;overflow:auto">
// ${lines || '(出力なし)'}
//       </pre>
//     `;
  }

  if (OCR && OCR.status) {
    OCR.status.textContent = found.length ? 'グリッドOCR完了' : '検出なし（グリッドOCR完了）';
  }

  // 既存の呼び出し元と互換のため「件数」を返す
  return found.length;
}

/* ---- サムネ生成（行数変更や画像選択で更新） ---- */
let __lastFile = null;
const THUMB_W   = 40;
const THUMB_GAP = 6;

async function buildTileThumbnails(file){
  if(!file) return;
  const p   = getGridParamsFromUI();
  const img = await loadImageAny(file);

  // ▼ gapX を画像幅に合わせてクランプし、最新値で再取得
  applyGapXClampToUI(img, p);
  let pClamped = getGridParamsFromUI();
  
  // ▼ 追記: yOffset の安全範囲を画像に合わせてクランプ
  applyYOffsetClampToUI(img, getGridParamsFromUI());
  // クランプにより value/min/max が変わるので、最新値で再取得
  pClamped = getGridParamsFromUI();

  const wrap = document.getElementById('tileThumbs');
  if (wrap) {
    wrap.innerHTML = '';
    wrap.style.display = 'flex';
    wrap.style.flexWrap = 'nowrap';
    wrap.style.overflowX = 'auto';
    wrap.style.overflowY = 'hidden';
    wrap.style.gap = `${THUMB_GAP}px`;
    wrap.style.maxWidth = '100%';
    wrap.style.padding = '4px 2px';
    wrap.style.scrollSnapType = 'x proximity';
  }

  const stepX = pClamped.tileW + pClamped.gapX;
  const stepY = pClamped.tileH + pClamped.gapY;
  const usableW = Math.max(0, img.width - pClamped.left + pClamped.gapX);
  const maxCols = Math.max(1, Math.floor(usableW / stepX));
  const effCols = Math.min(pClamped.cols, maxCols);

  const scale = Math.max(0.05, Math.min(1, THUMB_W / pClamped.tileW));
  const tc = document.createElement('canvas');
  tc.width  = Math.round(pClamped.tileW * scale);
  tc.height = Math.round(pClamped.tileH * scale);
  const tctx = tc.getContext('2d');
  tctx.imageSmoothingEnabled  = true;
  tctx.imageSmoothingQuality  = 'high';

  let tileIndex = 0;
  for(let r=0; r<pClamped.rows; r++){
    for(let c=0; c<effCols; c++){
      const sx = pClamped.left + c*stepX;
      const sy = pClamped.top  + r*stepY;
      if (sx + pClamped.tileW > img.width)  continue;
      if (sy + pClamped.tileH > img.height) continue;

      tctx.clearRect(0,0,tc.width,tc.height);
      tctx.drawImage(img, sx, sy, pClamped.tileW, pClamped.tileH, 0, 0, tc.width, tc.height);

      const thumb = document.createElement('img');
      thumb.src   = tc.toDataURL('image/png');
      thumb.alt   = `tile ${++tileIndex}`;
      thumb.title = `tile ${tileIndex} (row ${r+1}, col ${c+1})`;
      thumb.style.width  = `${THUMB_W}px`;
      thumb.style.height = 'auto';
      thumb.style.flex   = '0 0 auto';
      thumb.style.border = '1px solid #eee';
      thumb.style.borderRadius = '4px';
      thumb.style.scrollSnapAlign = 'start';

      wrap?.appendChild(thumb);
    }
  }
}

// ★ 追加：モバイル保険（カスタムイベントでサムネ再生成）
window.addEventListener('ocr-rows-updated', async (e) => {
  try {
    if (__lastFile) {
      await buildTileThumbnails(__lastFile);
      if (OCR.status) OCR.status.textContent = 'サムネ更新済み';
    }
  } catch (err) {
    console.error('[ocr-rows-updated] thumbnail rebuild error', err);
  }
});

/* ---- 画像選択/行数変更ハンドラ ---- */
document.addEventListener('DOMContentLoaded', ()=>{
  const fileInput = document.getElementById('invImage');
  const rowsEl    = document.getElementById('ocrRows');

  fileInput?.addEventListener('change', async ()=>{
    __lastFile = fileInput.files?.[0] || null;
    if(__lastFile){
      await buildTileThumbnails(__lastFile);
    }
  });

  rowsEl?.addEventListener('change', async ()=>{
    if(__lastFile) await buildTileThumbnails(__lastFile);
  });

  // ★ 追加：input イベントも拾う（モバイル保険）
  rowsEl?.addEventListener('input', async ()=>{ if(__lastFile) await buildTileThumbnails(__lastFile); });

  const readBtn = document.getElementById('gridOcrBtn');
  if (readBtn) readBtn.textContent = '読取';
});

/* ---- 読取ボタン：クリック処理（倍率リトライ／状態汚染なし） ---- */
// 正しい「読取」クリック ― OCR 実行に接続
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('gridOcrBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    try{
      // 必要なら在庫バックアップ（↺対応を復活させたい場合）
      // if (typeof backupInventory === 'function') backupInventory();

      await onGridOcrClick();   // ← これが本来のOCR実行
    }catch(e){
      console.error(e);
      alert('読取中にエラーが発生しました');
    }
  });
});

let __running = false;
async function onGridOcrClick(){
  if (__running) return;
  __running = true;

  const btn = document.getElementById('gridOcrBtn');
  try{
    if (btn) btn.disabled = true;
    if (OCR.status) OCR.status.textContent = '読み取り中…';

    const file = document.getElementById('invImage')?.files?.[0];
    if (!file){ alert('スクショ画像を選択してください'); return; }

    console.time('gridOCR:click');

    // 1回目：4.0倍スタート（要求倍率）、結果0件なら「0件扱い」にしてリトライ発火
    let found = await ocrHybridGrid(file, 0.8);
    if (found && Array.isArray(found.tiles) && found.tiles.length === 0) {
      found = null; // ← 0件は「未検出」として扱い、下の !found 分岐に入れる
    }

    // 0件なら「縮小 → 拡大」の順に倍率を変えて再試行（UI値は変えない）
    if (!found){
      const p = getGridParamsFromUI();
      const base = Number(p.scale) || 2;

      // 上げ方向（細部を拾いたい時に）
      const ups   = [1.0, 1.2, 1.5, 2.0]

      // 下げ方向（保険として最後に試す））
      const downs = [0.75, 0.67, 0.5]


      // 端末保護（必要なら既に定義している MIN_SCALE/MAX_SCALE を使う）
      const MIN_S = (typeof MIN_SCALE === 'number' ? MIN_SCALE : 1);
      const MAX_S = (typeof MAX_SCALE === 'number' ? MAX_SCALE : 4);

      // base と重複を除去しつつ、範囲内にクランプ
      const candSet = new Set();
      const pushClamped = (v) => {
        const s = Math.max(MIN_S, Math.min(MAX_S, v));
        if (Math.abs(s - base) < 0.01) return;        // base とほぼ同じはスキップ
        candSet.add(s.toFixed(2));                    // 文字列キーで重複防止
      };

      // ★ 高→低の順に投入（Setは順序維持）
      ups.forEach(pushClamped);
      downs.forEach(pushClamped);

      // 実行（上げ → 下げの順）+ 念のため数値降順で最終整列
      const ordered = [...candSet];
      for (const sv of ordered){
        const s = Number(sv);
        found = await ocrHybridGrid(file, s);
        if (found) break;
      }
    }

    if (OCR.status) OCR.status.textContent = found ? '読み取り完了' : '検出なし（グリッドOCR完了）';
    } catch(e){
      console.error('[grid OCR error]', e);
      if (OCR.status) {
        const msg = (String(e?.message||e).match(/(allocate|memory|canvas|decode)/i))
          ? 'メモリ不足の可能性あり。倍率を下げて再試行します。'
          : 'グリッドOCRでエラー';
        OCR.status.textContent = msg;
      }
    } finally {
    console.timeEnd('gridOCR:click');
    if (btn) btn.disabled = false;
    __running = false;
  }
}

// ---- スクショ読込ボタン専用 DropZone 初期化（ボタン範囲だけ反応） ----
document.addEventListener('DOMContentLoaded', () => {
  const zone  = document.getElementById('screenshotDrop');
  const input = document.getElementById('invImage');
  if (!zone || !input) return;

  const enter = (e) => { e.preventDefault(); zone.classList.add('drag-over'); };
  const over  = (e) => { e.preventDefault(); };
  const leave = ()   => { zone.classList.remove('drag-over'); };

  async function handleFiles(files){
    const file = files && files[0];
    if (!file) return;
    try{
      if (typeof ocrHybridGrid === 'function') {
        await ocrHybridGrid(file);   // ← 既存のOCR実行に直結
      } else {
        alert('読み取り関数が見つかりません（ocrHybridGrid）');
      }
    } catch(err){
      console.error(err);
      alert('画像の読み込みに失敗しました。別の画像でお試しください。');
    } finally {
      zone.classList.remove('drag-over');
    }
  }

  // D&D は zone だけで反応
  zone.addEventListener('dragenter', enter);
  zone.addEventListener('dragover',  enter);
  zone.addEventListener('dragleave', leave);
  zone.addEventListener('drop', (e)=>{
    e.preventDefault();
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length) handleFiles(dt.files);
  });

  // クリックで従来のファイル選択も可能
  zone.addEventListener('click', (e) => {
    // 入力自身のクリックは素通し（重複防止）
    if (e.target === input) return;
    // 既定動作抑止（将来、内部にボタン/リンクを置いても二重起動しないように）
    e.preventDefault();
    // 明示的に1回だけダイアログを開く
    input.click();
  });
});

// ====== 追加：グリッド設定の保存・読込 ======
const GRID_STORE_KEY = 'gridParamsV1';

function loadGridPrefs(){
  try{
    const obj = JSON.parse(localStorage.getItem(GRID_STORE_KEY) || '{}');
    if (typeof obj.tileH === 'number') {
      const el = document.getElementById('ocrTileH');
      if (el) el.value = String(obj.tileH);
      const out = document.getElementById('ocrTileHVal');
      if (out) out.textContent = obj.tileH + 'px';
    }
    if (typeof obj.gapX === 'number') {
      const el = document.getElementById('ocrGapX');
      if (el) el.value = String(obj.gapX);
      const out = document.getElementById('ocrGapXVal');
      if (out) out.textContent = obj.gapX + 'px';
    }
    if (typeof obj.yOffset === 'number') {
      const y = document.getElementById('ocrYOffset');
      if (y) y.value = String(obj.yOffset);
      const val = document.getElementById('ocrYOffsetVal');
      if (val) val.textContent = String(obj.yOffset);
    }
  }catch{}
}

function saveGridPrefs(){
  try{
    const tileH = Number(document.getElementById('ocrTileH')?.value);
    const gapX  = Number(document.getElementById('ocrGapX')?.value);
    const yOffset = Number(document.getElementById('ocrYOffset')?.value);
    const obj = {};
    
    if (Number.isFinite(tileH)) obj.tileH = tileH;
    if (Number.isFinite(gapX))  obj.gapX  = gapX;
    if (Number.isFinite(yOffset)) obj.yOffset = yOffset;
    localStorage.setItem(GRID_STORE_KEY, JSON.stringify(obj));
  }catch{}
}

// 値表示の同期
function syncRangeOutputs(){
  const tileH = document.getElementById('ocrTileH');
  const gapX  = document.getElementById('ocrGapX');
  const outH  = document.getElementById('ocrTileHVal');
  const outG  = document.getElementById('ocrGapXVal');
  if (tileH && outH) outH.textContent = tileH.value + 'px';
  if (gapX  && outG) outG.textContent = gapX.value  + 'px';
}

// リアルタイムでサムネ更新 + 保存
async function onGridRangeInput(){
  syncRangeOutputs();
  saveGridPrefs();

  // 画像選択済みなら gapX を再クランプ（min/max/value を更新）
  if (__lastFile) {
    try {
      const img = await loadImageAny(__lastFile);
      applyGapXClampToUI(img, getGridParamsFromUI());
      // yOffset もクランプ（縦方向も最新に）
      applyYOffsetClampToUI(img, getGridParamsFromUI());
    } catch {}
  }
  // ▼ クランプが終わってから、最後に一度だけ再描画
  if (__lastFile) await buildTileThumbnails(__lastFile);
}

document.addEventListener('DOMContentLoaded', ()=>{
  // 起動時に保存値を反映
  loadGridPrefs();
  syncRangeOutputs();

  // ▼ 垂直オフセットの即時反映
  const yEl = document.getElementById('ocrYOffset');
  if (yEl) {
    yEl.addEventListener('input', () => {
      const span = document.getElementById('ocrYOffsetVal');
      if (span) span.textContent = String(yEl.value);
      const fileInput = document.getElementById('invImage');
      const file = fileInput && fileInput.files && fileInput.files[0];
      if (file && typeof buildTileThumbnails === 'function') {
        buildTileThumbnails(file);
      }
    });
  }

  // スライダーのイベント
  const rH = document.getElementById('ocrTileH');
  const gX = document.getElementById('ocrGapX');
  rH?.addEventListener('input', onGridRangeInput);
  gX?.addEventListener('input', onGridRangeInput);

  // 「デフォルトに戻す」ボタン
  document.getElementById('gridDefaultsBtn')?.addEventListener('click', async ()=>{
    const DEF = DEFAULT_GRID; // 既存のデフォルト群を利用

    // 既存：高さと列間隔を初期化
    const rH = document.getElementById('ocrTileH');
    const gX = document.getElementById('ocrGapX');
    if (rH) rH.value = String(DEF.tileH);
    if (gX) gX.value = String(DEF.gapX);

    // ★追加：垂直オフセットも初期化
    const yEl = document.getElementById('ocrYOffset');
    if (yEl) {
      yEl.value = String(DEF.yOffset ?? 0);        // 既定は 0
      // 値表示(#ocrYOffsetVal)やサムネ再描画を発火させるため 'input' を通知
      yEl.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // 既存の処理（表示同期・保存・再クランプ・サムネ再生成）をまとめて実行
    await onGridRangeInput();
  });
});

