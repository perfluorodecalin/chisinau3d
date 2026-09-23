import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { analyzeBridges, makeTerrainSampler, toMarkdown } from '../scripts/report-bridges.mjs';

const meta = { nx: 2, nz: 2, step: 1, xmin: 0, zmin: 0 };
const samples = new Float32Array([0, 10, 20, 30]);
const ground = makeTerrainSampler(meta, Buffer.from(samples.buffer));
assert.equal(ground(0, 0), 0);
assert.ok(Math.abs(ground(1, 0) - 9.99) < 1e-6);
assert.equal(ground(0.5, 0.5), 15);
assert.throws(() => makeTerrainSampler(meta, Buffer.alloc(4)), /byte length/);

const profile = (points, bridge, name) => ({ points, bridge, width: 4, name, highway: bridge ? 'primary' : 'residential' });
const model = { profiles: {
  a: { bridge: true, group: 'g', points: [[0.5, 0.5], [2.5, 0.5]] },
  b: { bridge: true, group: 'g', points: [[2.5, 0.5], [4.5, 0.5]] },
  c: { bridge: false, points: [[0.5, 0.5], [0.5, 3.5]], attachments: [[0, 6]], serves: ['g'] }
}, clearanceAssumption: 6, approachGrade: 6.5, source: 'fixture' };
const bridges = { source: 'fixture', profiles: {
  a: profile([[0.5, 0.5, 10], [2.5, 0.5, 10.2]], true, 'Span A'),
  b: profile([[2.5, 0.5, 11.7], [4.5, 0.5, 11.8]], true, 'Span B'),
  c: profile([[0.5, 0.5, 9.7], [0.5, 3.5, 11]], false, 'Approach C')
} };
const report = analyzeBridges({ model, bridges, sampleGround: () => 0 });
assert.equal(report.counts.bridgeWays, 2);
assert.equal(report.counts.approachProfilesTotal, 1);
assert.equal(report.counts.bridgeWaysUnder20m, 2);
assert.equal(report.counts.bridgeEndpointLinks, 1);
assert.equal(report.counts.bridgeApproachEndpointLinks, 1);
assert.equal(report.counts.nearEndpointElevationDifferencesOver1m, 1);
assert.equal(report.counts.recordedAttachmentSeamsOver0_1m, 1);
assert.equal(report.worst.recordedAttachmentSeams[0].elevationDifferenceM.toFixed(1), '0.3');
assert.equal(report.worst.shortestSpans[0].name, 'Span A');
assert.equal(report.worst.largestElevationSeams[0].elevationDifferenceM, 1.5);
assert.match(toMarkdown(report), /low-confidence diagnostic/);
assert.match(toMarkdown(report), /Local X\/Z/);

// The generated model must correspond to the checked-in offline sources.
const data = new URL('../dist/data/', import.meta.url);
const read = async name => fs.readFile(new URL(name, data));
const parse = async name => JSON.parse(await read(name));
async function fingerprint(names) {
  const digest = createHash('sha256');
  for (const name of names.sort()) { digest.update(name); digest.update(await read(name)); }
  return digest.digest('hex');
}
const tiles = await parse('manifest.json');
const savedModel = await parse('bridge-model.json');
const savedBridges = await parse('bridges.json');
const sources = ['manifest.json', 'center.json', ...tiles.map(t => `${t.id}.json`), 'realism.json', 'road-model.json'];
assert.equal(savedModel.snapshotHash, await fingerprint(sources), 'bridge model must be regenerated after map/road source changes');
assert.equal(savedBridges.snapshotHash, savedModel.snapshotHash);
assert.equal(savedBridges.terrainHash, await fingerprint(['terrain.bin', 'terrain.json']), 'bridge elevations must be regenerated after terrain changes');
console.log('bridge model report checks passed');
