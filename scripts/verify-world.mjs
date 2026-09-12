import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import * as T from 'three';
import {decodeChunk,WORLD_VERSION} from '../dist/world-format.js';

const root=new URL('../dist/world/',import.meta.url);
const manifest=JSON.parse(await fs.readFile(new URL('manifest.json',root),'utf8'));
assert.equal(manifest.version,WORLD_VERSION);
const materials=manifest.materials.map(m=>new T.MaterialLoader().parse(m));
let meshes=0,triangles=0,buildings=0,obstacles=0,streets=0,bytes=0,terrainTriangles=0;
const ids=new Set();
for(const entry of manifest.chunks){
 assert.ok(!ids.has(entry.id));ids.add(entry.id);
 assert.ok(entry.bbox.every(Number.isFinite));assert.ok(entry.bbox[0]<=entry.bbox[2]&&entry.bbox[1]<=entry.bbox[3]);
 const compressed=await fs.readFile(new URL(entry.file,root));bytes+=compressed.length;
 const raw=gunzipSync(compressed),chunk=decodeChunk(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),materials);
 for(const mesh of chunk.meshes){
  meshes++;const g=mesh.geometry,count=g.index?g.index.count:g.attributes.position.count;
  assert.equal(count%3,0);triangles+=count/3*(mesh.isInstancedMesh?mesh.count:1);
  if(mesh.userData.layer==='terrain')terrainTriangles+=count/3;
  for(const a of Object.values(g.attributes))for(const value of a.array)assert.ok(Number.isFinite(value),'finite attribute');
  if(g.index)for(const i of g.index.array)assert.ok(i<g.attributes.position.count);
  if(mesh.isInstancedMesh)for(const v of mesh.instanceMatrix.array)assert.ok(Number.isFinite(v));
  if(mesh.userData.spans){let end=0;for(const span of mesh.userData.spans){assert.ok(span.end>end);assert.ok(Number.isFinite(span.r.height));end=span.end;buildings++;}assert.equal(end,count/3);}
  g.dispose();if(mesh.isInstancedMesh)mesh.dispose();
 }
 obstacles+=(chunk.physics.obstacles||[]).length;streets+=(chunk.physics.streets||[]).length;
}
assert.equal(terrainTriangles,(manifest.terrain.meta.nx-1)*(manifest.terrain.meta.nz-1)*2);
assert.ok(buildings>10000&&streets>10000&&obstacles>buildings);
console.log(JSON.stringify({chunks:ids.size,meshes,triangles,buildings,obstacles,streets,compressedMB:Math.round(bytes/1048576)},null,2));
