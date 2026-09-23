#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DATA = path.join(ROOT, 'dist/data');

function distance(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }
function lengthOf(points) { return points.slice(1).reduce((sum, point, i) => sum + distance(points[i], point), 0); }
function maxGrade(points) {
  let max = 0, segment = null;
  for (let i = 1; i < points.length; i++) {
    const run = distance(points[i - 1], points[i]);
    const grade = run > 0 ? Math.abs(points[i][2] - points[i - 1][2]) / run * 100 : 0;
    if (grade > max) { max = grade; segment = i - 1; }
  }
  return { percent: max, segment };
}

// Terrain is row-major little-endian float32, matching prepare_bridges.py.
export function makeTerrainSampler(meta, bytes) {
  if (!meta || !Number.isInteger(meta.nx) || !Number.isInteger(meta.nz) || !meta.step) throw new Error('Invalid terrain metadata');
  if (bytes.length !== meta.nx * meta.nz * 4) throw new Error('Terrain byte length does not match metadata');
  const values = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  return (x, z) => {
    const u = Math.max(0, Math.min(meta.nx - 1.001, (x - meta.xmin) / meta.step));
    const v = Math.max(0, Math.min(meta.nz - 1.001, (z - meta.zmin) / meta.step));
    const i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j;
    const h00 = values[j * meta.nx + i], h10 = values[j * meta.nx + i + 1];
    const h01 = values[(j + 1) * meta.nx + i], h11 = values[(j + 1) * meta.nx + i + 1];
    return (h00 * (1 - a) + h10 * a) * (1 - b) + (h01 * (1 - a) + h11 * a) * b;
  };
}

function endpointMatches(profiles, tolerance = 1, bridgeOnly = true) {
  const ends = [];
  for (const [id, p] of Object.entries(profiles)) {
    if ((bridgeOnly && !p.bridge) || !p.points?.length) continue;
    ends.push({ id, bridge: Boolean(p.bridge), point: p.points[0] }, { id, bridge: Boolean(p.bridge), point: p.points.at(-1) });
  }
  const pairs = [];
  for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
    if (ends[i].id === ends[j].id || (!ends[i].bridge && !ends[j].bridge) || (bridgeOnly && !ends[i].bridge)) continue;
    const d = distance(ends[i].point, ends[j].point);
    if (d <= tolerance) pairs.push({ a: ends[i].id, b: ends[j].id, aIsBridge: ends[i].bridge, bIsBridge: ends[j].bridge, distanceM: d,
      elevationDifferenceM: ends[i].point.length > 2 && ends[j].point.length > 2 ? Math.abs(ends[i].point[2] - ends[j].point[2]) : null,
      localXZ: ends[i].point.slice(0, 2) });
  }
  return pairs;
}

function attachmentSeams(model, profiles) {
  const key = point => `${point[0].toFixed(2)},${point[1].toFixed(2)}`;
  const deckJunctions = new Map();
  const sampledHeight = (profile, point) => {
    let best, distance = Infinity;
    for (const sample of profile.points) {
      const d = distanceBetween(point, sample);
      if (d < distance) { distance = d; best = sample; }
    }
    return distance < 0.15 ? best[2] : null;
  };
  for (const [id, source] of Object.entries(model.profiles)) {
    if (!source.bridge || !profiles[id]) continue;
    for (const point of source.points) {
      const height = sampledHeight(profiles[id], point);
      if (height === null) continue;
      const slot = key(point);
      if (!deckJunctions.has(slot)) deckJunctions.set(slot, []);
      deckJunctions.get(slot).push({ id, group: source.group, point, height });
    }
  }
  const seams = [];
  for (const [id, source] of Object.entries(model.profiles)) {
    if (source.bridge || !profiles[id]) continue;
    for (const [index] of source.attachments ?? []) {
      const point = source.points[index], height = point && sampledHeight(profiles[id], point);
      if (height === null || !point) continue;
      for (const deck of deckJunctions.get(key(point)) ?? []) {
        if (!source.serves?.includes(deck.group) || distanceBetween(point, deck.point) > 0.15) continue;
        seams.push({ bridgeId: deck.id, approachId: id, localXZ: point.slice(0, 2),
          elevationDifferenceM: Math.abs(height - deck.height) });
      }
    }
  }
  return seams.sort((a, b) => b.elevationDifferenceM - a.elevationDifferenceM);
}

const distanceBetween = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function analyzeBridges({ model, bridges, sampleGround, shortSpanM = 20, shortSpanCriticalM = 5, endpointToleranceM = 1 }) {
  const bridgeProfiles = Object.entries(bridges.profiles).filter(([, p]) => p.bridge && p.points?.length >= 2);
  const approachProfiles = Object.entries(bridges.profiles).filter(([, p]) => !p.bridge && p.points?.length >= 2);
  const spans = bridgeProfiles.map(([id, p]) => {
    const lengthM = lengthOf(p.points), grade = maxGrade(p.points);
    const clearances = p.points.map(pt => pt[2] - sampleGround(pt[0], pt[1]));
    const minimumClearanceM = Math.min(...clearances), clearanceIndex = clearances.indexOf(minimumClearanceM);
    return { id, name: p.name, highway: p.highway, lengthM, widthM: p.width, maxGradePercent: grade.percent,
      worstGradeSegment: grade.segment, worstGradeLocalXZ: grade.segment === null ? null : p.points[grade.segment].slice(0, 2),
      minimumTerrainClearanceM: minimumClearanceM, minimumClearanceLocalXZ: p.points[clearanceIndex].slice(0, 2) };
  });
  const allBridgeLinks = endpointMatches(bridges.profiles, endpointToleranceM, false);
  const linkedApproachIds = new Set(allBridgeLinks.filter(x => x.aIsBridge !== x.bIsBridge).map(x => x.aIsBridge ? x.b : x.a));
  const approaches = approachProfiles.filter(([id]) => linkedApproachIds.has(id)).map(([id, p]) => {
    const grade = maxGrade(p.points);
    return { id, name: p.name, highway: p.highway, lengthM: lengthOf(p.points), maxGradePercent: grade.percent,
      worstGradeSegment: grade.segment, worstGradeLocalXZ: grade.segment === null ? null : p.points[grade.segment].slice(0, 2) };
  });
  const top = (items, key, n = 10) => [...items].sort((a, b) => b[key] - a[key]).slice(0, n);
  const clearanceLow = [...spans].sort((a, b) => a.minimumTerrainClearanceM - b.minimumTerrainClearanceM);
  const short = spans.filter(s => s.lengthM < shortSpanM);
  const modelCount = Object.keys(model.profiles).length;
  const bridgeEndpointLinks = endpointMatches(bridges.profiles, endpointToleranceM);
  const modelBridgeCount = Object.values(model.profiles).filter(p => p.bridge).length;
  const bridgeModelMismatches = Object.keys(model.profiles).filter(id => !bridges.profiles[id]).length + Object.keys(bridges.profiles).filter(id => !model.profiles[id]).length;
  const joinSeams = attachmentSeams(model, bridges.profiles);
  return {
    source: { compilerSnapshot: bridges.source, modelSource: model.source, snapshotHash: model.snapshotHash,
      terrainHash: bridges.terrainHash, clearanceAssumptionM: model.clearanceAssumption,
      targetApproachGradePercent: model.approachGrade },
    counts: { modelProfiles: modelCount, compiledProfiles: Object.keys(bridges.profiles).length,
      bridgeWays: spans.length, approachProfilesTotal: approachProfiles.length, directlyLinkedApproachProfiles: approaches.length, bridgeWaysUnder20m: short.length,
      bridgeWaysUnder5m: spans.filter(s => s.lengthM < shortSpanCriticalM).length,
      bridgeWaysOver10PercentGrade: spans.filter(s => s.maxGradePercent > 10).length,
      linkedApproachesOver6_5PercentSlope: approaches.filter(a => a.maxGradePercent > 6.5).length,
      bridgeEndpointLinks: bridgeEndpointLinks.length, bridgeApproachEndpointLinks: allBridgeLinks.filter(x => x.aIsBridge !== x.bIsBridge).length,
      bridgeWaysLinkedToOtherWays: new Set(allBridgeLinks.filter(x => x.aIsBridge !== x.bIsBridge).map(x => x.aIsBridge ? x.a : x.b)).size,
      nearEndpointElevationDifferencesOver1m: allBridgeLinks.filter(x => x.elevationDifferenceM !== null && x.elevationDifferenceM > 1).length,
      recordedAttachmentSeamsOver0_1m: joinSeams.filter(x => x.elevationDifferenceM > 0.1).length,
      distinctLinkedBridgeWays: new Set(bridgeEndpointLinks.flatMap(x => [x.a, x.b])).size,
      modelBridgeWays: modelBridgeCount, modelCompiledProfileMismatches: bridgeModelMismatches },
    thresholds: { shortSpanM, shortSpanCriticalM, endpointToleranceM, steepBridgeGradePercent: 10, steepApproachGradePercent: 6.5 },
    worst: { shortestSpans: [...spans].sort((a, b) => a.lengthM - b.lengthM).slice(0, 10),
      steepestSpans: top(spans, 'maxGradePercent'), steepestApproaches: top(approaches, 'maxGradePercent'),
      lowestTerrainClearance: clearanceLow.slice(0, 10), highestTerrainClearance: [...spans].sort((a, b) => b.minimumTerrainClearanceM - a.minimumTerrainClearanceM).slice(0, 10),
      endpointLinks: bridgeEndpointLinks.slice(0, 20), largestElevationSeams: [...allBridgeLinks].filter(x => x.elevationDifferenceM !== null).sort((a, b) => b.elevationDifferenceM - a.elevationDifferenceM).slice(0, 10),
      recordedAttachmentSeams: joinSeams.slice(0, 10) },
    anomalies: { shortSpans: short, spansOver10PercentGrade: spans.filter(s => s.maxGradePercent > 10),
      linkedApproachesOver6_5PercentSlopeDiagnostic: approaches.filter(a => a.maxGradePercent > 6.5),
      diagnosticOnlyTerrainClearanceUnder3m: spans.filter(s => s.minimumTerrainClearanceM < 3),
      diagnosticOnlyTerrainClearanceOver12m: spans.filter(s => s.minimumTerrainClearanceM > 12),
      nearEndpointElevationDifferencesOver1mDiagnostic: allBridgeLinks.filter(x => x.elevationDifferenceM !== null && x.elevationDifferenceM > 1) }
  };
}

export function toMarkdown(report) {
  const lines = ['# Bridge model anomaly report', '',
    'Generated from the checked-in map snapshot and estimated bridge profiles. Reproduce with `npm run report:bridges` after `python3 scripts/prepare_bridges.py`; neither command requests map data from the network.',
    '', 'The saved map sections omit OSM node IDs. The model uses recorded road joins where available and infers some connections from coincident endpoints. Its 6 m landing offset and 6.5% approach *offset taper* are assumptions, not surveyed dimensions. The DEM under bridges can be unreliable.',
    '', `- Source fingerprint: ${report.source.snapshotHash?.slice(0, 16) ?? 'fixture'}; terrain fingerprint: ${report.source.terrainHash?.slice(0, 16) ?? 'fixture'}`,
    `- Bridge ways: ${report.counts.bridgeWays}; non-bridge profiles: ${report.counts.approachProfilesTotal}; directly linked to bridge endpoints: ${report.counts.directlyLinkedApproachProfiles}`,
    `- Short spans: ${report.counts.bridgeWaysUnder20m} under 20 m (${report.counts.bridgeWaysUnder5m} under 5 m)`,
    `- Slope diagnostics: ${report.counts.bridgeWaysOver10PercentGrade} bridge ways over 10%; ${report.counts.linkedApproachesOver6_5PercentSlope} linked profiles over 6.5% slope (screening threshold, not a design grade limit)`,
    `- Bridge endpoint links within ${report.thresholds.endpointToleranceM} m: ${report.counts.bridgeEndpointLinks}`, '', '## Shortest bridge ways', '',
    '| Way | Name | Type | Length | Max grade | Min deck-to-DEM |', '| --- | --- | --- | ---: | ---: | ---: |'];
  for (const s of report.worst.shortestSpans) lines.push(`| ${s.id} | ${s.name ?? ''} | ${s.highway ?? ''} | ${s.lengthM.toFixed(1)} m | ${s.maxGradePercent.toFixed(1)}% | ${s.minimumTerrainClearanceM.toFixed(1)} m |`);
  lines.push('', '## Steepest bridge profiles', '', '| Way | Name | Length | Max grade | Segment |', '| --- | --- | ---: | ---: | ---: |');
  for (const s of report.worst.steepestSpans) lines.push(`| ${s.id} | ${s.name ?? ''} | ${s.lengthM.toFixed(1)} m | ${s.maxGradePercent.toFixed(1)}% | ${s.worstGradeSegment ?? '—'} |`);
  lines.push('', '## Steepest linked approach slope diagnostics', '', '| Way | Name | Max grade | Segment | Local X/Z |', '| --- | --- | ---: | ---: | --- |');
  for (const a of report.worst.steepestApproaches) lines.push(`| ${a.id} | ${a.name ?? ''} | ${a.maxGradePercent.toFixed(1)}% | ${a.worstGradeSegment ?? '—'} | ${a.worstGradeLocalXZ?.map(v => v.toFixed(1)).join(', ') ?? '—'} |`);
  lines.push('', '## Smallest deck-to-DEM separations (diagnostic only)', '', '| Way | Name | Minimum deck-to-DEM | Local X/Z |', '| --- | --- | ---: | --- |');
  for (const s of report.worst.lowestTerrainClearance) lines.push(`| ${s.id} | ${s.name ?? ''} | ${s.minimumTerrainClearanceM.toFixed(1)} m | ${s.minimumClearanceLocalXZ.map(v => v.toFixed(1)).join(', ')} |`);
  lines.push('', '## Near-endpoint elevation differences (diagnostic)' , '', '| Way A | Way B | Bridge A | Bridge B | Elevation difference | Local X/Z |', '| --- | --- | --- | --- | ---: | --- |');
  for (const x of report.worst.largestElevationSeams) lines.push(`| ${x.a} | ${x.b} | ${x.aIsBridge} | ${x.bIsBridge} | ${x.elevationDifferenceM.toFixed(2)} m | ${x.localXZ.map(v => v.toFixed(1)).join(', ')} |`);
  lines.push('', '## Recorded bridge-to-approach attachment seams', '',
    `Attachments with more than 0.1 m difference: ${report.counts.recordedAttachmentSeamsOver0_1m}.`, '',
    '| Bridge way | Approach way | Elevation difference | Local X/Z |', '| --- | --- | ---: | --- |');
  for (const x of report.worst.recordedAttachmentSeams) lines.push(`| ${x.bridgeId} | ${x.approachId} | ${x.elevationDifferenceM.toFixed(2)} m | ${x.localXZ.map(v => v.toFixed(1)).join(', ')} |`);
  lines.push('', '## Interpretation', '', 'Terrain clearance is a low-confidence diagnostic: it is deck elevation minus the saved DEM sampled beneath bridge vertices, and the DEM under bridges may not represent actual ground. Treat it as neither measured clearance nor a pass/fail threshold. Approach slopes are screening measurements against a 6.5% comparison threshold; the source’s 6.5% value is an offset taper assumption, not a grade requirement. Near-endpoint elevation differences are only possible discontinuities: close geometry does not establish shared-node topology or same-level connectivity, and grade-separated crossings can be nearby.');
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2), format = args.includes('--json') ? 'json' : 'markdown';
  const dataDir = args.find(a => !a.startsWith('--')) ?? DEFAULT_DATA;
  const load = name => JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
  const terrain = load('terrain.json'), raw = fs.readFileSync(path.join(dataDir, 'terrain.bin'));
  const report = analyzeBridges({ model: load('bridge-model.json'), bridges: load('bridges.json'), sampleGround: makeTerrainSampler(terrain, raw) });
  process.stdout.write(format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : `${toMarkdown(report)}\n`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
