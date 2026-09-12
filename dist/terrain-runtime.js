import {closest} from './driving-physics.js';
let meta=null,values=null,profiles={},waterLevels={},segments=new Map();
export function configureWater(levels){waterLevels=levels;}
export function terrainProfile(id){return profiles[id];}
export function configureTerrain(m,v,p={}){meta=m;values=v;profiles=p;segments=new Map();for(const [id,profile] of Object.entries(p)){for(let i=1;i<profile.points.length;i++){const a=profile.points[i-1],b=profile.points[i],r=profile.width/2+1;const s={a,b,id,width:profile.width,bridge:profile.bridge};for(let x=Math.floor((Math.min(a[0],b[0])-r)/50);x<=Math.floor((Math.max(a[0],b[0])+r)/50);x++)for(let z=Math.floor((Math.min(a[1],b[1])-r)/50);z<=Math.floor((Math.max(a[1],b[1])+r)/50);z++){const k=x+','+z;if(!segments.has(k))segments.set(k,[]);segments.get(k).push(s);}}}}
export function heightAt(x,z){if(!meta)return 0;const u=Math.max(0,Math.min(meta.nx-1.000001,(x-meta.xmin)/meta.step)),v=Math.max(0,Math.min(meta.nz-1.000001,(z-meta.zmin)/meta.step)),i=Math.floor(u),j=Math.floor(v),a=u-i,b=v-j,k=j*meta.nx+i;return (values[k]*(1-a)+values[k+1]*a)*(1-b)+(values[k+meta.nx]*(1-a)+values[k+meta.nx+1]*a)*b;}
function segmentSample(x,z,s){const p=closest(x,z,s.a,s.b),length=Math.hypot(s.b[0]-s.a[0],s.b[1]-s.a[1]),t=length?Math.hypot(p.x-s.a[0],p.z-s.a[1])/length:0;return {...p,y:s.a[2]+(s.b[2]-s.a[2])*t,s};}
export function roadHeight(x,z,id){const list=segments.get(Math.floor(x/50)+','+Math.floor(z/50))||[];let best;for(const s of list)if(s.id===String(id)){const p=segmentSample(x,z,s);if(!best||p.d<best.d)best=p;}return best&&best.d<=best.s.width/2+4?best.y:heightAt(x,z);}
export function driveHeight(x,z,reference=heightAt(x,z)){const ground=heightAt(x,z);let best=ground,score=Math.abs(ground-reference);for(const s of segments.get(Math.floor(x/50)+','+Math.floor(z/50))||[]){if(!/^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|service|.*_link)$/.test(profiles[s.id].highway))continue;const p=segmentSample(x,z,s);if(p.d>Math.max(.15,s.width/2-1.0))continue;const d=Math.abs(p.y-reference);if(d<score+.16){best=p.y;score=d;}}return best;}
export function waterHeight(id,poly){return waterLevels[id]??heightAt(...poly.outer[0]);}
export function isElevated(id){return !!profiles[id];}
export function buildingBase(poly){return Math.max(...poly.outer.map(p=>heightAt(...p)));}
