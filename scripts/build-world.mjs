import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import * as T from 'three';
import {loadRoadModel} from '../dist/road-model.js';
import {loadTerrain} from '../dist/terrain.js';
import {compileAtmosphere} from '../dist/realism.js';
import {addStreetDetails} from '../dist/street-details.js';
import {ORIGIN} from '../dist/model.js';
import {WORLD_VERSION} from '../dist/world-format.js';
import {createCityCompiler} from './compile-city.mjs';
import {createPhysicsCompiler} from './compile-physics.mjs';
import {encodeChunk} from './world-format.mjs';
import {worldInputHash} from './world-inputs.mjs';

const root=new URL('../dist/',import.meta.url),output=new URL('world/',root);
const inputHash=await worldInputHash();
await fs.mkdir(output,{recursive:true});
// All source adapters read saved snapshots. A network URL is always an error.
globalThis.fetch=async url=>{
 if(typeof url!=='string'||!/^\.\/data\/[\w.-]+$/.test(url))throw Error('Build accepts local snapshots only: '+url);
 const b=await fs.readFile(new URL(url,root));
 return {ok:true,json:async()=>JSON.parse(b.toString()),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};
};
const json=async name=>(await fetch('./data/'+name)).json();
const materials=[],materialIds=new Map(),chunks=[];
function materialId(m){
 if(!materialIds.has(m)){
  const data=m.toJSON();delete data.uuid;delete data.metadata;
  const key=JSON.stringify(data);let id=materials.findIndex(x=>JSON.stringify(x)===key);
  if(id<0){id=materials.length;materials.push(data);}materialIds.set(m,id);
 }return materialIds.get(m);
}
async function asset(prefix,bytes){const compressed=gzipSync(bytes,{level:9}),hash=createHash('sha256').update(compressed).digest('hex').slice(0,20),name=prefix+'-'+hash+'.bin.gz';await fs.writeFile(new URL(name,output),compressed);return name;}
const latitude=z=>ORIGIN.lat-z/111320,longitude=x=>ORIGIN.lon+x/(111320*Math.cos(ORIGIN.lat*Math.PI/180));
let sequence=0;
async function emit(groups,physics){
 const cells=new Map();
 function cell(x,z){const key=Math.floor(x/500)+','+Math.floor(z/500);if(!cells.has(key))cells.set(key,{meshes:[],physics:{obstacles:[],streets:[]},bounds:new T.Box3()});return cells.get(key);}
 for(const [layer,group] of Object.entries(groups)){
  group.updateMatrixWorld(true);group.traverse(m=>{
   if(!m.isMesh)return;
   const bounds=new T.Box3().setFromObject(m),center=bounds.getCenter(new T.Vector3()),c=cell(center.x,center.z);
   m.userData.layer=layer;m.matrix.copy(m.matrixWorld);m.matrixAutoUpdate=false;c.meshes.push(m);c.bounds.union(bounds);
  });
 }
 for(const [kind,list] of Object.entries(physics))for(const value of list){
  const points=kind==='streets'?[value.a,value.b]:value.outer;
  const b=new T.Box3();for(const p of points)b.expandByPoint(new T.Vector3(p[0],0,p[1]));
  const p=b.getCenter(new T.Vector3()),c=cell(p.x,p.z);c.physics[kind].push(value);c.bounds.union(b);
 }
 for(const [key,c] of cells){
  const id=String(sequence++),file=await asset('chunk',encodeChunk(c.meshes,c.physics,materialId));
  chunks.push({id,cell:key,file,bbox:[latitude(c.bounds.max.z),longitude(c.bounds.min.x),latitude(c.bounds.min.z),longitude(c.bounds.max.x)]});
 }
 const disposed=new Set();for(const group of Object.values(groups))group.traverse(m=>{if(m.geometry&&!disposed.has(m.geometry)){disposed.add(m.geometry);m.geometry.dispose();}});
}
console.log('Compiling saved terrain and connected road profiles…');
await loadRoadModel();const terrainScene=new T.Group(),terrain=await loadTerrain(terrainScene);
await emit({terrain:terrainScene},{});terrainScene.clear();
const physics=createPhysicsCompiler(),realism=await json('realism.json'),city=createCityCompiler(physics,realism);
const tiles=await json('manifest.json');
for(const name of ['center',...tiles.map(t=>t.id)]){
 console.log('Compiling snapshot '+name);await city.ingest(await json(name+'.json'));
 await emit({buildings:city.buildings,greens:city.greens,roads:city.roads},{obstacles:physics.obstacles,streets:physics.streets});city.clear();physics.clear();
}
console.log('Compiling mapped street furniture, vegetation and lamps…');
const detailScene=new T.Group(),details=await addStreetDetails(detailScene,physics,realism.extra);
await emit({details:details.group},{obstacles:physics.obstacles});physics.clear();detailScene.clear();details.group.clear();
const atmosphere=compileAtmosphere(new T.Group(),realism);
await emit({vegetation:atmosphere.vegetation,lamps:atmosphere.lamps},{});
const bridges=[];
for(const needle of ['Ismail','Mihai Viteazul','Renașterii','Miorița']){
 const p=Object.values(terrain.profiles).find(p=>p.bridge&&p.name.includes(needle)&&!['footway','path','steps'].includes(p.highway));
 if(p){const pt=p.points[Math.floor(p.points.length/2)];bridges.push({name:p.name,location:[latitude(pt[1]),longitude(pt[0])]});}
}
const heightFile=await asset('heights',await fs.readFile(new URL('data/terrain.bin',root)));
const manifest={version:WORLD_VERSION,cellSize:500,attribution:'© OpenStreetMap contributors (ODbL); Mapzen Terrain Tiles, USGS and EU-DEM. Heights, façades, furniture and bridge clearance include estimates. See README.md.',terrain,heightFile,materials,chunks,pois:realism.pois,lampHeads:atmosphere.heads,bridges,details:{trees:details.trees,benches:details.benches}};
// Publish the manifest last. Interrupted builds leave the previous build usable.
if(inputHash!==await worldInputHash())throw Error('World inputs changed during compilation; rerun the build.');
manifest.inputHash=inputHash;
await fs.writeFile(new URL('manifest.tmp',output),JSON.stringify(manifest));
await fs.rename(new URL('manifest.tmp',output),new URL('manifest.json',output));
console.log(`Built ${chunks.length} spatial chunks and ${materials.length} shared materials. No network sources requested.`);
