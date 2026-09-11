export function buildingStyle(tags){const b=tags.building||'';return /industrial|warehouse|hangar|garage|shed/.test(b)?2:/commercial|office|hotel|hospital/.test(b)?3:/house|detached|terrace|hut/.test(b)?0:/apartments|residential|dormitory/.test(b)?1:parseFloat(tags['building:levels'])>=4?1:0;}
export function installFacades(material){const enabled={value:1};material.onBeforeCompile=shader=>{shader.uniforms.facadesEnabled=enabled;shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float cityType;\nattribute float cityBase;\nvarying float vCityType;\nvarying vec3 vCityPosition;\nvarying vec3 vCityNormal;').replace('#include <begin_vertex>','#include <begin_vertex>\nvCityType=cityType; vCityPosition=position;vCityPosition.y-=cityBase; vCityNormal=normal;');shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float facadesEnabled;\nvarying float vCityType;\nvarying vec3 vCityPosition;\nvarying vec3 vCityNormal;').replace('#include <color_fragment>',`#include <color_fragment>
if(facadesEnabled>0.5){
 vec3 n=normalize(vCityNormal); vec3 p=vCityPosition;
 if(n.y>0.7){
  vec2 roof=fract(p.xz*0.65);float seam=step(.92,roof.x)+step(.93,roof.y);
  diffuseColor.rgb*=vCityType<.5?mix(vec3(.63,.48,.38),vec3(.4,.33,.29),min(seam,1.)):mix(vec3(.7),vec3(.58),min(seam*.35,1.));
 }else if(abs(n.y)<.3){
  float horizontal=dot(p.xz,normalize(vec2(-n.z,n.x)));float floorH=vCityType>2.5?3.4:3.;
  vec2 cell=fract(vec2(horizontal/(vCityType<.5?3.3:2.8),p.y/floorH));
  // Screen-space filtering fades details before they shimmer at city scale.
  float visibility=1.-smoothstep(.06,.26,max(fwidth(horizontal/2.8),fwidth(p.y/floorH)));
  float windowMask=step(.24,cell.x)*step(cell.x,.72)*step(.24,cell.y)*step(cell.y,.76)*step(1.2,p.y);
  vec3 wall=diffuseColor.rgb;
  if(vCityType>1.5&&vCityType<2.5){float rib=step(.91,fract(horizontal*1.8));wall*=mix(.86,1.,rib);windowMask*=step(.64,cell.y);}
  else if(vCityType>2.5){windowMask=step(.1,cell.x)*step(cell.x,.9)*step(.13,cell.y)*step(cell.y,.88);wall*=.82;}
  else if(vCityType<.5){vec2 brick=vec2(horizontal*2.+step(.5,fract(p.y*3.))*.5,p.y*6.);float mortar=max(step(.94,fract(brick.x)),step(.91,fract(brick.y)));wall*=mix(1.,.87,mortar*.55);}
  else {wall*=mix(.79,1.,step(.045,cell.y));}
  float frame=max(step(.46,cell.x)*step(cell.x,.50),step(.48,cell.y)*step(cell.y,.52));
  vec3 windowColor=mix(vec3(.09,.16,.20),vec3(.3,.39,.43),cell.y*.7);windowColor=mix(windowColor,wall*.75,frame);
  vec3 facade=mix(wall,windowColor,windowMask);diffuseColor.rgb=mix(diffuseColor.rgb,facade,visibility);
 }
}`);};material.customProgramCacheKey=()=> 'chisinau-facades-v1';return enabled;}
