/**
 * Cloudflare Pages Function — API proxy for Google Apps Script.
 * The browser only calls /api. Secrets remain in Cloudflare environment variables.
 */

const ALLOWED_ACTIONS = new Set([
  'register', 'login', 'state', 'logout',
  'completeMission', 'submitPractice', 'submitReflection', 'mentorFeedback'
]);

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin');
  const requestOrigin = new URL(request.url).origin;
  if (origin && origin !== requestOrigin) {
    return json({ ok: false, message: 'Origen no permitido.' }, 403);
  }

  if (!env.GAS_WEB_APP_URL || !env.GAS_API_SECRET) {
    return json({
      ok: false,
      message: 'El backend aún no está configurado. Revisa GAS_WEB_APP_URL y GAS_API_SECRET en Cloudflare.'
    }, 503);
  }

  let payload;
  try {
    const contentLength = Number(request.headers.get('Content-Length') || 0);
    if (contentLength > 18000) return json({ ok: false, message: 'La solicitud supera el tamaño permitido.' }, 413);
    payload = await request.json();
  } catch (_) {
    return json({ ok: false, message: 'La solicitud debe contener JSON válido.' }, 400);
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !ALLOWED_ACTIONS.has(String(payload.action || ''))) {
    return json({ ok: false, message: 'Acción no válida.' }, 400);
  }

  let gasUrl;
  try {
    gasUrl = new URL(env.GAS_WEB_APP_URL);
    if (gasUrl.protocol !== 'https:' || gasUrl.hostname !== 'script.google.com' || !gasUrl.pathname.includes('/macros/s/')) {
      return json({ ok: false, message: 'GAS_WEB_APP_URL no corresponde a una URL válida de Apps Script.' }, 500);
    }
  } catch (_) {
    return json({ ok: false, message: 'GAS_WEB_APP_URL no es una URL válida.' }, 500);
  }

  const safePayload = { ...payload, secret: env.GAS_API_SECRET };
  try {
    const upstream = await fetch(gasUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(safePayload),
      redirect: 'follow'
    });
    const raw = await upstream.text();
    let result;
    try {
      result = JSON.parse(raw);
    } catch (_) {
      return json({ ok: false, message: 'Apps Script no devolvió JSON. Revisa la implementación y los permisos del despliegue.' }, 502);
    }
    return json(result, upstream.ok ? 200 : 502);
  } catch (error) {
    return json({ ok: false, message: 'No fue posible establecer conexión con Google Apps Script.' }, 502);
  }
}

export async function onRequestGet() {
  return json({ ok: true, service: 'Misión Evaluación API', method: 'POST' }, 200);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
