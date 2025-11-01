const DEFAULT_DATA = {
      weeklyGroups: [
        { id: 'A', label: 'カレー' },
        { id: 'B', label: 'サラダ' },
        { id: 'C', label: 'デザート' }
      ],
      recipes: [
        { id: 'とくせんリンゴカレー', name: 'とくせんリンゴカレー', group: 'A', slug: 'a-fallback-01', per: { 'とくせんリンゴ': 7 } }
      ],
      ingredients: [
        { name: 'とくせんリンゴ', img: 'images/ingredients/apple.png', aliases: [] }
      ]
    };

    let DATASET = null;
    const DATASET_INDEX = { bySlug: Object.create(null), byId: Object.create(null) };

    // 食材インデックス（name/aliases → レコード）& 順序
    let ING_INDEX = Object.create(null);
    let ING_ORDER = Object.create(null); // name -> index（ingredients配列の順番）

    // =========================
    // dataset.json 読み込み
    // =========================
    async function loadDataset() {
      try {
        const res = await fetch('dataset.json', { cache: 'no-cache' });
        if (!res.ok) throw new Error('dataset fetch failed');
        const data = await res.json();
        return data;
      } catch (e) {
        console.warn('dataset.json load failed. use DEFAULT_DATA', e);
        return DEFAULT_DATA;
      }
    }

    function buildIndexes(data) {
      DATASET_INDEX.bySlug = Object.create(null);
      DATASET_INDEX.byId   = Object.create(null);
      data.recipes.forEach(r => {
        const slug = r.slug || r.id;
        DATASET_INDEX.bySlug[slug] = r;
        DATASET_INDEX.byId[r.id] = r;
      });

      ING_INDEX = Object.create(null);
      ING_ORDER = Object.create(null);
      data.ingredients.forEach((ing, idx) => {
        const names = [ing.name, ...(ing.aliases || [])].filter(Boolean);
        for (const k of names) ING_INDEX[k] = ing; // name/alias → レコード
        ING_ORDER[ing.name] = idx;
      });
    }

    function getRecipeListByGroup(group) {
      const list = DATASET.recipes.filter(r => (r.group || 'A') === group);
      list.sort((a,b) => (b.slug||b.id).localeCompare(a.slug||a.id, 'ja'));
      return list;
    }

    function getRecipeParts(recipe) {
      const per = recipe.per || {};
      return Object.entries(per);
    }

function createIngImg(name, cls='ing-32') {
  const img = document.createElement('img');
  const rec = ING_INDEX[name];
  img.alt = name;
  img.title = name;
  img.className = `ing-img ${cls}`;

  // 文字ベースのSVGプレースホルダ（404時に即座に切替）
  const svg = encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'>
      <rect width='100%' height='100%' fill='#f1f3f5'/>
      <text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle'
            font-size='10' fill='#6c757d'>${(name||'').slice(0,2)}</text>
    </svg>`
  );
  const fallback = `data:image/svg+xml;charset=utf-8,${svg}`;

  img.src = (rec && rec.img) ? rec.img : fallback;
  img.onerror = () => { img.onerror = null; img.src = fallback; };

  return img;
}

