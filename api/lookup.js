// pages/api/lookup.js

export default async function handler(req, res) {
  // 🔹 Configurar CORS (para permitir el acceso desde tu formulario en Shopify)
  res.setHeader('Access-Control-Allow-Origin', '*'); // en prod podés poner tu dominio
  res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // 🔹 Responder preflight de CORS
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // 🔹 Aceptar solo GET o POST
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  try {
    // 1️⃣ Leer email desde query (GET) o body (POST)
    let email = '';
    if (req.method === 'GET') {
      email = req.query.email || '';
    } else if (req.method === 'POST') {
      email = req.body?.email || '';
    }

    email = email.trim();
    if (!email) {
      return res.status(400).json({ ok: false, error: 'Falta el parámetro email' });
    }

    // 2️⃣ Leer las variables de entorno
    const SHOPIFY_STORE = process.env.SHOPIFY_STORE; // Ej: clubdvigi.myshopify.com
    const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN; // Ej: shpat_xxx...

    if (!SHOPIFY_STORE || !SHOPIFY_ADMIN_TOKEN) {
      return res.status(500).json({
        ok: false,
        error:
          'Faltan variables de entorno SHOPIFY_STORE o SHOPIFY_ADMIN_TOKEN en Vercel',
      });
    }

    // 3️⃣ Hacer consulta a Shopify
    const url = `https://${SHOPIFY_STORE}/admin/api/2024-10/customers/search.json?query=email:${encodeURIComponent(
      email
    )}`;

    const shopifyResponse = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN,
        'Content-Type': 'application/json',
      },
    });

    // 4️⃣ Manejar errores de Shopify
    if (!shopifyResponse.ok) {
      const text = await shopifyResponse.text().catch(() => '');
      return res.status(502).json({
        ok: false,
        error: 'Error al consultar Shopify',
        status: shopifyResponse.status,
        details: text.slice(0, 300),
      });
    }

    // 5️⃣ Enviar respuesta JSON al cliente
    const data = await shopifyResponse.json();
    return res.status(200).json({
      ok: true,
      found: data.customers?.length > 0,
      data: data.customers || [],
    });
  } catch (error) {
    console.error('[Lookup error]', error);
    return res.status(500).json({
      ok: false,
      error: 'Error interno del servidor',
      details: error?.message || 'unknown',
    });
  }
}
