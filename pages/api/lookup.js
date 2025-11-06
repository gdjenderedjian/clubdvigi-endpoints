// pages/api/lookup.js
export const runtime = 'nodejs'; // recomendable si usás libs de Node
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const email = (searchParams.get('email') || '').trim();
  if (!email) return Response.json({ ok: false, error: 'Falta email' }, { status: 400 });

  const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
  const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!SHOPIFY_STORE || !SHOPIFY_ADMIN_TOKEN) {
    return Response.json({ ok: false, error: 'Faltan ENV' }, { status: 500 });
  }

  const url = `https://${SHOPIFY_STORE}/admin/api/2024-10/customers/search.json?query=email:${encodeURIComponent(email)}`;
  const r = await fetch(url, { headers: { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN, 'Content-Type': 'application/json' }, cache: 'no-store' });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    return Response.json({ ok: false, error: 'Error Shopify', status: r.status, details: t.slice(0,300) }, { status: 502 });
  }
  const data = await r.json();
  return Response.json({ ok: true, found: Array.isArray(data.customers) && data.customers.length>0, data: data.customers || [] });
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const email = String(body?.email || '').trim();
  if (!email) return Response.json({ ok: false, error: 'Falta email' }, { status: 400 });
  // Podés reutilizar la lógica del GET (o extraerla a una función)
  return GET(new Request(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://local' }/api/lookup?email=${encodeURIComponent(email)}`));
}
