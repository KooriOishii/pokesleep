// =====================================
// ocr_engine.js  (Tesseract + matching)
// =====================================

// ---- Normalization & distance helpers ----
function normalizeKey(s){
  return String(s || '')
    .replace(/[\s\u3000]/g, '')
    .replace(/[×✕xX＊*·・]/g, 'x')
    .replace(/[()（）\[\]【】]/g, '')
    .trim();
}

function toHalfWidthDigits(s){
  return String(s || '').replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
}

function levenshtein(a, b){
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({length: m + 1}, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++){
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++){
      const cb = b.charCodeAt(j - 1);
      const cost = (ca === cb) ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i-1][j] + 1,
        dp[i][j-1] + 1,
        dp[i-1][j-1] + cost
      );
    }
  }
  return dp[m][n];
}

function minSubstrDistance(text, key){
  if (!text || !key) return Infinity;
  const t = normalizeKey(text), k = normalizeKey(key);
  if (!t || !k) return Infinity;
  let best = Infinity;
  for (let i = 0; i <= t.length - k.length; i++){
    const sub = t.slice(i, i + k.length);
    const d = levenshtein(sub, k);
    if (d < best) best = d;
    if (best === 0) break;
  }
  return best;
}

// ---- Ingredient token index & matching ----
let ING_FULL_KEYS = [];
let KEYWORD_INDEX = new Map(); // token -> Set<ingId>

function buildIngredientMatchers(){
  const list = (typeof DATASET !== "undefined" && DATASET.ingredients) ? DATASET.ingredients : [];
  ING_FULL_KEYS = list.map(i => normalizeKey(i.name));
  KEYWORD_INDEX = new Map();
  list.forEach((ing, id) => {
    const all = [ing.name, ...(ing.aliases || [])];
    for (const s of all){
      String(s)
        .split(/[^\wぁ-ゔァ-ヴー一-龠]+/)
        .map(x => normalizeKey(x))
        .filter(x => x.length >= 2)
        .forEach(tok => {
          if (!KEYWORD_INDEX.has(tok)) KEYWORD_INDEX.set(tok, new Set());
          KEYWORD_INDEX.get(tok).add(id);
        });
    }
  });
}

function matchIngredientByTokens(tokens, compactText){
  const votes = new Map();
  for (const t of tokens){
    const s = normalizeKey(t);
    const ids = KEYWORD_INDEX.get(s);
    if (!ids) continue;
    ids.forEach(id => votes.set(id, (votes.get(id) || 0) + 1));
  }
  if (votes.size){
    let bestId = null, bestVote = -1, bestDist = Infinity;
    for (const [id, v] of votes){
      const full = ING_FULL_KEYS[id] || '';
      const d = minSubstrDistance(compactText || '', full || '');
      if (v > bestVote || (v === bestVote && d < bestDist)){
        bestId = id; bestVote = v; bestDist = d;
      }
    }
    if (typeof OCR_CONST !== "undefined" && bestDist <= OCR_CONST.MAX_DIST) {
      return { id: bestId, votes: bestVote, dist: bestDist };
    }
  }
  // Fallback: full scan by distance
  const text = compactText || '';
  let pickId = null, pickD = Infinity;
  for (let id = 0; id < ING_FULL_KEYS.length; id++){
    const d = minSubstrDistance(text, ING_FULL_KEYS[id]);
    if (d < pickD){ pickD = d; pickId = id; if (d === 0) break; }
  }
  if (typeof OCR_CONST !== "undefined" && pickD <= OCR_CONST.MAX_DIST) {
    return { id: pickId, votes: 0, dist: pickD };
  }
  return null;
}

// ---- Tesseract bootstrapping ----
async function ensureTesseract(){
  if (typeof OCR === "undefined") { throw new Error("OCR global is not defined"); }
  if (OCR.loading) { while(!OCR.langReady) await new Promise(r=>setTimeout(r,60)); return; }
  if (OCR.langReady) return;
  OCR.loading = true;
  try {
    const CDN = {
      esm:   'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.esm.min.js',
      umd:   'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js',
      worker:'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/worker.min.js',
      core:  'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.0/tesseract-core.wasm.js',
      lang:  'https://tessdata.projectnaptha.com/4.0.0'
    };

    let TesseractNS = (typeof window !== 'undefined') ? window.Tesseract : undefined;
    if (!TesseractNS) {
      try { const mod = await import(CDN.esm); TesseractNS = mod?.default || mod; } catch(_) {}
    }
    if (!TesseractNS || typeof TesseractNS.createWorker !== 'function') {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = CDN.umd; s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('failed to load tesseract.min.js'));
        document.head.appendChild(s);
      });
      TesseractNS = window.Tesseract;
    }
    const createWorker = TesseractNS?.createWorker;
    if (typeof createWorker !== 'function') throw new Error('Unable to acquire Tesseract.createWorker');

    const OPTS = { workerPath: CDN.worker, corePath: CDN.core, langPath: CDN.lang };

    // 日本語（名前）— 単一行
    OCR.W_NAME = await createWorker('jpn', undefined, OPTS);
    await OCR.W_NAME.setParameters({
      tessedit_char_blacklist: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_',
      tessedit_pageseg_mode: 7
    });

    // 英語（数字）— 単一行／x記号も許容
    OCR.W_DIG  = await createWorker('eng', undefined, OPTS);
    await OCR.W_DIG.setParameters({
      tessedit_char_whitelist: '0123456789xX×✕',
      tessedit_pageseg_mode: 7,
      classify_bln_numeric_mode: 1
    });

    OCR.langReady = true;
  } finally {
    OCR.loading = false;
  }
}

// ---- Single tile OCR ----
async function recognizeTile(tileCanvas, up = 1.0){
  let inputCanvas = tileCanvas;
  if (up > 1.01){
    const UP_CAP = 3.0;
    const f = Math.min(up, UP_CAP);
    const upW = Math.round(tileCanvas.width  * f);
    const upH = Math.round(tileCanvas.height * f);
    const can  = document.createElement('canvas');
    can.width = upW; can.height = upH;
    const ctx = can.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tileCanvas, 0, 0, tileCanvas.width, tileCanvas.height, 0, 0, upW, upH);
    inputCanvas = can;
  }
  const dataURL = inputCanvas.toDataURL('image/png');

  // 並列実行（名前・数字）
  const [r1, r2] = await Promise.all([
    OCR.W_NAME.recognize(dataURL),
    OCR.W_DIG .recognize(dataURL)
  ]);

  const rawName  = r1.data.text || '';
  const rawDigit = r2.data.text || '';
  const nameNoSp = normalizeKey(rawName);
  const digitNoSp= normalizeKey(rawDigit);

  const tokens = rawName
    .replace(/[×✕xX]/g, ' ')
    .replace(/[^一-龠ぁ-ゔァ-ヴーa-zA-Z0-9]/g, ' ')
    .split(/\s+/)
    .map(s => normalizeKey(s))
    .filter(s => s.length >= 2);
  const m = matchIngredientByTokens(tokens, nameNoSp);

  // 数量抽出
  let qty = 0;
  const rdNorm = toHalfWidthDigits(rawDigit).replace(/\u3000/g,' ').replace(/\s+/g,' ').trim();
  const rnNorm = toHalfWidthDigits(rawName ).replace(/\u3000/g,' ').replace(/\s+/g,' ').trim();

  let mQty = rdNorm.match(/[x×✕]\s*([0-9]{1,3})/i);
  if (!mQty) mQty = rnNorm.match(/[x×✕]\s*([0-9]{1,3})/i);

  if (mQty && mQty[1]) {
    qty = parseInt(mQty[1], 10) || 0;
  } else {
    const nums = [...rdNorm.matchAll(/\b([0-9]{1,3})\b/g)].map(n => n[1]);
    if (nums.length) {
      nums.sort((a,b) => b.length - a.length);
      qty = parseInt(nums[0], 10) || 0;
    }
  }

  if (typeof OCR !== "undefined" && OCR.debug) {
    try {
      const rn = (rawName  || '').replace(/\n/g, ' ');
      const rd = (rawDigit || '').replace(/\n/g, ' ');
      console.log(`[OCR][RAW] scale=${up}  name="${rn}"  digit="${rd}"`);
    } catch (_) {}
  }

  const bestName = (m != null && typeof DATASET !== "undefined")
    ? (DATASET.ingredients[m.id]?.name || null)
    : null;

  return { best: m, bestName, qty, rawName, rawDigit, tokens, nameNoSp, digitNoSp };
}
