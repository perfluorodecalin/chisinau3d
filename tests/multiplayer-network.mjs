import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRoomTransport, validateMultiplayerState } from '../dist/multiplayer-network.js';

const good = { protocol: 1, worldId: 'city-v1', seq: 12, active: true, x: -400, y: 12.5, z: 900, heading: 1.2, speed: -18 };
assert.deepEqual(validateMultiplayerState(good, 'city-v1'), {
  seq: 12, active: true, x: -400, y: 12.5, z: 900, heading: 1.2, speed: -18,
});
for (const bad of [
  null,
  [],
  { ...good, protocol: 2 },
  { ...good, worldId: 'other-world' },
  { ...good, seq: -1 },
  { ...good, seq: Number.MAX_SAFE_INTEGER + 1 },
  { ...good, x: Infinity },
  { ...good, x: 100_001 },
  { ...good, y: -10_001 },
  { ...good, heading: 1_000_001 },
  { ...good, speed: 100.1 },
  { ...good, active: 1 },
  { ...good, extra: 'x'.repeat(600) },
]) assert.equal(validateMultiplayerState(bad, 'city-v1'), null);

const transport = await readFile(new URL('../dist/multiplayer-network.js', import.meta.url), 'utf8');
const vendor = await readFile(new URL('../dist/vendor/trystero.js', import.meta.url), 'utf8');
assert.match(transport, /\.\/vendor\/trystero\.js/);
assert.doesNotMatch(transport, /from\s*['"](?:trystero|@trystero-p2p)\//);
assert.match(vendor, /Trystero 0\.25\.4/);

const sent = [], received = [], joined = [], left = [], errors = [];
let action, room, joinConfig;
const transportRoom = createRoomTransport({
  roomId: '7553d952-d468-4306-836e-16af36dcfece', worldId: 'city-v1',
  onPeerJoin: id => joined.push(id), onPeerLeave: id => left.push(id),
  onState: (id, state) => received.push({ id, state }), onError: error => errors.push(error),
}, (config, id, callbacks) => {
  joinConfig = { config, id, callbacks };
  action = { send: async payload => { sent.push(payload); } };
  room = { makeAction: name => { assert.equal(name, 'vehicle-state-v1'); return action; }, leave() { this.closed = true; } };
  return room;
});
assert.equal(joinConfig.config.appId, 'chisinau3d-multiplayer-v1');
room.onPeerJoin('alice');
assert.deepEqual(joined, ['alice']);
assert.equal(transportRoom.sendState(good), true);
assert.equal(transportRoom.sendState({ ...good, x: 4 }), true);
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(sent.map(packet => packet.seq), [0, 1]);
assert.equal(transportRoom.sendState({ ...good, x: Infinity }), false);
assert.equal(sent.length, 2);
action.onMessage({ ...sent[1], seq: 2 }, { peerId: 'alice' });
action.onMessage({ ...sent[1], worldId: 'other-world' }, { peerId: 'alice' });
assert.deepEqual(received, [{ id: 'alice', state: { seq: 2, active: true, x: 4, y: 12.5, z: 900, heading: 1.2, speed: -18 } }]);
assert.equal(errors.length, 2, 'bad outbound and incompatible inbound snapshots report errors');
room.onPeerLeave('alice');
assert.deepEqual(left, ['alice']);
transportRoom.leave();
assert.equal(room.closed, true);
assert.equal(transportRoom.sendState(good), false);
transportRoom.leave();

// Slow transports must never accumulate sends; intermediate snapshots collapse
// to the newest state while a packet is in flight.
let resolveFirst, resolveLatest, inFlight = 0, maxInFlight = 0;
const deferredSent = [];
const deferredTransport = createRoomTransport({
  roomId: '9553d952-d468-4306-836e-16af36dcfece', worldId: 'city-v1',
}, (_config, _id) => ({
  makeAction: () => ({ send(payload) {
    deferredSent.push(payload);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    if (deferredSent.length === 1) return new Promise(resolve => { resolveFirst = () => { inFlight -= 1; resolve(); }; });
    return new Promise(resolve => { resolveLatest = () => { inFlight -= 1; resolve(); }; });
  } }),
  leave() {},
}));
deferredTransport.sendState({ ...good, x: 1 });
deferredTransport.sendState({ ...good, x: 2 });
deferredTransport.sendState({ ...good, x: 3 });
deferredTransport.sendState({ ...good, x: 4 });
assert.deepEqual(deferredSent.map(packet => packet.x), [1]);
resolveFirst();
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(deferredSent.map(packet => packet.x), [1, 4]);
assert.equal(maxInFlight, 1);
resolveLatest();
await new Promise(resolve => setTimeout(resolve, 0));
deferredTransport.leave();
const withTurn = createRoomTransport({
  roomId: '9553d952-d468-4306-836e-16af36dcfece', worldId: 'city-v1',
  turnConfig: [{ urls: ['turns:turn.example:443?transport=tcp'], username: 'u', credential: 'c' }],
}, config => {
  assert.equal(config.turnConfig[0].urls[0], 'turns:turn.example:443?transport=tcp');
  return { makeAction: () => ({ send: async () => {} }), leave() {} };
});
withTurn.leave();
console.log('Multiplayer transport validation passed.');
