import assert from 'node:assert/strict';
import * as T from 'three';
import {VISUAL_LEVELS,reduceGeometry,visualStats,variantError} from '../scripts/lod-variants.mjs';

// A regular patch models the shape emitted by dist/terrain.js. Every reduced
// level must retain the exact x/z boundary samples for seamless neighbors.
function patchGeometry(nx=9,nz=7){
 const p=[],i=[];for(let z=0;z<nz;z++)for(let x=0;x<nx;x++)p.push(x*20,Math.sin(x*.3)+Math.cos(z*.4),z*20);
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
console.log('LOD compiler variants preserve terrain boundaries and reduce geometry');
