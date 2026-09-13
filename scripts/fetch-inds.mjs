// Optional public WFS acquisition. Never called by dev, build or tests.
// Research snapshots stay outside dist/ pending source/OSM conflation and reuse review.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';

const directory = new URL('../.local/inds/', import.meta.url);
const bbox = [28.740, 46.975, 28.980, 47.100]; // longitude, latitude (CRS84)
const limit = 5000;
const layers = {
  surfaces: '26559a1a-278c-11ed-9927-931557eabfd2',
  roughness: '839129f4-2789-11ed-9963-a7bda0d10e71',
  'road-links': 'RoadLink',
  'railway-crossings': 'intersectii_cf_v',
  parking: 'parking_camioane_v',
  'traffic-monitoring': 'monitorizare_trafic_v',
};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function featureBounds(feature) {
  const pairs = feature.geometry.coordinates.flat(feature.geometry.type === 'Point' ? 0 :
    ({MultiPoint: 0, LineString: 0, MultiLineString: 1, Polygon: 1, MultiPolygon: 2})[feature.geometry.type]);
  const points = feature.geometry.type === 'Point' ? [pairs] : pairs;
  return points.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]),
    Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
}
function overlapsCity(bounds) {
  return bounds[2] >= bbox[0] && bounds[0] <= bbox[2] && bounds[3] >= bbox[1] && bounds[1] <= bbox[3];
}

function validate(collection, requireCity = true) {
  if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features))
    throw new Error('Expected a GeoJSON FeatureCollection');
  const count = collection.features.length;
  if (count >= limit || collection.links?.some(link => link.rel === 'next'))
    throw new Error('Possible truncation; do not treat this snapshot as complete');
  if (collection.numberReturned !== undefined && collection.numberReturned !== count)
    throw new Error('Returned feature count mismatch');
  const total = collection.numberMatched ?? collection.totalFeatures;
  if (total !== undefined && (!Number.isFinite(Number(total)) || Number(total) !== count))
    throw new Error('Matched feature count is unknown or differs from returned count');
  const ids = new Set();
  for (const feature of collection.features) {
    if (!feature.id || ids.has(feature.id)) throw new Error('Missing or duplicate source ID');
    ids.add(feature.id);
    if (!['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'].includes(feature.geometry?.type))
      throw new Error(`Unsupported geometry: ${feature.id}`);
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    function visit(coords) {
      if (!Array.isArray(coords) || !coords.length) throw new Error('Empty geometry');
      if (typeof coords[0] === 'number') {
        if (coords.length < 2 || !coords.every(Number.isFinite) || Math.abs(coords[0]) > 180 || Math.abs(coords[1]) > 90)
          throw new Error('Invalid geographic coordinates');
        bounds[0] = Math.min(bounds[0], coords[0]); bounds[2] = Math.max(bounds[2], coords[0]);
        bounds[1] = Math.min(bounds[1], coords[1]); bounds[3] = Math.max(bounds[3], coords[1]);
      } else coords.forEach(visit);
    }
    visit(feature.geometry.coordinates);
    // WFS selects intersecting features; it does not clip their full geometry.
    if (requireCity && !overlapsCity(bounds))
      throw new Error(`Feature outside requested city bounds: ${feature.id} ${JSON.stringify(bounds)}`);
  }
  return count;
}

const mode = process.argv[2];
if (!['--download', '--verify'].includes(mode) || process.argv.length !== 3)
  throw new Error('Usage: node scripts/fetch-inds.mjs --download | --verify');

if (mode === '--verify') {
  const manifest = JSON.parse(await fs.readFile(new URL('manifest.json', directory), 'utf8'));
  for (const name of Object.keys(layers)) {
    const bytes = await fs.readFile(new URL(`${name}.geojson`, directory));
    const count = validate(JSON.parse(bytes));
    const record = manifest.datasets.find(entry => entry.name === name);
    if (!record || record.sha256 !== digest(bytes) || record.count !== count)
      throw new Error(`Snapshot manifest mismatch: ${name}`);
    const raw = await fs.readFile(new URL(`${name}.response.json`, directory));
    if (digest(raw) !== record.rawSha256 || validate(JSON.parse(raw), false) !== record.rawCount)
      throw new Error(`Raw response manifest mismatch: ${name}`);
    console.log(`${name}: ${count} features, geometry/count/hash verified`);
  }
} else {
  await fs.mkdir(directory, {recursive: true});
  const manifest = {
    retrievedAt: new Date().toISOString(), bbox, bboxCrs: 'OGC:CRS84',
    provider: 'S.A. Administrația Națională a Drumurilor, Republica Moldova',
    discovery: 'https://geoportalinds.gov.md/geonetwork/srv/eng/catalog.search',
    map: 'https://harta.asd.md/',
    purpose: 'Local research only; not approved for redistribution or automatic OSM overrides. See research/inds/README.md.',
    datasets: [],
  };
  // Six sequential, bounded requests; no pagination, retry loop or OSM requests.
  for (const [name, layer] of Object.entries(layers)) {
    const url = new URL('https://data.asd.md/geoserver/public/ows');
    url.search = new URLSearchParams({service: 'WFS', version: '2.0.0', request: 'GetFeature',
      typeNames: `public:${layer}`, outputFormat: 'application/json',
      srsName: 'EPSG:4326', bbox: `${bbox.join(',')},urn:ogc:def:crs:OGC:1.3:CRS84`, count: String(limit)});
    // Reuse saved responses; explicitly remove individual local files to refresh.
    const rawFile = new URL(`${name}.response.json`, directory);
    let raw;
    try { raw = await fs.readFile(rawFile); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const response = await fetch(url, {signal: AbortSignal.timeout(30000)});
      if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
      raw = Buffer.from(await response.arrayBuffer());
      validate(JSON.parse(raw), false);
      await fs.writeFile(rawFile, raw);
    }
    const collection = JSON.parse(raw), rawCount = validate(collection, false);
    // Native-CRS envelope filtering overfetches. Remove geographic bbox misses;
    // retained geometries remain whole and still require clipping before use.
    collection.features = collection.features.filter(f => overlapsCity(featureBounds(f)));
    collection.numberReturned = collection.numberMatched = collection.totalFeatures = collection.features.length;
    delete collection.bbox;
    const count = validate(collection), bytes = Buffer.from(JSON.stringify(collection));
    await fs.writeFile(new URL(`${name}.geojson`, directory), bytes);
    manifest.datasets.push({name, layer: `public:${layer}`, url: url.href, count, rawCount,
      rawSha256: digest(raw), fetchedAt: (await fs.stat(rawFile)).mtime.toISOString(),
      sha256: digest(bytes), bytes: bytes.length,
      fields: [...new Set(collection.features.flatMap(f => Object.keys(f.properties)))].sort()});
    console.log(`${name}: saved ${count} features (${bytes.length} bytes)`);
  }
  await fs.writeFile(new URL('manifest.json', directory), JSON.stringify(manifest, null, 2) + '\n');
}
