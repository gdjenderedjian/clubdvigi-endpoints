// pages/api/lookup.js

export default async function handler(req, res) {
  // --- CORS ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  // --- Selftest: revisar ENV ---
  if (req.method === 'GET' && req.query.selftest === '1') {
    return res.status(200).json({
      ok: true,
      hasStore: !!process.env.SHOPIFY_STORE,
      hasToken: !!process.env.SHOPIFY_ADMIN_TOKEN,
    });
  }

  // --- Checkshop: probar conexión Shopify ---
  if (req.method === 'GET' && req.query.checkshop === '1') {
    try {
      const r = await fetch(`https://${process.env.SHOPIFY_STORE}/admin/api/2024-10/shop.json`, {
        headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN },
        cache: 'no-store',
      });
      const txt = await r.text().catch(() => '');
      return res.status(200).json({ ok: r.ok, status: r.status, sample: txt.slice(0, 200) });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'CHECKSHOP_FAIL', details: e?.message || 'unknown' });
    }
  }

  try {
    // --- Normalizador de email ---
    const extractEmail = (obj = {}) => {
      const candidates = [
        'email', 'Email', 'e-mail', 'mail', 'correo', 'correo_electronico',
        'customer[email]', 'fields[email]', 'contact[email]'
      ];
      for (const k of candidates) if (obj[k]) return String(obj[k]).trim();
      for (const k of Object.keys(obj)) {
        if (k.toLowerCase().includes('email') && obj[k]) return String(obj[k]).trim();
      }
      return '';
    };

    const emailFromQuery = extractEmail(req.query || {});
    const emailFromBody = extractEmail(req.body || {});
    const email = (emailFromBody || emailFromQuery || '').trim();

    if (!email) {
      return res.status(400).json({
        ok: false,
        error: 'Falta el parámetro email',
        hint: 'Usá ?email=... o enviá JSON {"email":"..."}',
      });
    }

    const SHOPIFY_STORE = process.env.SHOPIFY_STORE; // Ej: clubdvigi.myshopify.com
    const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN; // shpat_...
    if (!SHOPIFY_STORE || !SHOPIFY_ADMIN_TOKEN) {
      return res.status(500).json({ ok: false, error: 'Faltan SHOPIFY_STORE o SHOPIFY_ADMIN_TOKEN' });
    }

    const base = `https://${SHOPIFY_STORE}/admin/api/2024-10`;

    // --- 1️⃣ Buscar cliente exacto ---
    const rExact = await fetch(`${base}/customers.json?email=${encodeURIComponent(email)}`, {
      headers: { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN, 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    let exact = [];
    try { exact = (await rExact.json())?.customers || []; } catch {}
    if (!rExact.ok) {
      const t = await rExact.text().catch(() => '');
      return res.status(502).json({
        ok: false,
        where: 'customers_exact',
        error: 'SHOPIFY_ERROR',
        status: rExact.status,
        details: t.slice(0, 500),
      });
    }
    if (exact.length > 0) {
      return res.status(200).json({
        ok: true,
        found: true,
        where: 'customers_exact',
        count: exact.length,
        data: exact,
      });
    }

    // --- 2️⃣ Buscar cliente general (search) ---
    const rSearch = await fetch(`${base}/customers/search.json?query=${encodeURIComponent(`email:${email}`)}`, {
      headers: { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN, 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    let search = [];
    try { search = (await rSearch.json())?.customers || []; } catch {}
    if (!rSearch.ok) {
      const t = await rSearch.text().catch(() => '');
      return res.status(502).json({
        ok: false,
        where: 'customers_search',
        error: 'SHOPIFY_ERROR',
        status: rSearch.status,
        details: t.slice(0, 500),
      });
    }
    if (search.length > 0) {
      return res.status(200).json({
        ok: true,
        found: true,
        where: 'customers_search',
        count: search.length,
        data: search,
      });
    }

    // --- 3️⃣ Buscar órdenes (checkout como invitado) ---
    const rOrders = await fetch(`${base}/orders.json?email=${encodeURIComponent(email)}&status=any&limit=5`, {
      headers: { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN, 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    let orders = [];
    try { orders = (await rOrders.json())?.orders || []; } catch {}
    if (!rOrders.ok) {
      const t = await rOrders.text().catch(() => '');
      return res.status(502).json({
        ok: false,
        where: 'orders',
        error: 'SHOPIFY_ERROR',
        status: rOrders.status,
        details: t.slice(0, 500),
      });
    }
    if (orders.length > 0) {
      return res.status(200).json({
        ok: true,
        found: false,
        where: 'orders',
        note: 'Email visto en órdenes, no en clientes',
        ordersCount: orders.length,
        orders,
      });
    }

    // --- Nada encontrado ---
    return res.status(200).json({ ok: true, found: false, where: 'none', data: [] });

  } catch (e) {
    console.error('[LOOKUP] UNCAUGHT:', e);
    return res.status(500).json({ ok: false, error: 'UNCAUGHT', details: e?.message || 'unknown' });
  }
}

