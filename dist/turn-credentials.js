// Set this to the separately deployed credential issuer's HTTPS /turn URL.
// The long-lived TURN key belongs in that service, never in this public file.
export const TURN_CREDENTIALS_URL = '';

export async function fetchTurnConfig(endpoint, fetchImpl = fetch) {
  const url = new URL(endpoint, globalThis.location?.href || 'http://localhost/');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('TURN credentials must be fetched over HTTPS.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchImpl(url.href, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`TURN credential service returned ${response.status}.`);
    const data = await response.json();
    const servers = data?.iceServers?.filter(server => server?.username && server?.credential &&
      Array.isArray(server.urls) && server.urls.length && server.urls.every(value =>
        typeof value === 'string' && /^turns?:/i.test(value)));
    if (!servers?.length) throw new Error('TURN credential service returned no relay servers.');
    return servers.map(({ urls, username, credential }) => ({ urls, username, credential }));
  } catch (error) {
    if (controller.signal.aborted) throw new Error('TURN credential service timed out.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
