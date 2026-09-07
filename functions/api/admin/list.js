import { requireAdmin, json } from '../../_utils.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!(await requireAdmin(request, env))) {
    return json({ error: 'Neprisijungta.' }, 401);
  }

  const list = await env.APPLICATIONS_KV.list({ prefix: 'application:' });
  const items = await Promise.all(
    list.keys.map(async (k) => {
      const value = await env.APPLICATIONS_KV.get(k.name);
      return value ? JSON.parse(value) : null;
    })
  );
  const applications = items.filter(Boolean).sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));

  return json({ applications });
}
