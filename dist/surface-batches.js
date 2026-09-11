import * as T from 'three';

// Partition triangles, rather than whole OSM ways, so even long roads and large
// parks have local bounds. Attributes and triangle order within each cell survive.
export function addSurfaceBatches(group,geometries,material,size=500){
  const cells=new Map();
  for(const geometry of geometries){
    const position=geometry.getAttribute('position'),index=geometry.index;
    const count=index?index.count:position.count;
    for(let i=0;i<count;i+=3){
      const a=index?index.getX(i):i,b=index?index.getX(i+1):i+1,c=index?index.getX(i+2):i+2;
      const x=(position.getX(a)+position.getX(b)+position.getX(c))/3;
      const z=(position.getZ(a)+position.getZ(b)+position.getZ(c))/3;
      const key=Math.floor(x/size)+','+Math.floor(z/size);
      if(!cells.has(key))cells.set(key,new Map());
      const cell=cells.get(key);
      if(!cell.has(geometry))cell.set(geometry,[]);
      cell.get(geometry).push(a,b,c);
    }
  }
  const meshes=[];
  for(const cell of cells.values()){
    const entries=[...cell],count=entries.reduce((sum,[,indices])=>sum+indices.length,0);
    const geometry=new T.BufferGeometry();
    const attributes=Object.entries(entries[0][0].attributes);
    for(const [name,attribute] of attributes){
      const size=attribute.itemSize,array=new attribute.array.constructor(count*size);
      let offset=0;
      for(const [source,indices] of entries){
        const input=source.getAttribute(name);
        for(const index of indices)for(let k=0;k<size;k++)array[offset++]=input.array[index*size+k];
      }
      geometry.setAttribute(name,new T.BufferAttribute(array,size,attribute.normalized));
    }
    geometry.computeBoundingSphere();
    const mesh=new T.Mesh(geometry,material);mesh.matrixAutoUpdate=false;
    group.add(mesh);meshes.push(mesh);
  }
  for(const geometry of geometries)geometry.dispose();
  return meshes;
}
