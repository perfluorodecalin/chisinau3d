import * as T from 'three';

export const WORLD_VERSION=1;
const types={Float32Array,Uint32Array,Uint16Array,Uint8Array,Int32Array,Int16Array,Int8Array};

// A small JSON header describes views into an aligned, GPU-ready binary payload.
// No ObjectLoader geometry constructors, triangulation or normal generation run here.
export function decodeChunk(buffer,materials){
 const view=new DataView(buffer);
 if(view.byteLength<8||view.getUint32(0,true)!==0x43495459)throw Error('Invalid city chunk');
 const length=view.getUint32(4,true),start=(8+length+3)&~3;
 if(start>buffer.byteLength)throw Error('Truncated city chunk');
 const header=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,8,length)));
 if(header.version!==WORLD_VERSION)throw Error('Unsupported city chunk version');
 function attribute(a){const Type=types[a.type];if(!Type||a.offset<0||a.offset%Type.BYTES_PER_ELEMENT||a.length<0||start+a.offset+a.length*Type.BYTES_PER_ELEMENT>buffer.byteLength)throw Error('Invalid city buffer view');return new T.BufferAttribute(new Type(buffer,start+a.offset,a.length),a.itemSize,a.normalized);}
 const geometries=header.geometries.map(source=>{
  const g=new T.BufferGeometry();for(const [key,a] of Object.entries(source.attributes))g.setAttribute(key,attribute(a));
  if(source.index)g.setIndex(attribute(source.index));
  g.boundingSphere=new T.Sphere(new T.Vector3(...source.sphere.center),source.sphere.radius);
  g.boundingBox=new T.Box3(new T.Vector3(...source.box.min),new T.Vector3(...source.box.max));return g;
 });
 const meshes=header.meshes.map(source=>{
  const material=materials[source.material],g=geometries[source.geometry];if(!material||!g)throw Error('Missing city mesh resource');
  const m=source.instances?new T.InstancedMesh(g,material,source.instances.length/16):new T.Mesh(g,material);
  if(source.instances){const a=attribute(source.instances);m.instanceMatrix=new T.InstancedBufferAttribute(a.array,16);m.boundingSphere=new T.Sphere(new T.Vector3(...source.sphere.center),source.sphere.radius);}
  m.matrix.fromArray(source.matrix);m.matrixAutoUpdate=false;m.userData=source.userData;return m;
 });
 return {meshes,physics:header.physics};
}
