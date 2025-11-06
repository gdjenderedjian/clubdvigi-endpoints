// pages/api/lookup.js
// Busca un cliente por email en Shopify Admin (GraphQL) y devuelve si existe.
// CORS habilitado para tu tienda. No expone tokens en el front: usa variables de entorno.
//
// Requiere en Vercel (Settings → Environment Variables):
// - SHOPIFY_STORE = dvigiarg.myshopify.com
// - SHOPIFY_ADMIN_TOKEN = shpat_xxx (Admin API access token)

const API_VERSION = '2025-01';
const ALLOW_ORIGIN = 'https://dvigiarg.myshopify.com'; // cambiá si usás otro dominio de tienda

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

export default async function handler(req, res) {
  setCORS(res);

  // Preflight
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    // Admite varios alias por compatibilidad con el front
    const body = req.body || {};
    const email =
      body.email ||
      body?.customer?.email ||
      body.mail ||
      body.customer_email;

    if (!email) {
      return res.status(400).json({ error: 'email requerido' });
    }

    // Llamada a Shopify GraphQL Admin
    const resp = await fetch(
      `https://${process.env.SHOPIFY_STORE}/admin/api/${API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: `
            query($q: String!) {
              customers(first: 1, query: $q) {
                edges {
                  node {
                    id
                    email
                    firstName
                    lastName
                    phone
                    tags
                  }
                }
              }
            }
          `,
          // La sintaxis email: funciona sin comillas
          variables: { q: `email:${email}` },
        }),
      }
    );

    const json = await resp.json();

    if (!resp.ok) {
      // Error HTTP
      return res
        .status(resp.status)
        .json({ error: 'shopify_http_error', detail: json });
    }

    if (json.errors) {
      // Errores GraphQL de nivel superior
      return res
        .status(500)
        .json({ error: 'shopify_graphql_error', detail: json.errors });
    }

    const node = json?.data?.customers?.edges?.[0]?.node || null;

    return res.status(200).json({
      found: Boolean(node),
      customer: node, // puede ser null si no existe
    });
  } catch (e) {
    console.error('[lookup] error', e);
    return res
      .status(500)
      .json({ error: 'server_error', detail: String(e?.message || e) });
  }
}

