import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {worldInputHash} from '../scripts/world-inputs.mjs';

const rootPath=await fs.mkdtemp(path.join(os.tmpdir(),'chisinau-world-inputs-'));
const write=async(name,content)=>{
 const file=path.join(rootPath,name);
 await fs.mkdir(path.dirname(file),{recursive:true});
 await fs.writeFile(file,content);
};
try{
 await write('package-lock.json',JSON.stringify({packages:{'node_modules/three':{version:'1.0.0',integrity:'sha512-example'}}}));
 await write('scripts/build-world.mjs',"import {geometry} from '../dist/geometry.js'; console.log(geometry);");
 await write('dist/geometry.js','export const geometry = 1;');
 await write('dist/data/tile.json','{"roads":1}');
 await write('dist/mobile-ui.js','export const menu = 1;');
 const options={rootPath};
 const original=await worldInputHash(options);
 await write('dist/mobile-ui.js','export const menu = 2;');
 assert.equal(await worldInputHash(options),original,'UI changes should reuse the city');
 await write('dist/geometry.js','export const geometry = 2;');
 const changedGeometry=await worldInputHash(options);
 assert.notEqual(changedGeometry,original,'compiler dependency changes should rebuild');
 await write('dist/geometry.js','export const geometry = 1;');
 await write('dist/data/tile.json','{"roads":2}');
 assert.notEqual(await worldInputHash(options),original,'snapshot changes should rebuild');
 await write('dist/data/tile.json','{"roads":1}');
 await write('package-lock.json',JSON.stringify({packages:{'node_modules/three':{version:'2.0.0',integrity:'sha512-other'}}}));
 assert.notEqual(await worldInputHash(options),original,'Three.js changes should rebuild');
 console.log('World input cache boundaries passed.');
}finally{
 await fs.rm(rootPath,{recursive:true,force:true});
}
