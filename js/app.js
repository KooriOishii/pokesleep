/* =========================================================================
 * app.js — UI / 在庫 / レシピ管理（グリッドOCR専用プロジェクト）
 * 依存: data.js（ingredientNames, genresList, recipesRaw）
 *       utils.js（normalizeKey など）
 * 説明:
 *  - レシピ選択 → 追加 → 合計テーブルを算出
 *  - 在庫（所持数）は localStorage に保存
 *  - グリッドOCRから在庫を更新する前にバックアップし、↺で復元可能
 * ========================================================================= */

/* ===== モデル ===== */
class Ingredient {
  constructor(id, name, img, aliases){
    this.id = id;
    this.name = name;
    this.img = img;
    this.aliases = Array.isArray(aliases) ? aliases : [];
  }
}
class Recipe {
  constructor(id, name, usage, partsOrdered){
    this.id = id;
    this.name = name;
    this.usage = usage;
    this.partsOrdered = partsOrdered || []; // [{idx, qty}]
  }
}
class Genre {
  constructor(id, name){ this.id = id; this.name = name; this.recipes = []; }
  addRecipe(r){ this.recipes.push(r); }
}

/* ===== data.js → モデル化 ===== */
const ingredients = (ingredientNames || []).map((o, i) =>
  new Ingredient(i, o.name, o.img, o.aliases)
);
const ingIndex = new Map(ingredients.map(i => [i.name, i.id]));
const genres   = (genresList || []).map((g, i) => new Genre(i, g));

let ridSeq = 0;
(recipesRaw || []).forEach(r => {
  const g = genres.find(x => x.name === r.genre);
  if (!g) { console.warn('未定義ジャンル:', r.genre); return; }
  const usage = new Array(ingredients.length).fill(0);
  const partsOrdered = [];
  for (const [iname, qty] of r.parts) {
    const idx = ingIndex.get(iname);
    if (typeof idx === 'number') {
      usage[idx] = qty;
      partsOrdered.push({ idx, qty });
    } else {
      console.warn('未定義食材:', iname, 'in', r.name);
    }
  }
  g.addRecipe(new Recipe(ridSeq++, r.name, usage, partsOrdered));
});

/* ===== 状態管理 ===== */
class Manager {
  constructor(ingredients, genres){
    this.ingredients = ingredients;
    this.genres      = genres;
    this.cart        = this._load();
  }
  _save(){ localStorage.setItem('recipeCart', JSON.stringify(this.cart)); }
  _load(){ try{ return JSON.parse(localStorage.getItem('recipeCart') || '[]'); }catch{ return []; } }

  add(gid, rid, qty){
    if (!Number.isInteger(qty) || qty < 1) throw new Error('qty must be integer >= 1');
    this.cart.push({ genreId: gid, recipeId: rid, qty });
    this._save();
  }
  remove(i){
    if (i >= 0 && i < this.cart.length) { this.cart.splice(i, 1); this._save(); }
  }
  setQty(i, qty){
    if (i >= 0 && i < this.cart.length && Number.isInteger(qty) && qty > 0){
      this.cart[i].qty = qty; this._save();
    }
  }
  totals(){
    const t = new Array(this.ingredients.length).fill(0);
    for (const it of this.cart){
      const g = this.genres.find(g => g.id === it.genreId);
      const r = g?.recipes.find(x => x.id === it.recipeId);
      if (!r) continue;
      r.usage.forEach((u, i) => { t[i] += (u || 0) * it.qty; });
    }
    return t;
  }
  genreById(id){ return this.genres.find(g => g.id === id); }
  recipe(gid, rid){ const g = this.genreById(gid); return g?.recipes.find(r => r.id === rid); }
}
const manager = new Manager(ingredients, genres);

/* ===== 在庫（所持数）管理 ===== */
const inventory = new Map();           // name -> qty
const INV_KEY   = 'inventoryByName_v1';

// 直前の在庫スナップショット（↺用）
window.__inventoryBackup = null;

function saveInventory(){
  try{
    const obj = Object.fromEntries(inventory.entries());
    localStorage.setItem(INV_KEY, JSON.stringify(obj));
  }catch{}
}
function loadInventory(){
  try{
    const raw = localStorage.getItem(INV_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    inventory.clear();
    Object.entries(obj).forEach(([k, v]) => inventory.set(k, Number(v) || 0));
  }catch{}
}
function getStock(name){ return inventory.get(name) ?? 0; }
function setStock(name, qty){
  const v = Math.max(0, Number(qty) || 0);
  inventory.set(name, v);
  saveInventory();
}

// OCRの直前バックアップ
function backupInventory(){
  window.__inventoryBackup = Object.fromEntries(inventory.entries());
  const undoBtn = document.getElementById('undoOcrBtn');
  if (undoBtn){
    undoBtn.disabled = false;
    undoBtn.classList.remove('hidden');   // 表示
  }
}

// バックアップとの差分件数カウント（確認ダイアログ用）
function diffCountWithBackup(){
  const snap = window.__inventoryBackup;
  if (!snap) return 0;
  const current = Object.fromEntries(inventory.entries());
  const keys = new Set([...Object.keys(current), ...Object.keys(snap)]);
  let n = 0;
  for (const k of keys){
    const prev = Number(current[k] ?? 0);
    const val  = Number(snap[k]    ?? 0);
    if (prev !== val) n++;
  }
  return n;
}

// ↺ 復元（1段階 Undo）
function restoreInventoryFromBackup(){
  const snap = window.__inventoryBackup;
  if (!snap) return;

  const current = Object.fromEntries(inventory.entries());
  const keys = new Set([...Object.keys(current), ...Object.keys(snap)]);
  const updated = new Set();

  inventory.clear();
  keys.forEach(k => {
    const prev = Number(current[k] ?? 0);
    const val  = Number(snap[k]    ?? 0);
    if (prev !== val) updated.add(k);
    inventory.set(k, val);
  });

  saveInventory();
  window.__justUpdatedStocks = updated;

  if (typeof refresh === 'function') refresh();
  else if (typeof renderTotals === 'function') renderTotals();

  window.__inventoryBackup = null;
  const undoBtn = document.getElementById('undoOcrBtn');
  if (undoBtn){
    undoBtn.disabled = true;
    undoBtn.classList.add('hidden'); // 使い切りで隠す
  }
}

/* ===== DOMキャッシュ ===== */
const DOM = {
  genreRadios:  document.getElementById('genreRadios'),
  csSelected:   document.getElementById('csSelected'),
  csSelThumbs:  document.getElementById('csSelThumbs'),
  csSelName:    document.getElementById('csSelName'),
  csItems:      document.getElementById('csItems'),
  recipePreview:document.getElementById('recipePreview'),
  qtyInput:     document.getElementById('qtyInput'),
  addBtn:       document.getElementById('addBtn'),
  clearBtn:     document.getElementById('clearBtn'),
  addedListPC:  document.getElementById('addedListPC'),
  addedListSP:  document.getElementById('addedListSP'),
  itemsCount:   document.getElementById('itemsCount'),
  totalsBody:   document.querySelector('#totalsTable tbody')
};

/* ===== 小物ユーティリティ ===== */
function safeSetHTML(el, html){ if (!el) return; el.innerHTML = html; }

/* - / + ステッパーを生成して input を包む */
function buildStepper(input, {min, max, step = 1} = {}){
  const wrap = document.createElement('div');
  wrap.className = 'numwrap';

  const btnMinus = document.createElement('button');
  btnMinus.type = 'button';
  btnMinus.className = 'step-btn';
  btnMinus.textContent = '−';

  const btnPlus = document.createElement('button');
  btnPlus.type = 'button';
  btnPlus.className = 'step-btn';
  btnPlus.textContent = '+';

  const lo = (min ?? (input.min !== '' ? Number(input.min) : -Infinity));
  const hi = (max ?? (input.max !== '' ? Number(input.max) :  Infinity));
  const st = Number(input.step || step) || 1;

  function clamp(v){
    if (Number.isFinite(lo)) v = Math.max(lo, v);
    if (Number.isFinite(hi)) v = Math.min(hi, v);
    return v;
  }
  function changeBy(delta){
    let v = parseInt(input.value, 10);
    if (isNaN(v)) v = Number.isFinite(lo) ? lo : 0;
    v = clamp(v + delta);
    input.value = String(v);
    input.dispatchEvent(new Event('change', {bubbles: true}));
  }

  btnMinus.addEventListener('click', () => changeBy(-st));
  btnPlus.addEventListener('click', () => changeBy(+st));

  wrap.appendChild(btnMinus);
  wrap.appendChild(input);
  wrap.appendChild(btnPlus);
  return wrap;
}
function attachStepper(input, opts){
  if (!input || input.dataset.stepped) return;
  const parent = input.parentNode;
  if (!parent) return;

  const marker = document.createComment('stepper-marker');
  parent.insertBefore(marker, input);
  const wrap = buildStepper(input, opts);
  parent.replaceChild(wrap, marker);

  input.dataset.stepped = '1';
}

/* レシピプレビューの挿し込み先が無い場合に補完 */
function ensureRecipePreviewSlot(){
  if (DOM.recipePreview) return;
  const host = document.getElementById('recipeSelect');
  if (!host) return;
  const div = document.createElement('div');
  div.id = 'recipePreview';
  div.className = 'recipe-preview';
  host.parentElement.insertBefore(div, host.nextSibling);
  DOM.recipePreview = div;
}

// === OCR 行数セグメントの接続（★復活させる） ===
const seg = document.getElementById('ocrRowSeg');
const ocrRowsHidden = document.getElementById('ocrRows');

if (seg && ocrRowsHidden){
  // 初期状態：hidden の値に合わせて is-active を付け直す
  const initVal = String(ocrRowsHidden.value || '4');
  seg.querySelectorAll('.seg-btn').forEach(btn=>{
    const on = btn.dataset.val === initVal;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });

  // クリックで見た目更新＋値更新＋change発火（→ ocr.js が拾ってサムネ再生成）
  seg.addEventListener('click', (e)=>{
    const btn = e.target.closest('.seg-btn');
    if(!btn) return;
    const val = btn.dataset.val;
    if(!val) return;

    // 見た目更新（単一選択）
    seg.querySelectorAll('.seg-btn').forEach(b=>{
      const on = (b === btn);
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    // 裏方の値を更新し、change を通知（ocr.js が #ocrRows の change を監視）
    // 既存：裏方の値を更新
    ocrRowsHidden.value = val;
    // 既存：change を通知（PC はこれで動く環境が多い）
    ocrRowsHidden.dispatchEvent(new Event('change', { bubbles: true }));

    // ★ 追加：モバイル保険（確実通知）
    window.dispatchEvent(new CustomEvent('ocr-rows-updated', {
      detail: { rows: Number(val) }
    }));
  });
}

/* ===== ジャンル（ラジオ生成） ===== */
function populateGenres(){
  const wrap = DOM.genreRadios;
  safeSetHTML(wrap, '');
  manager.genres.forEach(g => {
    const id = 'genre-' + g.id;
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'genre';
    input.value = g.id;
    input.id = id;
    label.appendChild(input);

    const uiName =
      (g.name === 'カレー・シチュー') ? 'カレー' :
      (g.name === 'デザート・ドリンク') ? 'デザート' :
      g.name;

    label.appendChild(document.createTextNode(uiName));
    wrap && wrap.appendChild(label);

    input.addEventListener('change', () => { populateRecipesCustom(Number(input.value)); });
  });

  // 初期選択（レシピは自動選択しない）
  if (manager.genres.length > 0){
    const first = wrap ? wrap.querySelector('input[type=radio]') : null;
    if (first){ first.checked = true; populateRecipesCustom(Number(first.value)); }
  }
}
function currentGenreId(){
  const checked = DOM.genreRadios ? DOM.genreRadios.querySelector('input[type=radio]:checked') : null;
  return checked ? Number(checked.value) : null;
}

/* ===== レシピ：カスタムセレクト ===== */
function buildThumbsByParts(recipe){
  const div = document.createElement('div'); div.className = 'thumbs';
  recipe.partsOrdered.forEach(({idx, qty}) => {
    const ing = manager.ingredients[idx];
    const img = document.createElement('img');
    img.src = ing.img; img.alt = ing.name; img.title = `${ing.name} × ${qty}`;
    img.onerror = () => { img.style.opacity = '0.35'; };
    div.appendChild(img);
  });
  return div;
}
function populateRecipesCustom(gid){
  const g = manager.genreById(gid);
  safeSetHTML(DOM.csItems, '');
  if (!g){
    safeSetHTML(DOM.csSelThumbs, '');
    if (DOM.csSelName) DOM.csSelName.textContent = '--レシピを選択--';
    if (DOM.csSelected) DOM.csSelected.dataset.recipeId = '';
    renderRecipePreview(null);
    return;
  }
  g.recipes.forEach(r => {
    const item   = document.createElement('div'); item.className = 'cs-item';
    const name   = document.createElement('div'); name.className = 'name'; name.textContent = r.name;
    const thumbs = buildThumbsByParts(r);
    item.appendChild(name); item.appendChild(thumbs);
    item.addEventListener('click', () => { setSelectedRecipe(r); closeMenu(); });
    DOM.csItems && DOM.csItems.appendChild(item);
  });
  safeSetHTML(DOM.csSelThumbs, '');
  if (DOM.csSelName) DOM.csSelName.textContent = '--レシピを選択--';
  if (DOM.csSelected) DOM.csSelected.dataset.recipeId = '';
  renderRecipePreview(null);
}

// （重複定義を解消し、リッチ版のみ採用）
function setSelectedRecipe(recipe){
  if (DOM.csSelName) DOM.csSelName.textContent = recipe.name;
  safeSetHTML(DOM.csSelThumbs, ''); // 選択後はサムネ非表示
  if (DOM.csSelected) {
    DOM.csSelected.dataset.recipeId = recipe.id;
    DOM.csSelected.classList.add('has-selection');
  }
  renderRecipePreview(recipe);
}

/* ドロップダウン開閉 */
function isClosed(){ return DOM.csItems ? DOM.csItems.classList.contains('cs-hide') : true; }
function openMenu(){
  if (!DOM.csItems || !DOM.csSelected) return;
  DOM.csItems.classList.remove('cs-hide');
  DOM.csSelected.setAttribute('aria-expanded', 'true');
}
function closeMenu(){
  if (!DOM.csItems || !DOM.csSelected) return;
  DOM.csItems.classList.add('cs-hide');
  DOM.csSelected.setAttribute('aria-expanded', 'false');
}
DOM.csSelected && DOM.csSelected.addEventListener('click', () => { if (isClosed()) openMenu(); else closeMenu(); });
document.addEventListener('click', (e) => { if (!e.target.closest('.custom-select')) closeMenu(); });

/* セレクト直下に「食材画像 × 個数」プレビュー */
function renderRecipePreview(recipe){
  if (!DOM.recipePreview) return;
  safeSetHTML(DOM.recipePreview, '');
  if (!recipe) return;
  const stack = document.createElement('div');
  stack.className = 'ing-stack';
  recipe.partsOrdered.forEach(({idx, qty}) => { stack.appendChild(makeIngLineByPart(idx, qty)); });
  DOM.recipePreview.appendChild(stack);
}

/* ===== 登録済みリスト表示 ===== */
function makeIngLineByPart(idx, count){
  const line = document.createElement('div'); line.className = 'ing-line';
  const ing  = manager.ingredients[idx];
  const img  = document.createElement('img'); img.src = ing.img; img.alt = ing.name; img.onerror = () => { img.style.opacity = '0.35'; };
  const cnt  = document.createElement('span'); cnt.className = 'cnt'; cnt.textContent = `×${count}`;
  line.title = ing.name; line.appendChild(img); line.appendChild(cnt);
  return line;
}
function renderAddedList(){
  safeSetHTML(DOM.addedListPC, ''); safeSetHTML(DOM.addedListSP, '');
  manager.cart.forEach((it, idx) => {
    const g = manager.genreById(it.genreId);
    const r = manager.recipe(it.genreId, it.recipeId);
    if (!r) return;

    const buildRow = () => {
      const row    = document.createElement('div'); row.className    = 'added-row';
      const left   = document.createElement('div'); left.className   = 'added-left'; left.textContent   = `${g.name} / ${r.name}`;
      const center = document.createElement('div'); center.className = 'added-center';

      const qty = document.createElement('input');
      qty.type = 'number'; qty.min = 1; qty.value = it.qty; qty.className = 'qty';
      qty.addEventListener('change', () => {
        let v = parseInt(qty.value, 10); if (isNaN(v) || v < 1) v = 1;
        qty.value = v; manager.setQty(idx, v); renderTotals(); renderAddedList();
      });
      const qtyWrap = buildStepper(qty, { min: 1, step: 1 });

      const stack = document.createElement('div'); stack.className = 'ing-stack';
      r.partsOrdered.forEach(({idx: pi, qty: q}) => { stack.appendChild(makeIngLineByPart(pi, q * it.qty)); });

      const right = document.createElement('div'); right.className = 'added-right';
      const del = document.createElement('button'); del.className = 'ghost'; del.textContent = '削除';
      del.addEventListener('click', () => { manager.remove(idx); refresh(); });
      right.appendChild(del);

      center.appendChild(qtyWrap);
      center.appendChild(stack);
      row.appendChild(left); row.appendChild(center); row.appendChild(right);
      return row;
    };

    DOM.addedListPC && DOM.addedListPC.appendChild(buildRow());
    DOM.addedListSP && DOM.addedListSP.appendChild(buildRow());
  });
  if (DOM.itemsCount) DOM.itemsCount.textContent = String(manager.cart.length);
}

/* ===== 合計テーブル ===== */
function renderTotals(){
  safeSetHTML(DOM.totalsBody, '');
  const totals = manager.totals();

  let needSum = 0;
  let shortSum = 0;

  totals.forEach((need, i) => {
    if (need === 0) return;

    const name     = manager.ingredients[i].name;
    const stock    = getStock(name);
    const shortage = Math.max(need - stock, 0);

    needSum  += need;
    shortSum += shortage;

    const tr = document.createElement('tr');

    // 食材セル（画像＋名前。名前は CSS で初期非表示）
    const td1  = document.createElement('td');
    const img  = document.createElement('img');
    img.className = 'tot-img'; img.src = manager.ingredients[i].img; img.alt = name;
    img.onerror   = () => { img.style.opacity = '0.35'; };
    const nameSpan = document.createElement('span');
    nameSpan.className = 'ing-name'; nameSpan.textContent = name;
    td1.appendChild(img); td1.appendChild(nameSpan);

    const tdNeed = document.createElement('td'); tdNeed.textContent = need; tdNeed.style.textAlign = 'center';

    const tdStock = document.createElement('td'); tdStock.style.textAlign = 'center';
    const input = document.createElement('input');
    input.type = 'number'; input.min = '0'; input.value = stock; input.className = 'stock-input';
    input.addEventListener('change', () => { setStock(name, input.value); renderTotals(); });
    tdStock.appendChild(input);

    // 直前のOCR復元やOCR反映時の点灯
    const just = window.__justUpdatedStocks;
    if (just && just.has(name)){
      tdStock.classList.add('flash');
      setTimeout(() => tdStock.classList.remove('flash'), 900);
    }

    const tdShort = document.createElement('td'); tdShort.textContent = shortage; tdShort.style.textAlign = 'center';

    tr.appendChild(td1); tr.appendChild(tdNeed); tr.appendChild(tdStock); tr.appendChild(tdShort);
    DOM.totalsBody && DOM.totalsBody.appendChild(tr);

    // 一度だけ点灯させる
    window.__justUpdatedStocks = null;
  });

  // 総計行
  const trTotal = document.createElement('tr'); trTotal.className = 'total-row';
  const tdLabel = document.createElement('td'); tdLabel.textContent = '総計';
  const tdNeedSum = document.createElement('td'); tdNeedSum.textContent = needSum; tdNeedSum.style.textAlign = 'center';
  const tdStockSum = document.createElement('td'); // 空欄のまま
  const tdShortSum = document.createElement('td'); tdShortSum.textContent = shortSum; tdShortSum.style.textAlign = 'center';
  trTotal.appendChild(tdLabel); trTotal.appendChild(tdNeedSum); trTotal.appendChild(tdStockSum); trTotal.appendChild(tdShortSum);
  DOM.totalsBody && DOM.totalsBody.appendChild(trTotal);
}

/* ===== イベント ===== */
DOM.addBtn && DOM.addBtn.addEventListener('click', () => {
  const gid = currentGenreId();
  const ridAttr = DOM.csSelected ? DOM.csSelected.dataset.recipeId : '';
  if (gid == null || !ridAttr){ alert('レシピを選択してください'); return; }
  const rid = Number(ridAttr);
  const qty = parseInt(DOM.qtyInput.value, 10);
  if (!Number.isInteger(qty) || qty < 1){ alert('個数は1以上の整数'); return; }
  manager.add(gid, rid, qty); refresh();

  // 追加後のリセット
  DOM.qtyInput && (DOM.qtyInput.value = '1');
  if (DOM.csSelName) DOM.csSelName.textContent = '--レシピを選択--';
  safeSetHTML(DOM.csSelThumbs, '');
  if (DOM.csSelected) { DOM.csSelected.dataset.recipeId = ''; DOM.csSelected.classList.remove('has-selection'); }
  renderRecipePreview(null);
  closeMenu();
});

DOM.clearBtn && DOM.clearBtn.addEventListener('click', () => {
  if(!confirm('登録済みをすべて削除しますか？')) return;
  manager.cart = []; localStorage.removeItem('recipeCart'); refresh();
});

// ↻ 所持数を一括リセット（表示中の必要食材のみ 0 に）
const resetBtn = document.getElementById('resetStockBtn');
if (resetBtn){
  resetBtn.addEventListener('click', () => {
    const totals = manager.totals();
    totals.forEach((need, i) => {
      if (need > 0){
        const nm = manager.ingredients[i].name;
        setStock(nm, 0);
      }
    });
    renderTotals();
  });
}

// 📷 OCRインラインパネル開閉（テーブルの上に展開）
const toggleBtn = document.getElementById('toggleOcrBtn');
const ocrPanel  = document.getElementById('ocrPanel');
const defBtn    = document.getElementById('gridDefaultsBtn');

if (toggleBtn && ocrPanel && defBtn) {
  toggleBtn.addEventListener('click', () => {
    // 既存の開閉方式に合わせて1行だけ選択してください
    // A) display方式:
    const opened = ocrPanel.style.display !== 'none';
    ocrPanel.style.display = opened ? 'none' : 'block';

    // // B) class方式（↑をコメントアウトし、↓を使用）
    // const opened = ocrPanel.classList.toggle('open');

    toggleBtn.setAttribute('aria-expanded', opened ? 'false' : 'true');
    defBtn.style.display = opened ? 'none' : 'inline-flex';
  });
}

// OCRボタン：実行直前にバックアップ（↺を表示）
// const ocrRunBtn = document.getElementById('gridOcrBtn');
// if (ocrRunBtn){
//   ocrRunBtn.addEventListener('click', () => { backupInventory(); });
// }

// ↺ のクリックで復元（確認ダイアログを挟む）
// const undoBtn = document.getElementById('undoOcrBtn');
// if (undoBtn){
//   undoBtn.addEventListener('click', () => {
//     if (!window.__inventoryBackup) return;
//     const count = diffCountWithBackup();
//     const ok = confirm(
//       count > 0
//         ? `直前のOCRで更新した所持数を元に戻しますか？\n（変更対象: ${count} 件）`
//         : '直前のOCRの変更は見つかりません。元に戻しますか？'
//     );
//     if (!ok) return;
//     restoreInventoryFromBackup();
//   });
// }

/* ===== 初期化 ===== */
function refresh(){ renderAddedList(); renderTotals(); }
function init(){
  ensureRecipePreviewSlot();
  loadInventory();
  populateGenres();
  refresh();

  // メインの「個数」入力：左右に − / ＋ を付ける
  const mainQty = document.getElementById('qtyInput');
  if (mainQty) attachStepper(mainQty, { min: 1, step: 1 });

  // 食材名の表示/非表示トグル（ヘッダーの「＋／－」）
  const tgl   = document.getElementById('toggleNameBtn');
  const table = document.getElementById('totalsTable');
  const wrap  = document.getElementById('totalsWrap');
  if (tgl && table){
    tgl.addEventListener('click', ()=>{
      const on = table.classList.toggle('show-names');
      tgl.textContent = on ? '－' : '＋';
      tgl.title       = on ? '食材名を隠す' : '食材名を表示';
      if (wrap) wrap.classList.toggle('wide', on);
    });
  }
}
init();
