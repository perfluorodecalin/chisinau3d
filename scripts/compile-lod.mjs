import * as T from 'three';
import {heightAt,roadHeight} from '../dist/terrain.js';
import {project} from '../dist/model.js';

// Distant surfaces retain footprint and road shape, but omit walls, façades,
// markings, furniture and physics. Cells match the full world's 500 m grid.
export function createLodCompiler(){
 const cells=new Map();
 const roofMaterial=new T.MeshBasicMaterial({vertexColors:true,side:T.DoubleSide});
 const roadMaterial=new T.MeshBasicMaterial({color:'#667477',side:T.DoubleSide});
 const parkMaterial=new T.MeshBasicMaterial({color:'#385a4d',side:T.DoubleSide});
 const waterMaterial=new T.MeshBasicMaterial({color:'#3b8391',side:T.DoubleSide});
 function bucket(x,z,layer){const key=Math.floor(x/500)+','+Math.floor(z/500)+','+layer;if(!cells.has(key))cells.set(key,{positions:[],colors:[],spans:[],layer});return cells.get(key);}
 function add(cell,vertices,record){if(!vertices.length)return;cell.positions.push(...vertices);if(!record)return;
  if(cell.layer==='buildings'){const c=new T.Color().setHSL(.1+(record.id%7)*.004,.17,.65+(record.id%5)*.025);for(let i=0;i<vertices.length;i+=3)cell.colors.push(c.r,c.g,c.b);}
  const last=cell.spans.at(-1);if(last?.r===record)last.end=cell.positions.length/9;else cell.spans.push({end:cell.positions.length/9,r:record});}
 function building(poly,r){
  const shape=new T.Shape(poly.outer.map(([x,z])=>new T.Vector2(x,-z)));
  for(const hole of poly.holes)shape.holes.push(new T.Path(hole.map(([x,z])=>new T.Vector2(x,-z))));
  const geometry=new T.ShapeGeometry(shape),position=geometry.attributes.position,index=geometry.index;
  const vertices=[],y=r.base+r.height+.25;
  for(let i=0;i<(index?.count||position.count);i++){
   const v=index?index.getX(i):i;
   vertices.push(position.getX(v),y,-position.getY(v));
  }
  geometry.dispose();
  add(bucket(poly.outer[0][0],poly.outer[0][1],'buildings'),vertices,r);
 }
 function road(e,r){
  if(!e.tags.highway||e.geometry?.length<2)return;
  const points=e.geometry.map(project),half=Math.max(1,Math.min(30,r.derived.width_m/2));
  for(let i=1;i<points.length;i++){
   const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
   if(length<.01)continue;
   const ox=-dz/length*half,oz=dx/length*half;
   const ya=roadHeight(a[0],a[1],e.id)+.3,yb=roadHeight(b[0],b[1],e.id)+.3;
   const v=[a[0]-ox,ya,a[1]-oz,b[0]-ox,yb,b[1]-oz,a[0]+ox,ya,a[1]+oz,
    a[0]+ox,ya,a[1]+oz,b[0]-ox,yb,b[1]-oz,b[0]+ox,yb,b[1]+oz];
   add(bucket((a[0]+b[0])/2,(a[1]+b[1])/2,'roads'),v,r);
  }
 }
 function surface(poly,waterLevel){
  const shape=new T.Shape(poly.outer.map(([x,z])=>new T.Vector2(x,-z)));
  for(const hole of poly.holes)shape.holes.push(new T.Path(hole.map(([x,z])=>new T.Vector2(x,-z))));
  const geometry=new T.ShapeGeometry(shape),position=geometry.attributes.position,index=geometry.index,vertices=[];
  for(let i=0;i<(index?.count||position.count);i++){
   const v=index?index.getX(i):i,x=position.getX(v),z=-position.getY(v);
   vertices.push(x,(waterLevel??heightAt(x,z))+.35,z);
  }
  geometry.dispose();add(bucket(poly.outer[0][0],poly.outer[0][1],waterLevel==null?'parks':'water'),vertices,null);
 }
 function drain(){const buildings=new T.Group(),roads=new T.Group(),greens=new T.Group();
  for(const [key,c] of cells){
   const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(c.positions,3));geometry.computeBoundingSphere();
   if(c.layer==='buildings')geometry.setAttribute('color',new T.Float32BufferAttribute(c.colors,3));
   const mesh=new T.Mesh(geometry,({buildings:roofMaterial,roads:roadMaterial,parks:parkMaterial,water:waterMaterial})[c.layer]);
   if(c.spans.length)mesh.userData.spans=c.spans;
   mesh.userData.lod=true;
   mesh.userData.lodCell=key.split(',').slice(0,2).join(',');
   (c.layer==='buildings'?buildings:c.layer==='roads'?roads:greens).add(mesh);
  }
  cells.clear();return {buildings,roads,greens};
 }
 return {building,road,surface,drain};
}

export function coarseTerrain(meta){
 const group=new T.Group(),material=new T.MeshBasicMaterial({color:'#385448',side:T.DoubleSide});
 const stride=5,patch=13;
 for(let z0=0;z0<meta.nz-1;z0+=patch*stride)for(let x0=0;x0<meta.nx-1;x0+=patch*stride){
  const xs=[],zs=[];for(let x=x0;x<Math.min(meta.nx-1,x0+patch*stride);x+=stride)xs.push(x);xs.push(Math.min(meta.nx-1,x0+patch*stride));
  for(let z=z0;z<Math.min(meta.nz-1,z0+patch*stride);z+=stride)zs.push(z);zs.push(Math.min(meta.nz-1,z0+patch*stride));
  const positions=[],indices=[];for(const z of zs)for(const x of xs){const X=meta.xmin+x*meta.step,Z=meta.zmin+z*meta.step;positions.push(X,heightAt(X,Z)-.5,Z);}
  for(let z=0;z<zs.length-1;z++)for(let x=0;x<xs.length-1;x++){const k=z*xs.length+x;indices.push(k,k+xs.length,k+1,k+1,k+xs.length,k+xs.length+1);}
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeBoundingSphere();
  const mesh=new T.Mesh(geometry,material);mesh.userData.lod=true;group.add(mesh);
 }
 return group;
}
