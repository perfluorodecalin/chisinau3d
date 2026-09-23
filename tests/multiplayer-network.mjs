import assert from 'node:assert/strict';
import { createRoomTransport } from '../dist/multiplayer-network.js';
import { parseTick, validSnapshot, PROTOCOL_VERSION } from '../dist/multiplayer-protocol.js';
import worker, { Room } from '../relay/worker.js';

const roomId = '7553d952-d468-4306-836e-16af36dcfece';
const worldId = 'a'.repeat(64);
const otherWorld = 'b'.repeat(64);
const pose = { active: true, x: -400, y: 12.5, z: 900, heading: 1.2, speed: -18 };
const tick = (n, p = pose) => JSON.stringify({ t: 'tick', v: PROTOCOL_VERSION, n, p });
assert.equal(parseTick(tick(0))?.n, 0);
for (const bad of [tick(0, { ...pose, x: Infinity }), tick(0, { ...pose, speed: 101 }), tick(0, { ...pose, extra: 1 }), JSON.stringify({ ...JSON.parse(tick(0)), id: roomId }), 'x'.repeat(513), new Uint8Array(1)]) assert.equal(parseTick(bad), null);
assert.equal(validSnapshot({ t: 'snapshot', v: 2, n: 0, peers: [{ id: roomId, seq: 0, ...pose }] }, 0), true);
assert.equal(validSnapshot({ t: 'snapshot', v: 2, n: 0, peers: [{ id: roomId, seq: 0, ...pose, html: 'x' }] }, 0), false);

// Simulate hibernatable DO attachments and WebSocketPair; both use the same Worker handlers.
class Socket {
  static OPEN = 1;
  readyState = 1;
  messages = [];
  attachment = null;
  send(value) { this.peer.messages.push(JSON.parse(value)); }
  close(code, reason) { this.readyState = 3; this.code = code; this.reason = reason; }
  serializeAttachment(value) { this.attachment = structuredClone(value); }
  deserializeAttachment() { return this.attachment && structuredClone(this.attachment); }
}
globalThis.WebSocket = Socket;
globalThis.WebSocketPair = class { constructor() { this[0] = new Socket(); this[1] = new Socket(); this[0].peer = this[1]; this[1].peer = this[0]; } };
globalThis.Response = class { constructor(body, options) { this.status = options.status; this.webSocket = options.webSocket; } };
const sockets = [];
const state = { getWebSockets: () => sockets, acceptWebSocket: socket => sockets.push(socket) };
let room = new Room(state);
const join = async (world = worldId) => { const client = (await room.fetch(new Request(`https://relay.example/rooms/${roomId}?world=${world}`))).webSocket; client.server = client.peer; return client; };
const a = await join(), b = await join();
assert.equal(a.messages[0].t, 'welcome');
assert.equal(b.messages[0].t, 'welcome');
room.webSocketMessage(a.server, tick(0));
assert.equal(a.messages.at(-1).peers.length, 1);
assert.equal(a.messages.at(-1).peers[0].seq, -1);
room.webSocketMessage(b.server, tick(0, { ...pose, x: 42 }));
assert.equal(b.messages.at(-1).peers[0].x, -400);
const c = await join();
room.webSocketMessage(c.server, tick(0));
assert.equal(c.messages.at(-1).peers.length, 2);
const different = await join(otherWorld);
assert.equal(different.messages[0].reason, 'world');
assert.equal(different.server.readyState, 3);
for (let i = 3; i < 8; i++) await join();
const full = await join();
assert.equal(full.messages[0].reason, 'full');
assert.equal(sockets.filter(socket => socket.readyState === 1).length, 8);
a.server.close(1000);
const replacement = await join();
assert.equal(replacement.messages[0].t, 'welcome');
room.webSocketMessage(b.server, tick(1, { ...pose, x: 7, id: roomId }));
assert.equal(b.server.readyState, 3, 'identity spoofing closes sender');
const stale = c.server.deserializeAttachment(); stale.seen = Date.now() - 31_000; c.server.serializeAttachment(stale);
const afterStale = await join();
assert.equal(afterStale.messages[0].t, 'welcome');
assert.equal(c.server.readyState, 3);
room = new Room(state); // Attachment survives an object restart.
room.webSocketMessage(replacement.server, tick(0));
assert.equal(replacement.messages.at(-1).t, 'snapshot');
room.webSocketMessage(replacement.server, tick(1));
assert.equal(replacement.messages.at(-1).n, 0, 'rapid request is dropped');
for (let i = 1; i <= 5; i++) room.webSocketMessage(replacement.server, tick(i));
assert.equal(replacement.server.readyState, 3, 'flood closes sender');

const statuses = [], joined = [], left = [], received = [];
let current;
class ClientSocket {
  constructor(url) { this.url = url; this.sent = []; this.closed = false; current = this; }
  send(raw) { this.sent.push(JSON.parse(raw)); }
  close() { this.closed = true; }
  emit(data) { this.onmessage({ data: JSON.stringify(data) }); }
}
const callbacks = new Map(); let timerId = 0;
const timers = { setTimeout(callback, delay) { const id = ++timerId; callbacks.set(id, { callback, delay }); return id; }, clearTimeout(id) { callbacks.delete(id); } };
function nextTimer() { const [id, entry] = callbacks.entries().next().value; callbacks.delete(id); entry.callback(); return entry.delay; }
const transport = createRoomTransport({ roomId, worldId, endpoint: 'wss://relay.example', WebSocketClass: ClientSocket, timers, random: () => .5,
  onStatus: value => statuses.push(value), onPeerJoin: id => joined.push(id), onPeerLeave: id => left.push(id), onState: (id, value) => received.push([id, value]) });
assert.match(current.url, new RegExp(`/rooms/${roomId}\\?world=${worldId}$`));
const first = current;
first.emit({ t: 'welcome', v: 2, id: roomId });
assert.deepEqual(statuses, ['connecting', 'connected']);
assert.equal(first.sent.length, 1);
assert.equal(transport.sendState(pose), true);
assert.equal(transport.sendState({ ...pose, x: 51 }), true);
assert.equal(first.sent.length, 1, 'only one outstanding request');
first.emit({ t: 'snapshot', v: 2, n: 0, peers: [{ id: '9553d952-d468-4306-836e-16af36dcfece', seq: 0, ...pose }] });
assert.equal(joined.length, 1);
assert.equal(received.length, 1);
assert.ok(nextTimer() <= 100);
assert.equal(first.sent[1].p.x, 51);
first.emit({ t: 'snapshot', v: 2, n: 1, peers: [] });
assert.equal(left.length, 1);
first.onclose();
assert.equal(statuses.at(-1), 'reconnecting');
nextTimer();
assert.notEqual(current, first);
const second = current;
second.emit({ t: 'reject', v: 2, reason: 'full' });
assert.equal(statuses.at(-1), 'full');
assert.equal(callbacks.size, 0);
transport.leave();
assert.equal(transport.sendState(pose), false);
second.emit({ t: 'welcome', v: 2, id: roomId });
assert.equal(callbacks.size, 0, 'leave during connect ignores late callbacks');
console.log('Multiplayer relay and transport validation passed.');
