const TTL_SECONDS = 12 * 60 * 60;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/turn') return new Response('Not found', { status: 404 });

    const origin = request.headers.get('Origin');
    if (!env.ALLOWED_ORIGIN || origin !== env.ALLOWED_ORIGIN) return new Response('Forbidden', { status: 403 });
    const headers = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Vary': 'Origin',
      'Cache-Control': 'no-store',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers });
    if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN || !env.CREDENTIAL_LIMIT || !env.GLOBAL_LIMIT) {
      return new Response('Credential service is not configured', { status: 503, headers });
    }

    // Anonymous public clients need issuance limits. These per-edge limits are
    // abuse friction, not authentication or a global spending cap.
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const [individual, global] = await Promise.all([
      env.CREDENTIAL_LIMIT.limit({ key: ip }),
      env.GLOBAL_LIMIT.limit({ key: 'all' }),
    ]);
    if (!individual.success || !global.success) return new Response('Try again later', { status: 429, headers });

    try {
      const upstream = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: TTL_SECONDS }),
      });
      if (!upstream.ok) return new Response('Could not issue TURN credentials', { status: 502, headers });
      const data = await upstream.json();
      if (!Array.isArray(data?.iceServers) || !data.iceServers.some(server => server?.username && server?.credential)) {
        return new Response('TURN service returned invalid credentials', { status: 502, headers });
      }
      return Response.json({ iceServers: data.iceServers }, { headers });
    } catch {
      return new Response('TURN credential service unavailable', { status: 502, headers });
    }
  },
};
