import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION, ROOM_CAPACITY, ROOM_ID_PATTERN, STALE_MS, WORLD_ID_PATTERN, parseTick } from '../dist/multiplayer-protocol.js';

const reject = (status, message) => new Response(message, { status, headers: { 'Cache-Control': 'no-store' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return reject(405, 'WebSocket upgrade required');
    if (request.headers.get('Origin') !== env.PAGES_ORIGIN) return reject(403, 'Origin not allowed');
    const match = /^\/rooms\/([^/]+)$/.exec(url.pathname);
    if (!match || !ROOM_ID_PATTERN.test(match[1]) || match[1] !== match[1].toLowerCase()
        || url.searchParams.size !== 1 || !WORLD_ID_PATTERN.test(url.searchParams.get('world') || '')) return reject(400, 'Invalid room or world');
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    // Native edge binding limits upgrades. Room capacity is separately enforced in the DO.
    const { success } = await env.UPGRADE_LIMIT.limit({ key: ip });
    if (!success) return reject(429, 'Too many joins');
    const stub = env.ROOMS.get(env.ROOMS.idFromName(match[1]));
    return stub.fetch(request);
  },
};

const safeClose = (socket, code, reason) => {
  try { socket.close(code, reason); } catch { /* Already closed. */ }
};
const safeSend = (socket, data) => {
  try { socket.send(JSON.stringify(data)); return true; } catch { safeClose(socket, 1011, 'Send failed'); return false; }
};

export class Room {
  constructor(state) { this.state = state; }

  sockets() { return this.state.getWebSockets(); }

  prune(now) {
    for (const socket of this.sockets()) {
      const entry = socket.deserializeAttachment();
      if (!entry || now - entry.seen > STALE_MS) safeClose(socket, 1001, 'Idle room connection');
    }
  }

  async fetch(request) {
    const world = new URL(request.url).searchParams.get('world');
    const now = Date.now();
    this.prune(now);
    const members = this.sockets().filter(socket => socket.readyState === WebSocket.OPEN)
      .map(socket => socket.deserializeAttachment()).filter(member => member && now - member.seen <= STALE_MS);
    const reason = members.some(member => member.world !== world) ? 'world' : members.length >= ROOM_CAPACITY ? 'full' : null;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    if (reason) {
      safeSend(server, { t: 'reject', v: PROTOCOL_VERSION, reason });
      safeClose(server, 1008, reason);
    } else {
      const id = crypto.randomUUID();
      server.serializeAttachment({ id, world, seq: -1, tick: -1, pose: { active: false, x: 0, y: 0, z: 0, heading: 0, speed: 0 }, seen: now, lastTick: 0, strikes: 0 });
      safeSend(server, { t: 'welcome', v: PROTOCOL_VERSION, id });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket, raw) {
    const now = Date.now();
    const entry = socket.deserializeAttachment();
    if (!entry) { safeClose(socket, 1008, 'Rejected'); return; }
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_BYTES || new TextEncoder().encode(raw).byteLength > MAX_MESSAGE_BYTES) {
      safeClose(socket, 1008, 'Invalid message'); return;
    }
    const tick = parseTick(raw);
    if (!tick || tick.n <= entry.tick) { safeClose(socket, 1008, 'Invalid tick'); return; }
    if (now - entry.lastTick < 70) {
      entry.strikes++;
      socket.serializeAttachment(entry);
      if (entry.strikes >= 5) safeClose(socket, 1008, 'Rate exceeded');
      return;
    }
    this.prune(now);
    entry.strikes = 0;
    entry.lastTick = entry.seen = now;
    entry.tick = entry.seq = tick.n;
    entry.pose = tick.p;
    socket.serializeAttachment(entry);
    const peers = [];
    for (const other of this.sockets()) {
      if (other === socket || other.readyState !== WebSocket.OPEN) continue;
      const member = other.deserializeAttachment();
      if (member && member.world === entry.world && now - member.seen <= STALE_MS)
        peers.push({ id: member.id, seq: member.seq, ...member.pose });
    }
    safeSend(socket, { t: 'snapshot', v: PROTOCOL_VERSION, n: tick.n, peers });
  }

  webSocketClose() { /* Hibernatable sockets disappear from getWebSockets automatically. */ }
  webSocketError(socket) { safeClose(socket, 1011, 'Socket error'); }
}
