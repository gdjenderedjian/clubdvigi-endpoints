// pages/api/clubdvigi-upsert.js

export default async function handler(req, res) {
  // --- CORS ---
  res.setHeader('Access-Control-Allow-Origin', '*'); // en prod poné tu dominio
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  // --- ENV ---
  const SHOPIFY_STORE = process.env.SHOPIFY_STORE;           // ej: midominio.myshopify.com
  const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN; // shpat_... (Admin API con read_customers)
  if (!SHOPIFY_STORE || !SHOPIFY_ADMIN_TOKEN) {
    return res.status(500).json({
      ok: false,
      error: 'Faltan SHOPIFY_STORE o SHOPIFY_ADMIN_TOKEN en variables de entorno',
    });
  }

  try {
    // --- BODY ---
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    // Campos mínimos recomendados
    const email = String(body.email || '').trim();
    const first_name = String(body.first_name || body.nombre || '').trim();
    const last_name = String(body.last_name || body.apellido || '').trim();
    const phone = String(body.phone || '').trim();
    const tags = Array.isArray(body.tags) ? body.tags : (body.tags ? String(body.tags).split(',').map(s => s.trim()).filter(Boolean) : []);
    const accepts_marketing = Boolean(body.accepts_marketing ?? false);
    const note = String(body.note || body.nota || '').trim();

    if (!email) {
      return res.status(400).json({ ok: false, error: 'Falta email' });
    }

    const base = `https://${SHOPIFY_STORE}/admin/api/2024-10`;

    // --- 1) ¿Existe ya un customer con este email? (match exacto)
    const rExact = await fetch(`${base}/customers.json?email=${encodeURIComponent(email)}`, {
      headers: { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN, 'Content-Type': 'application/json' },
      cache: 'no-store',
    });

    const exactJson = await rExact.json().catch(() => ({}));
    if (!rExact.ok) {
      const txt = JSON.stringify(exactJson).slice(0, 500);
      return res.status(502).json({ ok: false, stage: 'lookup', error: 'SHOPIFY_ERROR', status: rExact.status, details: txt });
    }

    const customers = Array.isArray(exactJson?.customers) ? exactJson.customers : [];
    const exists = customers.length > 0;
    const existing = exists ? customers[0] : null;

    // --- 2) Armar payload de customer
    const customerPayload = {
      customer: {
        email,
        first_name: first_name || undefined,
        last_name: last_name || undefined,
        phone: phone || undefined,
        tags: tags.length ? tags.join(', ') : undefined,
        accepts_marketing,
        note: note || undefined,
        // Si querés metafields, descomentá y ajustá:
        // metafields: [
        //   {
        //     namespace: 'clubdvigi',
        //     key: 'serial',
        //     type: 'single_line_text_field',
        //     value: String(body.serial || '')
        //   }
        // ]
      }
    };

    // --- 3) Crear o actualizar
    if (!exists) {
      // CREATE
      const rCreate = await fetch(`${base}/customers.json`, {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify(customerPayload),
      });
      const createJson = await rCreate.json().catch(() => ({}));
      if (!rCreate.ok) {
        const txt = JSON.stringify(createJson).slice(0, 1000);
        return res.status(502).json({ ok: false, action: 'create', error: 'SHOPIFY_ERROR', status: rCreate.status, details: txt });
      }
      return res.status(201).json({ ok: true, action: 'created', data: createJson.customer || createJson });
    } else {
      // UPDATE
      const id = existing.id;
      const rUpdate = await fetch(`${base}/customers/${id}.json`, {
        method: 'PUT',
        headers: { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify(customerPayload),
      });
      const updateJson = await rUpdate.json().catch(() => ({}));
      if (!rUpdate.ok) {
        const txt = JSON.stringify(updateJson).slice(0, 1000);
        return res.status(502).json({ ok: false, action: 'update', error: 'SHOPIFY_ERROR', status: rUpdate.status, details: txt });
      }
      return res.status(200).json({ ok: true, action: 'updated', id, data: updateJson.customer || updateJson });
    }
  } catch (e) {
    console.error('[UPSERT] UNCAUGHT:', e);
    return res.status(500).json({ ok: false, error: 'UNCAUGHT', details: e?.message || 'unknown' });
  }
}
