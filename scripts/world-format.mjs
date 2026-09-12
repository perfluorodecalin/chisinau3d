import {WORLD_VERSION} from '../dist/world-format.js';

export function encodeChunk(meshes,physics,materialId){
 const parts=[],geometries=[],geometryIds=new Map();let offset=0;
 function attribute(a){
  const pad=(4-offset%4)%4;if(pad){parts.push(Buffer.alloc(pad));offset+=pad;}
  const bytes=Buffer.from(a.array.buffer,a.array.byteOffset,a.array.byteLength);
  const result={type:a.array.constructor.name,offset,length:a.array.length,itemSize:a.itemSize,normalized:a.normalized};
  parts.push(bytes);offset+=bytes.length;return result;
 }
 const sphere=s=>({center:s.center.toArray(),radius:s.radius});
 const objects=meshes.map(m=>{
  const g=m.geometry;
  if(!geometryIds.has(g)){
   g.computeBoundingBox();if(!g.boundingSphere)g.computeBoundingSphere();
   geometryIds.set(g,geometries.length);
   geometries.push({attributes:Object.fromEntries(Object.entries(g.attributes).map(([k,a])=>[k,attribute(a)])),index:g.index?attribute(g.index):null,sphere:sphere(g.boundingSphere),box:{min:g.boundingBox.min.toArray(),max:g.boundingBox.max.toArray()}});
  }
  if(m.matrixAutoUpdate)m.updateMatrix();
  return {geometry:geometryIds.get(g),material:materialId(m.material),matrix:m.matrix.toArray(),userData:m.userData,instances:m.isInstancedMesh?attribute(m.instanceMatrix):null,sphere:m.isInstancedMesh?sphere(m.boundingSphere):null};
 });
 // JSON null represents an unbounded interval; CollisionMap already uses ?? Infinity.
 const json=Buffer.from(JSON.stringify({version:WORLD_VERSION,geometries,meshes:objects,physics}));
 const prefix=Buffer.alloc((8+json.length+3)&~3);prefix.writeUInt32LE(0x43495459);prefix.writeUInt32LE(json.length,4);json.copy(prefix,8);
 return Buffer.concat([prefix,...parts]);
}
