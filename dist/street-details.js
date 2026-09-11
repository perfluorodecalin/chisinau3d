import {spatialBatches,SegmentIndex,nearestIndexedSegment} from './spatial.js';
import {addSurfaceBatches} from './surface-batches.js';
import {yieldToBrowser} from './loading.js';
import {roadTags} from './road-model.js';
import * as T from 'three';
import {heightAt,drapeGeometry,roadHeight,isElevated} from './terrain.js';
import {roadWidth} from './realism.js';
import {project,metres} from './model.js';
import {closest} from './driving-physics.js';

const widths={motorway:20,trunk:17,primary:14,secondary:11,tertiary:9,residential:6,living_street:5,service:4};
export function marked(t){return t['crossing:markings']!=='no'&&(!!t['crossing:markings']||/^(zebra|marked)$/.test(t.crossing));}
export function zebra(t){return /zebra/.test(t['crossing:markings']||'')||t.crossing==='zebra';}
export async function addStreetDetails(scene,driving,extra={}){
 const response=await fetch('./data/street-details.json');if(!response.ok)throw Error('Street details unavailable');const data=await response.json(),group=new T.Group();scene.add(group);
 const trunks=[],crowns=[],conifers=[],benchSeats=[],benchBacks=[],benchLegs=[],pavement=[],elevatedPavement=[],paint=[],crossLines=[],treePositions=[],treeGrid=new Map();const roadSegments=[],crossPaths=[];
 const dummy=new T.Object3D();const mat=(c)=>new T.MeshStandardMaterial({color:c,roughness:.9});
 const roadIndex=new SegmentIndex();
 function instance(geometry,material,list){for(const part of spatialBatches(list)){const m=new T.InstancedMesh(geometry,material,part.length);part.forEach((o,i)=>{dummy.position.set(o.p[0],o.p[1]+heightAt(o.p[0],o.p[2]),o.p[2]);dummy.rotation.set(0,o.r||0,0);dummy.scale.set(...o.s);dummy.updateMatrix();m.setMatrixAt(i,dummy.matrix);});m.computeBoundingSphere();m.matrixAutoUpdate=false;group.add(m);}}
 function strip(a,b,width,y,list,id=null){const dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len<.01)return;const nx=-dz/len*width/2,nz=dx/len*width/2;const coords=[a[0]+nx,y,a[1]+nz,a[0]-nx,y,a[1]-nz,b[0]+nx,y,b[1]+nz,b[0]+nx,y,b[1]+nz,a[0]-nx,y,a[1]-nz,b[0]-nx,y,b[1]-nz];if(id!==null&&isElevated(id)){for(let i=0;i<coords.length;i+=3)coords[i+1]+=roadHeight(coords[i],coords[i+2],id);elevatedPavement.push(...coords);}else list.push(...coords);}
 function obstacle(x,z,r,height=2){driving.addBuilding({outer:[[x-r,z-r],[x+r,z-r],[x+r,z+r],[x-r,z+r],[x-r,z-r]],holes:[]},0,height);}
 function addTree(p,t,id,row=false){const [x,z]=p,h=Math.max(2,Math.min(35,metres(t.height)||7+(id%5))),diam=Math.max(1.5,Math.min(18,metres(t.diameter_crown)||h*.55)),needle=t.leaf_type==='needleleaved';trunks.push({p:[x,h*.3,z],s:[.2,h*.6,.2]});(needle?conifers:crowns).push({p:[x,h*.6,z],s:[diam*.5,h*.4,diam*.5],r:(id%10)*.6});obstacle(x,z,.25,h);if(!row){const k=Math.floor(x/4)+','+Math.floor(z/4);if(!treeGrid.has(k))treeGrid.set(k,[]);treeGrid.get(k).push([x,z]);}}
 for(const e of data.elements){const t=roadTags(e.id,{...(e.tags||{}),...(extra[e.id]||{})});if(t.gameHidden||t.gameArea)continue;if(t.highway&&e.geometry){const p=e.geometry.map(project);if(t.footway==='crossing'){crossPaths.push({p,t});continue;}for(let i=1;i<p.length;i++){
 const a=p[i-1],b=p[i];if(t.footway==='sidewalk'){strip(a,b,Math.max(1,Math.min(6,metres(t.width)||2)),.22,pavement,e.id);continue;}
 const segment={a,b,width:roadWidth(t)};roadSegments.push(segment);roadIndex.add(segment);const dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(!len)continue;const w=roadWidth(t),sw=Math.max(1,Math.min(5,metres(t['sidewalk:width'])||1.8));
 for(const [side,sign] of [['left',1],['right',-1]]){const explicit=t['sidewalk:'+side];const present=explicit==='yes'||(!explicit&&(t['sidewalk:both']==='yes'||t.sidewalk==='both'||t.sidewalk===side||t.sidewalk==='yes'));if(!present)continue;const off=(w+sw)/2*sign;const n=[dz/len*off,-dx/len*off];strip([a[0]+n[0],a[1]+n[1]],[b[0]+n[0],b[1]+n[1]],sw,.22,pavement,e.id);}
 }}
 if(t.natural==='tree'&&e.lat!=null)addTree(project(e),t,e.id);
 }
 function crossing(p,t){if(!marked(t)||p.length<2)return;const total=p.slice(1).reduce((s,b,i)=>s+Math.hypot(b[0]-p[i][0],b[1]-p[i][1]),0);if(total<1||total>100)return;const w=Math.max(1.5,Math.min(8,metres(t['crossing:width'])||metres(t.width)||3));let traveled=0;for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!len)continue;const dx=(b[0]-a[0])/len,dz=(b[1]-a[1])/len;if(zebra(t)){for(let d=Math.ceil(traveled/1.1)*1.1-traveled;d<len;d+=1.1)strip([a[0]+dx*d,a[1]+dz*d],[a[0]+dx*Math.min(d+.55,len),a[1]+dz*Math.min(d+.55,len)],w,.27,paint);}else{for(const sign of [-1,1]){const off=w/2*sign;strip([a[0]-dz*off,a[1]+dx*off],[b[0]-dz*off,b[1]+dx*off],.16,.27,paint);}}traveled+=len;}}
 for(const c of crossPaths)crossing(c.p,c.t);
 function nearest(x,z){return nearestIndexedSegment(roadIndex,roadSegments,x,z);}
 for(const e of data.elements){const t=roadTags(e.id,{...(e.tags||{}),...(extra[e.id]||{})});if(t.gameHidden||t.gameArea)continue;if(e.lat!=null&&t.amenity==='bench'){const [x,z]=project(e),near=e.road||nearest(x,z),num=parseFloat(t.direction);const angle=Number.isFinite(num)?Math.PI-num*Math.PI/180:near?Math.atan2(near.s.b[0]-near.s.a[0],near.s.b[1]-near.s.a[1])+Math.PI/2:0;const width=Math.max(1.2,Math.min(3,(parseFloat(t.seats)||3)*.55));benchSeats.push({p:[x,.65,z],s:[width,.14,.5],r:angle});if(t.backrest!=='no')benchBacks.push({p:[x-Math.sin(angle)*.22,1,z-Math.cos(angle)*.22],s:[width,.6,.1],r:angle});for(const side of [-1,1])benchLegs.push({p:[x+Math.cos(angle)*width*.34*side,.37,z-Math.sin(angle)*width*.34*side],s:[.1,.56,.42],r:angle});obstacle(x,z,.5);}
 if(e.lat!=null&&t.highway==='crossing'&&marked(t)){const p=project(e);if(crossPaths.some(c=>c.p.slice(1).some((b,i)=>closest(...p,c.p[i],b).d<6)))continue;const n=e.road||nearest(...p);if(!n||n.d>15)continue;const len=Math.hypot(n.s.b[0]-n.s.a[0],n.s.b[1]-n.s.a[1]),nx=-(n.s.b[1]-n.s.a[1])/len,nz=(n.s.b[0]-n.s.a[0])/len,w=n.s.width/2;crossing([[n.x-nx*w,n.z-nz*w],[n.x+nx*w,n.z+nz*w]],t);}
 if(t.natural==='tree_row'&&e.geometry){const ps=e.geometry.map(project);let dist=0;for(let i=1;i<ps.length;i++){const a=ps[i-1],b=ps[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!len)continue;for(let d=dist;d<len;d+=8){const p=[a[0]+(b[0]-a[0])*d/len,a[1]+(b[1]-a[1])*d/len];let close=false;for(let xx=Math.floor(p[0]/4)-1;xx<=Math.floor(p[0]/4)+1;xx++)for(let zz=Math.floor(p[1]/4)-1;zz<=Math.floor(p[1]/4)+1;zz++)if((treeGrid.get(xx+','+zz)||[]).some(q=>Math.hypot(q[0]-p[0],q[1]-p[1])<4))close=true;if(!close)addTree(p,t,e.id+i,true);}dist=(dist-len)%8;if(dist<0)dist+=8;}}
 }
 instance(new T.CylinderGeometry(1,1,1,6),mat('#77553c'),trunks);instance(new T.IcosahedronGeometry(1,1),mat('#42764d'),crowns);instance(new T.ConeGeometry(1,2,7),mat('#315f4c'),conifers);const cube=new T.BoxGeometry(1,1,1);instance(cube,mat('#b38654'),benchSeats);instance(cube,mat('#b38654'),benchBacks);instance(cube,mat('#354349'),benchLegs);
 for(const [positions,color] of [[pavement,'#aaa99b'],[elevatedPavement,'#aaa99b'],[paint,'#f0edda']])if(positions.length){let g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g=drapeGeometry(g,positions===elevatedPavement?()=>0:heightAt,12);addSurfaceBatches(group,[g],new T.MeshStandardMaterial({color,side:T.DoubleSide,roughness:1}));await yieldToBrowser();}
 return {group,trees:trunks.length,benches:benchSeats.length};
}
