import fs from 'node:fs/promises';
import {worldInputHash} from './world-inputs.mjs';

const output=new URL('../dist/world/',import.meta.url);
let current=false;
try{
 const manifest=JSON.parse(await fs.readFile(new URL('manifest.json',output),'utf8'));
 if(manifest.inputHash===await worldInputHash()&&Array.isArray(manifest.chunks)&&Array.isArray(manifest.lodChunks)){
  const files=new Set(await fs.readdir(output));
  current=typeof manifest.heightFile==='string'&&files.has(manifest.heightFile)
   &&[...manifest.chunks,...manifest.lodChunks].every(chunk=>typeof chunk.file==='string'&&files.has(chunk.file));
 }
}catch(error){
 if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;
}
if(current)console.log('Compiled world is current; skipping compilation.');
else await import('./build-world.mjs');
