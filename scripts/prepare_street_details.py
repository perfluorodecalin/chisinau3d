"""Prepare static street furniture from existing Overpass downloads; no network requests."""
import json,pathlib,sys,collections
roads=json.load(open(sys.argv[1]));detail=json.load(open(sys.argv[2]));assert not detail.get('remark'),detail.get('remark')
keys={'highway','footway','sidewalk','sidewalk:left','sidewalk:right','sidewalk:both','sidewalk:width','width','crossing','crossing:markings','crossing:width','crossing:direction','direction','natural','amenity','height','diameter_crown','leaf_type','leaf_cycle','species','genus','backrest','seats','material'}
import math
ox,oy=28.8323,47.0245
scale=111320*math.cos(oy*math.pi/180)
def project(p):return ((p['lon']-ox)*scale,-(p['lat']-oy)*111320)
widths={'motorway':20,'trunk':17,'primary':14,'secondary':11,'tertiary':9,'residential':6,'living_street':5,'service':4,'unclassified':6}
models=json.load(open(pathlib.Path(__file__).resolve().parents[1]/'dist/data/road-model.json'))['profiles']
grid=collections.defaultdict(list)
for e in roads['elements']:
 t=e.get('tags',{})
 model=models.get(str(e['id']),{})
 if t.get('highway') not in widths or model.get('hidden') or model.get('area'):continue
 ps=[project(p) for p in e.get('geometry',[])]
 for a,b in zip(ps,ps[1:]):
  segment={'a':a,'b':b,'width':model.get('width',widths[t['highway']]),'id':e['id']}
  for i in range(math.floor(min(a[0],b[0])/50),math.floor(max(a[0],b[0])/50)+1):
   for j in range(math.floor(min(a[1],b[1])/50),math.floor(max(a[1],b[1])/50)+1):grid[i,j].append(segment)
def nearest_road(e):
 x,z=project(e);best=None;distance=40
 for i in range(math.floor(x/50)-1,math.floor(x/50)+2):
  for j in range(math.floor(z/50)-1,math.floor(z/50)+2):
   for s in grid[i,j]:
    a,b=s['a'],s['b'];dx,dz=b[0]-a[0],b[1]-a[1];u=max(0,min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz or 1)));xx,zz=a[0]+u*dx,a[1]+u*dz;d=math.hypot(x-xx,z-zz)
    if d<distance:distance=d;best={'x':xx,'z':zz,'d':d,'s':s}
 return best
features=[]
for e in roads['elements']:
 t=e.get('tags',{})
 if t.get('highway') and (t.get('footway') in ('sidewalk','crossing') or any(k.startswith('sidewalk') for k in t)):
  features.append(e)
features+=detail['elements']
for e in features:
 if e.get('lat') is not None and e.get('tags',{}).get('natural')!='tree':e['road']=nearest_road(e)
for e in features:
 e.pop('nodes',None);e.pop('bounds',None);e['tags']={k:v for k,v in e.get('tags',{}).items() if k in keys}
 for p in e.get('geometry',[]):p['lat']=round(p['lat'],6);p['lon']=round(p['lon'],6)
out={'osm3s':detail['osm3s'],'elements':features}
p=pathlib.Path(__file__).resolve().parents[1]/'dist/data/street-details.json';p.write_text(json.dumps(out,separators=(',',':')))
print('Saved features',len(features),'bytes',p.stat().st_size)
print(collections.Counter(e['tags'].get('natural') or e['tags'].get('amenity') or e['tags'].get('footway') or e['tags'].get('highway') for e in features))
