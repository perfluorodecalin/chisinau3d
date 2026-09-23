import * as T from 'three';
import {project} from './model.js';
import {ribbonPositions} from './road-ribbon.js';
export {ribbonPositions};
let profiles={};
export async function loadRoadModel(){const response=await fetch('./data/road-model.json');if(!response.ok)throw Error('Road profiles unavailable');profiles=(await response.json()).profiles;}
export function roadProfile(id){return profiles[id];}
export function roadTags(id,t){const p=t.highway&&t.highway!=='crossing'?profiles[id]:null;return p?{...t,...p.tags,gameWidth:p.width,gameArea:p.area,gameHidden:p.hidden,gameOneway:p.oneway}:t;}
export function roadPositions(e,width){
 const p=e.geometry.map(project),profile=profiles[e.id];
 if(e.tags.gameArea||e.tags.area==='yes'){
  const contour=p.map(p=>new T.Vector2(...p)),tri=T.ShapeUtils.triangulateShape(contour,[]),pos=[];
  for(const indices of tri)for(const i of indices)pos.push(p[i][0],.13,p[i][1]);return pos;
 }
 return ribbonPositions(p,width,e.tags.waterway?.08:.13,profile?.joins);
}
export function nearJunction(e,index,distance,len){const p=profiles[e.id],j=p?.joins;const clearance=q=>q?(q.junction?q.radius+3:Math.abs(q.width-p.width)>.1?20:0):0;return distance<clearance(j?.[index-1])||len-distance<clearance(j?.[index]);}
