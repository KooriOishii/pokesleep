    // カメラUI（開閉・行数・スライダー・読取）
    function bindCameraUI() {
      const toggleBtn = document.getElementById('cameraToggle');
      const refreshBtn = document.getElementById('cameraRefresh');
      const area = document.getElementById('cameraArea');
      const file = document.getElementById('cameraFile');
      const fileBtn = document.getElementById('fileSelectBtn');
      const fileName = document.getElementById('fileName');
      const s1 = document.getElementById('cameraSlider1');
      const s2 = document.getElementById('cameraSlider2');
      const readBtn = document.getElementById('cameraReadBtn');
      const rowCount = document.getElementById('rowCount');
      const gridPreview = document.getElementById('gridPreview');
      const debugToggle = document.getElementById('debugToggle');

      OCR.status = document.getElementById('ocrStatus');

      const setOpen = (open) => {
        toggleBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
        toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        area.classList.toggle('d-none', !open);
        area.setAttribute('aria-hidden', open ? 'false' : 'true');
        refreshBtn.classList.toggle('d-none', !open);
        if (!open) gridPreview.classList.add('d-none');
        toggleBtn.classList.toggle('btn-primary', open);
        toggleBtn.classList.toggle('btn-outline-secondary', !open);
      };
      setOpen(false);

      toggleBtn.addEventListener('click', () => {
        const open = toggleBtn.getAttribute('aria-pressed') !== 'true';
        setOpen(open);
      });

      fileBtn.addEventListener('click', () => file.click());
      file.addEventListener('change', async () => {
        const has = file.files && file.files.length;
        const name = has ? file.files[0].name : '未選択';
        fileName.textContent = name;
        gridPreview.classList.toggle('d-none', !has);
        if (!has) { gridPreview.classList.add('d-none'); document.getElementById('tileThumbs').innerHTML=''; return; }
        __lastFile = file.files[0];
        await buildTileThumbnails(__lastFile);
      });

      function updateRowButtons() {
        [...rowCount.querySelectorAll('button[data-rows]')].forEach(btn => {
          const isActive = parseInt(btn.dataset.rows, 10) === gridRowCount;
          btn.classList.toggle('active', isActive);
          btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
      }
      rowCount.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-rows]');
        if (!btn) return;
        gridRowCount = parseInt(btn.dataset.rows, 10) || 4;
        updateRowButtons();
        if (__lastFile) await buildTileThumbnails(__lastFile);
      });
      updateRowButtons();

      s1.addEventListener('input', async () => { if (__lastFile) await buildTileThumbnails(__lastFile); });
      s2.addEventListener('input', async () => { if (__lastFile) await buildTileThumbnails(__lastFile); });

      refreshBtn.addEventListener('click', async () => {
        gridRowCount = 4; updateRowButtons();
        s1.value = '50'; s2.value = '50'; delete s1.dataset.gapx; delete s2.dataset.yofs;
        file.value = ''; fileName.textContent = '未選択';
        document.getElementById('tileThumbs').innerHTML='';
        gridPreview.classList.add('d-none');
        document.getElementById('confirmPanel').classList.add('d-none');
        document.getElementById('leftoverPanel').classList.add('d-none');
        if (OCR.status) OCR.status.textContent = '';
      });

      if (debugToggle) { debugToggle.addEventListener('change', ()=>{ OCR.debug = !!debugToggle.checked; if (!OCR.debug) setDebugLines(''); else setDebugLines('(ON)'); }); }

      readBtn.addEventListener('click', async () => {
        try{
          readBtn.disabled = true;
          if (!__lastFile) { alert('画像を選択してください'); return; }
          await ocrHybridGrid(__lastFile);
        }catch(e){ console.error(e); alert('読取中にエラーが発生しました'); }
        finally{ readBtn.disabled = false; }
      });
    }

