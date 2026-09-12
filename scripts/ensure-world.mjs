import fs from 'node:fs/promises';
import {worldInputHash} from './world-inputs.mjs';
let valid=false;
try {const m=JSON.parse(await fs.readFile(new URL('../dist/world/manifest.json',import.meta.url),'utf8'));valid=m.inputHash===await worldInputHash();}
catch {}
if(!valid)await import('./build-world.mjs');
