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
  if(mesh.userData.spans){let end=0;for(const span of mesh.userData.spans){assert.ok(span.end>end);if(mesh.userData.layer==='buildings'){assert.ok(Number.isFinite(span.r.height));buildings++;}else assert.ok(['road','bridge','waterway'].includes(span.r.kind));end=span.end;}assert.equal(end,count/3);}
  g.dispose();if(mesh.isInstancedMesh)mesh.dispose();
 }
 obstacles+=(chunk.physics.obstacles||[]).length;streets+=(chunk.physics.streets||[]).length;
}
// Visual LOD assets are independent payloads. They may carry render meshes,
// but never collision data; the canonical file above remains authoritative.
let variantsChecked=0,variantTriangles=0;
for(const entry of manifest.chunks){
 const variants=entry.visualVariants||entry.variants||[];
 if(!variants.length)continue;
 assert.equal(variants[0].file,entry.file,'near LOD must alias canonical chunk');
 assert.equal(variants.at(-1).maxDistance,null,'far LOD must be terminal');
 for(let i=1;i<variants.length;i++){
  const variant=variants[i];assert.ok(variant.file&&variant.level);
  if(i<variants.length-1)assert.ok(Number.isFinite(variant.maxDistance));else assert.equal(variant.maxDistance,null);
  assert.ok(variant.error&&Number.isFinite(variant.error.max)&&Number.isFinite(variant.error.rms));
  const compressed=await fs.readFile(new URL(variant.file,root));
  assert.equal(compressed.length,variant.compressedBytes,'variant compressed byte count');
  const raw=gunzipSync(compressed),chunk=decodeChunk(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),materials);
  assert.deepEqual(chunk.physics,{obstacles:[],streets:[]},'LOD variant must not contain physics');
  let trianglesForVariant=0,decodedForVariant=0;
  for(const mesh of chunk.meshes){
   assert.equal(mesh.userData.layer,'terrain','only terrain has generated visual variants');
   const g=mesh.geometry,count=g.index?g.index.count:g.attributes.position.count;trianglesForVariant+=count/3*(mesh.isInstancedMesh?mesh.count:1);
   for(const a of Object.values(g.attributes)){decodedForVariant+=a.array.byteLength;for(const value of a.array)assert.ok(Number.isFinite(value),'finite LOD attribute');}
   if(g.index)decodedForVariant+=g.index.array.byteLength;
   assert.ok(g.boundingBox.min.toArray().every(Number.isFinite)&&g.boundingBox.max.toArray().every(Number.isFinite));
  }
  assert.equal(trianglesForVariant,variant.triangles,'variant triangle count');assert.equal(decodedForVariant,variant.decodedBytes,'variant decoded byte count');
  variantTriangles+=trianglesForVariant;variantsChecked++;for(const mesh of chunk.meshes){mesh.geometry.dispose();if(mesh.isInstancedMesh)mesh.dispose();}
 }
}
assert.equal(terrainTriangles,(manifest.terrain.meta.nx-1)*(manifest.terrain.meta.nz-1)*2);
assert.ok(buildings>10000&&streets>10000&&obstacles>buildings);
assert.ok(manifest.lodChunks?.length>0,'citywide overview required');
let lodBuildings=0,lodRoads=0,lodTerrain=0,lodBytes=0;
for(const entry of manifest.lodChunks){
 assert.ok(entry.bbox.every(Number.isFinite));
 const compressed=await fs.readFile(new URL(entry.file,root));lodBytes+=compressed.length;
 const raw=gunzipSync(compressed),chunk=decodeChunk(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),materials);
 for(const mesh of chunk.meshes){
  assert.equal(mesh.userData.lod,true);
  if(mesh.userData.layer==='buildings')lodBuildings+=mesh.userData.spans.length;
  if(mesh.userData.layer==='roads')lodRoads+=mesh.userData.spans.length;
  if(mesh.userData.layer==='terrain')lodTerrain++;
  for(const value of mesh.geometry.attributes.position.array)assert.ok(Number.isFinite(value));
  mesh.geometry.dispose();
 }
}
assert.ok(lodBuildings>=buildings&&lodRoads>10000&&lodTerrain>0,'overview covers the whole compiled city');
console.log(JSON.stringify({chunks:ids.size,meshes,triangles,buildings,obstacles,streets,variantsChecked,variantTriangles,compressedMB:Math.round(bytes/1048576),lodChunks:manifest.lodChunks.length,lodBuildings,lodRoads,lodTerrain,lodCompressedMB:Math.round(lodBytes/1048576)},null,2));
