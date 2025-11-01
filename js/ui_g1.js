// =========================
    // G1（選択 → 追加）
    // =========================
    let weeklyGroup = 'A';

    function bindGroup1() {
      const radA = document.getElementById('wgA');
      const radB = document.getElementById('wgB');
      const radC = document.getElementById('wgC');
      const select = document.getElementById('recipeSelect');
      const g1Prev = document.getElementById('g1Preview');
      const qtyMinus = document.getElementById('qtyMinus');
      const qtyPlus  = document.getElementById('qtyPlus');
      const qtyInput = document.getElementById('qtyInput');
      const addBtn   = document.getElementById('addBtn');

      const renderGroupLabel = () => {
        const A = DATASET.weeklyGroups.find(g=>g.id==='A');
        const B = DATASET.weeklyGroups.find(g=>g.id==='B');
        const C = DATASET.weeklyGroups.find(g=>g.id==='C');
        if (A) document.getElementById('wgLabelA').textContent = A.label || 'A';
        if (B) document.getElementById('wgLabelB').textContent = B.label || 'B';
        if (C) document.getElementById('wgLabelC').textContent = C.label || 'C';
      };

      const renderSelect = () => {
        select.innerHTML = '';
        const list = getRecipeListByGroup(weeklyGroup);
        const empty = document.createElement('option'); empty.value = ''; empty.textContent = '— 料理を選択 —'; select.appendChild(empty);
        for (const r of list) {
          const opt = document.createElement('option');
          opt.value = r.slug || r.id;
          opt.textContent = r.name || r.id;
          select.appendChild(opt);
        }
      };

      const renderPreview = (slug, qty) => {
        g1Prev.innerHTML = '';
        if (!slug) return;
        const r = DATASET_INDEX.bySlug[slug];
        const per = r?.per || {};
        for (const [ing, base] of Object.entries(per)) {
          const chip = document.createElement('span'); chip.className = 'ing-chip border rounded bg-light';
          chip.appendChild(createIngImg(ing, 'ing-28'));
          const txt = document.createElement('span'); txt.textContent = `× ${base * qty}`; txt.className = 'ing-count';
          chip.appendChild(txt);
          g1Prev.appendChild(chip);
        }
      };

      const setQty = (v) => { const n = Math.max(1, parseInt(v||'1',10)||1); qtyInput.value = String(n); return n; };

      radA.addEventListener('change', () => { if (radA.checked) { weeklyGroup = 'A'; renderSelect(); renderPreview(select.value, setQty(qtyInput.value)); } });
      radB.addEventListener('change', () => { if (radB.checked) { weeklyGroup = 'B'; renderSelect(); renderPreview(select.value, setQty(qtyInput.value)); } });
      radC.addEventListener('change', () => { if (radC.checked) { weeklyGroup = 'C'; renderSelect(); renderPreview(select.value, setQty(qtyInput.value)); } });
      select.addEventListener('change', () => renderPreview(select.value, setQty(qtyInput.value)));
      qtyMinus.addEventListener('click', () => renderPreview(select.value, setQty((parseInt(qtyInput.value||'1',10)||1)-1)));
      qtyPlus .addEventListener('click', () => renderPreview(select.value, setQty((parseInt(qtyInput.value||'1',10)||1)+1)));
      qtyInput.addEventListener('input', () => renderPreview(select.value, setQty(qtyInput.value)));

      addBtn.addEventListener('click', () => {
        const slug = select.value; if (!slug) return;
        const q = Math.max(1, parseInt(qtyInput.value||'1',10)||1);
        cart.set(slug, { qty: q });
        renderAll();
        saveCartToLS();
      });

      renderGroupLabel(); renderSelect(); renderPreview('', setQty(qtyInput.value));
    }

    