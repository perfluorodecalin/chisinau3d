// Small static spatial buckets keep proximity queries local and instance bounds useful.
export function spatialBatches(points,size=500){const cells=new Map();for(const p of points){const key=Math.floor(p.p[0]/size)+','+Math.floor(p.p[2]/size);if(!cells.has(key))cells.set(key,[]);cells.get(key).push(p);}return [...cells.values()].flatMap(ps=>{const chunks=[];for(let i=0;i<ps.length;i+=1000)chunks.push(ps.slice(i,i+1000));return chunks;});}
export class SegmentIndex{
 constructor(size=100){this.size=size;this.cells=new Map();}
 add(s){const n=this.size;for(let x=Math.floor(Math.min(s.a[0],s.b[0])/n);x<=Math.floor(Math.max(s.a[0],s.b[0])/n);x++)for(let z=Math.floor(Math.min(s.a[1],s.b[1])/n);z<=Math.floor(Math.max(s.a[1],s.b[1])/n);z++){const k=x+','+z;if(!this.cells.has(k))this.cells.set(k,[]);this.cells.get(k).push(s);}}
 near(x,z,r=100){const found=new Set(),n=this.size;for(let i=Math.floor((x-r)/n);i<=Math.floor((x+r)/n);i++)for(let j=Math.floor((z-r)/n);j<=Math.floor((z+r)/n);j++)for(const s of this.cells.get(i+','+j)||[])found.add(s);return [...found];}
}
