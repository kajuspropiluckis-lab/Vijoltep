import { requireAdmin, json } from '../../_utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!(await requireAdmin(request, env))) {
    return json({ error: 'Neprisijungta.' }, 401);
  }

  let data;
  try { data = await request.json(); } catch (e) { data = {}; }
  const id = data.id;
  if (!id) return json({ error: 'Trūksta ID.' }, 400);

  await env.APPLICATIONS_KV.delete('application:' + id);
  return json({ ok: true });
}
