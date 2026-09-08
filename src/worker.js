function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

function getCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

async function requireAdmin(request, env) {
  const token = getCookie(request, 'admin_session');
  if (!token) return false;
  const session = await env.APPLICATIONS_KV.get('session:' + token);
  return !!session;
}

async function notifyByEmail(env, record) {
  if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: env.NOTIFY_FROM || 'Reta grandis <onboarding@resend.dev>',
        to: env.NOTIFY_EMAIL,
        subject: 'Nauja paraiška — Reta grandis',
        text: 'Vardas: ' + record.name + '\n' +
              'El. paštas: ' + record.email + '\n' +
              'Apie: ' + record.about + '\n' +
              'Klausimas tinklui: ' + record.question + '\n' +
              'Pakvietimo kodas: ' + (record.invite || '—')
      })
    });
  } catch (e) {
    // Nepavykus išsiųsti laiško, paraiška jau išsaugota — netrukdome pagrindiniam srautui.
  }
}

async function handleApply(request, env) {
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

  await notifyByEmail(env, record);

  return json({ ok: true });
}

async function handleAdminLogin(request, env) {
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

async function handleAdminLogout() {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.append('Set-Cookie', 'admin_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

async function handleAdminCheck(request, env) {
  const isAdmin = await requireAdmin(request, env);
  return json({ isAdmin });
}

async function handleAdminList(request, env) {
  if (!(await requireAdmin(request, env))) return json({ error: 'Neprisijungta.' }, 401);

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

async function handleAdminStatus(request, env) {
  if (!(await requireAdmin(request, env))) return json({ error: 'Neprisijungta.' }, 401);

  let data;
  try { data = await request.json(); } catch (e) { data = {}; }
  const id = data.id;
  const status = data.status;
  const allowed = ['new', 'approved', 'rejected'];
  if (!id || !allowed.includes(status)) {
    return json({ error: 'Blogi parametrai.' }, 400);
  }

  const key = 'application:' + id;
  const value = await env.APPLICATIONS_KV.get(key);
  if (!value) return json({ error: 'Paraiška nerasta.' }, 404);

  const record = JSON.parse(value);
  record.status = status;
  await env.APPLICATIONS_KV.put(key, JSON.stringify(record));

  return json({ ok: true, application: record });
}

async function handlePostsList(request, env) {
  const list = await env.APPLICATIONS_KV.list({ prefix: 'post:' });
  const items = await Promise.all(
    list.keys.map(async (k) => {
      const value = await env.APPLICATIONS_KV.get(k.name);
      return value ? JSON.parse(value) : null;
    })
  );
  const posts = items.filter(Boolean).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 60);
  return json({ posts });
}

async function handlePostsCreate(request, env) {
  let data;
  try {
    data = await request.json();
  } catch (e) {
    return json({ error: 'Blogas užklausos formatas.' }, 400);
  }

  const authorName = (data.authorName || '').trim().slice(0, 60);
  const text = (data.text || '').trim().slice(0, 2000);
  const ownerId = (data.ownerId || '').trim().slice(0, 80);
  let images = Array.isArray(data.images) ? data.images.slice(0, 4) : [];
  images = images.filter((img) => typeof img === 'string' && img.startsWith('data:image/') && img.length < 700000);

  if (!authorName || !ownerId || (!text && images.length === 0)) {
    return json({ error: 'Trūksta vardo arba turinio.' }, 400);
  }

  const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const record = { id, authorName, text, images, ownerId, createdAt: new Date().toISOString() };

  try {
    await env.APPLICATIONS_KV.put('post:' + id, JSON.stringify(record));
  } catch (e) {
    return json({ error: 'Nepavyko paskelbti. Bandykite dar kartą.' }, 500);
  }

  return json({ ok: true, post: record });
}

async function handlePostsDelete(request, env) {
  let data;
  try { data = await request.json(); } catch (e) { data = {}; }
  const id = data.id;
  const ownerId = (data.ownerId || '').trim();
  if (!id || !ownerId) return json({ error: 'Trūksta parametrų.' }, 400);

  const key = 'post:' + id;
  const value = await env.APPLICATIONS_KV.get(key);
  if (!value) return json({ ok: true });

  const record = JSON.parse(value);
  if (record.ownerId !== ownerId) return json({ error: 'Neturite teisės šalinti šio įrašo.' }, 403);

  await env.APPLICATIONS_KV.delete(key);
  return json({ ok: true });
}

async function handlePostComment(request, env) {
  let data;
  try {
    data = await request.json();
  } catch (e) {
    return json({ error: 'Blogas užklausos formatas.' }, 400);
  }

  const postId = (data.postId || '').trim();
  const authorName = (data.authorName || '').trim().slice(0, 60);
  const text = (data.text || '').trim().slice(0, 500);
  if (!postId || !authorName || !text) return json({ error: 'Trūksta duomenų.' }, 400);

  const key = 'post:' + postId;
  const value = await env.APPLICATIONS_KV.get(key);
  if (!value) return json({ error: 'Skelbimas nerastas.' }, 404);

  const post = JSON.parse(value);
  if (!Array.isArray(post.comments)) post.comments = [];
  const commentId = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  post.comments.push({ id: commentId, authorName, text, createdAt: new Date().toISOString() });

  await env.APPLICATIONS_KV.put(key, JSON.stringify(post));
  return json({ ok: true, post });
}

async function handleAdminDelete(request, env) {
  if (!(await requireAdmin(request, env))) return json({ error: 'Neprisijungta.' }, 401);

  let data;
  try { data = await request.json(); } catch (e) { data = {}; }
  const id = data.id;
  if (!id) return json({ error: 'Trūksta ID.' }, 400);

  await env.APPLICATIONS_KV.delete('application:' + id);
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    if (pathname === '/api/apply' && method === 'POST') return handleApply(request, env);
    if (pathname === '/api/admin/login' && method === 'POST') return handleAdminLogin(request, env);
    if (pathname === '/api/admin/logout' && method === 'POST') return handleAdminLogout();
    if (pathname === '/api/admin/check' && method === 'GET') return handleAdminCheck(request, env);
    if (pathname === '/api/admin/list' && method === 'GET') return handleAdminList(request, env);
    if (pathname === '/api/admin/status' && method === 'POST') return handleAdminStatus(request, env);
    if (pathname === '/api/admin/delete' && method === 'POST') return handleAdminDelete(request, env);
    if (pathname === '/api/posts' && method === 'GET') return handlePostsList(request, env);
    if (pathname === '/api/posts' && method === 'POST') return handlePostsCreate(request, env);
    if (pathname === '/api/posts/delete' && method === 'POST') return handlePostsDelete(request, env);
    if (pathname === '/api/posts/comment' && method === 'POST') return handlePostComment(request, env);

    return json({ error: 'Not found' }, 404);
  }
};
