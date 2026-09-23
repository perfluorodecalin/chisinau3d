import {createSoundscape} from './soundscape.js';
import {yieldToBrowser} from './loading.js';
import {loadWorld,loadChunk,loadVisualVariant,disposeChunk} from './world-loader.js';
import {resolveFeature,showFeature} from './inspector.js';
import * as THREE from 'three';
import {configureTerrain,heightAt,roadHeight} from './terrain-runtime.js';
import {addAtmosphere} from './atmosphere.js';
import {createLodController} from './lod.js';
import {createWorldStreamer} from './world-streamer.js';
import {createDriving} from './driving.js';
import {createRemoteCars} from './remote-cars.js';
import {createMultiplayerUI} from './multiplayer-ui.js';
import {createMobileUI} from './mobile-ui.js';
import {OrbitControls} from './vendor/OrbitControls.js';
import {ORIGIN,project} from './model.js';
import {ribbonPositions} from './road-ribbon.js';
import {buildingCsv} from './csv-export.js';
const $=s=>document.querySelector(s),scene=new THREE.Scene();scene.background=new THREE.Color('#172b36');scene.fog=new THREE.Fog('#172b36',13000,33000);
let renderer;try{renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});}catch(e){$('#status').textContent='WebGL is unavailable';$('#substatus').textContent='Enable hardware acceleration / WebGL in your browser, then reload.';$('#loading').className='error';throw e;}
const ratios={low:.85,balanced:1.25,high:1.8};renderer.setPixelRatio(Math.min(devicePixelRatio,ratios.balanced));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.3;$('#view').appendChild(renderer.domElement);
const camera=new THREE.PerspectiveCamera(42,innerWidth/innerHeight,1,65000);camera.position.set(950,1150,1500);
const lod=createLodController({camera,quality:$('#quality').value,onStats:()=>streamer?.update(performance.now())});
$('#quality').onchange=()=>{renderer.setPixelRatio(Math.min(devicePixelRatio,ratios[$('#quality').value]));renderer.setSize(innerWidth,innerHeight);lod.setQuality($('#quality').value);streamer?.setQuality($('#quality').value);lod.update(performance.now(),true);};
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,0,0);controls.enableDamping=true;controls.dampingFactor=.08;controls.maxPolarAngle=Math.PI*.485;controls.minDistance=45;controls.maxDistance=24000;controls.autoRotateSpeed=.3;controls.screenSpacePanning=false;
const ambient=new THREE.HemisphereLight('#dbeeff','#43565b',2.1);scene.add(ambient);const sun=new THREE.DirectionalLight('#fff0d2',3.4);sun.position.set(-2000,2300,1800);scene.add(sun);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(120000,120000),new THREE.MeshStandardMaterial({color:'#263d46',roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.8;scene.add(ground);
const grid=new THREE.GridHelper(28000,56,'#415963','#2c444e');grid.position.y=-.6;scene.add(grid);
const buildings=new THREE.Group(),greens=new THREE.Group(),roads=new THREE.Group();scene.add(buildings,greens,roads);
const lineMapRoads=new THREE.Group();lineMapRoads.name='LineMap road geometry test';lineMapRoads.visible=false;scene.add(lineMapRoads);
const resident=new Map(),records=[],pickables=[],loaded=new Set(),chunks=[],lodMeshes=[],places={center:[47.0245,28.8323],buiucani:[47.034,28.803],rascani:[47.059,28.868],ciocana:[47.060,28.893],botanica:[46.998,28.854],lake:[47.019,28.812]};
const facadeSetting={set value(v){for(const m of world?.materials||[])if(m.userData.facadeUniform)m.userData.facadeUniform.value=v;}};
let terrainInfo=null;
let realismData={pois:[]},atmosphere=null,streamer=null;
let active=places.center,manifest=[],busy=false,stop=false,queuedTiles=null,retryTiles=null,flight=null,topView=false,selected=null,totalMapped=0,lastAreaCheck=0;
let world,details,remoteCars=null,roomTransport=null,multiplayerUI=null,lastRoomSend=0,roomRequest=0;const roomPeers=new Set();
const driving=createDriving({scene,camera,controls,onExit(){document.querySelector('#drive').textContent='Drive a car';if(roomTransport&&roomPeers.size)roomTransport.sendState(driving.networkState);},onTravel(x,z){if(busy)return;const lat=ORIGIN.lat-z/111320,lon=ORIGIN.lon+x/(111320*Math.cos(ORIGIN.lat*Math.PI/180));const ts=nearTiles(lat,lon).filter(t=>!loaded.has(t.id));if(ts.length)loadTiles(ts);else evictDistant(x,z);}});
createSoundscape(()=>({...driving.audioState,hour:+$('#time-of-day').value}));
$('#drive').onclick=()=>{if(driving.active){driving.exit();return;}flight=null;$('#close').click();if(!driving.start(controls.target.x,controls.target.z))status('Load a city area first','Driving needs a loaded street to start.','error');};
function status(title,sub='',state=''){ $('#status').textContent=title;$('#substatus').textContent=sub;$('#loading').className=state;$('#retry').hidden=state!=='error'; }
function leaveRoom(){roomRequest++;roomTransport?.leave();roomTransport=null;for(const id of roomPeers)remoteCars?.removePeer(id);roomPeers.clear();multiplayerUI?.setPeerCount(0);multiplayerUI?.setRoom(null);multiplayerUI?.setStatus('Not connected');}
async function joinRoom(roomId){
 if(!world?.inputHash)throw new Error('The city is still loading. Try joining when the map is ready.');
 leaveRoom();
 const request=roomRequest;
 try{
  // Keep signaling code off the startup and driving paths until someone joins.
  const {createRoomTransport}=await import('./multiplayer-network.js');
  if(request!==roomRequest)return;
  roomTransport=createRoomTransport({roomId,worldId:world.inputHash,
   onPeerJoin(id){roomPeers.add(id);lastRoomSend=0;multiplayerUI.setPeerCount(roomPeers.size);multiplayerUI.setStatus('Connected');},
   onPeerLeave(id){roomPeers.delete(id);remoteCars?.removePeer(id);multiplayerUI.setPeerCount(roomPeers.size);multiplayerUI.setStatus(roomPeers.size?'Connected':'Waiting for another driver');},
   onState(id,state){if(state.active)remoteCars??=createRemoteCars(scene);remoteCars?.updatePeer(id,state);},
   onError(error){console.error('Multiplayer connection:',error);multiplayerUI.setStatus('Connection issue · '+(error?.message||error));}
  });
  multiplayerUI.setRoom(roomId);multiplayerUI.setStatus('Waiting for another driver');lastRoomSend=0;
 }catch(error){console.error('Could not join room:',error);if(request===roomRequest)multiplayerUI.setRoom(null);throw error;}
}
addEventListener('pagehide',leaveRoom);
multiplayerUI=createMultiplayerUI({onJoin:joinRoom,onLeave:leaveRoom});
createMobileUI();
function colorFor(r){const mode=$('#mode').value;if(mode==='source')return new THREE.Color({height:'#6bdcba',levels:'#73a9ef',estimate:'#ddb274'}[r.source]);if(mode==='height')return new THREE.Color().setHSL(.52-Math.min(r.height/110,1)*.48,.57,.57);return new THREE.Color().setHSL(.1+(r.id%7)*.004,.17,.65+(r.id%5)*.025);}
function fly(lat,lon,distance=1800){const [x,z]=project({lat,lon});const target=new THREE.Vector3(x,heightAt(x,z),z),offset=topView?new THREE.Vector3(0,distance,.1):new THREE.Vector3(distance*.48,distance*.65,distance*.8);flight={start:performance.now(),from:camera.position.clone(),to:target.clone().add(offset),fromTarget:controls.target.clone(),target};}
controls.addEventListener('start',()=>flight=null);
function nearTiles(lat,lon){return manifest.filter(t=>{const b=t.bbox;return lat>=b[0]-.007&&lat<=b[2]+.007&&lon>=b[1]-.01&&lon<=b[3]+.01;}).sort((a,b)=>{const d=t=>Math.hypot((t.bbox[0]+t.bbox[2])/2-lat,((t.bbox[1]+t.bbox[3])/2-lon)*.68);return d(a)-d(b);});}
function evictDistant(x=driving.position.x,z=driving.position.z){
 const removedMeshes=new Set(),removedRecords=new Set();
 for(const t of manifest){
  const chunk=resident.get(t.id);if(!chunk)continue;
  const lo=project({lat:t.bbox[2],lon:t.bbox[1]}),hi=project({lat:t.bbox[0],lon:t.bbox[3]});
  if(Math.hypot(Math.max(lo[0]-x,0,x-hi[0]),Math.max(lo[1]-z,0,z-hi[1]))<3500)continue;
  driving.removeCompiled(chunk.physics);
  for(const m of chunk.meshes){if(m.userData.spans||m.userData.feature)removedMeshes.add(m);if(m.userData.layer==='buildings'&&m.userData.spans)for(const s of m.userData.spans){removedRecords.add(s.r);if(s.r.source!=='estimate')totalMapped--;}}
  if(streamer)streamer.unregister(t.id);else {for(const m of chunk.meshes)lod.unregister(m);disposeChunk(chunk);}
  resident.delete(t.id);loaded.delete(t.id);
 }
 if(removedMeshes.size){
  $('#close').click();
  const retain=(items,removed)=>{let n=0;for(const item of items)if(!removed.has(item))items[n++]=item;items.length=n;};
  retain(records,removedRecords);retain(pickables,removedMeshes);retain(chunks,removedMeshes);
  $('#count').textContent=records.length.toLocaleString();$('#known').textContent=records.length?Math.round(totalMapped/records.length*100)+'%':'—';
  $('#export').disabled=!records.length;
 }
}
function addVisualMeshes(chunk,includeMetadata=false){
  for(const m of chunk.meshes){
   const layer=m.userData.layer;
   lod.register(m,{includeExternal:true});
   (layer==='buildings'?buildings:layer==='greens'?greens:layer==='roads'?roads:layer==='vegetation'?atmosphere.vegetation:layer==='lamps'?atmosphere.lamps:layer==='details'?details.group:scene).add(m);
   if(m.userData.spans||m.userData.feature)pickables.push(m);
   if(includeMetadata&&layer==='buildings'&&m.userData.spans){chunks.push(m);for(const s of m.userData.spans){records.push(s.r);if(s.r.source!=='estimate')totalMapped++;}}
  }
}
async function loadCityLod(){
 const entries=world.lodChunks||[],progress=$('#lod-progress');let done=0,failed=0;
 for(let i=0;i<entries.length;i+=4){
   const batch=entries.slice(i,i+4),results=await Promise.allSettled(batch.map(t=>loadChunk(world,t)));
  for(let j=0;j<results.length;j++){const result=results[j];done++;if(result.status==='rejected'){failed++;console.error(result.reason);continue;}
   for(const m of result.value.meshes){scene.add(m);lodMeshes.push(m);if(m.userData.spans)pickables.push(m);if(m.userData.layer==='buildings'&&$('#mode').value!=='material')recolorLod(m);}
  }
  progress.textContent=`City overview ${done} / ${entries.length} sections${failed?` · ${failed} failed`:''}`;
  await yieldToBrowser();
 }
 progress.textContent=failed?`City overview incomplete · ${failed} failed`:'Whole city overview loaded';
}
let lastLodCheck=0;
function updateLodVisibility(){
 if(performance.now()-lastLodCheck<300)return;lastLodCheck=performance.now();
 const counts=new Map(),present=new Map();for(const t of manifest){counts.set(t.cell,(counts.get(t.cell)||0)+1);if(loaded.has(t.id))present.set(t.cell,(present.get(t.cell)||0)+1);}
 for(const m of lodMeshes){
   const covered=counts.has(m.userData.lodCell)&&counts.get(m.userData.lodCell)===present.get(m.userData.lodCell);
   m.visible=(m.userData.layer==='terrain'||!covered)&&(m.userData.layer!=='roads'||$('#roads').checked)&&(m.userData.layer!=='greens'||$('#parks').checked);
  }
}
function removeVisualMeshes(chunk){for(const m of chunk?.meshes||[]){lod.unregister(m);const i=pickables.indexOf(m);if(i>=0)pickables.splice(i,1);const j=chunks.indexOf(m);if(j>=0)chunks.splice(j,1);m.removeFromParent();}}
async function getTile(t){
 // Terrain chunks have no physics or picking payload. Decode the visual LOD
 // appropriate for the current camera directly, avoiding a full 5 m mesh
 // transiently entering the scene during wide-city loading.
 if(t.visualVariants?.length){const index=streamer?.desiredIndex(t)??0,variant=t.visualVariants[index]||t.visualVariants[0];const chunk=await loadVisualVariant(world,t,variant);chunk.__initialVisualLevel=index;return chunk;}
 return loadChunk(world,t);
}
async function ingest(chunk,t){
 addVisualMeshes(chunk,true);
 driving.addCompiled(chunk.physics);
 if($('#mode').value!=='material')recolor(chunk.meshes.filter(m=>m.userData.layer==='buildings'&&m.userData.spans));
 facadeSetting.value=$('#mode').value==='material'&&$('#textures').checked?1:0;
 $('#count').textContent=records.length.toLocaleString();$('#known').textContent=records.length?Math.round(totalMapped/records.length*100)+'%':'—';$('#export').disabled=!records.length;
  applyTime();
  if(streamer){const initialLevel=chunk.__initialVisualLevel;streamer.register(t,chunk,initialLevel===undefined?{physics:false}:{physics:false,initialPhysics:false,initialLevel});}
 }
async function loadTiles(tiles,wide=false){
 if(busy)return;busy=true;stop=false;$('#load').disabled=true;$('#city').textContent='Stop loading';
 let failed=0,done=0;const pending=tiles.filter(t=>!loaded.has(t.id));
 try{
  for(let i=0;i<pending.length&&!stop;i+=4){
   const batch=pending.slice(i,i+4),results=await Promise.allSettled(batch.map(getTile));
   for(let j=0;j<results.length;j++){
    const result=results[j],t=batch[j];
    status('Loading Chișinău',`${++done} / ${pending.length} sections · You can explore while it loads`);
    if(result.status==='rejected'){failed++;console.error(result.reason);continue;}
    const chunk=result.value;await ingest(chunk,t);resident.set(t.id,chunk);loaded.add(t.id);
    await yieldToBrowser();
   }
  }
  if(driving.active)evictDistant();
 }catch(e){failed++;console.error(e);}
 finally{busy=false;$('#load').disabled=false;$('#city').textContent='Load full city detail';}
 retryTiles=failed?pending.filter(t=>!loaded.has(t.id)):null;
 status(failed?'Some sections could not load':records.length?'Ready to explore':'No buildings loaded',failed?'Loaded areas remain visible. Retry to reload missing saved sections.':`${records.length.toLocaleString()} buildings · ${loaded.size} / ${manifest.length} city sections loaded`,failed?'error':'done');
 if(queuedTiles){const next=queuedTiles;queuedTiles=null;void loadTiles(next);}
}

function requestTiles(tiles){if(busy){queuedTiles=tiles;stop=true;$('#city').textContent='Switching area…';}else void loadTiles(tiles);}
$('#load').onclick=()=>{const [x,z]=[controls.target.x,controls.target.z];active=[ORIGIN.lat-z/111320,ORIGIN.lon+x/(111320*Math.cos(ORIGIN.lat*Math.PI/180))];const ts=nearTiles(...active);if(!ts.length){status('Outside the covered city area','Choose a neighbourhood to return to Chișinău.','error');return;}requestTiles(ts);};
$('#city').onclick=()=>{if(busy){stop=true;queuedTiles=null;$('#city').textContent='Finishing current section…';}else loadTiles(manifest,true);};
$('#retry').onclick=()=>requestTiles(retryTiles?.length?retryTiles:nearTiles(...active));$('#place').onchange=()=>{active=places[$('#place').value];fly(...active,$('#place').value.startsWith('bridge')?450:1800);requestTiles(nearTiles(...active));};$('#home').onclick=()=>{active=places.center;$('#place').value='center';fly(...active);};
$('#textures').onchange=e=>{facadeSetting.value=e.target.checked&&$('#mode').value==='material'?1:0;};
$('#parks').onchange=e=>greens.visible=e.target.checked;
$('#roads').onchange=e=>{roads.visible=e.target.checked;updateRoadComparison();if(e.target.checked&&roadComparison.dataset.mode==='osm-linemap')void ensureLineMapRoads();};
$('#orbit').onchange=e=>controls.autoRotate=e.target.checked;

let lineMapRoadData=null,lineMapRoadsLoaded=false,lineMapRoadsLoading=false,lineMapRoadSummary='',lineMapLoadError=null;
const roadComparison=$('#road-comparison');
function setRoadComparisonMode(mode){
 roadComparison.dataset.mode=mode;
 roadComparison.setAttribute('aria-pressed',mode==='osm-linemap'?'true':'false');
 roadComparison.textContent=mode==='osm'?'Switch to OSM + LineMap':'Switch to Old OSM';
}
function updateRoadComparison(){
 const roadsVisible=$('#roads').checked,compare=roadComparison.dataset.mode==='osm-linemap';
 roadComparison.disabled=!roadsVisible||lineMapRoadsLoading;
 lineMapRoads.visible=roadsVisible&&compare&&lineMapRoadsLoaded;
 if(lineMapRoadsLoading)return;
 if(!roadsVisible)$('#linemap-status').textContent='Street network hidden · enable it to compare roads';
 else if(compare&&!terrainInfo)$('#linemap-status').textContent='OSM + LineMap selected · waiting for city data';
 else if(lineMapLoadError)$('#linemap-status').textContent=`LineMap test layer unavailable: ${lineMapLoadError}`;
 else if(lineMapRoadsLoaded)$('#linemap-status').textContent=`${compare?'OSM + LineMap':'Old OSM'} · ${lineMapRoadSummary} ${compare?'shown':'ready'}`;
 else $('#linemap-status').textContent='Old OSM · LineMap pilot off';
}
roadComparison.onclick=()=>{
 setRoadComparisonMode(roadComparison.dataset.mode==='osm'?'osm-linemap':'osm');
 updateRoadComparison();
 if(roadComparison.dataset.mode==='osm-linemap')void ensureLineMapRoads();
};
$('#linemap-pilot').onclick=()=>{if(!terrainInfo)return;const [west,south,east,north]=lineMapRoadData?.bbox||[28.84,47.018,28.85,47.025];fly((south+north)/2,(west+east)/2,550);};
async function ensureLineMapRoads(){
 if(!terrainInfo||!$('#roads').checked||lineMapRoadsLoaded||lineMapRoadsLoading)return;
 lineMapLoadError=null;
 lineMapRoadsLoading=true;updateRoadComparison();$('#linemap-status').textContent='Loading saved LineMap match…';
 try{
  const response=await fetch(new URL('./linemap-road-test.json',import.meta.url));
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  lineMapRoadData=await response.json();
  if(lineMapRoadData.version!==1||!Array.isArray(lineMapRoadData.features))throw new Error('Unsupported or invalid test layer data');
  let accepted=0,outside=0,centres=0,edges=0;const batches={centre:{positions:[],ranges:[]},edge:{positions:[],ranges:[]}},ribbonSurface=[];
  for(const feature of lineMapRoadData.features){
   const coords=feature.coordinates;
   if(!Array.isArray(coords)||coords.length<2)continue;
   const meta=terrainInfo.meta,xmax=meta.xmin+(meta.nx-1)*meta.step,zmax=meta.zmin+(meta.nz-1)*meta.step;
   if(coords.some(([x,z])=>!Number.isFinite(x)||!Number.isFinite(z)||x<meta.xmin||x>xmax||z<meta.zmin||z>zmax)){outside++;continue;}
   const batch=batches[feature.kind];if(!batch)continue;
   if(feature.kind==='centre'&&Number.isFinite(feature.width)&&feature.width>0){
    const ribbon=ribbonPositions(coords,feature.width);
    for(let i=0;i<ribbon.length;i+=3){const x=ribbon[i],z=ribbon[i+2];ribbonSurface.push(x,roadHeight(x,z,feature.osmId)+.28,z);}
   }
   const record={type:'way',id:feature.osmId,kind:`LineMap ${feature.kind} match`,tags:feature.osmTags||{},derived:{linemap_source_id:feature.sourceId,linemap_geometry:feature.kind,matching:feature.match||{},osm_id:feature.osmId}};
   const start=batch.positions.length/3;
   for(let i=1;i<coords.length;i++){
    const [ax,az]=coords[i-1],[bx,bz]=coords[i];
    batch.positions.push(ax,roadHeight(ax,az,feature.osmId)+.4,az,bx,roadHeight(bx,bz,feature.osmId)+.4,bz);
   }
   const end=batch.positions.length/3;if(end>start)batch.ranges.push({start,end,record});
   accepted++;if(feature.kind==='centre')centres++;else edges++;
  }
  if(ribbonSurface.length){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(ribbonSurface,3));lineMapRoads.add(new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:'#26d6de',transparent:true,opacity:.62,depthWrite:false,side:THREE.DoubleSide})));}
  for(const kind of ['centre','edge']){const batch=batches[kind];if(!batch.positions.length)continue;const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(batch.positions,3));const material=new THREE.LineBasicMaterial({color:kind==='centre'?'#b8ffff':'#ff54cf',transparent:true,opacity:.95,depthTest:true});const line=new THREE.LineSegments(geometry,material);line.userData.lineMapRanges=batch.ranges;lineMapRoads.add(line);pickables.push(line);}
  lineMapRoadsLoaded=true;
  lineMapRoadSummary=`${centres} LineMap road surfaces · ${edges} mapped edges (cyan / magenta)${outside?` · ${outside} outside terrain coverage`:''}`;
 }catch(error){setRoadComparisonMode('osm');lineMapLoadError=error.message;console.warn('LineMap road test layer could not load',error);}
 finally{lineMapRoadsLoading=false;updateRoadComparison();}
};

$('#mode').onchange=()=>{const mode=$('#mode').value;facadeSetting.value=mode==='material'&&$('#textures').checked?1:0;$('#legend').innerHTML=mode==='source'?'<i style="background:#6bdcba"></i> Height tag<br><i style="background:#73a9ef"></i> Derived from mapped floors<br><i style="background:#ddb274"></i> Estimated height':mode==='height'?'<i style="background:#51c0c8"></i> Low-rise → <i style="background:#e4a34f"></i> High-rise':'<i style="background:#ead6b5"></i> Footprints extruded to height';recolor(chunks);for(const m of lodMeshes)if(m.userData.layer==='buildings')recolorLod(m);};
function recolor(meshes){for(const m of meshes){const colors=m.geometry.attributes.color,normals=m.geometry.attributes.normal;let start=0;for(const span of m.userData.spans){const c=colorFor(span.r);for(let i=start;i<span.end*3;i++){const f=normals.getY(i)>.6?1.1:.83;colors.setXYZ(i,c.r*f,c.g*f,c.b*f);}start=span.end*3;}colors.needsUpdate=true;}}
function recolorLod(m){const colors=m.geometry.attributes.color;let start=0;for(const span of m.userData.spans){const c=colorFor(span.r);for(let i=start;i<span.end*3;i++)colors.setXYZ(i,c.r,c.g,c.b);start=span.end*3;}colors.needsUpdate=true;}

$('#top').onclick=()=>{topView=!topView;$('#top').textContent=topView?'3D':'2D';const d=camera.position.distanceTo(controls.target);camera.position.copy(controls.target).add(topView?new THREE.Vector3(0,d,.01):new THREE.Vector3(d*.48,d*.65,d*.8));};$('#north').onclick=()=>{const d=camera.position.distanceTo(controls.target);camera.position.copy(controls.target).add(new THREE.Vector3(0,d*.8,d*.7));topView=false;$('#top').textContent='2D';};$('#plus').onclick=()=>camera.position.sub(controls.target).multiplyScalar(.75).add(controls.target);$('#minus').onclick=()=>camera.position.sub(controls.target).multiplyScalar(1.3).add(controls.target);
const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();ray.params.Line.threshold=2.5;let pointerStart;
function isWorldVisible(mesh){for(let node=mesh;node;node=node.parent)if(!node.visible)return false;return true;}
renderer.domElement.addEventListener('pointerdown',e=>pointerStart=[e.clientX,e.clientY]);
renderer.domElement.addEventListener('pointerup',e=>{
 if(driving.active||!pointerStart||Math.hypot(e.clientX-pointerStart[0],e.clientY-pointerStart[1])>5)return;
 pointer.set(e.clientX/innerWidth*2-1,1-e.clientY/innerHeight*2);ray.setFromCamera(pointer,camera);
 const hit=ray.intersectObjects(pickables.filter(isWorldVisible),false)[0];if(!hit)return;
 let feature;if(hit.object.userData.lineMapRanges){const ranges=hit.object.userData.lineMapRanges;let lo=0,hi=ranges.length;while(lo<hi){const mid=(lo+hi)>>1;if(hit.index<ranges[mid].end)hi=mid;else lo=mid+1;}if(lo<ranges.length&&hit.index>=ranges[lo].start)feature={record:ranges[lo].record,start:ranges[lo].start,end:ranges[lo].end,lineMap:true};}else feature=resolveFeature(hit.object,hit.faceIndex);if(!feature)return;
 showFeature(feature.record,$('#inspect'));
 if(selected){scene.remove(selected);selected.geometry.dispose();selected.material.dispose();}
 const source=hit.object.geometry,geometry=new THREE.BufferGeometry();
 if(feature.lineMap){const positions=source.attributes.position.array.slice(feature.start*3,feature.end*3);geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));selected=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:'#f3fcab',depthTest:false}));}
 else {
 if(feature.end==null){geometry.copy(source);}else{
  const positions=source.attributes.position.array.slice(feature.start*3,feature.end*3);
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
 }
 selected=new THREE.LineSegments(new THREE.EdgesGeometry(geometry,25),new THREE.LineBasicMaterial({color:'#f3fcab',depthTest:false}));geometry.dispose();
 }
 selected.matrix.copy(hit.object.matrixWorld);selected.matrixAutoUpdate=false;selected.renderOrder=5;scene.add(selected);
});
$('#close').onclick=()=>{$('#inspect').hidden=true;if(selected){scene.remove(selected);selected.geometry.dispose();selected.material.dispose();selected=null;}};
$('#about').onclick=()=>$('#info').showModal();$('#info-close').onclick=()=>$('#info').close();$('#info').addEventListener('click',e=>{if(e.target===$('#info')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
$('#export').onclick=()=>{const blob=new Blob([buildingCsv(records)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='chisinau-buildings.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);};
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();status('Graphics context lost','Reload the page to restart the map.','error');});
let perfStart=performance.now(),perfFrames=0,perfMs=[];
let lastFrame=performance.now();
function animate(now){
 requestAnimationFrame(animate);
 const elapsed=(now-lastFrame)/1000,dt=Math.min(elapsed,.04);lastFrame=now;perfFrames++;perfMs.push(elapsed*1000);
 if(now-perfStart>2000){perfMs.sort((a,b)=>a-b);$('#perf').textContent=Math.round(perfFrames*1000/(now-perfStart))+' FPS · p95 '+Math.round(perfMs[Math.floor(perfMs.length*.95)]||0)+' ms · '+renderer.info.render.calls+' draws · '+renderer.info.render.triangles.toLocaleString()+' triangles';const drivePerf=$('#drive-perf');if(drivePerf)drivePerf.textContent=$('#perf').textContent;perfFrames=0;perfMs=[];perfStart=now;}
 atmosphere?.update(now,camera.position);
 if(driving.active)driving.update(Math.min(elapsed,.2));
 remoteCars?.update(dt);
 if(roomTransport&&roomPeers.size&&driving.active&&now-lastRoomSend>=100){roomTransport.sendState(driving.networkState);lastRoomSend=now;}
 if(driving.active){lod.update(now);streamer?.update(now);updateLodVisibility();renderer.render(scene,camera);return;}
 if(flight){const t=Math.min((now-flight.start)/1100,1),s=t*t*(3-2*t);camera.position.lerpVectors(flight.from,flight.to,s);controls.target.lerpVectors(flight.fromTarget,flight.target,s);if(t===1)flight=null;}
 if(!flight)controls.target.y=heightAt(controls.target.x,controls.target.z);
 camera.position.y=Math.max(camera.position.y,heightAt(camera.position.x,camera.position.z)+3);controls.update();lod.update(now);streamer?.update(now);updateLodVisibility();
 if(now-lastAreaCheck>700&&camera.position.distanceTo(controls.target)<2500&&!busy){lastAreaCheck=now;const lat=ORIGIN.lat-controls.target.z/111320,lon=ORIGIN.lon+controls.target.x/(111320*Math.cos(ORIGIN.lat*Math.PI/180));const missing=nearTiles(lat,lon).filter(t=>!loaded.has(t.id));if(missing.length)void loadTiles(missing);}
 renderer.render(scene,camera);
}
requestAnimationFrame(animate);
try{
 world=await loadWorld();
 terrainInfo=world.terrain;configureTerrain(terrainInfo.meta,world.heights,terrainInfo.profiles);$('#linemap-pilot').disabled=false;updateRoadComparison();if(roadComparison.dataset.mode==='osm-linemap')void ensureLineMapRoads();
 ground.position.y=terrainInfo.meta.minElevation-terrainInfo.meta.offset-20;grid.visible=false;
 realismData={pois:world.pois};setupDestinations();manifest=world.chunks;
 atmosphere=addAtmosphere(scene,realismData,{vegetation:new THREE.Group(),lamps:new THREE.Group(),heads:world.lampHeads,materials:world.materials});
 details={group:new THREE.Group()};scene.add(details.group);
  streamer=createWorldStreamer({world,camera,quality:$('#quality').value,onVisualAttach:({loaded})=>{addVisualMeshes(loaded,false);if($('#mode').value!=='material')recolor(loaded.meshes.filter(m=>m.userData.layer==='buildings'&&m.userData.spans));},onVisualDetach:({loaded})=>removeVisualMeshes(loaded),onError:e=>console.warn('Visual LOD request failed',e)});
 globalThis.__chisinau3d={lodMetrics:()=>({...lod.stats(),streaming:streamer.metrics()})};
 $('#landscape').onchange=e=>atmosphere.vegetation.visible=e.target.checked;
 $('#street-details').onchange=e=>details.group.visible=e.target.checked;
 $('#street-count').textContent=world.details.trees.toLocaleString()+' trees · '+world.details.benches.toLocaleString()+' benches';
 for(const [i,p] of world.bridges.entries()){places['bridge'+i]=p.location;const o=document.createElement('option');o.value='bridge'+i;o.textContent='Bridge · '+p.name;$('#place').append(o);}
 await loadTiles(nearTiles(...active));void loadCityLod();
}catch(e){status('The city data could not load','Run npm run build, then reload. '+e.message,'error');console.error(e);}

function setupDestinations(){const select=$('#destination');realismData.pois.sort((a,b)=>a.name.localeCompare(b.name,'ro'));for(const [i,p] of realismData.pois.entries()){const o=document.createElement('option');o.value=i;o.textContent=p.name;select.append(o);}select.onchange=()=>{if(select.value===''){driving.setDestination(null);return;}const p=realismData.pois[+select.value],xz=project(p);driving.setDestination({name:p.name,x:xz[0],z:xz[1]});if(!driving.active){active=[p.lat,p.lon];fly(p.lat,p.lon,500);requestTiles(nearTiles(...active));}};}

function applyTime(){const hour=+$('#time-of-day').value,daylight=Math.max(0,Math.sin((hour-6)/12*Math.PI)),twilight=(hour>=5&&hour<7)||(hour>=17&&hour<20),night=daylight<.15;$('#clock-label').textContent=String(Math.floor(hour)%24).padStart(2,'0')+':'+String(Math.round((hour%1)*60)).padStart(2,'0');ambient.intensity=.16+daylight*1.94;sun.intensity=daylight*3.4;sun.position.set(Math.cos((hour-6)/12*Math.PI)*3000,Math.max(50,daylight*3000),1800);scene.background.set(night?(twilight?'#26354b':'#070d1e'):'#172b36');scene.fog.color.copy(scene.background);atmosphere?.setDusk(night);driving.setDusk(night);$('#night-skip').textContent=night?'Skip to day':'Skip to night';}
$('#time-of-day').oninput=applyTime;$('#night-skip').onclick=()=>{$('#time-of-day').value=$('#night-skip').textContent==='Skip to day'?12:22;applyTime();};$('#day-skip').onclick=()=>{$('#time-of-day').value=12;applyTime();};$('#dusk-skip').onclick=()=>{$('#time-of-day').value=18.5;applyTime();};
