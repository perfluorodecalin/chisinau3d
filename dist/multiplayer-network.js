import { joinRoom } from './vendor/trystero.js';

const PROTOCOL_VERSION = 1;
const MAX_MESSAGE_BYTES = 512;
const MAX_POSITION = 100_000;
const MAX_HEIGHT = 10_000;
const MAX_SPEED = 100;
const MAX_HEADING = 1_000_000;
const APP_ID = 'chisinau3d-multiplayer-v1';

function report(callback, ...args) {
  if (typeof callback !== 'function') return;
  try { callback(...args); } catch (error) { console.error('Multiplayer callback failed', error); }
}

export function validateMultiplayerState(payload, worldId) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  let encoded;
  try { encoded = JSON.stringify(payload); } catch { return null; }
  if (!encoded || new TextEncoder().encode(encoded).byteLength > MAX_MESSAGE_BYTES) return null;
  if (payload.protocol !== PROTOCOL_VERSION || payload.worldId !== worldId) return null;
  if (!Number.isSafeInteger(payload.seq) || payload.seq < 0 || typeof payload.active !== 'boolean') return null;
  const { x, y, z, heading, speed } = payload;
  if (![x, y, z, heading, speed].every(Number.isFinite)) return null;
  if (Math.abs(x) > MAX_POSITION || Math.abs(z) > MAX_POSITION || y < -MAX_HEIGHT || y > MAX_HEIGHT) return null;
  if (Math.abs(heading) > MAX_HEADING || Math.abs(speed) > MAX_SPEED) return null;
  return { seq: payload.seq, active: payload.active, x, y, z, heading, speed };
}

/** Join a Trystero Nostr-discovery room and exchange bounded vehicle snapshots. */
export function createRoomTransport({ roomId, worldId, turnConfig, onPeerJoin, onPeerLeave, onState, onError } = {}, join = joinRoom) {
  if (typeof roomId !== 'string' || roomId.length < 16 || roomId.length > 128) {
    throw new TypeError('roomId must be an unguessable string of 16–128 characters');
  }
  if (typeof worldId !== 'string' || !worldId || worldId.length > 128) {
    throw new TypeError('worldId must be a non-empty string of at most 128 characters');
  }
  if (turnConfig !== undefined && (!Array.isArray(turnConfig) || !turnConfig.length || !turnConfig.every(server =>
    server && Array.isArray(server.urls) && server.urls.length && server.urls.every(url => typeof url === 'string' && /^turns?:/i.test(url)) &&
    typeof server.username === 'string' && typeof server.credential === 'string'))) {
    throw new TypeError('Invalid TURN server configuration');
  }

  let closed = false;
  let seq = 0;
  let send;
  let room;
  let sending = false;
  let pendingState = null;

  // Snapshot traffic is replaceable: if the peer transport is slower than the
  // simulation tick, retain only the newest snapshot and send it next.
  function flushState(payload) {
    if (closed || sending) return;
    sending = true;
    let result;
    try { result = send(payload); }
    catch (error) {
      report(onError, error);
      sending = false;
      const next = pendingState;
      pendingState = null;
      if (next) flushState(next);
      return;
    }
    Promise.resolve(result).then(
      undefined,
      error => report(onError, error),
    ).then(() => {
      sending = false;
      if (closed) { pendingState = null; return; }
      const next = pendingState;
      pendingState = null;
      if (next) flushState(next);
    });
  }
  try {
    room = join({ appId: APP_ID, ...(turnConfig ? { turnConfig } : {}) }, roomId, {
      onJoinError: details => report(onError, details?.error || new Error('Unable to connect to multiplayer peer')),
    });
    const action = room.makeAction('vehicle-state-v1');
    send = action.send.bind(action);
    action.onMessage = (payload, { peerId } = {}) => {
      if (closed) return;
      const state = validateMultiplayerState(payload, worldId);
      if (!state) {
        report(onError, new Error('Ignored invalid or incompatible multiplayer state'));
        return;
      }
      report(onState, peerId, state);
    };
    room.onPeerJoin = peerId => { if (!closed) report(onPeerJoin, peerId); };
    room.onPeerLeave = peerId => { if (!closed) report(onPeerLeave, peerId); };
  } catch (error) {
    report(onError, error);
    throw error;
  }

  return {
    sendState(state) {
      if (closed) return false;
      const seqId = seq++;
      const payload = {
        protocol: PROTOCOL_VERSION,
        worldId,
        seq: seqId,
        active: state?.active === true,
        x: state?.x,
        y: state?.y,
        z: state?.z,
        heading: state?.heading,
        speed: state?.speed,
      };
      const valid = validateMultiplayerState(payload, worldId);
      if (!valid) {
        report(onError, new TypeError('Refusing invalid local vehicle state'));
        return false;
      }
      // Trystero handles serialization; bound outstanding work to one send
      // and one replaceable newest snapshot.
      if (sending) pendingState = payload;
      else flushState(payload);
      return true;
    },
    leave() {
      if (closed) return;
      closed = true;
      pendingState = null;
      room.onPeerJoin = null;
      room.onPeerLeave = null;
      room.leave();
    },
  };
}
