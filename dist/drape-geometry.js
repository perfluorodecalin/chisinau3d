import * as T from 'three';

// Keep subdivision and interpolation identical while reusing vertex scratch space.
// The extra slot caches elevation for vertices shared by the recursive triangles.
export function drapeGeometry(g,sample,maxEdge=55){
  let stride=0;
  const attributes=Object.entries(g.attributes).filter(([name])=>name!=='normal').map(([name,attribute])=>{
    const offset=stride;stride+=attribute.itemSize;
    return {name,attribute,offset,size:attribute.itemSize};
  });
  const position=attributes.find(a=>a.name==='position').offset;
  const inputCount=g.index?g.index.count:g.attributes.position.count;
  let capacity=Math.max(3,inputCount),count=0;
  for(const a of attributes)a.output=new Float32Array(capacity*a.size);
  const vertices=Array.from({length:3},()=>new Float64Array(stride+1));
  const midpoints=Array.from({length:13},()=>new Float64Array(stride+1));
  function read(vertex,index){
    for(const a of attributes){
      const source=a.attribute;
      const array=source.isInterleavedBufferAttribute?source.data.array:source.array;
      const start=source.isInterleavedBufferAttribute?index*source.data.stride+source.offset:index*a.size;
      for(let k=0;k<a.size;k++)vertex[a.offset+k]=array[start+k];
    }
    vertex[stride]=NaN;
  }
  function write(vertex){
    if(Number.isNaN(vertex[stride]))vertex[stride]=sample(vertex[position],vertex[position+2]);
    for(const a of attributes){
      const start=count*a.size;
      for(let k=0;k<a.size;k++)a.output[start+k]=a.name==='position'&&k===1?vertex[a.offset+k]+vertex[stride]:vertex[a.offset+k];
    }
    count++;
  }
  function emit(a,b,c,depth){
    const ab=Math.hypot(a[position]-b[position],a[position+2]-b[position+2]);
    const bc=Math.hypot(b[position]-c[position],b[position+2]-c[position+2]);
    const ca=Math.hypot(c[position]-a[position],c[position+2]-a[position+2]);
    const longest=Math.max(ab,bc,ca);
    if(longest>maxEdge&&depth<13){
      const edge=longest===ab?0:longest===bc?1:2;
      const from=edge===0?a:edge===1?b:c,to=edge===0?b:edge===1?c:a;
      const mid=midpoints[depth];
      for(let k=0;k<stride;k++)mid[k]=(from[k]+to[k])/2;
      mid[stride]=NaN;
      if(edge===0){emit(a,mid,c,depth+1);emit(mid,b,c,depth+1);}
      else if(edge===1){emit(a,b,mid,depth+1);emit(a,mid,c,depth+1);}
      else{emit(a,b,mid,depth+1);emit(mid,b,c,depth+1);}
      return;
    }
    if(count+3>capacity){
      capacity=Math.max(count+3,capacity*2);
      for(const attribute of attributes){const expanded=new Float32Array(capacity*attribute.size);expanded.set(attribute.output);attribute.output=expanded;}
    }
    write(a);write(b);write(c);
  }
  for(let i=0;i<inputCount;i+=3){
    for(let j=0;j<3;j++)read(vertices[j],g.index?g.index.getX(i+j):i+j);
    emit(...vertices,0);
  }
  const result=new T.BufferGeometry();
  for(const a of attributes)result.setAttribute(a.name,new T.BufferAttribute(a.output.slice(0,count*a.size),a.size));
  result.computeVertexNormals();g.dispose();return result;
}
