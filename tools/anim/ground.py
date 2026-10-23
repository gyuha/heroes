"""Ground sampled poses after actual three.js skinning; root always stays fixed.
Run once after generate.py + verify.mjs, then rerun verify.mjs and validate.py.
"""
import json,struct,hashlib
from generate import ROOT,UNITS,SELECTED_UNITS,read_glb,write_glb
poses=json.loads((ROOT/'tools/anim/poses.json').read_text());report=json.loads((ROOT/'tools/anim/grounding.json').read_text()) if (ROOT/'tools/anim/grounding.json').exists() else {}
for unit in SELECTED_UNITS:
 path=ROOT/f'public/assets/units/{unit}/animations.glb';g,data=read_glb(path);b=bytearray(data);report[unit]={}
 for anim in g['animations']:
  clip=anim['name'];peers=UNITS[:3] if unit!='cavalry' and clip!='attack' else [unit]
  offsets=[max(0,max(-min(frame[1::3]) for peer in peers for frame in [poses[peer]['clips'][clip]['frames'][f]])) for f in range(len(poses[unit]['clips'][clip]['frames']))]
  # Exact seam, independent of tiny sin() endpoint noise.
  if clip in ('idle','walk','run'):offsets[-1]=offsets[0]
  for ch in anim['channels']:
   if ch['target']['path']!='translation' or g['nodes'][ch['target']['node']]['name'] != 'hips':continue
   a=g['accessors'][anim['samplers'][ch['sampler']]['output']];v=g['bufferViews'][a['bufferView']];start=v['byteOffset']+a.get('byteOffset',0)
   for f,offset in enumerate(offsets):
    index=start+f*12+4;y=struct.unpack_from('<f',b,index)[0];struct.pack_into('<f',b,index,y+offset)
  report[unit][clip]={'max_ground_correction_m':max(offsets)}
 write_glb(path,g,bytes(b))
(ROOT/'tools/anim/grounding.json').write_text(json.dumps(report,indent=2)+'\n')
manifest=json.loads((ROOT/'tools/anim/generation.json').read_text())
for row in manifest:
 p=ROOT/f"public/assets/units/{row['unit']}/animations.glb";row['animation_sha256']=hashlib.sha256(p.read_bytes()).hexdigest();row['bytes']=p.stat().st_size
(ROOT/'tools/anim/generation.json').write_text(json.dumps(manifest,indent=2)+'\n')
