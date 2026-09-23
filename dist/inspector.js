export function resolveFeature(mesh,faceIndex){
 const spans=mesh.userData.spans;
 if(!spans)return mesh.userData.feature?{record:mesh.userData.feature,start:0,end:null}:null;
 if(faceIndex==null||!spans.length)return null;
 let low=0,high=spans.length-1;
 while(low<high){const mid=(low+high)>>1;if(faceIndex<spans[mid].end)high=mid;else low=mid+1;}
 if(faceIndex>=spans[low].end)return null;
 return {record:spans[low].r,start:low?spans[low-1].end*3:0,end:spans[low].end*3};
}

export function showFeature(record,root){
 const tags=record.tags||{},derived=record.kind==='building'?{
  height_m:record.height,height_source:record.source,height_explanation:record.reason,
  floors:record.floors,footprint_m2:Math.round(record.area),base_elevation_m:record.base,
  minimum_height_m:record.minHeight
 }:record.derived||{};
 root.querySelector('#feature-kind').textContent=(record.kind||'building').toUpperCase()+' · OSM '+record.type+'/'+record.id;
 root.querySelector('#bname').textContent=tags.name||tags['name:ro']||[tags['addr:street'],tags['addr:housenumber']].filter(Boolean).join(' ')||tags.highway||tags.building||record.kind||'Mapped feature';
 const details=root.querySelector('#bdetails');details.replaceChildren();
 function section(title,entries){const heading=document.createElement('h3');heading.textContent=title;details.append(heading);const list=document.createElement('dl');for(const [key,value] of Object.entries(entries).sort(([a],[b])=>a.localeCompare(b))){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value==null?'—':typeof value==='object'?JSON.stringify(value):String(value);list.append(dt,dd);}details.append(list);}
 section('Derived by the game',derived);
 section('OSM tags',tags);
 root.querySelector('#osmlink').href=`https://www.openstreetmap.org/${record.type}/${record.id}`;
 root.hidden=false;
}
