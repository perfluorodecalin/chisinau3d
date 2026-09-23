import { PROTOCOL_VERSION, ROOM_ID_PATTERN, WORLD_ID_PATTERN, validPose, validSnapshot } from './multiplayer-protocol.js';

const report = (callback, ...args) => { try { callback?.(...args); } catch (error) { console.error('Multiplayer callback failed', error); } };
const RESPONSE_TIMEOUT_MS = 6_000;
const WELCOME_TIMEOUT_MS = 8_000;
const MAX_RECONNECTS = 5;

/** One socket and at most one outstanding request per client. Calling sendState only replaces the latest pose. */
export function createRoomTransport({ roomId, worldId, endpoint, onPeerJoin, onPeerLeave, onState, onStatus, onError,
  WebSocketClass = globalThis.WebSocket, timers = globalThis, random = Math.random } = {}) {
  if (!ROOM_ID_PATTERN.test(roomId || '')) throw new TypeError('Invalid room code');
  if (!WORLD_ID_PATTERN.test(worldId || '')) throw new TypeError('Invalid compiled world');
  const base = new URL(endpoint);
  if (base.protocol !== 'wss:' && !(base.protocol === 'ws:' && ['localhost', '127.0.0.1'].includes(base.hostname)))
    throw new TypeError('Multiplayer needs a secure WSS endpoint');
  if (base.pathname !== '/' || base.search || base.hash || base.username || base.password) throw new TypeError('Expected a WebSocket origin without a path');
  if (typeof WebSocketClass !== 'function') throw new TypeError('WebSocket unavailable');
  const url = `${base.origin}/rooms/${roomId.toLowerCase()}?world=${worldId}`;
  const peers = new Set();
  let socket, timer, closed = false, ready = false, request = 0, pending = null, retries = 0, lastRequestAt = 0, latest = { active: false, x: 0, y: 0, z: 0, heading: 0, speed: 0 };
  const clearTimer = () => { if (timer) timers.clearTimeout(timer); timer = null; };
  const schedule = (fn, delay) => { clearTimer(); timer = timers.setTimeout(fn, delay); };
  const clearPeers = () => { for (const id of peers) report(onPeerLeave, id); peers.clear(); };
  const status = (state, detail) => report(onStatus, state, detail);

  function fail(connection, reason) {
    if (closed || (connection && socket !== connection)) return;
    clearTimer(); ready = false; pending = null; clearPeers();
    try { connection?.close(); } catch { /* Already disconnected. */ }
    socket = null;
    if (reason) { status(reason); return; }
    if (retries >= MAX_RECONNECTS) { status('disconnected'); report(onError, new Error('Connection stopped. Choose Join room to retry.')); return; }
    retries++;
    status('reconnecting', retries);
    schedule(connect, Math.min(8_000, 500 * 2 ** (retries - 1)) * (.8 + random() * .4));
  }

  function poll(connection) {
    if (closed || socket !== connection || !ready || pending !== null) return;
    lastRequestAt = Date.now();
    const n = request++;
    const message = { t: 'tick', v: PROTOCOL_VERSION, n, p: latest };
    try { connection.send(JSON.stringify(message)); } catch { fail(connection); return; }
    pending = n;
    schedule(() => fail(connection), RESPONSE_TIMEOUT_MS);
  }

  function connect() {
    if (closed) return;
    clearTimer();
    let connection;
    try { connection = new WebSocketClass(url); } catch (error) { report(onError, error); fail(null); return; }
    socket = connection;
    ready = false;
    pending = null;
    schedule(() => fail(connection), WELCOME_TIMEOUT_MS);
    connection.onmessage = event => {
      if (closed || socket !== connection) return;
      if (typeof event.data !== 'string' || event.data.length > 4096) { fail(connection, 'protocol'); return; }
      let message;
      try { message = JSON.parse(event.data); } catch { fail(connection, 'protocol'); return; }
      if (message?.t === 'reject' && message.v === PROTOCOL_VERSION && ['full', 'world'].includes(message.reason)) { fail(connection, message.reason); return; }
      if (!ready) {
        if (message?.t !== 'welcome' || message.v !== PROTOCOL_VERSION || !ROOM_ID_PATTERN.test(message.id || '')) { fail(connection, 'protocol'); return; }
        ready = true;
        status('connected');
        poll(connection);
        return;
      }
      if (pending === null || !validSnapshot(message, pending)) { fail(connection, 'protocol'); return; }
      retries = 0;
      const seen = new Set();
      for (const peer of message.peers) {
        seen.add(peer.id);
        if (!peers.has(peer.id)) { peers.add(peer.id); report(onPeerJoin, peer.id); }
        if (peer.seq >= 0) report(onState, peer.id, peer);
      }
      for (const id of peers) if (!seen.has(id)) { peers.delete(id); report(onPeerLeave, id); }
      pending = null;
      schedule(() => poll(connection), Math.max(0, (latest.active ? 100 : 500) - (Date.now() - lastRequestAt)));
    };
    connection.onclose = () => fail(connection);
    connection.onerror = () => { /* onclose follows; retry from a single path. */ };
  }

  status('connecting');
  connect();
  return {
    sendState(state) {
      if (closed || !validPose(state)) return false;
      latest = { active: state.active, x: state.x, y: state.y, z: state.z, heading: state.heading, speed: state.speed };
      return true;
    },
    leave() {
      if (closed) return;
      closed = true; clearTimer(); ready = false; pending = null;
      clearPeers();
      const old = socket; socket = null;
      try { old?.close(1000, 'Left room'); } catch { /* Closing socket. */ }
    },
  };
}
