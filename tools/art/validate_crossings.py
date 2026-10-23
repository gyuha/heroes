"""Inspect shipped bridge GLB geometry and record units unchanged."""
import json,struct,math,hashlib
from pathlib import Path
R=Path(__file__).resolve().parents[2];p=R/'public/assets/props/bridge.glb';d=p.read_bytes();magic,ver,total=struct.unpack_from('<III',d);assert magic==0x46546c67 and ver==2 and total==len(d)
n=struct.unpack_from('<I',d,12)[0];j=json.loads(d[20:20+n]);b=d[28+n:]
def vals(index):
 a=j['accessors'][index];v=j['bufferViews'][a['bufferView']];fmt={5126:'f',5123:'H',5121:'B',5125:'I'}[a['componentType']];size={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']];step=struct.calcsize(fmt)*size;start=v.get('byteOffset',0)+a.get('byteOffset',0)
 return [struct.unpack_from('<'+fmt*size,b,start+i*v.get('byteStride',step)) for i in range(a['count'])]
assert len(j['meshes'])==len(j['materials'])==1 and len(j['meshes'][0]['primitives'])==1
pr=j['meshes'][0]['primitives'][0];at=pr['attributes'];pos=vals(at['POSITION']);ids=[a[0] for a in vals(pr['indices'])];colors=vals(at['COLOR_0'])
assert len(ids)%3==0 and len(ids)//3<=5000 and len(pos)<=6000 and len(d)<500000
assert not j.get('textures') and not j.get('skins') and not j.get('animations') and j['materials'][0].get('alphaMode','OPAQUE')=='OPAQUE'
assert all(math.isfinite(c) for v in pos for c in v) and all(0<=c<=1 for v in colors for c in v)
assert all(0<=i<len(pos) for i in ids)
for node in j['nodes']:
 assert node.get('translation',[0,0,0])==[0,0,0] and node.get('rotation',[0,0,0,1])==[0,0,0,1] and node.get('scale',[1,1,1])==[1,1,1]
area=0;deck=[]
for i in range(0,len(ids),3):
 tri=[pos[k] for k in ids[i:i+3]]
 if all(abs(v[1])<1e-6 for v in tri):
  a,c,e=tri;area+=abs((c[0]-a[0])*(e[2]-a[2])-(c[2]-a[2])*(e[0]-a[0]))/2;deck.extend(tri)
assert abs(area-400)<1e-5
assert [min(v[0] for v in deck),max(v[0] for v in deck)]==[-5,5] and [min(v[2] for v in deck),max(v[2] for v in deck)]==[-20,20]
report={'file':str(p.relative_to(R)),'triangles':len(ids)//3,'vertices':len(pos),'bones':0,'bytes':len(d),'meshes':1,'primitives':1,'materials':1,'alpha_mode':'OPAQUE','bounds':[(min(v[k] for v in pos),max(v[k] for v in pos)) for k in range(3)],'flat_deck_area_m2':area,'flat_deck_local_y':0,'clear_walkable_width_m':10,'length_m':40,'structure_budget':'5000 triangles / 6000 vertices','unit_files_sha256':{str(p.relative_to(R)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((R/'public/assets/units').rglob('*.glb')) if p.name!='animations.glb'}}
(R/'tools/art/crossings_validation.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
