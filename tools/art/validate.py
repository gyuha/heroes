"""Validate actual GLB buffers; run python3 tools/art/validate.py."""
import json, struct, math
from pathlib import Path
from color_io import TERRAIN_SRGB, PALETTE, png_read, mean_rgb, hexmean, validate_palette, linear, png_write
ROOT=Path(__file__).resolve().parents[2]
def read(path):
 data=path.read_bytes(); magic,ver,total=struct.unpack_from('<III',data); assert magic==0x46546c67 and ver==2 and total==len(data)
 n=struct.unpack_from('<I',data,12)[0]; j=json.loads(data[20:20+n]); binary=data[28+n:]; return j,binary,len(data)
def values(j,b,a):
 a=j['accessors'][a]; v=j['bufferViews'][a['bufferView']]; fmt={5126:'f',5123:'H',5121:'B',5125:'I'}[a['componentType']]; size={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]; step=struct.calcsize(fmt)*size; start=v.get('byteOffset',0)+a.get('byteOffset',0); stride=v.get('byteStride',step)
 return [struct.unpack_from('<'+fmt*size,b,start+i*stride) for i in range(a['count'])]
report=[]; shared=None
for path in sorted((ROOT/'public/assets').rglob('*.glb')):
 if path.name=='animations.glb':continue  # T-009 owns skeleton-only clip validation.
 j,b,size=read(path); assert len(j['meshes'])==len(j['materials'])==1
 assert len(j['meshes'][0]['primitives'])==1
 p=j['meshes'][0]['primitives'][0]; a=p['attributes']; pos=values(j,b,a['POSITION']); idx=values(j,b,p['indices']); tri=len(idx)//3
 assert all(0<=v[0]<len(pos) for v in idx); assert all(math.isfinite(t) for v in pos for t in v)
 material=j['materials'][0]; assert material.get('alphaMode','OPAQUE')=='OPAQUE'
 unit='units' in path.parts; base=path.parent.name if unit else path.stem; horse=base=='cavalry'; limit=(700,900,40) if horse else ((300,400,20) if unit else (500,600,0))
 if path.stem=='bridge':limit=(5000,6000,0)
 if path.stem.endswith('_lod1'):limit=(180,900,40) if horse else (80,400,20)
 bones=len(j.get('skins',[{'joints':[]}])[0]['joints']); assert tri<=limit[0] and len(pos)<=limit[1] and bones<=limit[2]
 assert size<=(300000 if unit else 500000)
 if unit:
  assert len(j['skins'])==1 and len(j['images'])==1 and 'bufferView' in j['images'][0]; assert not j.get('animations')
  assert 'COLOR_0' not in a and 'TEXCOORD_0' in a
  iv=j['bufferViews'][j['images'][0]['bufferView']];validate_palette(b[iv.get('byteOffset',0):iv.get('byteOffset',0)+iv['byteLength']])
  skin=j['skins'][0]; weights=values(j,b,a['WEIGHTS_0']); joints=values(j,b,a['JOINTS_0'])
  assert all(abs(sum(w)-1)<1e-5 and all(x>=0 for x in w) for w in weights)
  assert all(all(k<bones for k in row) for row in joints)
  assert len(values(j,b,skin['inverseBindMatrices']))==bones
  # D-015: suffixes are legacy labels: hand_l is anatomical right (-X).
  uv=values(j,b,a['TEXCOORD_0']);bone_names=[j['nodes'][n]['name'] for n in skin['joints']]
  for i,(js,ws) in enumerate(zip(joints,weights)):
   hand=next((bone_names[k] for k,w in zip(js,ws) if w>0 and bone_names[k] in ['hand_l','hand_r']),None)
   if hand:
    assert pos[i][0]<0 if hand=='hand_l' else pos[i][0]>0
    cell=min(5,int(uv[i][0]*256)//42)
    if base=='archer':assert hand=='hand_r'
    elif base=='cavalry':assert hand=='hand_l'
    elif cell in [3,4]:assert hand=='hand_l' # sword/spear, not shield
    elif cell in [0,2]:assert hand=='hand_r' # shield and emblem

  if not horse:
   signature=[{k:v for k,v in j['nodes'][i].items() if k in ['name','translation','rotation','scale','matrix','children']} for i in skin['joints']]
   # Node index children references are stable in these exported files.
   if shared is None:shared=signature
   else: assert shared==signature
  bounds=[(min(v[k] for v in pos),max(v[k] for v in pos)) for k in range(3)]
 else:
  assert not j.get('skins') and 'COLOR_0' in a and not j.get('textures'); bounds=None
  allowed={'broadleaf':['61755B','3F5C4E','655044'],'conifer':['61755B','3F5C4E','655044'],'boulder':['788087','A2A49D','655044'],'bridge':['927853','9E835B','A98C63','967A54','5F5141','737A76','95978A','68583F','AF956D']}[path.stem]
  expected=[tuple(linear(int(h[i:i+2],16)/255) for i in [0,2,4]) for h in allowed]
  assert all(any(max(abs(c[k]-v[k]) for k in range(3))<.005 for v in expected) for c in values(j,b,a['COLOR_0'])),f'{path}: COLOR_0 must hold linear guide colors, not sRGB bytes'
  assert material['pbrMetallicRoughness'].get('baseColorFactor',[1,1,1,1])==[1,1,1,1]
 report.append(dict(file=str(path.relative_to(ROOT)),triangles=tri,vertices=len(pos),bones=bones,bytes=size,mesh=1,primitive=1,material=1,local_bounds=bounds))
(ROOT/'tools/art/validation.json').write_text(json.dumps(report,indent=2)+'\n'); print(json.dumps(report,indent=2))

# PNG Base Color bytes must match the guide in sRGB, without an extra linearization.
color_report={}
def assert_mean(data,target):
 measured=mean_rgb(data);assert max(abs(a-b) for a,b in zip(measured,target))<=4,f'Base Color stored in wrong color space: mean={measured}, guide sRGB={target}'
for name,h in TERRAIN_SRGB.items():
 path=ROOT/'public/assets/terrain'/f'{name}_albedo.png';data=path.read_bytes();target=[int(h[i:i+2],16) for i in [0,2,4]];assert_mean(data,target)
 color_report[name]={'mean_srgb':hexmean(data),'guide_srgb':'#'+h,'max_channel_error':max(abs(a-b) for a,b in zip(mean_rgb(data),target))}
 # A synthetic old-style linear PNG must fail this same assertion.
 bad=png_write(1,1,3,bytes(round(linear(c/255)*255) for c in target))
 try:assert_mean(bad,target)
 except AssertionError:pass
 else:raise AssertionError('Regression guard accepted a linear-encoded Base Color PNG')
validate_palette((ROOT/'tools/art/unit_palette.png').read_bytes())
color_report['unit_palettes']='All 4 embedded PNGs and source match six sRGB guide swatches; alpha masks preserved.'
color_report['props']='All COLOR_0 values match linear guide swatches; no image conversion needed.'
(ROOT/'tools/art/color_validation.json').write_text(json.dumps(color_report,indent=2)+'\n');print(json.dumps(color_report,indent=2))
