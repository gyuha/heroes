"""Exact LOD0/LOD1 rig, palette and immutable source validation."""
import json,struct,hashlib,math
from pathlib import Path
from color_io import validate_palette
R=Path(__file__).resolve().parents[2]
def read(p):
 d=p.read_bytes();n=struct.unpack_from('<I',d,12)[0];return json.loads(d[20:20+n]),d[28+n:]
def view(j,b,i):v=j['bufferViews'][i];return b[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]
def accessor(j,b,i):
 a=j['accessors'][i];v=j['bufferViews'][a['bufferView']];n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']];f={5126:'f',5123:'H',5121:'B',5125:'I'}[a['componentType']];size=struct.calcsize(f)*n;o=v.get('byteOffset',0)+a.get('byteOffset',0)
 return [struct.unpack_from('<'+f*n,b,o+k*v.get('byteStride',size)) for k in range(a['count'])]
def mask_area(j,b):
 pr=j['meshes'][0]['primitives'][0];a=pr['attributes'];p=accessor(j,b,a['POSITION']);uv=accessor(j,b,a['TEXCOORD_0']);idx=accessor(j,b,pr['indices']);total=mask=0
 for i in range(0,len(idx),3):
  ids=[idx[i+k][0] for k in range(3)];v=[p[n] for n in ids];u=[v[1][k]-v[0][k] for k in range(3)];w=[v[2][k]-v[0][k] for k in range(3)];c=[u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0]];area=math.sqrt(sum(t*t for t in c))/2;assert area>1e-10
  total+=area
  if all(uv[n][0]*256<42 for n in ids):mask+=area
 return {'ratio':mask/total,'area_m2':mask,'total_area_m2':total}
report={};g=json.loads((R/'tools/art/lod1_generation.json').read_text())
for u in ['infantry','spearman','archer','cavalry']:
 src=R/f'public/assets/units/{u}/{u}.glb';lod=src.with_name(u+'_lod1.glb');j,b=read(src);k,c=read(lod);anim,ab=read(src.with_name('animations.glb'))
 assert hashlib.sha256(src.read_bytes()).hexdigest()==g[u]['source_sha256']
 assert j['nodes']==k['nodes'] and j['scenes']==k['scenes']
 sj,sk=j['skins'][0].copy(),k['skins'][0].copy();ia=sj.pop('inverseBindMatrices');ib=sk.pop('inverseBindMatrices');assert sj==sk and accessor(j,b,ia)==accessor(k,c,ib)
 nodes=json.loads(json.dumps(k['nodes']))
 for n in nodes:n.pop('mesh',None);n.pop('skin',None)
 assert anim['nodes']==nodes and anim['scenes']==k['scenes']
 assert j['materials']==k['materials'] and j['textures']==k['textures'] and j.get('samplers')==k.get('samplers')
 orig=view(j,b,j['images'][0]['bufferView']);small=view(k,c,k['images'][0]['bufferView']);assert orig==small;validate_palette(small)
 report[u]={'nodes_scenes_exact':True,'joint_order_bind_matrices_exact':True,'animation_nodes_exact':True,'material_palette_sampler_exact':True,'surface_area_team_mask_ratio_lod0':mask_area(j,b)['ratio'],'surface_area_team_mask_ratio_lod1':mask_area(k,c)['ratio'],'team_mask_area_m2_lod0':mask_area(j,b)['area_m2'],'team_mask_area_m2_lod1':mask_area(k,c)['area_m2'],'source_unmodified':True,'source_sha256':hashlib.sha256(src.read_bytes()).hexdigest(),'animation_sha256':hashlib.sha256(src.with_name('animations.glb').read_bytes()).hexdigest()}
(R/'tools/art/lod1_validation.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
