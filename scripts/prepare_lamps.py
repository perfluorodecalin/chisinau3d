"""Place approximate lamps alongside every mapped paved carriageway, rejecting road interiors."""
import json,math,pathlib,collections
ROOT=pathlib.Path(__file__).resolve().parents[1];out=ROOT/'dist/data';data=json.load(open(out/'realism.json'));raw=json.load(open('/workspace/scratch/ac8a7cefa1c4/city.json'))['elements'];scale=111320*math.cos(math.radians(47.0245))
models=json.load(open(out/'road-model.json'))['profiles']
widths={'motorway':20,'trunk':17,'primary':14,'secondary':11,'tertiary':9,'residential':6,'living_street':5,'service':4,'unclassified':6}
allowed=set(widths)|{'motorway_link','trunk_link','primary_link','secondary_link','tertiary_link'}
def width(t):
 try:w=float(t.get('width','0'))
 except:w=0
 try:n=float(t.get('lanes','0'))
 except:n=0
 return min(50,w) if w>0 else min(40,n*3.2) if n>0 else widths.get(t['highway'],5)
def proj(p):return [(p['lon']-28.8323)*scale,-(p['lat']-47.0245)*111320]
def dist(x,z,a,b):
 dx,dz=b[0]-a[0],b[1]-a[1];t=max(0,min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz or 1)));return math.hypot(x-a[0]-dx*t,z-a[1]-dz*t)
roads=[];spatial=collections.defaultdict(list)
for e in raw:
 t=e.get('tags',{})
 if t.get('highway') not in allowed or not e.get('geometry') or t.get('tunnel') in ['yes','culvert']:continue
 model=models.get(str(e['id']),{});
 if model.get('hidden') or model.get('area'):continue
 ps=[proj(p) for p in e['geometry']];w=model.get('width',width(t));roads.append((e,ps,w))
 for a,b in zip(ps,ps[1:]):
  for i in range(math.floor((min(a[0],b[0])-w)/50),math.floor((max(a[0],b[0])+w)/50)+1):
   for j in range(math.floor((min(a[1],b[1])-w)/50),math.floor((max(a[1],b[1])+w)/50)+1):spatial[i,j].append((a,b,w))
lamps=[];dedup=collections.defaultdict(list);rejected=0;paved=0
for e,ps,w in roads:
 if e['tags'].get('surface') not in ['asphalt','paved','concrete','paving_stones','concrete:plates','sett','cobblestone']:continue
 paved+=1;travel=0
 for a,b in zip(ps,ps[1:]):
  length=math.dist(a,b)
  if not length:continue
  dx,dz=(b[0]-a[0])/length,(b[1]-a[1])/length
  d=math.ceil(travel/35)*35-travel
  while d<length:
   side=1 if int((travel+d)/35)%2 else -1
   for sign in [side,-side]:
    x=a[0]+dx*d-dz*(w/2+1.7)*sign;z=a[1]+dz*d+dx*(w/2+1.7)*sign
    if any(dist(x,z,A,B)<W/2+.9 for A,B,W in spatial[math.floor(x/50),math.floor(z/50)]):rejected+=1;continue
    cell=(math.floor(x/10),math.floor(z/10))
    if any(math.hypot(x-X,z-Z)<10 for i in range(cell[0]-1,cell[0]+2) for j in range(cell[1]-1,cell[1]+2) for X,Z in dedup[i,j]):continue
    lamps.append({'x':round(x,3),'z':round(z,3),'roadId':e['id']});dedup[cell].append((x,z));break
   d+=35
  travel+=length
data['lampPoints']=lamps;data['lampPolicy']={'mappedPavedSegments':paved,'spacing':35,'rejectedCarriagewayCandidates':rejected,'inferredPositions':True};(out/'realism.json').write_text(json.dumps(data,separators=(',',':')));print(data['lampPolicy'],'lamps',len(lamps))
