import assert from 'node:assert/strict';
import { fetchTurnConfig } from '../dist/turn-credentials.js';
import worker from '../workers/turn-credentials/worker.js';

const iceServers = [
  { urls: ['stun:stun.cloudflare.com:3478'] },
  { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'short-lived', credential: 'temporary' },
];
const clientServers = await fetchTurnConfig('https://example.workers.dev/turn', async (_url, options) => {
  assert.equal(options.cache, 'no-store');
  return Response.json({ iceServers });
});
assert.deepEqual(clientServers, [iceServers[1]], 'Trystero receives only credentialed TURN entries');
await assert.rejects(fetchTurnConfig('https://example.workers.dev/turn', async () => Response.json({ iceServers: [iceServers[0]] })), /no relay servers/);
await assert.rejects(fetchTurnConfig('http://example.workers.dev/turn'), /HTTPS/);

const env = {
  ALLOWED_ORIGIN: 'https://perfluorodecalin.github.io',
  TURN_KEY_ID: 'key-id', TURN_KEY_API_TOKEN: 'secret-token',
  CREDENTIAL_LIMIT: { limit: async () => ({ success: true }) },
  GLOBAL_LIMIT: { limit: async () => ({ success: true }) },
};
const url = 'https://example.workers.dev/turn';
const allowed = new Request(url, { headers: { Origin: env.ALLOWED_ORIGIN } });
const originalFetch = globalThis.fetch;
let calls = 0;
try {
  globalThis.fetch = async (_url, options) => {
    calls++;
    assert.match(_url, /\/keys\/key-id\/credentials\/generate-ice-servers$/);
    assert.equal(options.headers.Authorization, 'Bearer secret-token');
    assert.equal(JSON.parse(options.body).ttl, 43200);
    return Response.json({ iceServers });
  };
  assert.equal((await worker.fetch(new Request(url, { headers: { Origin: 'https://evil.example' } }), env)).status, 403);
  assert.equal(calls, 0, 'wrong origin cannot issue credentials');
  const issued = await worker.fetch(allowed, env);
  assert.equal(issued.status, 200);
  assert.equal(issued.headers.get('Access-Control-Allow-Origin'), env.ALLOWED_ORIGIN);
  assert.equal(issued.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual((await issued.json()).iceServers, iceServers);
  assert.equal(calls, 1);
  assert.equal((await worker.fetch(allowed, { ...env, CREDENTIAL_LIMIT: { limit: async () => ({ success: false }) } })).status, 429);
  assert.equal(calls, 1, 'rate-limited requests do not reach TURN API');
} finally {
  globalThis.fetch = originalFetch;
}
console.log('TURN credential flow passed.');
