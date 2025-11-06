// pages/api/lookup.js
export default async function handler(req, res) {
  // CORS básico
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  // --- Selftests útiles ---
  // 1) Chequear ENV rápido
  if (req.method === 'GET' && req.query.selftest === '1') {
    return res.status(200).json({
      ok: true,
      hasStore: !!process.env.SHOPIFY_STORE,
      hasToken: !!process.env.SHOPIFY_ADMIN_TOKEN,
    });
  }
  // 2) Probar acceso a la tienda (detecta 401/403/404)
  if (req.method === 'GET' && req.query.checkshop === '1') {
    try {
      const r = await fetch(`https://${process.env.SHOPIFY_STORE}/admin/api/2024-10/shop.json`, {
        headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN },
        cache: 'no-store',
      });
      const txt = await r.text().catch(() => '');
      return res.status(200).json({ ok: r.ok, status: r.status, sample: txt.slice(0, 300) });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'CHECKSHOP_FAIL', details: e?.message || 'unknown' });
    }
  }

  try {
    // Normalizar email desde GET/POST (acepta varios nombres)
    const extractEmail = (obj = {}) => {
      const candidates = [
        'email','Email','e-mail','mail','correo',
        'customer[email]','fields[email]','contact[email]'
      ];
      for (const k of candidates) if (obj[k]) return String(obj[k]).trim();
      for (const k of Object.keys(obj)) if (k.toLowerCase().includes('email') && obj[k]) return String(obj[k]).trim();
      return '';
    };
    const email = req.method === 'GET'
      ? extractEmail(req.query || {})
      : extractEmail(req.body || {});

    if (!email) {
      return res.status(400).json({ ok: false, error: 'Falta el parámetro email' });
    }

    const SHOPIFY_STORE = process.env.SHOPIFY_STORE;           // p.ej. my-store.myshopify.com
    const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN; // shpat_... (Admin API, no Storefront)
    if (!SHOPIFY_STORE || !SHOPIFY_ADMIN_TOKEN) {
      return res.status(500).json({ ok: false, error: 'Faltan SHOPIFY_STORE o SHOPIFY_ADMIN_TOKEN' });
    }

    const url = `https://${SHOPIFY_STORE}/admin/api/2024-10/customers/search.json?query=${encodeURIComponent(`email:${email}`)}`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    const raw = await resp.text().catch(() => '');
    if (!resp.ok) {
      // Devuelvo status y texto de Shopify para ver la causa real (401/403/404/429/etc.)
      return res.status(502).json({
        ok: false,
        error: 'SHOPIFY_ERROR',
        status: resp.status,
        details: raw.slice(0, 500),
      });
    }

    // Parse seguro
    let data;
    try { data = raw ? JSON.parse(raw) : { customers: [] }; }
    catch { data = { customers: [] }; }

    const customers = Array.isArray(data?.customers) ? data.customers : [];
    return res.status(200).json({
      ok: true,
      found: customers.length > 0,
      data: customers,
    });
  } catch (e) {
    console.error('[LOOKUP] UNCAUGHT:', e);
    return res.status(500).json({
      ok: false,
      error: 'UNCAUGHT',
      details: e?.message || 'unknown',
    });
  }
}
