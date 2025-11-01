    // =========================
    // 起動
    // =========================
    (async function init(){
      DATASET = await loadDataset();
      buildIndexes(DATASET);
      buildIngredientMatchers();
      bindGroup1();
      bindClearAll();
      bindCameraUI();
      renderAll();
    })();
  