// =========================
    // G2（レシピカード）
    // =========================
    function createCardStepper(initialQty, onLiveChange, onCommit) {
      const group = document.createElement('div');
      group.className = 'input-group input-group-sm stepper-compact';

      const minus = document.createElement('button');
      minus.className = 'btn btn-outline-secondary btn-step';
      minus.type = 'button';
      minus.textContent = '－';

      const input = document.createElement('input');
      input.className = 'form-control qty-input';
      input.type = 'number'; input.inputMode = 'numeric'; input.pattern = '[0-9]*'; input.min = '1'; input.step = '1'; input.value = String(initialQty);

      const plus = document.createElement('button');
      plus.className = 'btn btn-outline-secondary btn-step';
      plus.type = 'button';
      plus.textContent = '＋';

      const clamp = (v) => { const n = parseInt(v || '1', 10); return isNaN(n) ? 1 : Math.max(1, n); };

      const sync = () => { const q = clamp(input.value); input.value = String(q); onLiveChange?.(q); };
      const commit = () => { const q = clamp(input.value); onCommit?.(q); };

      minus.addEventListener('click', () => { input.value = String(Math.max(1, (parseInt(input.value||'1',10)||1) - 1)); sync(); commit(); });
      plus .addEventListener('click', () => { input.value = String((parseInt(input.value||'1',10)||1) + 1); sync(); commit(); });
      input.addEventListener('input', sync);
      input.addEventListener('change', commit);

      group.appendChild(minus); group.appendChild(input); group.appendChild(plus);
      return group;
    }

    function renderRecipeCard(slug, recipeName, qty, recipe) {
      const card = document.createElement('div');
      card.className = 'card';

      const header = document.createElement('div');
      header.className = 'card-header d-flex justify-content-between align-items-center gap-2';

      const title = document.createElement('div');
      title.className = 'fw-semibold';
      title.textContent = recipeName;

      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-sm btn-outline-danger';
      delBtn.textContent = '×';
      delBtn.addEventListener('click', () => { cart.delete(slug); renderAll(); saveCartToLS(); });

      header.appendChild(title); header.appendChild(delBtn);
      card.appendChild(header);

      const body = document.createElement('div');
      body.className = 'card-body';

      const list = document.createElement('div');
      list.className = 'ing-grid';

      const updateListForQty = (q) => {
        list.innerHTML = '';
        for (const [ing, base] of getRecipeParts(recipe)) {
          const item = document.createElement('div');
          item.className = 'ing-grid-item';
          item.appendChild(createIngImg(ing, 'ing-32'));
          const cnt = document.createElement('span'); cnt.className = 'ing-count'; cnt.textContent = `× ${base * q}`;
          item.appendChild(cnt);
          list.appendChild(item);
        }
      };

      const stepper = createCardStepper(
        qty,
        (liveQty)  => { updateListForQty(liveQty); },
        (commitQty)=> { cart.set(slug, { qty: Math.max(1, commitQty) }); renderTotals(); saveCartToLS(); }
      );

      updateListForQty(qty);

      const ctlRow = document.createElement('div');
      ctlRow.className = 'd-flex flex-wrap align-items-center gap-2 mb-2';
      ctlRow.appendChild(stepper);

      body.appendChild(ctlRow);
      body.appendChild(list);
      card.appendChild(body);

      return card;
    }

    function renderGroup2() {
      const body = document.getElementById('group2Body');
      body.innerHTML = '';

      if (cart.size === 0) {
        const p = document.createElement('p');
        p.className = 'empty-hint m-0';
        p.textContent = 'まだ料理がありません。「追加」で投入してください。';
        body.appendChild(p);
        return;
      }

      const grid = document.createElement('div');
      grid.className = 'row g-3';

      for (const [slug, { qty }] of cart) {
        const r = DATASET_INDEX.bySlug[slug];
        const col = document.createElement('div');
        col.className = 'col-12';
        col.appendChild(renderRecipeCard(slug, r.name, qty, r));
        grid.appendChild(col);
      }
      body.appendChild(grid);
    }

    function bindClearAll() {
      const clearBtn = document.getElementById('clearAllBtn');
      if (!clearBtn) return;
      clearBtn.addEventListener('click', () => {
        if (cart.size === 0) return;
        if (!confirm('本当に全削除しますか？')) return;
        cart.clear();
        renderAll();
        saveCartToLS();
      });
    }

    