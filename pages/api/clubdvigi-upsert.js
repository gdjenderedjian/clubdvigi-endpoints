// api/clubdvigi-upsert.js
// Crea o actualiza un cliente en Shopify + guarda productos con garantía (metafield JSON)
// y agrega tags: clubdvigi, Completó Formulario Web, y opcionalmente clubdvigi_whatsapp

const API_VERSION = '2025-01';
const NAMESPACE = 'dvigi';
const KEY_WARRANTY = 'warranty_items';

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
    const {
      email,
      first_name,
      last_name,
      whatsapp,
      notify_channel,
      product_id,
      product_handle,
      product_title,
      month,
      year,
      tags
    } = req.body || {};

    if (!email) return res.status(400).json({ error: 'Email requerido' });

    const shop = process.env.SHOPIFY_STORE;
    const token = process.env.SHOPIFY_ADMIN_TOKEN;
    if (!shop || !token) return res.status(500).json({ error: 'Faltan variables de entorno' });

    const admin = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;
    const headers = {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json'
    };

    // --- 1. Buscar cliente por email
    const qSearch = `
      query($q:String!){
        customers(first:1, query:$q){
          nodes{ id email tags }
        }
      }`;
    const search = await fetch(admin, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: qSearch, variables: { q: `email:${email}` } })
    }).then(r => r.json());
    const found = search?.data?.customers?.nodes?.[0] || null;
    const existed = !!found;

    // --- 2. Preparar tags
    const baseTags = Array.isArray(tags) ? tags : [];
    if (notify_channel === 'whatsapp') baseTags.push('clubdvigi_whatsapp');
    baseTags.push('clubdvigi', 'Completó Formulario Web');
    const allTags = Array.from(new Set([...(found?.tags || []), ...baseTags]));

    // --- 3. Crear o actualizar cliente
    const input = {
      email,
      firstName: first_name || undefined,
      lastName: last_name || undefined,
      phone: whatsapp || undefined,
      tags: allTags
    };

    let customerId = found?.id;

    if (!customerId) {
      const qCreate = `
        mutation($input:CustomerInput!){
          customerCreate(input:$input){
            customer{ id }
            userErrors{ message }
          }
        }`;
      const created = await fetch(admin, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: qCreate, variables: { input } })
      }).then(r => r.json());
      const err = created?.data?.customerCreate?.userErrors?.[0];
      if (err) return res.status(400).json({ error: err.message });
      customerId = created?.data?.customerCreate?.customer?.id;
    } else {
      const qUpdate = `
        mutation($id:ID!,$input:CustomerInput!){
          customerUpdate(id:$id,input:$input){
            customer{ id }
            userErrors{ message }
          }
        }`;
      const updated = await fetch(admin, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: qUpdate, variables: { id: customerId, input } })
      }).then(r => r.json());
      const err = updated?.data?.customerUpdate?.userErrors?.[0];
      if (err) return res.status(400).json({ error: err.message });
    }

    // --- 4. Obtener y actualizar metafield de productos con garantía
    const qGetMF = `
      query($id:ID!){
        customer(id:$id){
          metafield(namespace:"${NAMESPACE}", key:"${KEY_WARRANTY}"){
            id
            value
          }
        }
      }`;
    const curr = await fetch(admin, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: qGetMF, variables: { id: customerId } })
    }).then(r => r.json());

    let list = [];
    try {
      list = curr?.data?.customer?.metafield?.value
        ? JSON.parse(curr.data.customer.metafield.value)
        : [];
    } catch {}
    if (!Array.isArray(list)) list = [];

    const entry = {
      product_id: product_id || '',
      handle: product_handle || '',
      title: product_title || '',
      month,
      year,
      recordedAt: new Date().toISOString()
    };

    const duplicate = list.some(
      x => x.handle === entry.handle && x.month === entry.month && x.year === entry.year
    );
    if (!duplicate && (entry.title || entry.handle)) list.push(entry);

    const qSetMF = `
      mutation($ownerId:ID!,$value:String!){
        metafieldsSet(metafields:[{
          ownerId:$ownerId,
          namespace:"${NAMESPACE}",
          key:"${KEY_WARRANTY}",
          type:"json",
          value:$value
        }]){
          userErrors{ message }
        }
      }`;

    const saved = await fetch(admin, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: qSetMF,
        variables: { ownerId: customerId, value: JSON.stringify(list) }
      })
    }).then(r => r.json());

    const mfErr = saved?.data?.metafieldsSet?.userErrors?.[0];
    if (mfErr) return res.status(400).json({ error: mfErr.message });

    // --- 5. Respuesta final
    return res.status(200).json({
      ok: true,
      existed,
      message: existed
        ? 'Actualizamos tus datos y tu producto en Club Dvigi 💧'
        : 'Te registramos en Club Dvigi y guardamos tu producto 💙'
    });
  } catch (e) {
    console.error('Error general:', e);
    return res.status(500).json({ error: e?.message || 'Server error' });
  }
}
