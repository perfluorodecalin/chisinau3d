import assert from 'node:assert/strict';
import * as T from 'three';
import { createRemoteCars } from '../dist/remote-cars.js';

const scene = new T.Scene();
let clock = 0;
const cars = createRemoteCars(scene, { now: () => clock });
const snap = (x, heading = 0, seq = 1, active = true) => ({ active, x, y: 3, z: 12, heading, speed: 18, seq });
assert.equal(cars.updatePeer('alice', snap(0, Math.PI - .1)), true);
const alice = scene.getObjectByName('remote-car-alice');
assert.ok(alice?.visible);
assert.equal(alice.position.x, 0, 'first snapshot initializes position without sliding in from origin');

assert.equal(cars.updatePeer('alice', snap(20, -Math.PI + .1, 2)), true);
cars.update(.1);
assert.ok(alice.position.x > 0 && alice.position.x < 20, 'position eases toward the latest snapshot');
assert.ok(Math.abs(Math.abs(alice.rotation.y) - Math.PI) < .3, 'heading interpolation follows the short path across angle wrap');
const acceptedX = alice.position.x;
assert.equal(cars.updatePeer('alice', snap(500, 0, 1)), false, 'older sequence is rejected');
cars.update(.1);
assert.ok(alice.position.x < 20 && alice.position.x > acceptedX, 'rejected packet does not replace current target');

assert.equal(cars.updatePeer('alice', snap(0, 0, 2, false)), false, 'old inactive snapshot cannot hide a newer visible position');
assert.equal(alice.visible, true);
assert.equal(cars.updatePeer('alice', snap(0, 0, 3, false)), true);
assert.equal(alice.visible, false, 'inactive driver is hidden');
assert.equal(cars.updatePeer('alice', snap(0, 0, 2, true)), false, 'older active snapshot cannot resurrect an inactive peer');
assert.equal(cars.updatePeer('bob', snap(4, .4)), true);
const bob = scene.getObjectByName('remote-car-bob');
assert.notEqual(alice.children[0].material.color.getHex(), bob.children[0].material.color.getHex(), 'peers have distinct paint');
assert.equal(cars.updatePeer('carol', snap(8)), true);
assert.equal(cars.updatePeer('dave', snap(12)), true);
for (const [index, id] of ['erin', 'frank', 'gabi'].entries()) assert.equal(cars.updatePeer(id, snap(16 + index)), true);
assert.equal(cars.updatePeer('jules', snap(22)), false, 'seven remote cars stay bounded');

// Simulate a background-throttled tab: wall time advances even if frame updates do not.
clock += 5.1;
cars.update(.016);
assert.equal(bob.visible, false, 'peer with no fresh snapshots becomes stale and is hidden');
assert.equal(cars.removePeer('bob'), true);
assert.equal(scene.getObjectByName('remote-car-bob'), undefined, 'removed peer leaves scene');
cars.dispose();
assert.equal(scene.children.length, 0, 'dispose removes remaining peer objects');
console.log('Remote car quality checks passed.');
