"""Download a bounded Terrarium tile set sequentially, then prepare a static height grid."""
import math,json,pathlib,subprocess
import numpy as np
from PIL import Image
ROOT=pathlib.Path(__file__).resolve().parents[1];cache=pathlib.Path('/workspace/scratch/ac8a7cefa1c4/dem');cache.mkdir(exist_ok=True)
Z=12;N=2**Z;R=111320;lat0=47.0245;lon0=28.8323;scale=R*math.cos(math.radians(lat0))
def merc(lat,lon):return (lon+180)/360*N,(1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*N
west,east,south,north=28.725,28.995,46.96,47.115
x0,y0=merc(north,west);x1,y1=merc(south,east)
T={};todo=[(x,y) for x in range(int(x0),int(x1)+1) for y in range(int(y0),int(y1)+1)]
print('Bounded elevation tiles:',len(todo),flush=True)
for x,y in todo:
 p=cache/f'{Z}-{x}-{y}.png'
 if not p.exists():
  url=f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{x}/{y}.png'
  subprocess.run(['curl','-f','-sS','--max-time','45',url,'-o',str(p)],check=True)
 a=np.array(Image.open(p).convert('RGB'),dtype=np.float32);T[x,y]=a[:,:,0]*256+a[:,:,1]+a[:,:,2]/256-32768
 print(x,y,'ready',flush=True)
def sample(lat,lon):
 x,y=merc(lat,lon);px=x*256-.5;py=y*256-.5;ix,iy=math.floor(px),math.floor(py);fx,fy=px-ix,py-iy
 def at(a,b):return float(T[a//256,b//256][b%256,a%256])
 return (at(ix,iy)*(1-fx)+at(ix+1,iy)*fx)*(1-fy)+(at(ix,iy+1)*(1-fx)+at(ix+1,iy+1)*fx)*fy
xmin=(west-lon0)*scale+80;xmax=(east-lon0)*scale-80;zmin=-(north-lat0)*R+80;zmax=-(south-lat0)*R-80;step=40
nx=math.floor((xmax-xmin)/step)+1;nz=math.floor((zmax-zmin)/step)+1;offset=sample(lat0,lon0)
a=np.empty((nz,nx),dtype='<f4')
for j in range(nz):
 for i in range(nx):a[j,i]=sample(lat0-(zmin+j*step)/R,lon0+(xmin+i*step)/scale)-offset
out=ROOT/'dist/data';(out/'terrain.bin').write_bytes(a.tobytes())
meta={'nx':nx,'nz':nz,'step':step,'xmin':xmin,'zmin':zmin,'offset':offset,'minElevation':float(a.min()+offset),'maxElevation':float(a.max()+offset),'source':'Mapzen Terrain Tiles / AWS Open Data','url':'https://registry.opendata.aws/terrain-tiles/','attribution':'Mapzen, SRTM and other source providers; see https://github.com/tilezen/joerd/blob/master/docs/attribution.md','zoom':Z,'tileCount':len(todo)}
(out/'terrain.json').write_text(json.dumps(meta));print(meta)
