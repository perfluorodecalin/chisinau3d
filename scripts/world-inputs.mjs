import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Content hashes, not timestamps, make cache invalidation portable across checkouts.
export async function worldInputHash(){
 const root=new URL('../',import.meta.url),hash=createHash('sha256');
 const inputs=['package-lock.json'];
 for(const directory of ['dist','dist/data','scripts'])for(const entry of await fs.readdir(new URL(directory+'/',root),{withFileTypes:true})){
  if(entry.isFile()&&(directory==='dist/data'||/\.(mjs|js)$/.test(entry.name)))inputs.push(directory+'/'+entry.name);
 }
 for(const name of inputs.sort()){hash.update(name);hash.update(await fs.readFile(new URL(name,root)));}
 return hash.digest('hex');
}
