import { json } from '../../_utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  let data;
  try { data = await request.json(); } catch (e) { data = {}; }
  const password = data.password || '';

  if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
    return json({ error: 'Neteisingas slaptažodis.' }, 401);
  }

  const token = crypto.randomUUID();
  const ttl = 60 * 60 * 12; // 12 val.
  await env.APPLICATIONS_KV.put('session:' + token, '1', { expirationTtl: ttl });

  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.append('Set-Cookie', `admin_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${ttl}`);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
