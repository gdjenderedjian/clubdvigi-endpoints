// pages/api/clubdvgi-upsert.js
// Upsert de cliente + creación de Metaobjetos `warranty_registration` por compra
// + vinculación al metafield del cliente `custom.registros_de_garantia`.
// Versión robusta: autodetecta handles de campos en la definición del metaobjeto
// y asegura el tag `clubdvigi` con tagsAdd si hace falta.
//
// ENV (Vercel):
// - SHOPIFY_STORE = dvigiarg.myshopify.com
// - SHOPIFY_ADMIN_TOKEN = shpat_xxx

const API_VERSION = '2025-01';
const ALLOW_ORIGIN = 'https://dvigiarg.myshopify.com'; // Cambiá si tu tienda usa dominio propio

// Config general
const MO_TYPE = 'warranty_registration'; // handle del tipo de metaobjeto
const CUSTOMER_META_NAMESPACE = 'custom';
const CUSTOMER_META_KEY = 'registros_de_garantia';
const MONTHS_TO_EXPIRE = 12; // 12 o 6 según tu filtro

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

function toGid(type, id) {
  return `gid://shopify/${type}/${id}`;
}

async function gql(query, variables = {}) {
  const resp = await fetch(
    `https://${process.env.SHOPIFY_STORE}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    }
  );
  const json = await resp.json();
  if (!resp.ok) throw new Error(`shopify_http_error ${resp.status}: ${JSON.stringify(json)}`);
  if (json.errors) throw new Error(`shopify_graphql_error: ${JSON.stringify(json.errors)}`);
  return json.data;
}

// ---------- GraphQL ----------
const Q_CUSTOMER_SEARCH = `
  query($q:String!){
    customers(first:1, query:$q){
      edges{ node{ id email firstName lastName phone tags } }
    }
  }
`;
const M_CUSTOMER_CREATE = `
  mutation($input: CustomerInput!){
    customerCreate(input:$input){
      customer{ id }
      userErrors{ field message }
    }
  }
`;
const M_CUSTOMER_UPDATE = `
  mutation($input: CustomerInput!){
    customerUpdate(input:$input){
      customer{ id tags }
      userErrors{ field message }
    }
  }
`;
const M_TAGS_ADD = `
  mutation($id:ID!, $tags:[String!]!){
    tagsAdd(id:$id, tags:$tags){
      node{ id ... on Customer { tags } }
      userErrors{ field message }
    }
  }
`;
const M_METAOBJECT_CREATE = `
  mutation($type:String!, $fields:[MetaobjectFieldInput!]!){
    metaobjectCreate(metaobject:{ type:$type, fields:$fields }){
      metaobject{ id }
      userErrors{ field message }
    }
  }
`;
const Q_CUSTOMER_METAFIELD = `
  query($id:ID!, $ns:String!, $key:String!){
    customer(id:$id){
      id
      metafield(namespace:$ns, key:$key){
        id type value references(first:250){ edges{ node{ id } } }
      }
    }
  }
`;
const M_METAFIELDS_SET = `
  mutation($metafields:[MetafieldsSetInput!]!){
    metafieldsSet(metafields:$metafields){
      metafields{ id key namespace type value }
      userErrors{ field message }
    }
  }
`;
// Lee los campos definidos del metaobjeto para mapear sus handles reales
const Q_METAOBJECT_DEFINITION = `
  query($type:String!){
    metaobjectDefinitionByType(type:$type){
      id type name fieldDefinitions(first:50){
        edges{
          node{
            name
            key
          }
        }
      }
    }
  }
`;
// ----------------------------

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const debug = { steps: [] };

  try {
    // 1) Leer payload
    const body = req.body || {};
    const cust = body.customer || {};
    const email = cust.email || body.email || body.mail || body.customer_email;
    if (!email) return res.status(400).json({ error: 'email requerido' });

    const firstName = cust.first_name || '';
    const lastName = cust.last_name || '';
    const phone = cust.phone || null;

    // 2) Upsert de cliente
    debug.steps.push('customer_search');
    const found = await gql(Q_CUSTOMER_SEARCH, { q: `email:${email}` });
    const existing = found.customers.edges[0]?.node;

    let customerId;
    let appliedTag = false;

    if (!existing) {
      debug.steps.push('customer_create');
      const created = await gql(M_CUSTOMER_CREATE, {
        input: { email, firstName, lastName, phone, tags: ['clubdvgi'] },
      });
      const errs = created?.customerCreate?.userErrors;
      if (errs?.length) throw new Error(`customerCreate: ${JSON.stringify(errs)}`);
      customerId = created.customerCreate.customer.id;
      appliedTag = true;
    } else {
      customerId = existing.id;
      // actualizar datos
      debug.steps.push('customer_update');
      const newTags = Array.from(new Set([...(existing.tags || []), 'clubdvgi']));
      const updated = await gql(M_CUSTOMER_UPDATE, {
        input: { id: existing.id, email, firstName, lastName, phone, tags: newTags },
      });
      const errs = updated?.customerUpdate?.userErrors;
      if (errs?.length) throw new Error(`customerUpdate: ${JSON.stringify(errs)}`);

      // asegurar tag via tagsAdd si no quedó
      if (!newTags.includes('clubdvgi')) {
        debug.steps.push('tags_add');
        const add = await gql(M_TAGS_ADD, { id: existing.id, tags: ['clubdvgi'] });
        if (add?.tagsAdd?.userErrors?.length) throw new Error(`tagsAdd: ${JSON.stringify(add.tagsAdd.userErrors)}`);
        appliedTag = true;
      }
    }

    // 3) Obtener definición del metaobjeto y mapear keys reales
    debug.steps.push('definition_lookup');
    const def = await gql(Q_METAOBJECT_DEFINITION, { type: MO_TYPE });
    const defs = def?.metaobjectDefinitionByType?.fieldDefinitions?.edges || [];
    // Construimos un map {lowercaseNameOrKey: realKey}
    const keyMap = {};
    defs.forEach((e) => {
      const name = (e.node.name || '').toLowerCase().trim();
      const key = (e.node.key || '').toLowerCase().trim();
      // preferimos key (identificador) pero guardamos ambas entradas
      if (e.node.key) keyMap[key] = e.node.key;
      if (e.node.name) keyMap[name] = e.node.key;
    });

    function resolveKey(preferred) {
      const k = preferred.toLowerCase().trim();
      return keyMap[k] || preferred; // si no lo encuentra, deja el que pasamos
    }

    const K_CUSTOMER = resolveKey('customer');
    const K_PRODUCT  = resolveKey('product');
    const K_PM       = resolveKey('purchase_month');
    const K_PY       = resolveKey('purchase_year');
    const K_PD       = resolveKey('purchase_date');
    const K_EXP      = resolveKey('expiry_date');

    // 4) Crear metaobjeto por cada compra
    const purchases = Array.isArray(body.purchases) ? body.purchases : [];
    const createdMetaobjects = [];

    for (const p of purchases) {
      if (!p?.product_id || !p?.purchase_month || !p?.purchase_year) continue;

      const month = String(p.purchase_month).padStart(2, '0');
      const purchase_date = `${p.purchase_year}-${month}-01`;

      const d = new Date(purchase_date);
      d.setMonth(d.getMonth() + MONTHS_TO_EXPIRE);
      const expiry_date = d.toISOString().slice(0, 10);

      const fields = [
        { key: K_CUSTOMER, value: customerId },
        { key: K_PRODUCT,  value: toGid('Product', p.product_id) },
        { key: K_PM,       value: String(p.purchase_month) },
        { key: K_PY,       value: String(p.purchase_year) },
        { key: K_PD,       value: purchase_date },
        { key: K_EXP,      value: expiry_date },
      ];

      debug.steps.push(`metaobjectCreate:${JSON.stringify(fields.map(f => f.key))}`);
      const moRes = await gql(M_METAOBJECT_CREATE, { type: MO_TYPE, fields });
      const errs = moRes?.metaobjectCreate?.userErrors;
      if (errs?.length) throw new Error(`metaobjectCreate: ${JSON.stringify(errs)}`);
      createdMetaobjects.push(moRes.metaobjectCreate.metaobject.id);
    }

    // 5) Vincular metaobjetos al metafield del cliente (lista de referencias)
    let metafieldLinkedCount = 0;
    if (createdMetaobjects.length) {
      debug.steps.push('link_metafield');
      const metaQ = await gql(Q_CUSTOMER_METAFIELD, {
        id: customerId,
        ns: CUSTOMER_META_NAMESPACE,
        key: CUSTOMER_META_KEY,
      });

      const existingRefs =
        metaQ?.customer?.metafield?.references?.edges?.map((e) => e.node.id) || [];

      const merged = Array.from(new Set([...existingRefs, ...createdMetaobjects])).map((id) => ({ id }));

      const setRes = await gql(M_METAFIELDS_SET, {
        metafields: [
          {
            ownerId: customerId,
            namespace: CUSTOMER_META_NAMESPACE,
            key: CUSTOMER_META_KEY,
            type: 'list.metaobject_reference',
            value: JSON.stringify(merged),
          },
        ],
      });

      const errs = setRes?.metafieldsSet?.userErrors;
      if (errs?.length) throw new Error(`metafieldsSet: ${JSON.stringify(errs)}`);

      metafieldLinkedCount = createdMetaobjects.length;
    }

    // 6) Respuesta
    return res.status(200).json({
      ok: true,
      customerId,
      appliedTag,
      createdMetaobjectsCount: createdMetaobjects.length,
      metafieldLinkedCount,
      fieldKeysUsed: { K_CUSTOMER, K_PRODUCT, K_PM, K_PY, K_PD, K_EXP },
      debug
    });
  } catch (e) {
    console.error('[clubdvgi-upsert] error', e);
    return res.status(500).json({ error: 'server_error', detail: String(e?.message || e) });
  }
}
