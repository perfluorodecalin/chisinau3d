import * as T from 'three';

const MAX_PEERS = 7;
const STALE_AFTER = 5;
const COLORS = ['#4e9cff', '#aa73e8', '#49c79a', '#f0b84c', '#e87d86', '#74c9d9', '#d7dc73'];
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const validState = state => state && [state.x, state.y, state.z, state.heading, state.speed].every(Number.isFinite);

/** Render remote cars from world-space snapshots. Physics remain local to each driver. */
export function createRemoteCars(scene, { now = () => (globalThis.performance?.now?.() ?? Date.now()) / 1000 } = {}) {
  const geometry = {
    body: new T.BoxGeometry(1.85, .6, 4.3),
    cabin: new T.BoxGeometry(1.6, .65, 2.15),
    roof: new T.BoxGeometry(1.65, .12, 2.2),
    trim: new T.BoxGeometry(1.86, .18, .15),
    tire: new T.CylinderGeometry(.36, .36, .22, 12),
    hub: new T.CylinderGeometry(.2, .2, .23, 12),
    lamp: new T.BoxGeometry(.44, .15, .06),
    shadow: new T.CircleGeometry(2.7, 24),
  };
  const shared = {
    glass: new T.MeshStandardMaterial({ color: '#203f4c', roughness: .25, metalness: .4 }),
    rubber: new T.MeshStandardMaterial({ color: '#111b20', roughness: 1 }),
    metal: new T.MeshStandardMaterial({ color: '#b7c6cb', metalness: .7, roughness: .3 }),
    headlamp: new T.MeshBasicMaterial({ color: '#fff1bd' }),
    tailLamp: new T.MeshBasicMaterial({ color: '#ff293b' }),
    shadow: new T.MeshBasicMaterial({ color: '#09151b', transparent: true, opacity: .2, depthWrite: false }),
  };
  const peers = new Map();
  const lastSeq = new Map();

  function makePeer(peerId) {
    const slot = peers.size;
    const group = new T.Group();
    group.name = `remote-car-${peerId}`;
    const paint = new T.MeshStandardMaterial({ color: COLORS[slot % COLORS.length], roughness: .35, metalness: .25 });
    const add = (g, m, x, y, z) => {
      const mesh = new T.Mesh(g, m);
      mesh.position.set(x, y, z);
      group.add(mesh);
      return mesh;
    };
    add(geometry.body, paint, 0, .86, 0);
    add(geometry.cabin, shared.glass, 0, 1.43, -.25);
    add(geometry.roof, paint, 0, 1.8, -.25);
    add(geometry.trim, shared.metal, 0, .59, 2.17);
    add(geometry.trim, shared.metal, 0, .59, -2.17);
    for (const x of [-.62, .62]) {
      add(geometry.lamp, shared.headlamp, x, .91, 2.18);
      add(geometry.lamp, shared.tailLamp, x, .91, -2.18);
    }
    const wheels = [];
    for (const x of [-.96, .96]) for (const z of [-1.35, 1.35]) {
      const wheel = new T.Group();
      const tire = new T.Mesh(geometry.tire, shared.rubber);
      const hub = new T.Mesh(geometry.hub, shared.metal);
      tire.rotation.z = hub.rotation.z = Math.PI / 2;
      wheel.add(tire, hub);
      wheel.position.set(x, .51, z);
      group.add(wheel);
      wheels.push({ wheel, tire, hub, front: z > 0 });
    }
    const shadow = new T.Mesh(geometry.shadow, shared.shadow);
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.x = .5;
    shadow.position.y = .15;
    group.add(shadow);
    scene.add(group);
    const peer = { group, paint, wheels, visible: false, target: null, receivedAt: now() };
    peers.set(peerId, peer);
    return peer;
  }

  function updatePeer(peerId, state) {
    if (peerId == null || !validState(state)) return false;
    let peer = peers.get(peerId);
    // Track sequence numbers even for inactive packets so a delayed active update
    // cannot resurrect a peer after its later departure packet was observed.
    if (Number.isFinite(state.seq)) {
      const previous = lastSeq.get(peerId) ?? -Infinity;
      if (state.seq <= previous) return false;
      lastSeq.set(peerId, state.seq);
    }
    if (!state.active) {
      if (peer) { peer.visible = false; peer.group.visible = false; peer.target = null; }
      return true;
    }
    if (!peer && peers.size >= MAX_PEERS) return false;
    if (!peer) peer = makePeer(peerId);
    const next = { x: state.x, y: state.y, z: state.z, heading: state.heading, speed: clamp(state.speed, -80, 80) };
    peer.receivedAt = now();
    peer.target = next;
    if (!peer.visible) {
      peer.group.position.set(next.x, next.y, next.z);
      peer.group.rotation.y = next.heading;
      peer.visible = peer.group.visible = true;
    }
    return true;
  }

  function removePeer(peerId) {
    const peer = peers.get(peerId);
    lastSeq.delete(peerId);
    if (!peer) return false;
    scene.remove(peer.group);
    peer.group.traverse(object => {
      if (object.isMesh && object.material === peer.paint) object.material.dispose();
    });
    peers.delete(peerId);
    return true;
  }

  function update(dt) {
    const step = Number.isFinite(dt) ? clamp(dt, 0, .25) : 0;
    const alpha = 1 - Math.exp(-10 * step);
    for (const peer of peers.values()) {
      if (!peer.visible || !peer.target) continue;
      if (now() - peer.receivedAt > STALE_AFTER) {
        peer.visible = false;
        peer.group.visible = false;
        continue;
      }
      const target = peer.target, p = peer.group.position;
      p.x += (target.x - p.x) * alpha;
      p.y += (target.y - p.y) * alpha;
      p.z += (target.z - p.z) * alpha;
      const current = peer.group.rotation.y;
      const delta = Math.atan2(Math.sin(target.heading - current), Math.cos(target.heading - current));
      peer.group.rotation.y = current + delta * alpha;
      for (const w of peer.wheels) {
        if (w.front) w.wheel.rotation.y += (clamp(target.speed * .012, -.35, .35) - w.wheel.rotation.y) * alpha;
        w.tire.rotation.x += target.speed * step / .36;
        w.hub.rotation.x = w.tire.rotation.x;
      }
    }
  }

  function dispose() {
    for (const id of [...peers.keys()]) removePeer(id);
    for (const item of Object.values(geometry)) item.dispose();
    for (const item of Object.values(shared)) item.dispose();
  }

  return { updatePeer, removePeer, update, dispose };
}

export const REMOTE_CAR_STALE_SECONDS = STALE_AFTER;
