// Optional real-browser benchmark; no browser automation dependency is required.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';

const {values:options}=parseArgs({options:{
  root:{type:'string',default:fileURLToPath(new URL('../dist/',import.meta.url))},
  output:{type:'string'},url:{type:'string'},timeout:{type:'string',default:'240'},
  profile:{type:'boolean',default:false},'world-smoke':{type:'boolean',default:false}
}});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const root=path.resolve(options.root);
const output=path.resolve(options.output||await fs.mkdtemp(path.join(os.tmpdir(),'chisinau3d-benchmark-')));
await fs.mkdir(output,{recursive:true});
const browserPath=process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';
await fs.access(browserPath);
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'chisinau3d-chrome-'));
const server=http.createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(!pathname.startsWith('/chisinau3d/'))throw Error('Unknown path');
    const relative=pathname.slice('/chisinau3d/'.length)||'index.html';
    const file=path.resolve(root,relative);
    if(!file.startsWith(root+path.sep))throw Error('Outside static root');
    const body=await fs.readFile(file);
    res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.bin':'application/octet-stream'})[path.extname(file)]||'application/octet-stream');
    res.end(body);
  }catch{res.statusCode=404;res.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=options.url||`http://127.0.0.1:${server.address().port}/chisinau3d/`;
const browser=spawn(browserPath,['--headless=new','--no-first-run','--no-default-browser-check',
  '--remote-debugging-port=0','--user-data-dir='+profile,'--window-size=1280,720',
  '--disable-background-timer-throttling','--disable-renderer-backgrounding','about:blank'],
  {windowsHide:true,stdio:'ignore'});
let socket;
const errors=[],requests=[];
try{
  let port;
  for(let i=0;i<100;i++){
    try{port=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}
    catch{await sleep(100);}
  }
  if(!port)throw Error('Chrome did not open its debugging port');
  const targets=await(await fetch(`http://127.0.0.1:${port}/json`)).json();
  socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let id=0;const pending=new Map();
  socket.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    if(message.id){const entry=pending.get(message.id);if(entry){clearTimeout(entry.timer);pending.delete(message.id);message.error?entry.reject(Error(message.error.message)):entry.resolve(message.result);}return;}
    if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);
    if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')errors.push(message.params.args.map(a=>a.description||a.value));
    if(message.method==='Network.loadingFailed')errors.push(message.params);
    if(message.method==='Network.responseReceived')requests.push({url:message.params.response.url,status:message.params.response.status});
  });
  const call=(method,params={})=>new Promise((resolve,reject)=>{
    const requestId=++id;
    const timer=setTimeout(()=>{pending.delete(requestId);reject(Error(`Timed out: ${method}`));},90000);
    pending.set(requestId,{resolve,reject,timer});socket.send(JSON.stringify({id:requestId,method,params}));
  });
  const evaluate=async expression=>{
    const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
    return result.result.value;
  };
  await call('Runtime.enable');await call('Page.enable');await call('Network.enable');
  await call('Network.setCacheDisabled',{cacheDisabled:true});
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.__benchmark={frames:[],longTasks:[],lodSamples:[],lodLast:0,last:0,record:false};
    // LOD is optional while older snapshots are benchmarked. Newer runtimes
    // can expose either a metrics snapshot or the controller itself through
    // one of these stable diagnostic handles.
    __benchmark.readLod=()=>{try{
      const raw=globalThis.__chisinau3d?.lodMetrics??globalThis.__lodMetrics??globalThis.__chisinau3d?.lod??null;
      if(raw==null)return null;
      const value=typeof raw==='function'?raw():typeof raw.snapshot==='function'?raw.snapshot():typeof raw.stats==='function'?raw.stats():raw;
      return structuredClone(value);
    }catch(error){return {error:String(error)}}};
    new PerformanceObserver(list=>{for(const e of list.getEntries())__benchmark.longTasks.push({start:e.startTime,duration:e.duration});}).observe({type:'longtask',buffered:true});
    function frame(now){
      if(__benchmark.record&&__benchmark.last)__benchmark.frames.push(now-__benchmark.last);
      if(__benchmark.record&&now-__benchmark.lodLast>=500){const lod=__benchmark.readLod();if(lod!=null)__benchmark.lodSamples.push({t:now,data:lod});__benchmark.lodLast=now;}
      __benchmark.last=now;requestAnimationFrame(frame);
    }requestAnimationFrame(frame);
  `});
  if(options.profile){await call('Profiler.enable');await call('Profiler.setSamplingInterval',{interval:1000});await call('Profiler.start');}
  await call('Page.navigate',{url});
  const start=Date.now();let state,ready=false;
  while(Date.now()-start<Number(options.timeout)*1000){
    await sleep(5000);
    state=await evaluate(`({status:document.querySelector('#status')?.textContent,detail:document.querySelector('#substatus')?.textContent,buildings:document.querySelector('#count')?.textContent,street:document.querySelector('#street-count')?.textContent,performance:document.querySelector('#perf')?.textContent,lod:__benchmark.readLod(),ms:performance.now()})`);
    console.log(JSON.stringify({phase:'loading',...state}));
    if(state.status==='Ready to explore'&&/benches/.test(state.street)){ready=true;break;}
    if(/could not|unavailable/i.test(state.status))break;
  }
  if(options.profile){const result=await call('Profiler.stop');await fs.writeFile(path.join(output,'startup.cpuprofile'),JSON.stringify(result.profile));}
  const environment=await evaluate(`(()=>{const canvas=document.querySelector('canvas'),gl=canvas?.getContext('webgl2'),ext=gl?.getExtension('WEBGL_debug_renderer_info');return {userAgent:navigator.userAgent,width:innerWidth,height:innerHeight,dpr:devicePixelRatio,gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,heap:performance.memory?.usedJSHeapSize};})()`);
  const phases=[];
  async function measure(name){
    await evaluate('__benchmark.frames=[];__benchmark.lodSamples=[];__benchmark.lodLast=0;__benchmark.record=true');
    await sleep(10000);
    const result=await evaluate(`(()=>{__benchmark.record=false;const frames=__benchmark.frames.slice().sort((a,b)=>a-b);return {frames:frames.length,fps:1000/(frames.reduce((a,b)=>a+b,0)/frames.length),p95:frames[Math.floor(frames.length*.95)],max:frames.at(-1),hud:document.querySelector('#perf').textContent,heap:performance.memory?.usedJSHeapSize,driving:document.body.classList.contains('driving'),lod: {latest:__benchmark.lodSamples.at(-1)?.data??__benchmark.readLod(),samples:__benchmark.lodSamples.slice()}};})()`);
    phases.push({name,...result});console.log(JSON.stringify({phase:name,...result}));
  }
  if(ready){
    if(options['world-smoke']){
      let picked=null;
      picking:for(let y=180;y<650;y+=70)for(let x=380;x<1150;x+=70){
        await call('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
        await call('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
        picked=await evaluate("document.querySelector('#inspect').hidden?null:document.querySelector('#osmlink').href");
        if(picked)break picking;
      }
      if(!picked?.includes('openstreetmap.org/'))throw Error('Compiled building picking failed');
      await evaluate("document.querySelector('#close').click();document.querySelector('#mode').value='source';document.querySelector('#mode').dispatchEvent(new Event('change'))");
      await sleep(1000);
      await evaluate("document.querySelector('#mode').value='material';document.querySelector('#mode').dispatchEvent(new Event('change'))");
      const atlas=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'atlas.png'),Buffer.from(atlas.data,'base64'));
    }
    await measure('atlas');
    await evaluate("document.querySelector('#drive').click()");
    await sleep(2000);await measure('driving-idle');
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'w',code:'KeyW',windowsVirtualKeyCode:87});
    await measure('driving-forward');
    await call('Input.dispatchKeyEvent',{type:'keyUp',key:'w',code:'KeyW',windowsVirtualKeyCode:87});
    await evaluate("document.querySelector('#night-skip').click()");
    await sleep(3000);await measure('driving-night');
    if(options['world-smoke']){
      await evaluate("document.querySelector('#drive').click();document.querySelector('#day-skip').click();document.querySelector('#place').value='botanica';document.querySelector('#place').dispatchEvent(new Event('change'))");
      let districtReady=false;for(let i=0;i<40;i++){await sleep(2000);if(await evaluate("document.querySelector('#status').textContent==='Ready to explore'")){districtReady=true;break;}}
      if(!districtReady)throw Error('District chunk streaming failed');
      await evaluate("document.querySelector('#drive').click()");await sleep(4000);
      // Vite may timestamp this import after an edit. Read the engine's actual
      // module instance rather than creating a second, empty metrics module.
      const metrics=await evaluate("import(performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname.endsWith('/world-loader.js'))?.name||'./world-loader.js').then(m=>({...m.worldMetrics,driving:document.body.classList.contains('driving')}))");
      if(!metrics.driving||metrics.disposedChunks<1)throw Error('Driving did not evict distant chunks: '+JSON.stringify(metrics));
      if(requests.some(r=>r.url.includes('/data/')))throw Error('Runtime fetched a source snapshot');
      console.log(JSON.stringify({phase:'world-smoke',picking:true,lod:await evaluate('__benchmark.readLod()'),...metrics}));
    }
  }
  const screenshot=await call('Page.captureScreenshot',{format:'png'});
  await fs.writeFile(path.join(output,'scene.png'),Buffer.from(screenshot.data,'base64'));
  const timing=await evaluate('({longTasks:__benchmark.longTasks,resources:performance.getEntriesByType("resource").map(e=>({name:e.name,ms:e.duration,bytes:e.decodedBodySize}))})');
  const report={url,root,ready,state,environment,phases,errors,requests,...timing};
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({output,ready,errors:errors.length,environment}));
  if(!ready||errors.length)process.exitCode=1;
}finally{
  socket?.close();browser.kill();server.close();
  // Only this run's unique temporary profile may be removed.
  if(path.dirname(profile)===path.resolve(os.tmpdir())&&path.basename(profile).startsWith('chisinau3d-chrome-')){
    await fs.rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});
  }
}
