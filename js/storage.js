// =========================
    // localStorage（v1）
    // =========================
    const LS = { CART: 'ps-v1-cart', STOCK: 'ps-v1-stock' };

    function saveCartToLS() {
      try {
        const items = [...cart.entries()].map(([slug, { qty }]) => [slug, qty]);
        localStorage.setItem(LS.CART, JSON.stringify({ items }));
      } catch (e) { console.warn('saveCartToLS failed', e); }
    }

    function loadCartFromLS() {
      try {
        const raw = JSON.parse(localStorage.getItem(LS.CART) || '{}');
        const items = raw.items || [];
        const m = new Map();
        for (const [slug, qty] of items) {
          m.set(slug, { qty: Math.max(1, parseInt(qty || '1', 10) || 1) });
        }
        return m;
      } catch (e) { return new Map(); }
    }

    function saveStockToLS() {
      try {
        const entries = [...stock.entries()];
        localStorage.setItem(LS.STOCK, JSON.stringify({ entries }));
      } catch (e) { console.warn('saveStockToLS failed', e); }
    }

    function loadStockFromLS() {
      try {
        const raw = JSON.parse(localStorage.getItem(LS.STOCK) || '{}');
        const entries = raw.entries || [];
        return new Map(entries);
      } catch (e) { return new Map(); }
    }

    // =========================
    // 状態
    // =========================
    const cart  = loadCartFromLS(); // Map<slug,{qty}>
    const stock = loadStockFromLS(); // Map<name,have>

    