import assert from 'node:assert/strict';
import * as T from 'three';
import {VISUAL_LEVELS,terrainLodStride,reduceGeometry,visualStats,variantError} from '../scripts/lod-variants.mjs';

// A regular patch models the shape emitted by dist/terrain.js. Every reduced
// level must retain the exact x/z boundary samples for seamless neighbors.
function patchGeometry(nx=9,nz=7,spacing=20){
 const p=[],i=[];for(let z=0;z<nz;z++)for(let x=0;x<nx;x++)p.push(x*spacing,Math.sin(x*.3)+Math.cos(z*.4),z*spacing);
 for(let z=0;z<nz-1;z++)for(let x=0;x<nx-1;x++){const a=z*nx+x,b=a+nx,c=a+1,d=b+1;i.push(a,b,c,c,b,d);}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setIndex(i);g.computeVertexNormals();return g;
}
const source=patchGeometry(),middle=reduceGeometry(source,2,{terrain:true}),far=reduceGeometry(source,4,{terrain:true});
assert.ok(middle.index.count<source.index.count&&far.index.count<middle.index.count,'terrain LOD reduces triangles');
const boundary=(g,x,z)=>Array.from({length:g.getAttribute('position').count},(_,n)=>[g.getAttribute('position').getX(n),g.getAttribute('position').getZ(n)]).some(p=>p[0]===x&&p[1]===z);
for(const g of [middle,far])for(const [x,z] of [[0,0],[160,0],[0,120],[160,120]])assert.ok(boundary(g,x,z),'terrain corner retained');
assert.ok(variantError(source,middle,{terrain:true}).max>0);
assert.ok(visualStats([new T.Mesh(middle)]).decodedBytes>0);
assert.deepEqual(VISUAL_LEVELS.map(v=>v.level),['near','middle','far']);
source.dispose();middle.dispose();far.dispose();

// Nonlinear heights and irregular last patches expose cracks hidden by a
// corners-only check. Verify every exterior segment, normals, winding, area,
// manifold interior edges, and a decreasing triangle budget at actual strides.
for(const [nx,nz] of [[65,65],[57,43],[257,257],[257,89]]){
 const fine=patchGeometry(nx,nz,5),fp=fine.attributes.position,fn=fine.attributes.normal;
 const sourceVertices=new Map();for(let i=0;i<fp.count;i++)sourceVertices.set(`${fp.getX(i)},${fp.getZ(i)}`,i);
 const exterior=(x,z)=>x===0||z===0||x===(nx-1)*5||z===(nz-1)*5;
 let previous=fine.index.count;
 for(const stride of [terrainLodStride(2,5),terrainLodStride(4,5)]){
  assert.ok(stride===8||stride===16);
  const reduced=reduceGeometry(fine,stride,{terrain:true}),p=reduced.attributes.position,n=reduced.attributes.normal,indices=reduced.index.array;
  assert.ok(indices.length<previous,'coarser native 5 m levels reduce triangles');previous=indices.length;
  const edges=new Map(),seen=new Set();let area=0;
  for(let i=0;i<indices.length;i+=3){
   const [a,b,c]=indices.slice(i,i+3),cross=(p.getZ(b)-p.getZ(a))*(p.getX(c)-p.getX(a))-(p.getX(b)-p.getX(a))*(p.getZ(c)-p.getZ(a));
   assert.ok(cross>0,'upward nondegenerate triangle');area+=cross/2;
   for(const [u,v] of [[a,b],[b,c],[c,a]]){const k=u<v?`${u},${v}`:`${v},${u}`;edges.set(k,(edges.get(k)||0)+1);}
  }
  assert.equal(area,(nx-1)*(nz-1)*25,'complete patch coverage without overlap');
  for(let i=0;i<p.count;i++)if(exterior(p.getX(i),p.getZ(i))){
   const key=`${p.getX(i)},${p.getZ(i)}`,j=sourceVertices.get(key);assert.notEqual(j,undefined);seen.add(key);
   assert.equal(p.getY(i),fp.getY(j));for(let k=0;k<3;k++)assert.equal(n.array[i*3+k],fn.array[j*3+k],'boundary normals match near terrain');
  }
  for(let i=0;i<fp.count;i++)if(exterior(fp.getX(i),fp.getZ(i)))assert.ok(seen.has(`${fp.getX(i)},${fp.getZ(i)}`),'every original edge vertex is retained');
  for(const [key,count] of edges){
   assert.ok(count===1||count===2,'manifold edge');if(count===2)continue;
   const [a,b]=key.split(',').map(Number);
   assert.ok(exterior(p.getX(a),p.getZ(a))&&exterior(p.getX(b),p.getZ(b)),'no unstitched interior edges');
   assert.equal(Math.hypot(p.getX(a)-p.getX(b),p.getZ(a)-p.getZ(b)),5,'native boundary segments');
  }
  const error=variantError(fine,reduced,{terrain:true});assert.ok(Number.isFinite(error.max)&&Number.isFinite(error.rms));
  const grid=reduced.userData.terrainGrid;assert.equal(grid.xs[1]-grid.xs[0],stride*5,'40 m / 80 m coarse lattice');
  reduced.dispose();
 }
 fine.dispose();
}
console.log('LOD compiler variants preserve all terrain boundary segments and reduce geometry');
