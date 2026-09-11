// Frozen pre-optimization algorithm: verify exact saved-world geometry, not just counts.
import * as T from 'three';
export function referenceDrape(g,sample,maxEdge=55){const src=g.index?g.toNonIndexed():g;const attributes=Object.entries(src.attributes).filter(([k])=>k!=='normal');const out=Object.fromEntries(attributes.map(([k])=>[k,[]]));
 const read=i=>Object.fromEntries(attributes.map(([k,a])=>[k,Array.from(a.array.slice(i*a.itemSize,(i+1)*a.itemSize))]));
 const mid=(a,b)=>Object.fromEntries(attributes.map(([k])=>[k,a[k].map((v,i)=>(v+b[k][i])/2)]));
 const dist=(a,b)=>Math.hypot(a.position[0]-b.position[0],a.position[2]-b.position[2]);
 function emit(a,b,c,depth){const ds=[dist(a,b),dist(b,c),dist(c,a)],m=Math.max(...ds);if(m>maxEdge&&depth<13){const i=ds.indexOf(m);if(i===0){const h=mid(a,b);emit(a,h,c,depth+1);emit(h,b,c,depth+1);}else if(i===1){const h=mid(b,c);emit(a,b,h,depth+1);emit(a,h,c,depth+1);}else{const h=mid(c,a);emit(a,b,h,depth+1);emit(h,b,c,depth+1);}return;}for(const p of [a,b,c])for(const [k] of attributes){const v=[...p[k]];if(k==='position')v[1]+=sample(v[0],v[2]);out[k].push(...v);}}
 for(let i=0;i<src.attributes.position.count;i+=3)emit(read(i),read(i+1),read(i+2),0);const result=new T.BufferGeometry();for(const [k,a] of attributes)result.setAttribute(k,new T.Float32BufferAttribute(out[k],a.itemSize));result.computeVertexNormals();if(src!==g)src.dispose();g.dispose();return result;}
