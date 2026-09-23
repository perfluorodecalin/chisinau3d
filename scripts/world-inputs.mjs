import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root=fileURLToPath(new URL('../',import.meta.url));

// Follow the compiler's local imports so new geometry modules are included
// automatically. npm packages are external; Three's locked version is recorded below.
async function compilerSources(rootPath,entryPoint){
 const result=await build({entryPoints:[entryPoint],absWorkingDir:rootPath,bundle:true,packages:'external',platform:'node',format:'esm',metafile:true,write:false,logLevel:'silent'});
 return Object.keys(result.metafile.inputs).sort();
}

// Content hashes make cache keys portable across checkouts and independent of mtimes.
export async function worldInputHash({rootPath=root,entryPoint='scripts/build-world.mjs'}={}){
 const hash=createHash('sha256');
 const lock=JSON.parse(await fs.readFile(path.join(rootPath,'package-lock.json'),'utf8'));
 const three=lock.packages?.['node_modules/three'];
 if(!three?.version||!three?.integrity)throw Error('Missing locked Three.js package');
 hash.update('node-major');hash.update(process.versions.node.split('.')[0]);
 hash.update('three');hash.update(three.version);hash.update(three.integrity);
 const data=(await fs.readdir(path.join(rootPath,'dist/data'),{withFileTypes:true}))
  .filter(entry=>entry.isFile()).map(entry=>'dist/data/'+entry.name);
 for(const name of [...new Set([...await compilerSources(rootPath,entryPoint),...data])].sort()){
  hash.update(name);hash.update(await fs.readFile(path.join(rootPath,name)));
 }
 return hash.digest('hex');
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)
 console.log(await worldInputHash());
