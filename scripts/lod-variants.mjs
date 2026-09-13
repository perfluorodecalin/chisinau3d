import * as T from 'three';

// Visual variants are generated from the already compiled meshes. They never
// receive physics, picking records, or other simulation data. A terrain patch
// is treated specially so its shared edge samples survive every reduction.
export const VISUAL_LEVELS=[
 {level:'near',maxDistance:250,stride:1},
 {level:'middle',maxDistance:900,stride:2},
 {level:'far',maxDistance:null,stride:4}
];

export function terrainLodStride(stride,step=20){return Math.max(1,Math.round(stride*20/Math.max(.001,step)));}

const key=(x,z)=>`${Math.round(x*1000)},${Math.round(z*1000)}`;

function terrainGeometry(source,stride){
 const position=source.getAttribute('position');
 if(!position||position.count<9)return null;
 const xs=[...new Set(Array.from({length:position.count},(_,i)=>Math.round(position.getX(i)*1000)))].sort((a,b)=>a-b);
 const zs=[...new Set(Array.from({length:position.count},(_,i)=>Math.round(position.getZ(i)*1000)))].sort((a,b)=>a-b);
 if(xs.length*zs.length!==position.count||xs.length<2||zs.length<2)return null;
 const lookup=new Map();
 for(let i=0;i<position.count;i++)lookup.set(key(position.getX(i),position.getZ(i)),i);
 const xi=[];for(let i=0;i<xs.length;i+=stride)xi.push(i);if(xi.at(-1)!==xs.length-1)xi.push(xs.length-1);
 const zi=[];for(let i=0;i<zs.length;i+=stride)zi.push(i);if(zi.at(-1)!==zs.length-1)zi.push(zs.length-1);
 const sourceNormal=source.getAttribute('normal'),pos=[],normals=[],index=[],vertices=new Map();
 function vertex(x,z){
  const id=lookup.get(key(xs[x]/1000,zs[z]/1000));
  if(vertices.has(id))return vertices.get(id);
  const n=pos.length/3;vertices.set(id,n);
  for(let k=0;k<3;k++)pos.push(position.array[id*3+k]);
  if(sourceNormal)for(let k=0;k<3;k++)normals.push(sourceNormal.array[id*3+k]);
  return n;
 }
 // Emit the coarse lattice first; error measurement can query it directly.
 const grid=zi.map(z=>xi.map(x=>vertex(x,z)));
 for(let z=0;z<zi.length-1;z++)for(let x=0;x<xi.length-1;x++){
  const x0=xi[x],x1=xi[x+1],z0=zi[z],z1=zi[z+1];
  const a=grid[z][x],b=grid[z+1][x],c=grid[z][x+1],d=grid[z+1][x+1];
  const left=x===0,right=x===xi.length-2,top=z===0,bottom=z===zi.length-2;
  if(!left&&!right&&!top&&!bottom){index.push(a,b,c,c,b,d);continue;}
  // Stitch only exterior edges to native samples. Each boundary cell is a
  // convex polygon triangulated around its center, so no internal T-junctions
  // or full-resolution bands are needed. Adjacent coarse cells share edges.
  const perimeter=[a];
  if(left)for(let j=z0+1;j<z1;j++)perimeter.push(vertex(x0,j));
  perimeter.push(b);
  if(bottom)for(let i=x0+1;i<x1;i++)perimeter.push(vertex(i,z1));
  perimeter.push(d);
  if(right)for(let j=z1-1;j>z0;j--)perimeter.push(vertex(x1,j));
  perimeter.push(c);
  if(top)for(let i=x1-1;i>x0;i--)perimeter.push(vertex(i,z0));
  if(perimeter.length===4){index.push(a,b,c,c,b,d);continue;}
  const center=pos.length/3;
  // The center lies on the original coarse diagonal. Copy/interpolate source
  // normals; recomputing per-patch normals would introduce lighting seams.
  for(let k=0;k<3;k++)pos.push((pos[b*3+k]+pos[c*3+k])/2);
  if(sourceNormal){const normal=[0,1,2].map(k=>(normals[b*3+k]+normals[c*3+k])/2),length=Math.hypot(...normal)||1;normals.push(...normal.map(v=>v/length));}
  for(let i=0;i<perimeter.length;i++)index.push(center,perimeter[i],perimeter[(i+1)%perimeter.length]);
 }
 const out=new T.BufferGeometry();out.setAttribute('position',new T.Float32BufferAttribute(pos,3));
 if(sourceNormal)out.setAttribute('normal',new T.Float32BufferAttribute(normals,3));
 out.setIndex(index);out.computeBoundingBox();out.computeBoundingSphere();
 out.userData.terrainGrid={xs:xi.map(i=>xs[i]/1000),zs:zi.map(i=>zs[i]/1000),indices:grid};
 return out;
}

function genericGeometry(source,stride){
 const position=source.getAttribute('position'),index=source.index;
 if(!position)return null;
 const triangles=index?Math.floor(index.count/3):Math.floor(position.count/3);
 if(triangles<4||stride<=1)return source.clone();
 // Evenly sample triangles. Keeping a deterministic prefix/suffix prevents
 // small meshes and caps from disappearing completely at a distant level.
 const wanted=Math.max(2,Math.ceil(triangles/stride)),selected=[];
 for(let n=0;n<wanted;n++)selected.push(Math.min(triangles-1,Math.floor(n*triangles/wanted)));
 const attributes=Object.entries(source.attributes),out=new T.BufferGeometry();
 const arrays=new Map(attributes.map(([name,a])=>[name,new a.array.constructor(selected.length*3*a.itemSize)]));
 selected.forEach((triangle,n)=>{for(let vertex=0;vertex<3;vertex++){
   const sourceIndex=index?index.getX(triangle*3+vertex):triangle*3+vertex;
   for(const [name,a] of attributes){const array=arrays.get(name),base=(n*3+vertex)*a.itemSize;for(let k=0;k<a.itemSize;k++)array[base+k]=a.array[sourceIndex*a.itemSize+k];}
 }});
 for(const [name,a] of attributes)out.setAttribute(name,new T.BufferAttribute(arrays.get(name),a.itemSize,a.normalized));
 out.computeBoundingBox();out.computeBoundingSphere();return out;
}

export function reduceGeometry(source,stride,{terrain=false}={}){
 if(stride<=1)return source.clone();
 return terrain?terrainGeometry(source,stride):genericGeometry(source,stride);
}

export function makeVisualMesh(source,geometry){
 if(!geometry)return null;
 let result;
 if(source.isInstancedMesh){
   result=new T.InstancedMesh(geometry,source.material,source.count);
   result.instanceMatrix=new T.InstancedBufferAttribute(new source.instanceMatrix.array.constructor(source.instanceMatrix.array),16);
   result.computeBoundingSphere();
 }else result=new T.Mesh(geometry,source.material);
 result.matrix.copy(source.matrix);result.matrixAutoUpdate=false;result.userData={...source.userData};return result;
}

function bytesForGeometry(g){let bytes=0;for(const a of Object.values(g.attributes))bytes+=a.array.byteLength;if(g.index)bytes+=g.index.array.byteLength;return bytes;}
export function visualStats(meshes){
 let triangles=0,instances=0,decodedBytes=0;
 for(const mesh of meshes){const g=mesh.geometry,count=g.index?g.index.count:g.getAttribute('position')?.count||0;const multiplier=mesh.isInstancedMesh?mesh.count:1;triangles+=count/3*multiplier;instances+=mesh.isInstancedMesh?mesh.count:0;decodedBytes+=bytesForGeometry(g)+(mesh.isInstancedMesh?mesh.instanceMatrix.array.byteLength:0);}
 return {triangles,instances,decodedBytes};
}

function terrainError(source,variant){
 const a=source.getAttribute('position'),b=variant.getAttribute('position');if(!a||!b)return {max:0,rms:0};
 const grid=variant.userData.terrainGrid;
 const bx=grid?.xs??[...new Set(Array.from({length:b.count},(_,i)=>b.getX(i)))].sort((x,y)=>x-y),bz=grid?.zs??[...new Set(Array.from({length:b.count},(_,i)=>b.getZ(i)))].sort((x,y)=>x-y);
 const nearest=(values,value)=>{let lo=0,hi=values.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(values[mid]<value)lo=mid+1;else hi=mid;}return lo&&Math.abs(values[lo-1]-value)<Math.abs(values[lo]-value)?lo-1:lo;};
 let max=0,sum=0;
 for(let i=0;i<a.count;i++){const j=nearest(bx,a.getX(i)),k=nearest(bz,a.getZ(i));
   let best=Infinity;for(const zz of [Math.max(0,k-1),k,Math.min(bz.length-1,k+1)])for(const xx of [Math.max(0,j-1),j,Math.min(bx.length-1,j+1)]){const ci=grid?.indices[zz][xx]??zz*bx.length+xx;if(ci>=b.count)continue;const dx=a.getX(i)-b.getX(ci),dy=a.getY(i)-b.getY(ci),dz=a.getZ(i)-b.getZ(ci);best=Math.min(best,Math.hypot(dx,dy,dz));}
   const error=best;max=Math.max(max,error);sum+=error*error;}
 return {max,rms:Math.sqrt(sum/a.count)};
}

// Error is a conservative geometric distance for terrain (the same metric is
// useful to the runtime projected-error policy). For other layers we expose a
// deterministic upper bound based on the source bounding sphere.
export function variantError(source,variant,{terrain=false}={}){
 if(terrain)return terrainError(source,variant);
 const radius=source.boundingSphere?.radius||source.getBoundingSphere?.()?.radius||0;
 return {max:radius,rms:radius};
}
