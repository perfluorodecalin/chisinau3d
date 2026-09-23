import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as T from 'three';
import {FixedStepper,stepCar,CollisionMap,closest} from '../dist/driving-physics.js';
import {SegmentIndex,spatialBatches} from '../dist/spatial.js';
import {ribbonPositions,loadRoadModel,roadTags,roadPositions,roadProfile} from '../dist/road-model.js';
import {roadWidth,laneGeometry,addAtmosphere} from '../dist/realism.js';
import {configureTerrain,heightAt,roadHeight,driveHeight,loadTerrain} from '../dist/terrain.js';
import {project} from '../dist/model.js';
const json=async name=>JSON.parse(await fs.readFile(new URL('../dist/data/'+name,import.meta.url),'utf8'));
globalThis.fetch=async url=>({ok:true,json:()=>json(url.split('/').at(-1)),arrayBuffer:async()=>{const b=await fs.readFile(new URL('../dist/data/'+url.split('/').at(-1),import.meta.url));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}});
await loadRoadModel();
const roadData=await json('road-model.json');
assert.equal(roadWidth(roadTags(49802600,{highway:'tertiary',lanes:'12'})),6.4);
assert.equal(roadProfile(49802600).tags.lanes,'2');
assert.equal(roadData.corrections.length,1);
function simulate(fps){const state={x:0,z:0,heading:0,speed:0,steer:0},clock=new FixedStepper();for(let i=0;i<fps*10;i++)clock.advance(1/fps,dt=>stepCar(state,{forward:true,steer:.2},dt,()=>false));return state;}
const baseline=simulate(60);for(const fps of [15,20,30,120,144]){const state=simulate(fps);for(const k of Object.keys(state))assert.ok(Math.abs(state[k]-baseline[k])<1e-7,`${fps} FPS ${k}`);}
const car={x:0,z:0,heading:0,speed:30,steer:0};for(let i=0;i<20;i++)stepCar(car,{steer:0},1/60,(x,z)=>z>=4);assert.ok(car.z<2.66,'front bumper stops before wall');
for(let i=0;i<60;i++)stepCar(car,{reverse:true,steer:0},1/60,(x,z)=>z>=4);assert.ok(car.speed<0,'can reverse away');
const map=new CollisionMap(),wall={outer:[[-2,-2],[2,-2],[2,2],[-2,2],[-2,-2]],holes:[],minY:0,maxY:3};map.add(wall);assert.ok(map.blocked(0,0,1,0));assert.ok(!map.blocked(0,0,1,6));map.remove(wall);assert.ok(!map.blocked(0,0,1,0),'evicted collision geometry leaves the local buckets');
const index=new SegmentIndex();for(let x=0;x<10000;x+=10)index.add({a:[x,0],b:[x+10,0]});assert.ok(index.near(0,0,100).length<30);assert.ok(index.near(5000,0,20).some(s=>closest(5005,0,s.a,s.b).d===0));
const removedRoad={a:[-40,-40],b:[140,140]};index.add(removedRoad);assert.ok(index.near(0,0,10).includes(removedRoad));index.remove(removedRoad);assert.ok(!index.near(0,0,10).includes(removedRoad),'evicted road leaves every intersected bucket');
const ribbon=ribbonPositions([[0,0],[0,20],[20,20]],6);
assert.ok(ribbon.every(Number.isFinite));for(let i=18;i<ribbon.length;i+=18){assert.deepEqual(ribbon.slice(i,i+3),ribbon.slice(i-12,i-9));assert.deepEqual(ribbon.slice(i+3,i+6),ribbon.slice(i-3,i));}
// Shared endpoint widths must match even for short segments.
const short=ribbonPositions([[0,0],[0,5]],4,.13,{0:{width:6},1:{width:8}});assert.equal(Math.abs(short[0]-short[3]),6);assert.equal(Math.abs(short.at(-3)-short[6]),8);
const area={id:0,tags:{highway:'pedestrian',area:'yes'},geometry:[{lat:47.0245,lon:28.8323},{lat:47.0246,lon:28.8323},{lat:47.0246,lon:28.8324},{lat:47.0245,lon:28.8324},{lat:47.0245,lon:28.8323}]};assert.equal(roadPositions(area,5).length,18);assert.equal(laneGeometry({...area,tags:{...area.tags,gameArea:true,lanes:'2'}}),null);
let roadCount=0,triangles=0;for(const file of ['center.json',...(await json('manifest.json')).map(t=>t.id+'.json')]){for(const e of (await json(file)).elements){if(!e.tags?.highway||!e.geometry?.length)continue;e.tags=roadTags(e.id,e.tags);if(e.tags.gameHidden)continue;const p=roadPositions(e,roadWidth(e.tags));assert.ok(p.every(Number.isFinite),'finite road '+e.id);triangles+=p.length/9;roadCount++;}}
const scene=new T.Scene();const terrain=await loadTerrain(scene);assert.equal(terrain.meta.step,5);assert.match(terrain.meta.source,/Geoportal INDS/);assert.match(terrain.meta.verticalUnit,/inferred/);assert.match(terrain.meta.verticalDatum,/Baltic 1977.*inferred/);assert.ok(scene.children.length>100);assert.equal(scene.children.reduce((n,m)=>n+m.geometry.index.count/3,0),(terrain.meta.nx-1)*(terrain.meta.nz-1)*2);
let joinsChecked=0;const heights=new Map();for(const p of Object.values(terrain.profiles))for(const q of [p.points[0],p.points.at(-1)]){const key=q[0]+','+q[1];if(heights.has(key)){assert.ok(Math.abs(q[2]-heights.get(key))<.01);joinsChecked++;}heights.set(key,q[2]);}
const atmosphereScene=new T.Scene(),data=await json('realism.json');const lights=addAtmosphere(atmosphereScene,{...data,green:[],pois:[]});lights.setDusk(true);const h=data.lampPoints[100];for(let now=0;now<5000;now+=16)lights.update(now,new T.Vector3(h.x,10,h.z));const pointLights=atmosphereScene.children.filter(c=>c.isPointLight);assert.equal(pointLights.length,8);assert.ok(pointLights.some(l=>l.intensity>90));assert.ok(pointLights.every(l=>Number.isFinite(l.position.x)));lights.setDusk(false);assert.ok(pointLights.every(l=>l.intensity===0));
const instanceMeshes=lights.lamps.children;assert.ok(instanceMeshes.every(m=>m.boundingSphere.radius<1100),'lamp batches have local bounds');
assert.ok(pointLights.every(l=>!l.visible),'daylight excludes local lights from shader loops');
const glows=instanceMeshes.filter(m=>m.material.isShaderMaterial);assert.ok(glows.length>0);
assert.ok(glows.every(m=>!m.visible),'daylight skips transparent lamp glow draws');
lights.update(10000,new T.Vector3(h.x,10,h.z));assert.ok(glows.every(m=>!m.visible),'visibility refresh must not restore daytime glows');
lights.setDusk(true);assert.ok(pointLights.every(l=>l.visible),'night restores the same bounded light pool');
lights.update(11000,new T.Vector3(h.x,10,h.z));assert.ok(glows.some(m=>m.visible),'nearby night glows remain visible');
console.log(JSON.stringify({physics:'same path at 15–144 FPS; collision and reverse pass',roads:roadCount,roadTriangles:triangles,terrainPatches:scene.children.length,bridgeEndpointsChecked:joinsChecked,localLampLights:pointLights.length,lampBatches:instanceMeshes.length},null,2));
