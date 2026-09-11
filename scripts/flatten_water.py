import json,pathlib,math
import numpy as np
ROOT=pathlib.Path(__file__).resolve().parents[1];out=ROOT/'dist/data';m=json.load(open(out/'terrain.json'));base=pathlib.Path('/workspace/scratch/ac8a7cefa1c4/terrain-base.bin')
if not base.exists():base.write_bytes((out/'terrain.bin').read_bytes())
a=np.fromfile(base,dtype='<f4').reshape(m['nz'],m['nx']);result=a.copy();scale=111320*math.cos(math.radians(47.0245))
def inside(x,z,r):
 c=False
 for p,q in zip(r,r[1:]+r[:1]):
  if (p[1]>z)!=(q[1]>z) and x<(q[0]-p[0])*(z-p[1])/(q[1]-p[1])+p[0]:c=not c
 return c
levels={}
for e in json.load(open('/workspace/scratch/ac8a7cefa1c4/city.json'))['elements']:
 if e.get('tags',{}).get('natural')!='water' or len(e.get('geometry',[]))<4:continue
 r=[((p['lon']-28.8323)*scale,-(p['lat']-47.0245)*111320) for p in e['geometry']];xs=[p[0] for p in r];zs=[p[1] for p in r];cells=[]
 for j in range(max(0,math.ceil((min(zs)-m['zmin'])/40)),min(m['nz'],math.floor((max(zs)-m['zmin'])/40)+1)):
  for i in range(max(0,math.ceil((min(xs)-m['xmin'])/40)),min(m['nx'],math.floor((max(xs)-m['xmin'])/40)+1)):
   if inside(m['xmin']+i*40,m['zmin']+j*40,r):cells.append((j,i))
 samples=[float(a[j,i]) for j,i in cells]
 if not samples:samples=[float(a[max(0,min(m['nz']-1,round((z-m['zmin'])/40))),max(0,min(m['nx']-1,round((x-m['xmin'])/40)))]) for x,z in r]
 h=float(np.median(samples));levels[str(e['id'])]=h
 for j,i in cells:result[j,i]=h-.45
(out/'terrain.bin').write_bytes(result.astype('<f4').tobytes());(out/'water-levels.json').write_text(json.dumps(levels,separators=(',',':')));print('Levelled water polygons',len(levels))
