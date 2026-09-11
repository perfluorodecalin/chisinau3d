import * as T from 'three';
import {project} from './model.js';
let profiles={};
export async function loadRoadModel(){const response=await fetch('./data/road-model.json');if(!response.ok)throw Error('Road profiles unavailable');profiles=(await response.json()).profiles;}
export function roadProfile(id){return profiles[id];}
export function roadTags(id,t){const p=t.highway&&t.highway!=='crossing'?profiles[id]:null;return p?{...t,...p.tags,gameWidth:p.width,gameArea:p.area,gameHidden:p.hidden,gameOneway:p.oneway}:t;}
export function ribbonPositions(points,width,y=.13,joins={}){
 const pos=[],samples=[];if(points.length<2)return pos;
 const widths=points.map((p,i)=>joins[i]?.junction?width:(joins[i]?.width||width));
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<.001)continue;
  const steps=Math.max(1,Math.ceil(len/10));
  for(let j=0;j<steps;j++){const t=j/steps,d=len*t;const w=width+(widths[i-1]-width)*Math.max(0,1-d/Math.min(20,len/2))+(widths[i]-width)*Math.max(0,1-(len-d)/Math.min(20,len/2));samples.push({p:[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],w});}
 }
 samples.push({p:points.at(-1),w:widths.at(-1)});
 const edges=samples.map(({p,w},i)=>{
  const a=samples[Math.max(0,i-1)].p,b=samples[Math.min(samples.length-1,i+1)].p;
  let dx=p[0]-a[0],dz=p[1]-a[1],l=Math.hypot(dx,dz);if(!l){dx=b[0]-p[0];dz=b[1]-p[1];l=Math.hypot(dx,dz)||1;}const n1=[-dz/l,dx/l];
  dx=b[0]-p[0];dz=b[1]-p[1];l=Math.hypot(dx,dz);const n2=l?[-dz/l,dx/l]:n1;
  let nx=n1[0]+n2[0],nz=n1[1]+n2[1],nl=Math.hypot(nx,nz);if(nl<.01){nx=n1[0];nz=n1[1];nl=1;}nx/=nl;nz/=nl;
  const reach=Math.min(w, w/2/Math.max(.1,nx*n1[0]+nz*n1[1]));return [[p[0]+nx*reach,y,p[1]+nz*reach],[p[0]-nx*reach,y,p[1]-nz*reach]];
 });
 for(let i=1;i<edges.length;i++){const [a,b]=edges[i-1],[c,d]=edges[i];pos.push(...a,...b,...c,...c,...b,...d);}
 // Overlapping round caps cover the wedges between ways at real shared nodes.
 for(const [i,j] of Object.entries(joins)){if(!j.cap)continue;const p=points[+i];if(!p)continue;for(let k=0;k<12;k++){const a=k*Math.PI/6,b=(k+1)*Math.PI/6;pos.push(p[0],y,p[1],p[0]+Math.cos(a)*(j.junction?width:widths[+i])/2,y,p[1]+Math.sin(a)*(j.junction?width:widths[+i])/2,p[0]+Math.cos(b)*(j.junction?width:widths[+i])/2,y,p[1]+Math.sin(b)*(j.junction?width:widths[+i])/2);}}
 return pos;
}
export function roadPositions(e,width){
 const p=e.geometry.map(project),profile=profiles[e.id];
 if(e.tags.gameArea||e.tags.area==='yes'){
  const contour=p.map(p=>new T.Vector2(...p)),tri=T.ShapeUtils.triangulateShape(contour,[]),pos=[];
  for(const indices of tri)for(const i of indices)pos.push(p[i][0],.13,p[i][1]);return pos;
 }
 return ribbonPositions(p,width,e.tags.waterway?.08:.13,profile?.joins);
}
export function nearJunction(e,index,distance,len){const p=profiles[e.id],j=p?.joins;const clearance=q=>q?(q.junction?q.radius+3:Math.abs(q.width-p.width)>.1?20:0):0;return distance<clearance(j?.[index-1])||len-distance<clearance(j?.[index]);}
