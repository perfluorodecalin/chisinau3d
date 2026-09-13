import {loadChunk,loadVisualVariant,disposeChunk} from './world-loader.js';
import {normalizeVariants,selectVariant} from './lod.js';
import {project} from './model.js';

const PRESET_SCALE={low:.72,balanced:1,high:1.35};
const finite=(v,f)=>Number.isFinite(+v)?+v:f;
function variantsOf(chunk){
 const raw=chunk?.variants||chunk?.visualVariants||chunk?.visual?.variants;
 const list=normalizeVariants(raw?.length?raw:[]).map(v=>({...v,file:v.file||v.url,canonical:v.canonical??(v.file===chunk?.file)})).filter(v=>v.file);
 if(list.length)return list;
 return chunk?.file?[{level:0,maxDistance:Infinity,file:chunk.file,canonical:true}]:[];
}
function distanceToChunk(chunk,camera){
 const b=chunk?.bounds||chunk?.box;
 if(b?.min&&b?.max&&camera?.position){const p=camera.position,min=Array.isArray(b.min)?{x:b.min[0],y:b.min[1],z:b.min[2]}:b.min,max=Array.isArray(b.max)?{x:b.max[0],y:b.max[1],z:b.max[2]}:b.max,d=Math.sqrt(
  Math.max(min.x-p.x,0,p.x-max.x)**2+Math.max(min.y-p.y,0,p.y-max.y)**2+Math.max(min.z-p.z,0,p.z-max.z)**2);return d;}
 const s=chunk?.sphere||chunk?.bounds?.sphere;if(s&&camera?.position){const c=s.center||s.c||s;return Math.max(0,camera.position.distanceTo(c)-finite(s.radius,0));}
 if(chunk?.center&&camera?.position){const c=chunk.center;return camera.position.distanceTo(c);}
 // The legacy manifest has geographic bounds. This conservative approximation
 // is only used for visual quality; it never controls physics eviction.
 const q=chunk?.bbox;if(q&&camera?.position){const a=project({lat:q[0],lon:q[1]}),b=project({lat:q[2],lon:q[3]}),min={x:Math.min(a[0],b[0]),z:Math.min(a[1],b[1])},max={x:Math.max(a[0],b[0]),z:Math.max(a[1],b[1])};return Math.hypot(Math.max(min.x-camera.position.x,0,camera.position.x-max.x),Math.max(min.z-camera.position.z,0,camera.position.z-max.z));}
 return 0;
}
function canonicalFile(chunk){return chunk?.physicsFile||chunk?.physics?.file||chunk?.file;}

// Coordinates visual variant fetches and canonical physics residency. A visual
// request carries a generation token, so a district change can never attach a
// stale response after the user has moved on.
export function createWorldStreamer({world,camera,quality='balanced',interval=120,hysteresis=.2,minDwell=180,maxConcurrent=4,
 loadVisual=loadVisualVariant,loadPhysics=loadChunk,onVisualAttach,onVisualDetach,onPhysicsReady,onError}={}){
 const entries=new Map(),queue=[],active=new Set(),controllers=new Map();let scale=PRESET_SCALE[quality]||1,last=0,serial=0;
 const metrics={requested:0,completed:0,failed:0,stale:0,swaps:0,physicsRequested:0,physicsReady:0,bytes:0};
 function entryFor(chunk){const id=String(chunk?.id??chunk?.key??chunk?.file??entries.size);let e=entries.get(id);if(!e){const variants=variantsOf(chunk);e={id,chunk,variants,index:0,current:null,physics:null,physicsPromise:null,generation:0,retry:0,retryAt:0,lastSwap:-Infinity,requested:new Set(),removed:false};entries.set(id,e);}return e;}
 function priority(e,kind){const d=distanceToChunk(e.chunk,camera);return (kind==='physics'?0:1)*1e9+d;}
 function enqueue(e,kind,index=0,priority){
  const key=kind+':'+index;if(kind==='visual')e.target=index;if(e.requested.has(key)||e.removed)return;e.requested.add(key);queue.push({e,kind,index,generation:e.generation,priority:priority??priorityFor(e,kind),serial:serial++});queue.sort((a,b)=>a.priority-b.priority||a.serial-b.serial);pump();
 }
 function priorityFor(e,kind){return priority(e,kind);}
 function fail(e,kind,error,index=0){metrics.failed++;e.requested.delete(kind+':'+index);e.retry=Math.min(6,e.retry+1);e.retryAt=performance.now()+Math.min(30000,500*2**e.retry);onError?.({id:e.id,kind,error,retryAt:e.retryAt});}
 function pump(){while(active.size<Math.max(1,maxConcurrent)&&queue.length){const job=queue.shift();if(job.e.removed||job.generation!==job.e.generation){job.e.requested.delete(job.kind+':'+job.index);continue;}active.add(job);metrics.requested++;run(job).finally(()=>{active.delete(job);pump();});}}
 async function run(job){const e=job.e,token=e.generation,abort=new AbortController(),key=job.kind+':'+job.index;let loadedForCleanup=null;controllers.set(key+':'+e.id,abort);
  try{
   if(job.kind==='physics'){
    if(e.physicsPromise)return;
    metrics.physicsRequested++;e.physicsPromise=(async()=>{const source=canonicalFile(e.chunk);if(!source)throw Error('Chunk has no canonical physics file');const loaded=await loadPhysics(world,{...e.chunk,file:source},{signal:abort.signal});if(e.removed||e.generation!==token){disposeChunk(loaded);e.physicsPromise=null;metrics.stale++;return;}e.physicsLoaded=loaded;e.physics=loaded.physics;metrics.physicsReady++;onPhysicsReady?.({id:e.id,chunk:e.chunk,physics:e.physics});})();await e.physicsPromise;
   }else{
    const variant=e.variants[job.index];if(!variant)throw Error('Missing visual variant '+job.index);
    let loaded;if(variant.canonical&&e.physicsLoaded)loaded=e.physicsLoaded;
    if(!loaded)loaded=await loadVisual(world,e.chunk,variant,{signal:abort.signal});loadedForCleanup=loaded;
    if(e.removed||e.generation!==token||e.target!==job.index){if(loaded.meshes?.length)disposeChunk(loaded);loadedForCleanup=null;metrics.stale++;return;}
    const previous=e.current,attached=await onVisualAttach?.({id:e.id,chunk:e.chunk,variant,level:job.index,loaded,previous});
    if(attached===false){if(loaded!==e.physicsLoaded)disposeChunk(loaded);loadedForCleanup=null;e.retryAt=performance.now()+500;return;}
    if(e.removed||e.generation!==token){if(loaded.meshes?.length)disposeChunk(loaded);loadedForCleanup=null;metrics.stale++;return;}
    e.current={loaded,variant,level:job.index};loadedForCleanup=null;e.index=job.index;e.lastSwap=performance.now();metrics.completed++;metrics.bytes+=finite(variant.decodedBytes??variant.bytes,0);metrics.swaps+=previous?1:0;
    if(previous&&previous.loaded!==loaded){await onVisualDetach?.({id:e.id,chunk:e.chunk,variant:previous.variant,level:previous.level,loaded:previous.loaded});if(previous.loaded===e.physicsLoaded)e.physicsLoaded=null;disposeChunk(previous.loaded);}
   }
   e.retry=0;e.retryAt=0;
  }catch(error){if(loadedForCleanup&&loadedForCleanup!==e.current?.loaded)disposeChunk(loadedForCleanup);if(job.kind==='physics')e.physicsPromise=null;if(error?.name==='AbortError'||e.removed||e.generation!==token){metrics.stale++;return;}fail(e,job.kind,error,job.index);}
  finally{e.requested.delete(key);if(controllers.get(key+':'+e.id)===abort)controllers.delete(key+':'+e.id);}
 }
 function register(chunk,initial=null,options={}){const e=entryFor(chunk);e.removed=false;e.generation++;e.retry=0;e.retryAt=0;
  if(initial){e.current={loaded:initial,variant:{file:chunk.file,level:0,canonical:true},level:0};e.index=0;e.physicsLoaded=initial;e.physics=initial.physics;e.physicsPromise=Promise.resolve(initial);}
  if(options.physics!==false&&!e.physicsPromise)enqueue(e,'physics',0,priority(e,'physics'));if(!e.current&&e.variants.length)enqueue(e,'visual',0,priority(e,'visual'));return e.id;
 }
 function unregister(id){const e=entries.get(String(id));if(!e)return; e.removed=true;e.generation++;for(const [key,c] of controllers)if(key.endsWith(':'+e.id)){c.abort();controllers.delete(key);}entries.delete(e.id);let i=queue.findIndex(j=>j.e===e);while(i>=0){queue.splice(i,1);i=queue.findIndex(j=>j.e===e);}if(e.current){onVisualDetach?.({id:e.id,chunk:e.chunk,variant:e.current.variant,level:e.current.level,loaded:e.current.loaded});disposeChunk(e.current.loaded);e.current=null;}}
 function request(chunk,options={}){const e=entryFor(chunk);e.removed=false;if(options.generation!=null)e.generation=options.generation;if(options.physics!==false&&!e.physicsPromise)enqueue(e,'physics',0,options.priority);const index=options.index??desiredIndex(e);if(options.visual!==false&&index>=0&&(!e.current||e.index!==index))enqueue(e,'visual',index,options.priority);return e.id;}
 function desiredIndex(e){if(!e.variants.length)return -1;const current=e.current?e.index:0;return selectVariant(distanceToChunk(e.chunk,camera),e.variants,current,{hysteresis,scale}).index;}
 function update(now=performance.now(),force=false){if(!force&&now-last<interval){pump();return metrics;}last=now;for(const e of entries.values()){if(e.removed)continue;const index=desiredIndex(e);if(index<0)continue;if(e.current&&index!==e.index&&now-e.lastSwap<minDwell)continue;if(e.current&&index===e.index)e.target=index;if(index!==e.index||!e.current){if(e.retryAt<=now)enqueue(e,'visual',index,priority(e,'visual'));}if(!e.physicsPromise&&e.chunk.physicsFile)e.physicsPromise=null;}pump();return metrics;}
 function setQuality(value){scale=PRESET_SCALE[value]||1;last=0;update(performance.now(),true);}
 function invalidate(id){const e=entries.get(String(id));if(!e)return;e.generation++;e.retryAt=0;for(const [key,c] of controllers)if(key.endsWith(':'+e.id)){c.abort();controllers.delete(key);}e.requested.clear();}
 function dispose(){for(const e of [...entries.values()])unregister(e.id);queue.length=0;}
 return {register,request,unregister,update,setQuality,invalidate,dispose,metrics:()=>({...metrics,queued:queue.length,active:active.size,resident:entries.size}),desiredIndex:e=>desiredIndex(entryFor(e)),get:(id)=>entries.get(String(id))};
}
