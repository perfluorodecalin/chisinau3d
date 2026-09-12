import * as T from 'three';
import {WORLD_VERSION,decodeChunk} from './world-format.js';
import {installFacades} from './facades.js';
import {installRoadSurface} from './road-material.js';

export const worldMetrics={decodedChunks:0,disposedChunks:0};

async function response(path){const r=await fetch(new URL(path,import.meta.url));if(!r.ok)throw Error(`City asset unavailable (${r.status}): ${path}`);return r;}
export async function decodeWorldResponse(r){
 // Some hosts (including Vite) serve .gz files with Content-Encoding: gzip.
 // Fetch has already decompressed those bodies; static hosts may serve raw gzip.
 const bytes=await r.arrayBuffer(),magic=new Uint8Array(bytes,0,Math.min(2,bytes.byteLength));
 if(magic[0]!==0x1f||magic[1]!==0x8b)return bytes;
 return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
async function binary(path){return decodeWorldResponse(await response(path));}
export async function loadWorld(){
 const world=await(await response('./world/manifest.json')).json();
 if(world.version!==WORLD_VERSION)throw Error('City build version does not match the engine');
 const loader=new T.MaterialLoader();
 world.materials=world.materials.map(json=>{const m=loader.parse(json);if(m.userData.cityShader==='facade')m.userData.facadeUniform=installFacades(m);if(m.userData.cityShader==='road')installRoadSurface(m);return m;});
 world.heights=new Float32Array(await binary('./world/'+world.heightFile));return world;
}
export async function loadChunk(world,chunk){const result=decodeChunk(await binary('./world/'+chunk.file),world.materials);worldMetrics.decodedChunks++;return result;}
export function disposeChunk(chunk){
 const geometries=new Set();for(const m of chunk.meshes){m.removeFromParent();geometries.add(m.geometry);if(m.isInstancedMesh)m.dispose();}
 for(const g of geometries)g.dispose();worldMetrics.disposedChunks++;
}
