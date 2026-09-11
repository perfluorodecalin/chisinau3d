"""Estimate connected bridge decks and approach ramps using OSM topology and saved DEM."""
import json,math,pathlib,heapq,collections
import numpy as np
ROOT=pathlib.Path(__file__).resolve().parents[1];out=ROOT/'dist/data';meta=json.load(open(out/'terrain.json'));grid=np.fromfile(out/'terrain.bin',dtype='<f4').reshape(meta['nz'],meta['nx'])
scale=111320*math.cos(math.radians(47.0245))
def project(p):return [(p['lon']-28.8323)*scale,-(p['lat']-47.0245)*111320]
def height(x,z):
 u=max(0,min(meta['nx']-1.001,(x-meta['xmin'])/meta['step']));v=max(0,min(meta['nz']-1.001,(z-meta['zmin'])/meta['step']));i,j=int(u),int(v);a,b=u-i,v-j
 return float((grid[j,i]*(1-a)+grid[j,i+1]*a)*(1-b)+(grid[j+1,i]*(1-a)+grid[j+1,i+1]*a)*b)
D=json.load(open('/workspace/scratch/ac8a7cefa1c4/city.json'))['elements'];ways=[e for e in D if e.get('tags',{}).get('highway') not in (None,'proposed','construction') and e.get('nodes') and e.get('geometry') and e['tags'].get('tunnel') not in ('yes','culvert','flooded')]
bridges=[e for e in ways if e['tags'].get('bridge') in ('yes','viaduct')];ids={e['id'] for e in bridges};nodes={};adj=collections.defaultdict(list);bridgeNodes=set()
for e in ways:
 for n,p in zip(e['nodes'],e['geometry']):nodes[n]=project(p)
 for a,b in zip(e['nodes'],e['nodes'][1:]):
  l=math.dist(nodes[a],nodes[b]);adj[a].append((b,l));adj[b].append((a,l))
 if e['id'] in ids:bridgeNodes.update(e['nodes'])
# Shared bridge nodes get a common offset; overpass tags do not encode surveyed clearance.
raiseBy=6.0
offset={n:raiseBy for n in bridgeNodes};queue=[(-raiseBy,n) for n in bridgeNodes];heapq.heapify(queue)
while queue:
 neg,n=heapq.heappop(queue);o=-neg
 if o<offset.get(n,0)-1e-8:continue
 for nxt,l in adj[n]:
  val=o-l*.065
  if val>max(.01,offset.get(nxt,0)):
   offset[nxt]=val;heapq.heappush(queue,(-val,nxt))
models=json.load(open(out/'road-model.json'))['profiles']
profiles={};stats=collections.Counter()
for e in ways:
 ns=e['nodes'];isBridge=e['id'] in ids
 if not isBridge and not any(n in offset for n in ns):continue
 pts=[]
 for a,b in zip(ns,ns[1:]):
  A,B=nodes[a],nodes[b];length=math.dist(A,B);steps=max(1,math.ceil(length/6));ha,hb=height(*A),height(*B);oa,ob=offset.get(a,0),offset.get(b,0)
  for i in range(steps):
   t=i/steps;x=A[0]+(B[0]-A[0])*t;z=A[1]+(B[1]-A[1])*t
   if isBridge:y=ha+(hb-ha)*t+raiseBy
   else:y=height(x,z)+max(0,oa-length*t*.065,ob-length*(1-t)*.065)
   pts.append([round(x,3),round(z,3),round(y,3)])
 B=nodes[ns[-1]];pts.append([round(B[0],3),round(B[1],3),round(height(*B)+offset.get(ns[-1],0),3)])
 t=e['tags'];lanes=float(t.get('lanes','0')) if t.get('lanes','0').isdigit() else 0
 widths={'motorway':20,'trunk':17,'primary':14,'secondary':11,'tertiary':9,'residential':6,'living_street':5,'service':4,'footway':1.8,'path':1.5,'steps':2,'cycleway':2,'pedestrian':5}
 try:w=float(t.get('width','0'))
 except:w=0
 w=min(50,w) if w>0 else min(40,lanes*3.2) if lanes>0 else widths.get(t['highway'],5)
 w=models.get(str(e['id']),{}).get('width',w)
 profiles[str(e['id'])]={'points':pts,'bridge':isBridge,'width':w,'name':t.get('name',t.get('loc_name','Mapped bridge')),'highway':t['highway']};stats['bridges' if isBridge else 'approaches']+=1
(out/'bridges.json').write_text(json.dumps({'profiles':profiles,'clearanceAssumption':raiseBy,'approachGrade':.065,'source':'OSM bridge geometry and shared-node topology; heights and approaches estimated from DEM'},separators=(',',':')));print(dict(stats))
