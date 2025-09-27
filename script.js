/* script.js（data.js を先に読み込む前提） */

/* ===== モデル ===== */
class Ingredient { constructor(id,name,img){ this.id=id; this.name=name; this.img=img; } }
class Recipe {
  constructor(id,name,usage,partsOrdered){
    this.id=id; this.name=name; this.usage=usage;
    this.partsOrdered=partsOrdered||[]; // [{idx,qty}]
  }
}
class Genre { constructor(id,name){ this.id=id; this.name=name; this.recipes=[]; } addRecipe(r){ this.recipes.push(r); } }

/* ===== data.js → モデル化 ===== */
const ingredients=(ingredientNames||[]).map((o,i)=>new Ingredient(i,o.name,o.img));
const ingIndex=new Map(ingredients.map(i=>[i.name,i.id]));
const genres=(genresList||[]).map((g,i)=>new Genre(i,g));

let ridSeq=0;
(recipesRaw||[]).forEach(r=>{
  const g=genres.find(x=>x.name===r.genre);
  if(!g){ console.warn('未定義ジャンル:', r.genre); return; }
  const usage=new Array(ingredients.length).fill(0);
  const partsOrdered=[];
  for(const [iname,qty] of r.parts){
    const idx=ingIndex.get(iname);
    if(typeof idx==='number'){ usage[idx]=qty; partsOrdered.push({idx,qty}); }
    else console.warn('未定義食材:', iname, 'in', r.name);
  }
  g.addRecipe(new Recipe(ridSeq++, r.name, usage, partsOrdered));
});

/* ===== 状態管理 ===== */
class Manager{
  constructor(ingredients,genres){ this.ingredients=ingredients; this.genres=genres; this.cart=this._load(); }
  _save(){ localStorage.setItem('recipeCart', JSON.stringify(this.cart)); }
  _load(){ try{ return JSON.parse(localStorage.getItem('recipeCart')||'[]'); }catch{ return []; } }
  add(gid,rid,qty){ if(!Number.isInteger(qty)||qty<1) throw new Error(); this.cart.push({genreId:gid,recipeId:rid,qty}); this._save(); }
  remove(i){ if(i>=0&&i<this.cart.length){ this.cart.splice(i,1); this._save(); } }
  setQty(i,qty){ if(i>=0&&i<this.cart.length && Number.isInteger(qty)&&qty>0){ this.cart[i].qty=qty; this._save(); } }
  totals(){ const t=new Array(this.ingredients.length).fill(0); for(const it of this.cart){ const g=this.genres.find(g=>g.id===it.genreId); const r=g?.recipes.find(x=>x.id===it.recipeId); if(!r) continue; r.usage.forEach((u,i)=>{ t[i]+=(u||0)*it.qty; }); } return t; }
  genreById(id){ return this.genres.find(g=>g.id===id); }
  recipe(gid,rid){ const g=this.genreById(gid); return g?.recipes.find(r=>r.id===rid); }
}
const manager=new Manager(ingredients,genres);

/* ===== DOM ===== */
const DOM={
  genreRadios:document.getElementById('genreRadios'),
  csSelected:document.getElementById('csSelected'),
  csSelThumbs:document.getElementById('csSelThumbs'),
  csSelName:document.getElementById('csSelName'),
  csItems:document.getElementById('csItems'),
  recipePreview:document.getElementById('recipePreview'),
  qtyInput:document.getElementById('qtyInput'),
  addBtn:document.getElementById('addBtn'),
  clearBtn:document.getElementById('clearBtn'),
  addedListPC:document.getElementById('addedListPC'),
  addedListSP:document.getElementById('addedListSP'),
  itemsCount:document.getElementById('itemsCount'),
  totalsBody:document.querySelector('#totalsTable tbody')
};

function ensureRecipePreviewSlot(){
  if (DOM.recipePreview) return; // 既にあれば何もしない
  const host = document.getElementById('recipeSelect');
  if (!host) return;
  const div = document.createElement('div');
  div.id = 'recipePreview';
  div.className = 'recipe-preview';
  host.parentElement.insertBefore(div, host.nextSibling);
  DOM.recipePreview = div; // DOM参照を更新
}

/* 安全に innerHTML をセット */
function safeSetHTML(el, html){ if(!el) return; el.innerHTML = html; }

/* ===== ジャンル（ラジオ生成） ===== */
function populateGenres(){
  const wrap = DOM.genreRadios;
  safeSetHTML(wrap, '');
  manager.genres.forEach(g=>{
    const id = 'genre-' + g.id;
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'genre';
    input.value = g.id;
    input.id = id;
    label.appendChild(input);
    label.appendChild(document.createTextNode(g.name));
    wrap && wrap.appendChild(label);

    input.addEventListener('change', ()=>{ populateRecipesCustom(Number(input.value)); });
  });

  // 初期選択（レシピは自動選択しない）
  if(manager.genres.length>0){
    const first = wrap ? wrap.querySelector('input[type=radio]') : null;
    if(first){ first.checked = true; populateRecipesCustom(Number(first.value)); }
  }
}
function currentGenreId(){
  const checked = DOM.genreRadios ? DOM.genreRadios.querySelector('input[type=radio]:checked') : null;
  return checked ? Number(checked.value) : null;
}

/* ===== レシピ：カスタムセレクト ===== */
function buildThumbsByParts(recipe){
  const div=document.createElement('div'); div.className='thumbs';
  recipe.partsOrdered.forEach(({idx,qty})=>{
    const ing=manager.ingredients[idx];
    const img=document.createElement('img');
    img.src=ing.img; img.alt=ing.name; img.title=`${ing.name} × ${qty}`;
    img.onerror=()=>{ img.style.opacity='0.35'; };
    div.appendChild(img);
  });
  return div;
}

function populateRecipesCustom(gid){
  const g=manager.genreById(gid);
  safeSetHTML(DOM.csItems, '');
  if(!g){
    safeSetHTML(DOM.csSelThumbs, '');
    if(DOM.csSelName) DOM.csSelName.textContent='--レシピを選択--';
    if(DOM.csSelected) DOM.csSelected.dataset.recipeId='';
    renderRecipePreview(null);
    return;
  }

  g.recipes.forEach(r=>{
    const item=document.createElement('div'); item.className='cs-item';
    const name=document.createElement('div'); name.className='name'; name.textContent=r.name;
    const thumbs=buildThumbsByParts(r,16,3);
    item.appendChild(name); item.appendChild(thumbs);
    item.addEventListener('click',()=>{ setSelectedRecipe(r); closeMenu(); });
    DOM.csItems && DOM.csItems.appendChild(item);
  });

  // 自動選択しない（初期プレースホルダー）
  safeSetHTML(DOM.csSelThumbs, '');
  if(DOM.csSelName) DOM.csSelName.textContent='--レシピを選択--';
  if(DOM.csSelected) DOM.csSelected.dataset.recipeId='';
  renderRecipePreview(null);
}
function setSelectedRecipe(recipe){
  if(DOM.csSelName) DOM.csSelName.textContent=recipe.name;
  safeSetHTML(DOM.csSelThumbs, '');
  DOM.csSelThumbs && DOM.csSelThumbs.appendChild(buildThumbsByParts(recipe,18,4));
  if(DOM.csSelected) DOM.csSelected.dataset.recipeId=recipe.id;
  renderRecipePreview(recipe);
}

/* ドロップダウン開閉 */
function isClosed(){ return DOM.csItems ? DOM.csItems.classList.contains('cs-hide') : true; }
function openMenu(){ if(!DOM.csItems||!DOM.csSelected) return; DOM.csItems.classList.remove('cs-hide'); DOM.csSelected.setAttribute('aria-expanded','true'); }
function closeMenu(){ if(!DOM.csItems||!DOM.csSelected) return; DOM.csItems.classList.add('cs-hide'); DOM.csSelected.setAttribute('aria-expanded','false'); }
DOM.csSelected && DOM.csSelected.addEventListener('click',()=>{ if(isClosed()) openMenu(); else closeMenu(); });
document.addEventListener('click',(e)=>{ if(!e.target.closest('.custom-select')) closeMenu(); });

/* セレクト直下に「食材画像 × 個数」プレビュー */
function renderRecipePreview(recipe){
  if(!DOM.recipePreview) return;
  safeSetHTML(DOM.recipePreview, '');
  if(!recipe) return;
  const stack=document.createElement('div');
  stack.className='ing-stack';
  recipe.partsOrdered.forEach(({idx,qty})=>{
    stack.appendChild(makeIngLineByPart(idx, qty)); // 画像 + ×個数（名前なし）
  });
  DOM.recipePreview.appendChild(stack);
}

/* ===== 登録済みリスト ===== */
function makeIngLineByPart(idx,count){
  const line=document.createElement('div'); line.className='ing-line';
  const ing=manager.ingredients[idx];
  const img=document.createElement('img'); img.src=ing.img; img.alt=ing.name; img.onerror=()=>{ img.style.opacity='0.35'; };
  const cnt=document.createElement('span'); cnt.className='cnt'; cnt.textContent=`×${count}`;
  line.title=ing.name; line.appendChild(img); line.appendChild(cnt);
  return line;
}
function renderAddedList(){
  safeSetHTML(DOM.addedListPC, ''); safeSetHTML(DOM.addedListSP, '');
  manager.cart.forEach((it,idx)=>{
    const g=manager.genreById(it.genreId); const r=manager.recipe(it.genreId,it.recipeId);
    if(!r) return;

    const buildRow=()=>{
      const row=document.createElement('div'); row.className='added-row';
      const left=document.createElement('div'); left.className='added-left'; left.textContent=`${g.name} / ${r.name}`;
      const center=document.createElement('div'); center.className='added-center';

      const qty=document.createElement('input'); qty.type='number'; qty.min=1; qty.value=it.qty; qty.className='qty';
      qty.addEventListener('change',()=>{
        let v=parseInt(qty.value,10); if(isNaN(v)||v<1) v=1;
        qty.value=v; manager.setQty(idx,v); renderTotals(); renderAddedList();
      });

      const stack=document.createElement('div'); stack.className='ing-stack';
      r.partsOrdered.forEach(({idx:pi,qty:q})=>{ stack.appendChild(makeIngLineByPart(pi, q*it.qty)); });

      const right=document.createElement('div'); right.className='added-right';
      const del=document.createElement('button'); del.className='ghost'; del.textContent='削除';
      del.addEventListener('click',()=>{ manager.remove(idx); refresh(); });
      right.appendChild(del);

      center.appendChild(qty);
      center.appendChild(stack);
      row.appendChild(left); row.appendChild(center); row.appendChild(right);
      return row;
    };

    DOM.addedListPC && DOM.addedListPC.appendChild(buildRow());
    DOM.addedListSP && DOM.addedListSP.appendChild(buildRow());
  });
  if(DOM.itemsCount) DOM.itemsCount.textContent=String(manager.cart.length);
}

/* ===== 合計テーブル ===== */
function renderTotals(){
  safeSetHTML(DOM.totalsBody, '');
  const totals=manager.totals();

  let grand = 0;
  totals.forEach((t,i)=>{
    if(t===0) return;
    grand += t;

    const tr=document.createElement('tr');
    const td1=document.createElement('td');
    const img=document.createElement('img');
    img.className='tot-img';
    img.src=manager.ingredients[i].img;
    img.alt=manager.ingredients[i].name;
    img.onerror=()=>{ img.style.opacity='0.35'; };
    td1.appendChild(img);
    td1.appendChild(document.createTextNode(manager.ingredients[i].name));

    const td2=document.createElement('td');
    td2.textContent=t;

    tr.appendChild(td1);
    tr.appendChild(td2);
    DOM.totalsBody && DOM.totalsBody.appendChild(tr);
  });

  // --- 総計行を最後に追加 ---
  const trTotal = document.createElement('tr');
  const tdLabel = document.createElement('td');
  tdLabel.textContent = '総計';
  tdLabel.style.fontWeight = '700';

  const tdValue = document.createElement('td');
  tdValue.textContent = grand;

  trTotal.appendChild(tdLabel);
  trTotal.appendChild(tdValue);
  DOM.totalsBody && DOM.totalsBody.appendChild(trTotal);
}

/* ===== イベント ===== */
DOM.addBtn && DOM.addBtn.addEventListener('click',()=>{
  const gid=currentGenreId();
  const ridAttr = DOM.csSelected ? DOM.csSelected.dataset.recipeId : '';
  if(gid==null || !ridAttr){ alert('レシピを選択してください'); return; }
  const rid=Number(ridAttr);
  const qty=parseInt(DOM.qtyInput.value,10);
  if(!Number.isInteger(qty)||qty<1){ alert('個数は1以上の整数'); return; }
  manager.add(gid,rid,qty); refresh();
});
DOM.clearBtn && DOM.clearBtn.addEventListener('click',()=>{
  if(!confirm('登録済みをすべて削除しますか？')) return;
  manager.cart=[]; localStorage.removeItem('recipeCart'); refresh();
});

/* ===== 初期化 ===== */
function refresh(){ renderAddedList(); renderTotals(); }
function init(){
  ensureRecipePreviewSlot();       // ★ 念のため自動作成
  populateGenres();
  refresh();
}
init();
