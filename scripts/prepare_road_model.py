"""Offline game road profiles; never edits the source OSM snapshot."""
import json, math, pathlib, collections
ROOT=pathlib.Path(__file__).resolve().parents[1]
raw=json.load(open('/workspace/scratch/ac8a7cefa1c4/city.json'))['elements']
widths=dict(motorway=20,trunk=17,primary=14,secondary=11,tertiary=9,residential=6,unclassified=6,living_street=5,service=4,footway=1.8,path=1.5,pedestrian=5,steps=2,cycleway=2)
profiles={}; junctions=collections.defaultdict(list); corrections=[]
for e in raw:
 t=e.get('tags',{}); h=t.get('highway')
 if not h or not e.get('geometry'):continue
 t=dict(t)
 if e['id']==49802600:
  corrections.append(dict(id=e['id'],name=t.get('name'),field='lanes',source=t.get('lanes'),game='2',reason='Connected same-name tertiary continuations 102660769 and 155121121 both specify two lanes.'))
  t['lanes']='2'
 def number(k):
  try:return float(t.get(k,0))
  except (ValueError,TypeError):return 0
 n=number('lanes');w=number('width')
 # Link ways are individual ramps; no inherited full arterial cross section.
 default=3.5 if h.endswith('_link') and t.get('oneway') in ('yes','1','-1') else widths.get(h,5)
 if not n and not w and t.get('oneway') in ('yes','1','-1') and h in ('residential','service','living_street'):default=3.5
 w=min(50,w) if w>0 else min(40,n*3.2) if n>0 else default
 p=dict(width=w,lanes=int(n) if 0<n<=12 and n.is_integer() else 0,area=t.get('area')=='yes',hidden=h in ('proposed','construction') or t.get('tunnel') in ('yes','culvert','flooded'),oneway=t.get('oneway','no'),joins={})
 profiles[str(e['id'])]=p
 if e['id']==49802600:p['tags']={'lanes':'2'}
 if p['area'] or p['hidden']:continue
 for i,node in enumerate(e.get('nodes',[])):
  if i>=len(e['geometry']):continue
  # OSM shared nodes, not coincident screen coordinates, define connectivity.
  category='motor' if h in ('motorway','trunk','primary','secondary','tertiary','residential','unclassified','living_street','service') or h.endswith('_link') else 'path'
  junctions[node,category].append((e['id'],i,1 if i in (0,len(e['nodes'])-1) else 2))
for entries in junctions.values():
 if sum(x[2] for x in entries)<3 and len(entries)<2:continue
 maxw=max(profiles[str(e)]['width'] for e,i,d in entries)
 minw=min(profiles[str(e)]['width'] for e,i,d in entries)
 owner=max(entries,key=lambda v:profiles[str(v[0])]['width'])
 for eid,i,d in entries:
  p=profiles[str(eid)]
  p['joins'][str(i)]={'radius':maxw/2,'junction':sum(x[2] for x in entries)>2,'width':(maxw+minw)/2,'cap':(eid,i,d)==owner}
out=ROOT/'dist/data/road-model.json'
out.write_text(json.dumps({'profiles':profiles,'corrections':corrections,'policy':'OSM topology; bounded join tapers; explicit widths and lane counts retained except listed local corrections. Unbuilt and tunnel ways omitted from surface roads. Area highways filled as plazas.'},separators=(',',':')))
print('profiles',len(profiles),'junction entries',sum(len(p['joins']) for p in profiles.values()),'corrections',corrections)
