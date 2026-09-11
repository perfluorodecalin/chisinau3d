"""Split an existing Overpass JSON download into static neighbourhood files. No network calls."""
import argparse,json,pathlib
p=argparse.ArgumentParser();p.add_argument('snapshot');args=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[1]/'dist'/'data'
d=json.load(open(args.snapshot));assert not d.get('remark'),d.get('remark')
tiles=[{'id':f'{i}-{j}','bbox':[round(46.975+i*.025,6),round(28.74+j*.04,6),round(47+i*.025,6),round(28.78+j*.04,6)]} for i in range(5) for j in range(6)]
contents={t['id']:[] for t in tiles};center=[];centerbox=[47.015,28.815,47.035,28.85]
members={m['ref'] for e in d['elements'] if e['type']=='relation' and e.get('tags',{}).get('building') for m in e.get('members',[]) if m['type']=='way'}
keep={'building','height','building:levels','roof:height','roof:levels','min_height','building:min_level','name','name:ro','addr:street','addr:housenumber','natural','landuse','leisure','highway','waterway','location','layer'}
def intersects(a,b):return a[0]<=b[2] and a[2]>=b[0] and a[1]<=b[3] and a[3]>=b[1]
for e in d['elements']:
 t=e.get('tags',{})
 if e['type']=='way' and e['id'] in members and t.get('building'):continue
 if not (t.get('building') or t.get('highway') or t.get('waterway') or t.get('natural') in ('water','wood','scrub','grassland') or t.get('leisure') in ('park','garden','recreation_ground') or t.get('landuse') in ('forest','grass','cemetery','recreation_ground')):continue
 e.pop('nodes',None);e.pop('bounds',None);e['tags']={k:v for k,v in t.items() if k in keep}
 geom=e.get('geometry',[])
 if e['type']=='relation':
  geom=[p for m in e.get('members',[]) for p in m.get('geometry',[])]
 for pt in geom:pt['lat']=round(pt['lat'],6);pt['lon']=round(pt['lon'],6)
 if not geom:continue
 bbox=[min(p['lat'] for p in geom),min(p['lon'] for p in geom),max(p['lat'] for p in geom),max(p['lon'] for p in geom)]
 for tile in tiles:
  if intersects(bbox,tile['bbox']):contents[tile['id']].append(e)
 if intersects(bbox,centerbox):center.append(e)
for id,es in {**contents,'center':center}.items():
 (root/(id+'.json')).write_text(json.dumps({'osm3s':d['osm3s'],'elements':es},separators=(',',':')))
(root/'manifest.json').write_text(json.dumps(tiles,separators=(',',':')))
print('Saved',len(tiles),'sections; centre elements',len(center),'total bytes',sum(p.stat().st_size for p in root.glob('*.json')))
