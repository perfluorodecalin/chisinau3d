import {inside} from './model.js';
export function closest(x,z,a,b){const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));return {x:a[0]+dx*t,z:a[1]+dz*t,d:Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t)};}
export class CollisionMap{
 constructor(){this.cells=new Map();}
 add(poly){const r=poly.outer,xs=r.map(p=>p[0]),zs=r.map(p=>p[1]);for(let x=Math.floor(Math.min(...xs)/50);x<=Math.floor(Math.max(...xs)/50);x++)for(let z=Math.floor(Math.min(...zs)/50);z<=Math.floor(Math.max(...zs)/50);z++){const k=x+','+z;if(!this.cells.has(k))this.cells.set(k,[]);this.cells.get(k).push(poly);}}
 blocked(x,z,r=1.1,y=null){const found=new Set();for(let i=Math.floor((x-r)/50);i<=Math.floor((x+r)/50);i++)for(let j=Math.floor((z-r)/50);j<=Math.floor((z+r)/50);j++)for(const p of this.cells.get(i+','+j)||[])found.add(p);for(const p of found){if(y!==null&&((p.maxY??Infinity)<y+.1||(p.minY??-Infinity)>y+1.8))continue;if(inside([x,z],p.outer)&&!p.holes.some(h=>inside([x,z],h)))return true;for(const ring of [p.outer,...p.holes])for(let i=1;i<ring.length;i++)if(closest(x,z,ring[i-1],ring[i]).d<r)return true;}return false;}
}
export function stepCar(s,input,dt,blocked){dt=Math.min(dt,.04);const brake=input.brake?18:0;const acc=input.forward?7:input.reverse?-5:0;s.speed+=acc*dt;if(!acc||brake){const drag=(brake||1.4)+.008*s.speed*s.speed;s.speed=Math.sign(s.speed)*Math.max(0,Math.abs(s.speed)-drag*dt);}s.speed=Math.max(-8,Math.min(30,s.speed));s.steer+=(input.steer-s.steer)*Math.min(1,dt*9);const heading=s.heading+s.steer*s.speed/2.7*Math.tan(.46/(1+Math.abs(s.speed)*.07))*dt;const x=s.x+Math.sin(heading)*s.speed*dt,z=s.z+Math.cos(heading)*s.speed*dt;let hit=false;for(const offset of [-1.35,0,1.35])if(blocked(x+Math.sin(heading)*offset,z+Math.cos(heading)*offset)){hit=true;break;}if(hit)s.speed=0;else {s.x=x;s.z=z;s.heading=heading;}return hit;}

// Bound catch-up after a stall, but keep normal driving independent of render FPS.
export class FixedStepper{
 constructor(){this.accumulator=0;}
 reset(){this.accumulator=0;}
 advance(dt,step){this.accumulator+=Math.max(0,Math.min(dt,.2));let count=0;while(this.accumulator>=1/60-1e-9&&count<12){step(1/60);this.accumulator-=1/60;count++;}return count;}
}
