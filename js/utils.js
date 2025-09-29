// utils.js — 共通ユーティリティ（app.js / ocr.js の前に読み込む）

// 正規化（OCR/検索用）
function normalizeKey(s){
  if(!s) return '';
  return String(s)
    .replace(/\s+/g,'')
    .replace(/[×✕xX]/g,'x')
    .replace(/[，、・.\-＿—]/g,'')
    .trim();
}

// OCRテキストの簡易正規化（空白除去）
function normalizeOcrText(s){
  if (!s) return '';
  return String(s).replace(/\s+/g, '').trim();
}

// 検索除外の修飾語
const STOPWORDS = new Set([
  'とくせん','ワカクサ','おいしい','めざまし',
  'ピュア','ピュアな','あったか','あんみん',
  'リラックス','モーモー','ほっこり','あじわい','げきから'
]);

// レーベンシュタイン距離
function levenshtein(a,b){
  const al=a.length, bl=b.length;
  const dp=new Array((al+1)*(bl+1)).fill(0);
  const idx=(i,j)=>i*(bl+1)+j;
  for(let i=0;i<=al;i++) dp[idx(i,0)]=i;
  for(let j=0;j<=bl;j++) dp[idx(0,j)]=j;
  for(let i=1;i<=al;i++){
    for(let j=1;j<=bl;j++){
      const cost = (a.charCodeAt(i-1)===b.charCodeAt(j-1)) ? 0 : 1;
      dp[idx(i,j)] = Math.min(dp[idx(i-1,j)] + 1, dp[idx(i, j-1)] + 1, dp[idx(i-1,j-1)] + cost);
    }
  }
  return dp[idx(al,bl)];
}

// text 内の任意の部分文字列と pattern の最小距離
function minSubstrDistance(text, pattern){
  const t = text||'', p = pattern||'';
  const n = t.length, m = p.length;
  if (m === 0 || n === 0 || n < m) return Infinity;
  let best = Infinity;
  for (let i=0; i<=n-m; i++){
    const sub = t.slice(i, i+m);
    const d = levenshtein(sub, p);
    if (d < best) best = d;
    if (best === 0) break;
  }
  return best;
}

// （必要なら使う）OCRの明度/しきい値（現在は固定処理だが将来調整用）
const BIN_GAIN = 1.25;
const BIN_TH   = 175;
