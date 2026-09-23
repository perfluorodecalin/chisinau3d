import {createSoundscape} from './soundscape.js';
import {yieldToBrowser} from './loading.js';
import {loadWorld,loadChunk,disposeChunk} from './world-loader.js';
import * as THREE from 'three';
import {configureTerrain,heightAt} from './terrain-runtime.js';
import {addAtmosphere} from './atmosphere.js';
import {createDriving} from './driving.js';
import {createRemoteCars} from './remote-cars.js';
import {createRoomTransport} from './multiplayer-network.js';
import {createMultiplayerUI} from './multiplayer-ui.js';
import {OrbitControls} from './vendor/OrbitControls.js';
import {ORIGIN,project} from './model.js';
import {buildingCsv} from './csv-export.js';
const $=s=>document.querySelector(s),scene=new THREE.Scene();scene.background=new THREE.Color('#172b36');scene.fog=new THREE.Fog('#172b36',13000,33000);
let renderer;try{renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});}catch(e){$('#status').textContent='WebGL is unavailable';$('#substatus').textContent='Enable hardware acceleration / WebGL in your browser, then reload.';$('#loading').className='error';throw e;}
const ratios={low:.85,balanced:1.25,high:1.8};renderer.setPixelRatio(Math.min(devicePixelRatio,ratios.balanced));$('#quality').onchange=()=>{renderer.setPixelRatio(Math.min(devicePixelRatio,ratios[$('#quality').value]));renderer.setSize(innerWidth,innerHeight);};renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.3;$('#view').appendChild(renderer.domElement);
const camera=new THREE.PerspectiveCamera(42,innerWidth/innerHeight,1,65000);camera.position.set(950,1150,1500);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,0,0);controls.enableDamping=true;controls.dampingFactor=.08;controls.maxPolarAngle=Math.PI*.485;controls.minDistance=45;controls.maxDistance=24000;controls.autoRotateSpeed=.3;controls.screenSpacePanning=false;
const ambient=new THREE.HemisphereLight('#dbeeff','#43565b',2.1);scene.add(ambient);const sun=new THREE.DirectionalLight('#fff0d2',3.4);sun.position.set(-2000,2300,1800);scene.add(sun);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(120000,120000),new THREE.MeshStandardMaterial({color:'#263d46',roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.8;scene.add(ground);
const grid=new THREE.GridHelper(28000,56,'#415963','#2c444e');grid.position.y=-.6;scene.add(grid);
const buildings=new THREE.Group(),greens=new THREE.Group(),roads=new THREE.Group();scene.add(buildings,greens,roads);
const resident=new Map(),records=[],pickables=[],loaded=new Set(),chunks=[],places={center:[47.0245,28.8323],buiucani:[47.034,28.803],rascani:[47.059,28.868],ciocana:[47.060,28.893],botanica:[46.998,28.854],lake:[47.019,28.812]};
const facadeSetting={set value(v){for(const m of world?.materials||[])if(m.userData.facadeUniform)m.userData.facadeUniform.value=v;}};
let terrainInfo=null;
let realismData={pois:[]},atmosphere=null;
let active=places.center,manifest=[],busy=false,stop=false,queuedTiles=null,retryTiles=null,flight=null,topView=false,selected=null,totalMapped=0;
const remoteCars=createRemoteCars(scene),roomPeers=new Set();let roomTransport=null,multiplayerUI=null,lastRoomSend=0;
const driving=createDriving({scene,camera,controls,onExit(){document.querySelector('#drive').textContent='Drive a car';},onTravel(x,z){if(busy)return;const lat=ORIGIN.lat-z/111320,lon=ORIGIN.lon+x/(111320*Math.cos(ORIGIN.lat*Math.PI/180));const ts=nearTiles(lat,lon).filter(t=>!loaded.has(t.id));if(ts.length)loadTiles(ts);else evictDistant(x,z);}});
createSoundscape(()=>({...driving.audioState,hour:+$('#time-of-day').value}));
$('#drive').onclick=()=>{if(driving.active){driving.exit();return;}flight=null;$('#close').click();if(!driving.start(controls.target.x,controls.target.z))status('Load a city area first','Driving needs a loaded street to start.','error');};
function status(title,sub='',state=''){ $('#status').textContent=title;$('#substatus').textContent=sub;$('#loading').className=state;$('#retry').hidden=state!=='error'; }
function leaveRoom(){roomTransport?.leave();roomTransport=null;for(const id of roomPeers)remoteCars.removePeer(id);roomPeers.clear();multiplayerUI?.setPeerCount(0);multiplayerUI?.setStatus('Not connected');}
function joinRoom(roomId){
 leaveRoom();
 try{
  roomTransport=createRoomTransport({roomId,worldId:world.inputHash,
   onPeerJoin(id){roomPeers.add(id);multiplayerUI.setPeerCount(roomPeers.size);multiplayerUI.setStatus('Connected');},
   onPeerLeave(id){roomPeers.delete(id);remoteCars.removePeer(id);multiplayerUI.setPeerCount(roomPeers.size);multiplayerUI.setStatus(roomPeers.size?'Connected':'Waiting for another driver');},
   onState(id,state){remoteCars.updatePeer(id,state);},
   onError(error){console.error('Multiplayer connection:',error);multiplayerUI.setStatus('Connection issue · '+(error?.message||error));}
  });
  multiplayerUI.setRoom(roomId);multiplayerUI.setStatus('Waiting for another driver');lastRoomSend=0;
 }catch(error){console.error('Could not join room:',error);multiplayerUI.setRoom(null);throw error;}
}
addEventListener('pagehide',leaveRoom);
function colorFor(r){const mode=$('#mode').value;if(mode==='source')return new THREE.Color({height:'#6bdcba',levels:'#73a9ef',estimate:'#ddb274'}[r.source]);if(mode==='height')return new THREE.Color().setHSL(.52-Math.min(r.height/110,1)*.48,.57,.57);return new THREE.Color().setHSL(.1+(r.id%7)*.004,.17,.65+(r.id%5)*.025);}
function fly(lat,lon,distance=1800){const [x,z]=project({lat,lon});const target=new THREE.Vector3(x,heightAt(x,z),z),offset=topView?new THREE.Vector3(0,distance,.1):new THREE.Vector3(distance*.48,distance*.65,distance*.8);flight={start:performance.now(),from:camera.position.clone(),to:target.clone().add(offset),fromTarget:controls.target.clone(),target};}
controls.addEventListener('start',()=>flight=null);
function nearTiles(lat,lon){return manifest.filter(t=>{const b=t.bbox;return lat>=b[0]-.007&&lat<=b[2]+.007&&lon>=b[1]-.01&&lon<=b[3]+.01;}).sort((a,b)=>{const d=t=>Math.hypot((t.bbox[0]+t.bbox[2])/2-lat,((t.bbox[1]+t.bbox[3])/2-lon)*.68);return d(a)-d(b);});}
function evictDistant(x=driving.position.x,z=driving.position.z){
 let changed=false;
 for(const t of manifest){
  const chunk=resident.get(t.id);if(!chunk)continue;
  const lo=project({lat:t.bbox[2],lon:t.bbox[1]}),hi=project({lat:t.bbox[0],lon:t.bbox[3]});
  if(Math.hypot(Math.max(lo[0]-x,0,x-hi[0]),Math.max(lo[1]-z,0,z-hi[1]))<3500)continue;
  disposeChunk(chunk);resident.delete(t.id);loaded.delete(t.id);changed=true;
 }
 if(changed){
  $('#close').click();records.length=pickables.length=chunks.length=0;totalMapped=0;
  driving.clearCompiled();
  for(const chunk of resident.values()){
   driving.addCompiled(chunk.physics);
   for(const m of chunk.meshes)if(m.userData.spans){pickables.push(m);chunks.push(m);for(const s of m.userData.spans){records.push(s.r);if(s.r.source!=='estimate')totalMapped++;}}
  }
  $('#count').textContent=records.length.toLocaleString();$('#known').textContent=records.length?Math.round(totalMapped/records.length*100)+'%':'—';
 }
}
async function getTile(t){return loadChunk(world,t);}
async function ingest(chunk){
 for(const m of chunk.meshes){
  const layer=m.userData.layer;
  (layer==='buildings'?buildings:layer==='greens'?greens:layer==='roads'?roads:layer==='vegetation'?atmosphere.vegetation:layer==='lamps'?atmosphere.lamps:layer==='details'?details.group:scene).add(m);
  if(m.userData.spans){pickables.push(m);chunks.push(m);for(const s of m.userData.spans){records.push(s.r);if(s.r.source!=='estimate')totalMapped++;}}
 }
 driving.addCompiled(chunk.physics);
 if($('#mode').value!=='material')recolor(chunk.meshes.filter(m=>m.userData.spans));
 facadeSetting.value=$('#mode').value==='material'&&$('#textures').checked?1:0;
 $('#count').textContent=records.length.toLocaleString();$('#known').textContent=records.length?Math.round(totalMapped/records.length*100)+'%':'—';$('#export').disabled=!records.length;
 applyTime();
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
    const chunk=result.value;await ingest(chunk);resident.set(t.id,chunk);loaded.add(t.id);
    await yieldToBrowser();
   }
  }
  if(driving.active)evictDistant();
 }catch(e){failed++;console.error(e);}
 finally{busy=false;$('#load').disabled=false;$('#city').textContent='Load wider city';}
 retryTiles=failed?pending.filter(t=>!loaded.has(t.id)):null;
 status(failed?'Some sections could not load':records.length?'Ready to explore':'No buildings loaded',failed?'Loaded areas remain visible. Retry to reload missing saved sections.':`${records.length.toLocaleString()} buildings · ${loaded.size} / ${manifest.length} city sections loaded`,failed?'error':'done');
 if(queuedTiles){const next=queuedTiles;queuedTiles=null;void loadTiles(next);}
}

function requestTiles(tiles){if(busy){queuedTiles=tiles;stop=true;$('#city').textContent='Switching area…';}else void loadTiles(tiles);}
$('#load').onclick=()=>{const [x,z]=[controls.target.x,controls.target.z];active=[ORIGIN.lat-z/111320,ORIGIN.lon+x/(111320*Math.cos(ORIGIN.lat*Math.PI/180))];const ts=nearTiles(...active);if(!ts.length){status('Outside the covered city area','Choose a neighbourhood to return to Chișinău.','error');return;}requestTiles(ts);};
$('#city').onclick=()=>{if(busy){stop=true;queuedTiles=null;$('#city').textContent='Finishing current section…';}else loadTiles(manifest,true);};
$('#retry').onclick=()=>requestTiles(retryTiles?.length?retryTiles:nearTiles(...active));$('#place').onchange=()=>{active=places[$('#place').value];fly(...active,$('#place').value.startsWith('bridge')?450:1800);requestTiles(nearTiles(...active));};$('#home').onclick=()=>{active=places.center;$('#place').value='center';fly(...active);};
$('#textures').onchange=e=>{facadeSetting.value=e.target.checked&&$('#mode').value==='material'?1:0;};
$('#parks').onchange=e=>greens.visible=e.target.checked;$('#roads').onchange=e=>roads.visible=e.target.checked;$('#orbit').onchange=e=>controls.autoRotate=e.target.checked;

$('#mode').onchange=()=>{const mode=$('#mode').value;facadeSetting.value=mode==='material'&&$('#textures').checked?1:0;$('#legend').innerHTML=mode==='source'?'<i style="background:#6bdcba"></i> Height tag<br><i style="background:#73a9ef"></i> Derived from mapped floors<br><i style="background:#ddb274"></i> Estimated height':mode==='height'?'<i style="background:#51c0c8"></i> Low-rise → <i style="background:#e4a34f"></i> High-rise':'<i style="background:#ead6b5"></i> Footprints extruded to height';recolor(chunks);};
function recolor(meshes){for(const m of meshes){const colors=m.geometry.attributes.color,normals=m.geometry.attributes.normal;let start=0;for(const span of m.userData.spans){const c=colorFor(span.r);for(let i=start;i<span.end*3;i++){const f=normals.getY(i)>.6?1.1:.83;colors.setXYZ(i,c.r*f,c.g*f,c.b*f);}start=span.end*3;}colors.needsUpdate=true;}}

$('#top').onclick=()=>{topView=!topView;$('#top').textContent=topView?'3D':'2D';const d=camera.position.distanceTo(controls.target);camera.position.copy(controls.target).add(topView?new THREE.Vector3(0,d,.01):new THREE.Vector3(d*.48,d*.65,d*.8));};$('#north').onclick=()=>{const d=camera.position.distanceTo(controls.target);camera.position.copy(controls.target).add(new THREE.Vector3(0,d*.8,d*.7));topView=false;$('#top').textContent='2D';};$('#plus').onclick=()=>camera.position.sub(controls.target).multiplyScalar(.75).add(controls.target);$('#minus').onclick=()=>camera.position.sub(controls.target).multiplyScalar(1.3).add(controls.target);
const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();let pointerStart;
renderer.domElement.addEventListener('pointerdown',e=>pointerStart=[e.clientX,e.clientY]);renderer.domElement.addEventListener('pointerup',e=>{if(driving.active||!pointerStart||Math.hypot(e.clientX-pointerStart[0],e.clientY-pointerStart[1])>5)return;pointer.set(e.clientX/innerWidth*2-1,1-e.clientY/innerHeight*2);ray.setFromCamera(pointer,camera);const hit=ray.intersectObjects(pickables,false)[0];if(!hit)return;const spans=hit.object.userData.spans;let low=0,high=spans.length-1;while(low<high){const mid=(low+high)>>1;if(hit.faceIndex<spans[mid].end)high=mid;else low=mid+1;}const r=spans[low].r;$('#inspect').hidden=false;$('#bname').textContent=r.tags.name||r.tags['name:ro']||[r.tags['addr:street'],r.tags['addr:housenumber']].filter(Boolean).join(' ')||'Mapped '+(r.tags.building==='yes'?'building':r.tags.building);$('#bdetails').replaceChildren();for(const [a,b] of [['Height',r.height.toFixed(1)+' m'],['Method',{height:'Mapped height',levels:'Mapped floors → height',estimate:'Estimated'}[r.source]],['Footprint',Math.round(r.area).toLocaleString()+' m²'],['Mapped floors',r.floors??'Not available']]){const p=document.createElement('p'),s=document.createElement('strong');p.textContent=a;s.textContent=b;p.append(s);$('#bdetails').append(p);}$('#osmlink').href='https://www.openstreetmap.org/'+r.type+'/'+r.id;if(selected){scene.remove(selected);selected.geometry.dispose();selected.material.dispose();}const start=low?spans[low-1].end*3:0,end=spans[low].end*3;const pos=hit.object.geometry.attributes.position.array.slice(start*3,end*3),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));selected=new THREE.LineSegments(new THREE.EdgesGeometry(g,25),new THREE.LineBasicMaterial({color:'#f3fcab',depthTest:false}));g.dispose();selected.renderOrder=5;scene.add(selected);});
$('#close').onclick=()=>{$('#inspect').hidden=true;if(selected){scene.remove(selected);selected.geometry.dispose();selected.material.dispose();selected=null;}};
$('#about').onclick=()=>$('#info').showModal();$('#info-close').onclick=()=>$('#info').close();$('#info').addEventListener('click',e=>{if(e.target===$('#info')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
$('#export').onclick=()=>{const blob=new Blob([buildingCsv(records)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='chisinau-buildings.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);};
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();status('Graphics context lost','Reload the page to restart the map.','error');});
let perfStart=performance.now(),perfFrames=0,perfMs=[];
let lastFrame=performance.now();
function animate(now){requestAnimationFrame(animate);const elapsed=(now-lastFrame)/1000;const dt=Math.min(elapsed,.04);lastFrame=now;perfFrames++;perfMs.push(elapsed*1000);if(now-perfStart>2000){perfMs.sort((a,b)=>a-b);$('#perf').textContent=Math.round(perfFrames*1000/(now-perfStart))+' FPS · p95 '+Math.round(perfMs[Math.floor(perfMs.length*.95)]||0)+' ms · '+renderer.info.render.calls+' draws · '+renderer.info.render.triangles.toLocaleString()+' triangles';const drivePerf=$('#drive-perf');if(drivePerf)drivePerf.textContent=$('#perf').textContent;perfFrames=0;perfMs=[];perfStart=now;}atmosphere?.update(now,camera.position);if(driving.active)driving.update(Math.min(elapsed,.2));remoteCars.update(dt);if(roomTransport&&now-lastRoomSend>=70){roomTransport.sendState(driving.networkState);lastRoomSend=now;}if(driving.active){renderer.render(scene,camera);return;}if(flight){const t=Math.min((now-flight.start)/1100,1),s=t*t*(3-2*t);camera.position.lerpVectors(flight.from,flight.to,s);controls.target.lerpVectors(flight.fromTarget,flight.target,s);if(t===1)flight=null;}if(!flight)controls.target.y=heightAt(controls.target.x,controls.target.z);camera.position.y=Math.max(camera.position.y,heightAt(camera.position.x,camera.position.z)+3);controls.update();renderer.render(scene,camera);}requestAnimationFrame(animate);
let world,details;
try{
 world=await loadWorld();
 multiplayerUI=createMultiplayerUI({onJoin:joinRoom,onLeave:leaveRoom});
 terrainInfo=world.terrain;configureTerrain(terrainInfo.meta,world.heights,terrainInfo.profiles);
 ground.position.y=terrainInfo.meta.minElevation-terrainInfo.meta.offset-20;grid.visible=false;
 realismData={pois:world.pois};setupDestinations();manifest=world.chunks;
 atmosphere=addAtmosphere(scene,realismData,{vegetation:new THREE.Group(),lamps:new THREE.Group(),heads:world.lampHeads,materials:world.materials});
 details={group:new THREE.Group()};scene.add(details.group);
 $('#landscape').onchange=e=>atmosphere.vegetation.visible=e.target.checked;
 $('#street-details').onchange=e=>details.group.visible=e.target.checked;
 $('#street-count').textContent=world.details.trees.toLocaleString()+' trees · '+world.details.benches.toLocaleString()+' benches';
 for(const [i,p] of world.bridges.entries()){places['bridge'+i]=p.location;const o=document.createElement('option');o.value='bridge'+i;o.textContent='Bridge · '+p.name;$('#place').append(o);}
 await loadTiles(nearTiles(...active));
}catch(e){status('The city data could not load','Run npm run build, then reload. '+e.message,'error');console.error(e);}

function setupDestinations(){const select=$('#destination');realismData.pois.sort((a,b)=>a.name.localeCompare(b.name,'ro'));for(const [i,p] of realismData.pois.entries()){const o=document.createElement('option');o.value=i;o.textContent=p.name;select.append(o);}select.onchange=()=>{if(select.value===''){driving.setDestination(null);return;}const p=realismData.pois[+select.value],xz=project(p);driving.setDestination({name:p.name,x:xz[0],z:xz[1]});if(!driving.active){active=[p.lat,p.lon];fly(p.lat,p.lon,500);requestTiles(nearTiles(...active));}};}

function applyTime(){const hour=+$('#time-of-day').value,daylight=Math.max(0,Math.sin((hour-6)/12*Math.PI)),twilight=(hour>=5&&hour<7)||(hour>=17&&hour<20),night=daylight<.15;$('#clock-label').textContent=String(Math.floor(hour)%24).padStart(2,'0')+':'+String(Math.round((hour%1)*60)).padStart(2,'0');ambient.intensity=.16+daylight*1.94;sun.intensity=daylight*3.4;sun.position.set(Math.cos((hour-6)/12*Math.PI)*3000,Math.max(50,daylight*3000),1800);scene.background.set(night?(twilight?'#26354b':'#070d1e'):'#172b36');scene.fog.color.copy(scene.background);atmosphere?.setDusk(night);driving.setDusk(night);$('#night-skip').textContent=night?'Skip to day':'Skip to night';}
$('#time-of-day').oninput=applyTime;$('#night-skip').onclick=()=>{$('#time-of-day').value=$('#night-skip').textContent==='Skip to day'?12:22;applyTime();};$('#day-skip').onclick=()=>{$('#time-of-day').value=12;applyTime();};$('#dusk-skip').onclick=()=>{$('#time-of-day').value=18.5;applyTime();};
