// Procedural Web Audio: no downloads, microphone access, or autoplay.
export function createSoundscape(readState){
 const panel=document.createElement('div');panel.id='sound-controls';panel.innerHTML='<button id="sound-toggle" aria-pressed="false">Sound off</button><label id="sound-volume-label" hidden>Volume <input id="sound-volume" aria-label="Sound volume" type="range" min="0" max="100" value="35"></label>';document.body.append(panel);
 const button=panel.querySelector('button'),slider=panel.querySelector('input'),label=panel.querySelector('label');
 let ctx,master,engine,engineGain,engineFilter,tireGain,tireFilter,windGain,cityGain,birdGain,nightGain,timer,enabled=false,volume=.35;
 const smooth=(param,value,time=.15)=>param.setTargetAtTime(value,ctx.currentTime,time);
 function gain(value=0){const g=ctx.createGain();g.gain.value=value;g.connect(master);return g;}
 function loop(buffer,output,frequency,type='lowpass'){
  const source=ctx.createBufferSource();source.buffer=buffer;source.loop=true;
  if(frequency){const filter=ctx.createBiquadFilter();filter.type=type;filter.frequency.value=frequency;source.connect(filter);filter.connect(output);source.start();return filter;}
  source.connect(output);source.start();
 }
 function build(){
  const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw Error('Audio unavailable');ctx=new Audio();
  master=ctx.createGain();master.gain.value=0;const limiter=ctx.createDynamicsCompressor();limiter.threshold.value=-12;limiter.knee.value=12;limiter.ratio.value=5;master.connect(limiter);limiter.connect(ctx.destination);
  const noise=ctx.createBuffer(2,ctx.sampleRate*4,ctx.sampleRate);let seed=7241;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let c=0;c<2;c++){const a=noise.getChannelData(c);for(let i=0;i<a.length;i++)a[i]=random()*2-1;}
  engineGain=gain();engineFilter=ctx.createBiquadFilter();engineFilter.type='lowpass';engineFilter.frequency.value=400;engineFilter.connect(engineGain);
  engine=ctx.createOscillator();const real=new Float32Array(9),imag=new Float32Array([0,1,.42,.25,.15,.09,.05,.025,.012]);engine.setPeriodicWave(ctx.createPeriodicWave(real,imag));engine.frequency.value=32;engine.connect(engineFilter);engine.start();
  tireGain=gain();tireFilter=loop(noise,tireGain,1200,'bandpass');tireFilter.Q.value=.5;
  windGain=gain();loop(noise,windGain,450);cityGain=gain();loop(noise,cityGain,180,'bandpass');
  function calls(seconds,night){const b=ctx.createBuffer(2,ctx.sampleRate*seconds,ctx.sampleRate);for(let t=night?.2:1;t<seconds-1;t+=night?1.6:3+random()*3){const channel=random()<.5?0:1,a=b.getChannelData(channel),count=night?5:2+Math.floor(random()*3);for(let k=0;k<count;k++){const start=Math.floor((t+k*(night?.085:.18))*ctx.sampleRate),duration=night?.045:.12;let phase=0;for(let i=0;i<duration*ctx.sampleRate&&start+i<a.length;i++){const u=i/(duration*ctx.sampleRate),hz=night?4100:2200+1600*Math.sin(u*Math.PI);phase+=2*Math.PI*hz/ctx.sampleRate;a[start+i]+=Math.sin(phase)*Math.sin(Math.PI*u)**2*(night?.18:.3);}}}return b;}
  birdGain=gain();loop(calls(23,false),birdGain);nightGain=gain();loop(calls(11,true),nightGain);
 }
 function tick(){if(!ctx||!enabled||document.hidden)return;const s=readState(),speed=Math.min(30,Math.abs(s.speed||0)),day=s.hour>=6&&s.hour<20,driving=s.active&&!s.paused;
  const gear=Math.min(4,Math.floor(speed/7)),rpm=850+(speed-gear*7)*310+(s.throttle?450:0);
  smooth(engine.frequency,Math.max(28,rpm/30),.1);smooth(engineFilter.frequency,350+speed*22+(s.throttle?250:0));smooth(engineGain.gain,driving?.055+(s.throttle?.025:0):0);
  const rough=/gravel|unpaved|ground|dirt|sett|cobblestone/.test(s.surface||'');smooth(tireFilter.frequency,rough?650:1400);smooth(tireGain.gain,driving?speed/30*(rough?.13:.07)+(s.brake&&speed>4?.025:0):0);
  smooth(windGain.gain,.012+.005*Math.sin(ctx.currentTime*.12)+(driving?speed/30*.018:0),.8);smooth(cityGain.gain,day?.022:.008,1);smooth(birdGain.gain,day?.04:0,1);smooth(nightGain.gain,day?0:.035,1);
 }
 async function toggle(){button.disabled=true;try{if(!ctx)build();if(enabled){enabled=false;smooth(master.gain,0,.04);clearInterval(timer);await ctx.suspend();}else{await ctx.resume();if(ctx.state!=='running')throw Error('Audio paused');enabled=true;smooth(master.gain,volume,.08);tick();timer=setInterval(tick,100);}button.textContent=enabled?'Sound on':'Sound off';button.setAttribute('aria-pressed',String(enabled));label.hidden=!enabled;}catch(e){enabled=false;clearInterval(timer);if(master)master.gain.value=0;button.textContent='Retry sound';button.setAttribute('aria-pressed','false');button.title='Sound could not start. Tap to retry.';}finally{button.disabled=false;}}
 button.onclick=toggle;slider.oninput=()=>{volume=Number(slider.value)/100;if(ctx&&enabled)smooth(master.gain,volume,.05);};
 document.addEventListener('visibilitychange',()=>{if(!ctx||!enabled)return;if(document.hidden)ctx.suspend().catch(()=>{});else ctx.resume().then(tick).catch(()=>{button.textContent='Resume sound';});});
 window.addEventListener('pagehide',()=>{if(ctx)ctx.suspend().catch(()=>{});});
 window.addEventListener('pageshow',()=>{if(ctx&&enabled&&!document.hidden)ctx.resume().then(tick).catch(()=>{});});
 return {get enabled(){return enabled;}};
}
