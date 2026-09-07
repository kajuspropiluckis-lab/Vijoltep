export function getCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

export async function requireAdmin(request, env) {
  const token = getCookie(request, 'admin_session');
  if (!token) return false;
  const session = await env.APPLICATIONS_KV.get('session:' + token);
  return !!session;
}

export function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
