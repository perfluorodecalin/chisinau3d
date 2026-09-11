import json,pathlib
D=json.load(open('/workspace/scratch/ac8a7cefa1c4/city.json'))
extra={};pois=[];green=[];lights=[]
keys=['lanes','oneway','surface','maxspeed','lit','width','roof:shape','roof:height','roof:colour','roof:material','bridge','layer','tunnel','name','amenity','tourism','historic','shop']
for e in D['elements']:
 t=e.get('tags',{});g=e.get('geometry',[])
 if not g:continue
 tags={k:t[k] for k in keys if k in t}
 if tags:extra[str(e['id'])]=tags
 if t.get('name') and (t.get('tourism') in ['museum','attraction','hotel'] or t.get('amenity') in ['place_of_worship','theatre','restaurant','cafe','university'] or t.get('shop') in ['mall','supermarket'] or t.get('historic') in ['monument','memorial','castle']):
  pois.append({'id':e['id'],'name':t['name'],'lat':sum(p['lat'] for p in g)/len(g),'lon':sum(p['lon'] for p in g)/len(g),'height':float(t.get('building:levels','5'))*3 if str(t.get('building:levels','5')).replace('.','',1).isdigit() else 18,'kind':t.get('tourism') or t.get('amenity') or t.get('shop') or t.get('historic')})
 if t.get('landuse') in ['forest','meadow','orchard','vineyard'] or t.get('natural')=='wood':green.append({'id':e['id'],'type':e['type'],'tags':t,'geometry':g})
 if t.get('surface') in ['asphalt','paved','concrete','paving_stones','concrete:plates','sett','cobblestone'] and t.get('highway') in ['motorway','trunk','primary','secondary','tertiary','residential','living_street','unclassified','service','primary_link','secondary_link','tertiary_link','trunk_link','motorway_link']:
  lights.append({'id':e['id'],'tags':{**tags,'highway':t['highway']},'geometry':g})
out={'extra':extra,'pois':pois,'green':green,'lights':lights}
p=pathlib.Path('/workspace/sites/chisinau-3d/dist/data/realism.json');p.write_text(json.dumps(out,separators=(',',':')));print({k:len(v) for k,v in out.items()})
