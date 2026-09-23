// Shared by the static browser client and the Cloudflare Worker.
export const PROTOCOL_VERSION = 2;
export const MAX_MESSAGE_BYTES = 512;
export const ROOM_CAPACITY = 8;
export const STALE_MS = 30_000;
export const ROOM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const WORLD_ID_PATTERN = /^[0-9a-f]{64}$/;

const exactKeys = (value, keys) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export function validPose(pose) {
  if (!pose || typeof pose !== 'object' || Array.isArray(pose) || !exactKeys(pose, ['active', 'x', 'y', 'z', 'heading', 'speed'])) return false;
  const { active, x, y, z, heading, speed } = pose;
  return typeof active === 'boolean' && [x, y, z, heading, speed].every(Number.isFinite)
    && Math.abs(x) <= 100_000 && Math.abs(z) <= 100_000 && Math.abs(y) <= 10_000
    && Math.abs(heading) <= 1_000_000 && Math.abs(speed) <= 100;
}

export function parseTick(raw) {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > MAX_MESSAGE_BYTES) return null;
  let message;
  try { message = JSON.parse(raw); } catch { return null; }
  if (!message || typeof message !== 'object' || Array.isArray(message)
      || !exactKeys(message, ['t', 'v', 'n', 'p']) || message.t !== 'tick'
      || message.v !== PROTOCOL_VERSION || !Number.isSafeInteger(message.n)
      || message.n < 0 || !validPose(message.p)) return null;
  return message;
}

export function validSnapshot(message, requestSequence) {
  if (!message || typeof message !== 'object' || Array.isArray(message)
      || !exactKeys(message, ['t', 'v', 'n', 'peers']) || message.t !== 'snapshot' || message.v !== PROTOCOL_VERSION
      || message.n !== requestSequence || !Array.isArray(message.peers)
      || message.peers.length > ROOM_CAPACITY - 1) return false;
  const ids = new Set();
  return message.peers.every(peer => {
    if (!peer || typeof peer !== 'object' || Array.isArray(peer)
        || !exactKeys(peer, ['id', 'seq', 'active', 'x', 'y', 'z', 'heading', 'speed'])
        || typeof peer.id !== 'string' || !ROOM_ID_PATTERN.test(peer.id)
        || ids.has(peer.id) || !Number.isSafeInteger(peer.seq) || peer.seq < -1) return false;
    ids.add(peer.id);
    return validPose({ active: peer.active, x: peer.x, y: peer.y, z: peer.z, heading: peer.heading, speed: peer.speed });
  });
}
