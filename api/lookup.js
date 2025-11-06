const API_VERSION = '2025-01';

function setCors(res, origin) {
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(res, req.headers.origin);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email requerido' });

    const shop = process.env.SHOPIFY_STORE;
    const token = process.env.SHOPIFY_ADMIN_TOKEN;
    if (!shop || !token) return res.status(500).json({ error: 'Faltan variables de entorno' });

    const admin = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;
    const headers = { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' };

    const query = `
      query ($q: String!) {
        customers(first: 1, query: $q) {
          nodes { id email firstName lastName phone }
        }
      }`;

    const resp = await fetch(admin, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables: { q: \`email:${email}\` } }),
    }).then(r => r.json());

    const c = resp?.data?.customers?.nodes?.[0];
    if (!c) return res.status(404).json({});

    return res.status(200).json({
      first_name: c.firstName || '',
      last_name: c.lastName || '',
      phone: c.phone || ''
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Server error' });
  }
}
