import assert from 'node:assert/strict';
import {createLodController} from '../dist/lod.js';
import {createWorldStreamer} from '../dist/world-streamer.js';

const camera={position:{x:0,y:0,z:0,distanceTo(p){return Math.hypot(this.x-p.x,this.y-p.y,this.z-p.z);}}};
const mesh=(layer,x)=>({userData:{layer},geometry:{boundingSphere:{center:{x,y:0,z:0,clone(){return {x:this.x,y:this.y,z:this.z};}},radius:0}},parent:{},visible:true,localToWorld(p){return p;}});
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));

// Distance culling is layered: driving surfaces and terrain remain available,
// while atmosphere-owned layers retain their own visibility policy.
{
  let emitted;
  const lod=createLodController({camera,interval:0,onStats:stats=>{emitted=stats;}});
  const detail=mesh('details',6000),road=mesh('roads',6000),terrain=mesh('terrain',6000),vegetation=mesh('vegetation',6000);
  vegetation.userData.atmosphereVisible=false;
  lod.register(detail);lod.register(road);lod.register(terrain);lod.register(vegetation);lod.update(1,true);
  assert.equal(detail.visible,false,'distant detail should be culled');
  assert.equal(road.visible,true,'roads remain visible at distance');
  assert.equal(terrain.visible,true,'terrain remains visible at distance');
  assert.equal(vegetation.visible,false,'atmosphere visibility remains authoritative');
  assert.equal(detail.userData.lodVisible,false,'logical LOD state is exposed on the mesh');
  assert.deepEqual(emitted,lod.stats(),'stats callback must receive the current snapshot');
  assert.equal(emitted.visible,2);
  assert.equal(emitted.hidden,1);
  assert.ok(emitted.swaps>=1);
  assert.equal(lod.size(),3,'atmosphere-owned layers are not registered with LOD');
  lod.unregister(detail);assert.equal(lod.size(),2);
}

// A culled mesh should not flap at the edge of its limit. It returns only once
// it crosses the inner hysteresis threshold, and disappears at the outer one.
{
  const lod=createLodController({camera,interval:0,hysteresis:.2});
  const detail=mesh('details',6000);
  lod.register(detail);lod.update(1,true);
  assert.equal(detail.visible,false);
  camera.position.x=1100;lod.update(2,true);
  assert.equal(detail.visible,false,'culled detail should stay hidden in the hysteresis band');
  camera.position.x=2000;lod.update(3,true);
  assert.equal(detail.visible,true,'detail should reappear after entering the inner band');
  camera.position.x=1100;lod.update(4,true);
  assert.equal(detail.visible,true,'visible detail should remain through the hysteresis band');
  camera.position.x=0;lod.update(5,true);
  assert.equal(detail.visible,false,'detail should cull after leaving the outer band');
}

// Variant selection uses the first matching distance and the final variant as
// a safe fallback when an object is farther away than every declared level.
{
  camera.position.x=0;
  const lod=createLodController({camera,interval:0,minDwell:0});
  const variant=mesh('buildings',0);
  variant.userData.lodVariants=[
    {file:'near.bin',maxDistance:300,visible:true},
    {file:'middle.bin',maxDistance:900,visible:false},
    {file:'far.bin',maxDistance:Infinity,visible:true}
  ];
  lod.register(variant);lod.update(1,true);
  assert.equal(variant.visible,true,'near variant should be visible');
  camera.position.x=500;lod.update(2,true);
  assert.equal(variant.visible,false,'middle variant visibility should be honored');
  camera.position.x=1200;lod.update(3,true);
  assert.equal(variant.visible,true,'last variant is the far-distance fallback');
}

// Visual registration and disposal never mutate gameplay state. This guards
// the boundary between visual LOD ownership and collision/physics residency.
{
  camera.position.x=0;
  const lod=createLodController({camera,interval:0});
  const physics={obstacles:[{x:12,z:-8,minY:0,maxY:4}]};
  const detail=mesh('details',6000);detail.userData.physics=physics;
  const before=JSON.stringify(physics);
  lod.register(detail);lod.update(1,true);lod.unregister(detail);lod.update(2,true);
  assert.equal(JSON.stringify(physics),before,'LOD changes must preserve physics data');
  assert.equal(lod.size(),0,'disposed/unregistered meshes leave no controller entry');
}

// Terrain may arrive already decoded at its distant LOD. The streamer must
// retain that level without requesting the canonical 5 m mesh, then refine and
// dispose each replaced visual as the camera moves.
{
  camera.position.x=5000;
  const requested=[],detached=[];
  const t0=performance.now();
  const world={materials:[]};
  const terrain={id:'terrain',bounds:{min:{x:1000,y:-1,z:-10},max:{x:2000,y:1,z:10}},file:'canonical.bin',visualVariants:[
    {level:'near',maxDistance:250,file:'near.bin'},
    {level:'middle',maxDistance:900,file:'middle.bin'},
    {level:'far',maxDistance:Infinity,file:'far.bin'}
  ]};
  const streamer=createWorldStreamer({world,camera,interval:0,minDwell:0,
    loadVisual:async(_world,_chunk,variant)=>{requested.push(variant.file);return {meshes:[]};},
    onVisualDetach:({level})=>detached.push(level)
  });
  assert.equal(streamer.desiredIndex(terrain),2,'desiredIndex should select far without registering a chunk');
  assert.equal(streamer.metrics().resident,0,'LOD selection alone must not create streamer state');
  streamer.update(t0,true);await flush();
  assert.deepEqual(requested,[],'LOD selection alone must not schedule a visual request');
  streamer.register(terrain,{meshes:[]},{physics:false,initialPhysics:false,initialLevel:2});
  assert.deepEqual(requested,[],'preloaded far terrain must not request canonical or another visual');
  assert.equal(streamer.get('terrain').index,2);
  camera.position.x=1000;streamer.update(performance.now()+1,true);await flush();
  assert.deepEqual(requested,['near.bin'],'moving near should request only the near visual');
  assert.equal(streamer.get('terrain').index,0);
  camera.position.x=5000;streamer.update(performance.now()+1,true);await flush();
  assert.deepEqual(requested,['near.bin','far.bin'],'moving far should request the far visual');
  assert.deepEqual(detached,[2,0],'each replaced visual should be detached and disposed');
}

// Ordinary city chunks still use their canonical initial payload as gameplay
// physics residency; the terrain optimization must not disable that path.
{
  camera.position.x=0;
  const physics={obstacles:[{x:1,z:2}]},initial={meshes:[],physics};
  const streamer=createWorldStreamer({world:{materials:[]},camera,interval:0});
  streamer.register({id:'city',file:'city.bin'},initial,{physics:false});
  assert.equal(streamer.get('city').physics,physics,'canonical city chunks retain initial physics');
}

console.log(JSON.stringify({lod:'distance layers, hysteresis, variants, disposal and physics invariance pass'}));
