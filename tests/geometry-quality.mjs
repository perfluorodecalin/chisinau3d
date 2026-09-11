import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {drapeGeometry} from '../dist/drape-geometry.js';
import {referenceDrape} from './fixtures/drape-reference.mjs';
import {addSurfaceBatches} from '../dist/surface-batches.js';
import {configureTerrain,heightAt,roadHeight} from '../dist/terrain.js';
import {roadPositions,roadTags,loadRoadModel} from '../dist/road-model.js';
import {roadWidth} from '../dist/realism.js';
import {SegmentIndex,nearestIndexedSegment} from '../dist/spatial.js';
import {closest} from '../dist/driving-physics.js';
import {project} from '../dist/model.js';

const read=name=>fs.readFile(new URL('../dist/data/'+name,import.meta.url));
const json=async name=>JSON.parse(await read(name));
globalThis.fetch=async url=>({ok:true,json:()=>json(url.split('/').at(-1))});
await loadRoadModel();
const buffer=await read('terrain.bin'),meta=await json('terrain.json'),bridges=await json('bridges.json');
configureTerrain(meta,new Float32Array(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength)),bridges.profiles);
let checked=0;
function compare(geometry,sample=heightAt,edge=12){
  const expected=referenceDrape(geometry.clone(),sample,edge);
  const actual=drapeGeometry(geometry.clone(),sample,edge);
  assert.deepEqual(Object.keys(actual.attributes),Object.keys(expected.attributes));
  for(const name of Object.keys(expected.attributes))assert.deepEqual(actual.getAttribute(name).array,expected.getAttribute(name).array,`exact ${name} for case ${checked}`);
  expected.dispose();actual.dispose();checked++;
}
const plane=new T.PlaneGeometry(256,256,4,4);plane.rotateX(-Math.PI/2);
const count=plane.getAttribute('position').count;
plane.setAttribute('color',new T.Float32BufferAttribute(Array.from({length:count*3},(_,i)=>(i%7)/7),3));
plane.setAttribute('roadSurface',new T.Float32BufferAttribute(Array.from({length:count},(_,i)=>i%2),1));
compare(plane,(x,z)=>Math.sin(x/23)*12+Math.cos(z/45)*6);
compare(plane.toNonIndexed(),()=>0);
compare(plane,heightAt,55);
const empty=new T.BufferGeometry();empty.setAttribute('position',new T.Float32BufferAttribute([],3));compare(empty);
const needle=new T.BufferGeometry();needle.setAttribute('position',new T.Float32BufferAttribute([0,0,0,100000,0,0,0,0,1],3));compare(needle,()=>0,1);

const center=await json('center.json');
const roads=center.elements.filter(e=>e.tags?.highway&&e.geometry?.length>1);
const selected=roads.filter((e,i)=>i%Math.max(1,Math.floor(roads.length/48))===0);
selected.push(...roads.filter(e=>bridges.profiles[e.id]).slice(0,16));
const surfaces=[];
for(const original of selected){
  const e={...original,tags:roadTags(original.id,original.tags)};
  if(e.tags.gameHidden)continue;
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(roadPositions(e,roadWidth(e.tags)),3));
  g.setAttribute('roadSurface',new T.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(1),1));
  compare(g,(x,z)=>roadHeight(x,z,e.id));
  surfaces.push(drapeGeometry(g,(x,z)=>roadHeight(x,z,e.id),12));
}

// A triangle's complete attribute bytes survive partitioning, including paint,
// normals and bridge/deck elevations. No triangles may be lost or duplicated.
function fingerprints(geometries){
  const hashes=[];
  for(const g of geometries){
    const count=g.getAttribute('position').count;
    for(let i=0;i<count;i+=3){
      const hash=createHash('sha256');
      for(const name of Object.keys(g.attributes).sort()){
        const a=g.getAttribute(name),start=i*a.itemSize*a.array.BYTES_PER_ELEMENT;
        hash.update(name).update(Buffer.from(a.array.buffer,a.array.byteOffset+start,3*a.itemSize*a.array.BYTES_PER_ELEMENT));
      }
      hashes.push(hash.digest('hex'));
    }
  }
  return hashes.sort();
}
const expected=fingerprints(surfaces),group=new T.Group();
addSurfaceBatches(group,surfaces,new T.MeshStandardMaterial());
assert.deepEqual(fingerprints(group.children.map(m=>m.geometry)),expected);
assert.ok(group.children.length>1);
assert.ok(group.children.every(m=>m.geometry.boundingSphere.radius<500),'subdivided surfaces have local bounds');

const indexed=new T.PlaneGeometry(900,900,3,3);indexed.rotateX(-Math.PI/2);indexed.translate(-500,5,-500);
const indexedExpected=fingerprints([indexed.toNonIndexed()]),indexedGroup=new T.Group();
addSurfaceBatches(indexedGroup,[indexed],new T.MeshStandardMaterial());
assert.deepEqual(fingerprints(indexedGroup.children.map(m=>m.geometry)),indexedExpected,'indexed water and negative cell coordinates survive batching');

const streets=await json('street-details.json'),segments=[],streetIndex=new SegmentIndex();
for(const e of streets.elements){
  const tags=roadTags(e.id,e.tags||{});
  if(!tags.highway||!e.geometry||tags.gameHidden||tags.gameArea||['sidewalk','crossing'].includes(tags.footway))continue;
  const points=e.geometry.map(project);
  for(let i=1;i<points.length;i++){const s={a:points[i-1],b:points[i]};segments.push(s);streetIndex.add(s);}
}
function scan(all,x,z){let best;for(const s of all){const p=closest(x,z,s.a,s.b);if(!best||p.d<best.d)best={...p,s};}return best;}
let nearestChecks=0;
for(const e of streets.elements){
  if(e.road||e.lat==null||!(e.tags?.amenity==='bench'||e.tags?.highway==='crossing'))continue;
  const [x,z]=project(e);
  assert.deepEqual(nearestIndexedSegment(streetIndex,segments,x,z),scan(segments,x,z));nearestChecks++;
}
const ties=[{a:[100,0],b:[100,1]},{a:[-100,0],b:[-100,1]}],tieIndex=new SegmentIndex();
ties.forEach(s=>tieIndex.add(s));
assert.equal(nearestIndexedSegment(tieIndex,ties,0,0).s,ties[0],'equal-distance ties retain source order');
assert.deepEqual(nearestIndexedSegment(tieIndex,ties,10000,10000),scan(ties,10000,10000),'isolated benches retain the full-search fallback');
assert.equal(nearestIndexedSegment(new SegmentIndex(),[],0,0),undefined);

// Report timings for inspection; do not make machine-dependent speed a CI gate.
const times={reference:[],optimized:[]};
for(let i=0;i<7;i++)for(const [name,fn] of Object.entries({reference:referenceDrape,optimized:drapeGeometry})){
  const input=plane.clone(),start=performance.now(),result=fn(input,heightAt,12);
  times[name].push(performance.now()-start);result.dispose();
}
const median=values=>values.slice(1).sort((a,b)=>a-b)[3];
console.log(JSON.stringify({exactGeometryCases:checked,preservedSurfaceTriangles:expected.length,surfaceBatches:group.children.length,unchangedNearestRoadQueries:nearestChecks,drapeMedianMs:{reference:+median(times.reference).toFixed(2),optimized:+median(times.optimized).toFixed(2)}},null,2));
