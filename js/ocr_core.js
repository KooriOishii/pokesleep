// =========================
// ocr_core.js (definitions only; after split)
// =========================
const OCR = {
  status: null, out: null, debug: false,
  W_NAME: null, W_DIG: null, langReady: false, loading: false,
};

const OCR_CONST = {
  MAX_DIST: 3,
  AUTO_APPLY_DIST_MAX: 1,
  AUTO_CONFIRM_QTY_MIN: 300,
  RETRY_SCALES: [0.6],
  COLS: 4,
  ROWS_MIN: 1, ROWS_MAX: 4, ROWS_DEF: 4,
  THUMB_W: 40
};

// Debug panel helper kept here
function setDebugLines(lines){
  const dbg = document.getElementById('ocrDebug');
  const pre = document.getElementById('debugPre');
  if (!dbg || !pre) return;
  if (!OCR.debug){ dbg.style.display='none'; return; }
  dbg.style.display='';
  pre.textContent = lines || '';
}
