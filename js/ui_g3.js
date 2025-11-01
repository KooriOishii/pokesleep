// =========================
    // G3（集計テーブル／所持入力）
    // =========================
    function renderTotals() {
      const tbody = document.querySelector('#totalTable tbody');
      const empty = document.getElementById('totalEmpty');
      const resetBtn = document.getElementById('resetStockBtn');
      tbody.innerHTML = '';

      if (cart.size === 0) {
        empty.style.display = '';
        if (resetBtn) resetBtn.disabled = true;
        return;
      }
      empty.style.display = 'none';
      if (resetBtn) resetBtn.disabled = false;

      // 集計：ingredient -> needTotal（遭遇順も保持）
      const needMap = new Map();
      const encounterOrder = new Map();
      let seq = 0;
      for (const [slug, { qty }] of cart) {
        const per = DATASET_INDEX.bySlug[slug].per || {};
        for (const [ing, base] of Object.entries(per)) {
          if (!encounterOrder.has(ing)) encounterOrder.set(ing, seq++);
          needMap.set(ing, (needMap.get(ing) || 0) + base * qty);
        }
      }

      for (const ing of needMap.keys()) if (!stock.has(ing)) stock.set(ing, 0);

      const rowsKnown = [];
      const rowsUnknown = [];
      for (const [ing, need] of needMap.entries()) {
        const idx = ING_ORDER[ing];
        if (typeof idx === 'number') rowsKnown.push({ ing, need, idx });
        else rowsUnknown.push({ ing, need, ord: encounterOrder.get(ing) });
      }
      rowsKnown.sort((a,b) => a.idx - b.idx);
      rowsUnknown.sort((a,b) => a.ord - b.ord);
      const rows = rowsKnown.concat(rowsUnknown);

      for (const row of rows) {
        const { ing, need } = row;
        const tr = document.createElement('tr');
        tr.dataset.ing = ing;

        const tdIng = document.createElement('td');
        const ingWrap = document.createElement('div'); ingWrap.className = 'd-flex align-items-center gap-2';
        ingWrap.appendChild(createIngImg(ing, 'ing-28'));
        const label = document.createElement('span'); label.className = 'ing-label-minitext'; label.textContent = ing; // G3のみ極小ラベル
        ingWrap.appendChild(label);
        tdIng.appendChild(ingWrap);

        const tdNeed = document.createElement('td'); tdNeed.textContent = String(need);

        const tdHave = document.createElement('td');
        const input = document.createElement('input');
        input.type = 'number'; input.className = 'form-control form-control-sm w-6ch';
        input.min = '0'; input.step = '1'; input.inputMode = 'numeric'; input.pattern = '[0-9]*';
        input.value = String(stock.get(ing) || 0);
        tdHave.appendChild(input);

        const tdLack = document.createElement('td');
        tdLack.textContent = String(Math.max(need - (stock.get(ing) || 0), 0));

        input.addEventListener('input', () => {
          let v = parseInt(input.value || '0', 10);
          if (isNaN(v) || v < 0) v = 0;
          input.value = String(v);
          stock.set(ing, v);
          tdLack.textContent = String(Math.max(need - v, 0));
          saveStockToLS();
        });

        tr.appendChild(tdIng); tr.appendChild(tdNeed); tr.appendChild(tdHave); tr.appendChild(tdLack);
        tbody.appendChild(tr);
      }
    }

    // 在庫クリア
    document.addEventListener('click', (e)=>{
      const btn = e.target.closest('#resetStockBtn');
      if (!btn) return;
      if (!confirm('在庫を0にリセットします。よろしいですか？')) return;
      stock.clear();
      renderTotals();
      saveStockToLS();
    });

    // レイアウト描画
    function renderAll() {
      renderGroup2();
      renderTotals();

      const g2 = document.getElementById('group2Card');
      const clearBtn = document.getElementById('clearAllBtn');
      if (cart.size === 0) {
        g2.classList.add('d-none');
        if (clearBtn) clearBtn.disabled = true;
      } else {
        g2.classList.remove('d-none');
        if (clearBtn) clearBtn.disabled = false;
      }
    }

    