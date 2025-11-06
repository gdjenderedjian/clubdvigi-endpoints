// pages/api/clubdvgi-upsert.js
// Upsert de cliente + creación de Metaobjetos `warranty_registration` por cada compra
// y vinculación al metafield del cliente `custom.registros_de_garantia` (lista de referencias).
//
// Requiere en Vercel (Settings → Environment Variables):
// - SHOPIFY_STORE = dvigiarg.myshopify.com
// - SHOPIFY_ADMIN_TOKEN = shpat_xxx (Admin API access token)
//
// ⚙️ Si en tu Admin cambian los identificadores de campos del metaobjeto,
//   ajustá las constantes MO_FIELD_* más abajo.

const API_VERSION = '2025-01';

// ====== CORS (cambiá si usás otro dominio de tienda) ======
const ALLOW_ORIGIN = 'https://dvigi.com.ar';

// ====== Configuración de Metaobjetos / Metafields ======
const MO_TYPE = 'warranty_registration';            // handle del tipo de metaobjeto
// Identificadores EXACTOS de los campos del metaobjeto (handles de cada campo):
const MO_FIELD_CUSTOMER = 'customer';
const MO_FIELD_PRODUCT  = 'product';
const MO_FIELD_PM       = 'purchase_month';
const MO_FIELD_PY       = 'purchase_year';
const MO_FIELD_PD       = 'purchase_date';
const MO_FIELD_EXP      = 'expiry_date';

// Metafield del cliente (lista de referencias a warranty_registration)
const CUSTOMER_META_NAMESPACE = 'custom';
const CUSTOMER_META_KEY = 'registros_de_garantia';

// Vida útil del filtro (en meses) para calcular expiry_date
const MONTHS_TO_EXPIRE = 12;

// ========================================================

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
  if (!resp.ok) {
    throw new Error(
      `shopify_http_error ${resp.status}: ${JSON.stringify(json)}`
    );
  }
  if (json.errors) {
    throw new Error(`shopify_graphql_error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

// ---------- GraphQL snippets ----------
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
        id
        type
        value
        references(first:250){
          edges{ node{ id } }
        }
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
// -------------------------------------

export default async function handler(req, res) {
  setCORS(res);

  // Preflight
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    // 1) Leer payload del front (aceptamos alias de email por compatibilidad)
    const body = req.body || {};
    const customerPayload = body.customer || {};
    const email =
      customerPayload.email ||
      body.email ||
      body.mail ||
      body.customer_email;

    if (!email) {
      return res.status(400).json({ error: 'email requerido' });
    }

    const firstName = customerPayload.first_name || '';
    const lastName = customerPayload.last_name || '';
    const phone = customerPayload.phone || null;

    // 2) Buscar o crear/actualizar cliente
    const found = await gql(Q_CUSTOMER_SEARCH, { q: `email:${email}` });
    const existing = found.customers.edges[0]?.node;

    let customerId;
    if (!existing) {
      // Crear con tag clubdvigi
      const created = await gql(M_CUSTOMER_CREATE, {
        input: {
          email,
          firstName,
          lastName,
          phone,
          tags: ['clubdvigi'],
        },
      });
      const errs = created?.customerCreate?.userErrors;
      if (errs && errs.length) {
        throw new Error(`customerCreate: ${JSON.stringify(errs)}`);
      }
      customerId = created.customerCreate.customer.id;
    } else {
      // Actualizar datos + asegurar tag clubdvigi
      const newTags = Array.from(
        new Set([...(existing.tags || []), 'clubdvigi'])
      );
      const updated = await gql(M_CUSTOMER_UPDATE, {
        input: {
          id: existing.id,
          email,
          firstName,
          lastName,
          phone,
          tags: newTags,
        },
      });
      const errs = updated?.customerUpdate?.userErrors;
      if (errs && errs.length) {
        throw new Error(`customerUpdate: ${JSON.stringify(errs)}`);
      }
      customerId = existing.id;
    }

    // 3) Crear metaobjeto por cada compra
    const purchases = Array.isArray(body.purchases) ? body.purchases : [];
    const createdMetaobjects = [];

    for (const p of purchases) {
      if (!p?.product_id || !p?.purchase_month || !p?.purchase_year) continue;

      const month = String(p.purchase_month).padStart(2, '0');
      const purchase_date = `${p.purchase_year}-${month}-01`;

      const d = new Date(purchase_date);
      d.setMonth(d.getMonth() + MONTHS_TO_EXPIRE);
      const expiry_date = d.toISOString().slice(0, 10); // YYYY-MM-DD

      const fields = [
        { key: MO_FIELD_CUSTOMER, value: customerId },
        { key: MO_FIELD_PRODUCT, value: toGid('Product', p.product_id) },
        { key: MO_FIELD_PM, value: String(p.purchase_month) },
        { key: MO_FIELD_PY, value: String(p.purchase_year) },
        { key: MO_FIELD_PD, value: purchase_date },
        { key: MO_FIELD_EXP, value: expiry_date },
      ];

      const moRes = await gql(M_METAOBJECT_CREATE, {
        type: MO_TYPE,
        fields,
      });
      const mo = moRes?.metaobjectCreate;
      if (mo?.userErrors?.length) {
        throw new Error(`metaobjectCreate: ${JSON.stringify(mo.userErrors)}`);
      }
      createdMetaobjects.push(mo.metaobject.id);
    }

    // 4) Vincular los metaobjetos al cliente en el metafield lista (si hay nuevos)
    if (createdMetaobjects.length > 0) {
      const metaQ = await gql(Q_CUSTOMER_METAFIELD, {
        id: customerId,
        ns: CUSTOMER_META_NAMESPACE,
        key: CUSTOMER_META_KEY,
      });

      const existingRefs =
        metaQ?.customer?.metafield?.references?.edges?.map((e) => e.node.id) ||
        [];

      const merged = Array.from(
        new Set([...existingRefs, ...createdMetaobjects])
      ).map((id) => ({ id }));

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
      if (errs && errs.length) {
        throw new Error(`metafieldsSet: ${JSON.stringify(errs)}`);
      }
    }

    // 5) Respuesta OK
    return res.status(200).json({
      ok: true,
      customerId,
      created: createdMetaobjects,
    });
  } catch (e) {
    console.error('[clubdvgi-upsert] error', e);
    return res
      .status(500)
      .json({ error: 'server_error', detail: String(e?.message || e) });
  }
}
