// Visual LOD policy. This module never owns physics, map metadata or gameplay
// residency. Visuals may be culled or replaced while collision data stays put.
const PRESETS={low:{scale:.72},balanced:{scale:1},high:{scale:1.35}};
const LIMITS={buildings:18000,greens:12000,vegetation:2600,details:5200,lamps:2600,roads:Infinity,terrain:Infinity};
const EXTERNAL_VISIBILITY=new Set(['vegetation','lamps']);
function number(value,fallback){return value==null||value===''?fallback:Number.isFinite(+value)?+value:fallback;}
export function normalizeVariants(value){
 const source=Array.isArray(value)?value:[];
 return source.map((v,i)=>({...v,level:v.level??v.lod??i,maxDistance:number(v.maxDistance??v.distance,Infinity)}))
  .filter(v=>v.file||v.mesh||v.visible===false).sort((a,b)=>a.maxDistance-b.maxDistance||a.level-b.level);
}
export function boundsDistance(mesh,camera){
 const sphere=mesh?.boundingSphere||mesh?.geometry?.boundingSphere;if(!sphere||!camera?.position)return Infinity;
 const center=sphere.center?.clone?sphere.center.clone():{x:sphere.center?.x||0,y:sphere.center?.y||0,z:sphere.center?.z||0};
 if(mesh.localToWorld)mesh.localToWorld(center);
 return Math.max(0,camera.position.distanceTo(center)-number(sphere.radius,0));
}
// Select a target visual level with a 20% boundary band. The returned level
// only changes after crossing the outward/inward side of the current boundary.
export function selectVariant(distance,variants,current=0,{hysteresis=.2,scale=1}={}){
 const list=normalizeVariants(variants);if(!list.length)return {index:-1,variant:null,changed:current!==-1};
 const d=Math.max(0,number(distance,Infinity))/Math.max(.01,scale);
 let target=list.length-1;for(let i=0;i<list.length;i++)if(d<=list[i].maxDistance){target=i;break;}
 let index=Math.max(0,Math.min(list.length-1,number(current,0)));
 while(target>index){const boundary=list[index].maxDistance;if(d<=boundary*(1+hysteresis))break;index++;}
 while(target<index){const boundary=list[target].maxDistance;if(d>=boundary*(1-hysteresis))break;index--;}
 return {index,variant:list[index],changed:index!==current,distance:d};
}
function setVisible(mesh,value){mesh.userData.lodVisible=value;mesh.visible=value&&mesh.userData.atmosphereVisible!==false;}
export function createLodController({camera,quality='balanced',interval=120,hysteresis=.2,minDwell=180,onStats,onVariant}={}){
 const entries=new Map();let preset=PRESETS[quality]||PRESETS.balanced,last=0,stats={visible:0,hidden:0,swaps:0,variants:0};
 function register(mesh,options={}){
  if(!mesh||entries.has(mesh))return mesh;
  const layer=options.layer||mesh.userData?.layer||'buildings';
  if(EXTERNAL_VISIBILITY.has(layer)&&options.includeExternal!==true){mesh.visible=mesh.userData.atmosphereVisible!==false;return mesh;}
  const variants=normalizeVariants(options.variants||mesh.userData?.lodVariants||mesh.userData?.variants);
  mesh.userData.lodLayer=layer;mesh.userData.lodVisible=mesh.userData.lodVisible!==false;
  const e={mesh,layer,variants,index:number(options.index??mesh.userData?.lodIndex,0),visible:mesh.userData.lodVisible,lastSwap:0};
  entries.set(mesh,e);setVisible(mesh,e.visible);return mesh;
 }
 function unregister(mesh){entries.delete(mesh);}
 function setQuality(value){preset=PRESETS[value]||PRESETS.balanced;last=0;for(const e of entries.values())e.lastSwap=0;}
 function update(now=performance.now(),force=false){
  if(!force&&now-last<interval)return stats;last=now;let visible=0,hidden=0,swaps=0,variantCount=0;
  for(const e of entries.values()){
   const m=e.mesh;if(!m.parent){entries.delete(m);continue;}
   let next=e.visible;
   if(e.variants.length){
    const pick=selectVariant(boundsDistance(m,camera),e.variants,e.index,{hysteresis,scale:preset.scale});variantCount++;
    if(pick.index!==e.index&&now-e.lastSwap>=minDwell){const previous=e.index;e.index=pick.index;e.lastSwap=now;swaps++;onVariant?.({mesh:m,layer:e.layer,index:e.index,previous,variant:pick.variant,entry:e});}
    next=e.variants[e.index]?.visible!==false;
   }else{
    const limit=(LIMITS[e.layer]??9000)*preset.scale,d=boundsDistance(m,camera),out=e.visible?limit:limit*(1-hysteresis);next=d<=out;
    if(next!==e.visible)swaps++;
   }
   e.visible=next;setVisible(m,next);if(next)visible++;else hidden++;
  }
  stats={visible,hidden,swaps,variants:variantCount};onStats?.(stats);return stats;
 }
 return {register,unregister,update,setQuality,stats:()=>stats,size:()=>entries.size,entries:()=>[...entries.values()]};
}
export const LOD_PRESETS=PRESETS;
