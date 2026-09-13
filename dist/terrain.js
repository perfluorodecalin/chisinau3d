import * as T from 'three';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';
import {drapeGeometry as drape} from './drape-geometry.js';
import {terrainProfile,configureTerrain,configureWater,heightAt} from './terrain-runtime.js';
export * from './terrain-runtime.js';
export function drapeGeometry(g,sample=heightAt,maxEdge=55){return drape(g,sample,maxEdge);}
export async function loadTerrain(scene){const [m,v,p,w]=await Promise.all([fetch('./data/terrain.json').then(r=>r.json()),fetch('./data/terrain.bin').then(r=>r.arrayBuffer()),fetch('./data/bridges.json').then(r=>r.json()),fetch('./data/water-levels.json').then(r=>r.json())]);configureWater(w);const values=new Float32Array(v);configureTerrain(m,values,p.profiles);const material=new T.MeshStandardMaterial({color:'#385448',roughness:1});
 // Independent ~1.28 km patches retain the full DEM but can be frustum culled.
 const patchCells=Math.max(1,Math.round(1280/m.step));
 for(let z0=0;z0<m.nz-1;z0+=patchCells)for(let x0=0;x0<m.nx-1;x0+=patchCells){
 const nx=Math.min(patchCells+1,m.nx-x0),nz=Math.min(patchCells+1,m.nz-z0),pos=new Float32Array(nx*nz*3),normals=new Float32Array(nx*nz*3),idx=[];
 for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){const X=x+x0,Z=z+z0,k=z*nx+x,global=Z*m.nx+X;pos[k*3]=m.xmin+X*m.step;pos[k*3+1]=values[global]-.18;pos[k*3+2]=m.zmin+Z*m.step;
 const left=Math.max(0,X-1),right=Math.min(m.nx-1,X+1),up=Math.max(0,Z-1),down=Math.min(m.nz-1,Z+1);const dx=(values[Z*m.nx+right]-values[Z*m.nx+left])/((right-left)*m.step),dz=(values[down*m.nx+X]-values[up*m.nx+X])/((down-up)*m.step),n=Math.hypot(dx,1,dz);normals.set([-dx/n,1/n,-dz/n],k*3);
 if(x<nx-1&&z<nz-1)idx.push(k,k+nx,k+1,k+1,k+nx,k+nx+1);}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(pos,3));g.setAttribute('normal',new T.BufferAttribute(normals,3));g.setIndex(idx);g.computeBoundingSphere();const mesh=new T.Mesh(g,material);mesh.userData.terrainStep=m.step;scene.add(mesh);}
 return {meta:m,profiles:p.profiles};}
export function bridgeStructure(id){const p=terrainProfile(id);if(!p?.bridge)return null;const group=new T.Group(),mat=new T.MeshStandardMaterial({color:'#7a807c',roughness:1}),railMat=new T.MeshStandardMaterial({color:'#9ba6a3',metalness:.4,roughness:.6});let length=0;
 function bar(a,b,width,height,material){const A=new T.Vector3(...a),B=new T.Vector3(...b),mesh=new T.Mesh(new T.BoxGeometry(width,height,A.distanceTo(B)),material);mesh.position.copy(A).add(B).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),B.sub(A).normalize());group.add(mesh);}
 for(let i=1;i<p.points.length;i++){const a=p.points[i-1],b=p.points[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(!len)continue;bar([a[0],a[2]-.5,a[1]],[b[0],b[2]-.5,b[1]],p.width+.3,1,mat);for(const sign of [-1,1]){const off=sign*(p.width/2+.1),ox=-dz/len*off,oz=dx/len*off;bar([a[0]+ox,a[2]+.85,a[1]+oz],[b[0]+ox,b[2]+.85,b[1]+oz],.12,.17,railMat);if(i%2===0)bar([a[0]+ox,a[2],a[1]+oz],[a[0]+ox,a[2]+.95,a[1]+oz],.12,.12,railMat);}length+=len;if(length>32){length=0;const h=a[2]-.9-heightAt(a[0],a[1]);if(h>1.5){const pier=new T.Mesh(new T.BoxGeometry(Math.min(2,p.width*.4),h,1.5),mat);pier.position.set(a[0],a[2]-.9-h/2,a[1]);group.add(pier);}}}const mergedGroup=new T.Group();for(const material of [mat,railMat]){const gs=group.children.filter(m=>m.material===material).map(m=>{m.updateMatrix();m.geometry.applyMatrix4(m.matrix);return m.geometry;});if(gs.length){const g=mergeGeometries(gs,false);if(g)mergedGroup.add(new T.Mesh(g,material));gs.forEach(g=>g.dispose());}}return mergedGroup;}
