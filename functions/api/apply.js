import { json } from '../_utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  let data;
  try {
    data = await request.json();
  } catch (e) {
    return json({ error: 'Blogas užklausos formatas.' }, 400);
  }

  const name = (data.name || '').trim();
  const email = (data.email || '').trim();
  const about = (data.about || '').trim();
  const question = (data.question || '').trim();
  const invite = (data.invite || '').trim();

  if (!name || !email || !about || !question) {
    return json({ error: 'Prašome užpildyti visus privalomus laukus.' }, 400);
  }

  const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const record = {
    id, name, email, about, question, invite,
    submittedAt: new Date().toISOString(),
    status: 'new'
  };

  try {
    await env.APPLICATIONS_KV.put('application:' + id, JSON.stringify(record));
  } catch (e) {
    return json({ error: 'Nepavyko išsaugoti paraiškos. Bandykite dar kartą.' }, 500);
  }

  return json({ ok: true });
}
