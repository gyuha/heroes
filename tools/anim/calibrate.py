"""Set reference speed from backward sole travel during low contact phase.
Measures the final GLTFLoader skinned poses, never game balance movement speeds.
"""
import json,math,hashlib
from generate import ROOT,UNITS,SELECTED_UNITS,read_glb,write_glb
from validate import values
poses=json.loads((ROOT/'tools/anim/poses.json').read_text());report=json.loads((ROOT/'tools/anim/locomotion.json').read_text()) if (ROOT/'tools/anim/locomotion.json').exists() else {}
for unit in SELECTED_UNITS:
 src=ROOT/f'public/assets/units/{unit}/{unit}.glb';model,mb=read_glb(src)
 attrs=model['meshes'][0]['primitives'][0]['attributes'];positions=values(model,mb,attrs['POSITION']);joints=values(model,mb,attrs['JOINTS_0']);weights=values(model,mb,attrs['WEIGHTS_0'])
 bone_names=[model['nodes'][i]['name'] for i in model['skins'][0]['joints']]
 feet=[f'horse_leg_{i}' for i in range(4)] if unit=='cavalry' else ['foot_l','foot_r']
 path=src.with_name('animations.glb');g,b=read_glb(path);report[unit]={}
 for clip in ('walk','run'):
  frames=poses[unit]['clips'][clip]['frames'];samples=[]
  for foot in feet:
   ids=[i for i,(js,ws) in enumerate(zip(joints,weights)) if bone_names[js[max(range(4),key=lambda k:ws[k])]]==foot]
   y0=min(positions[i][1] for i in ids);ids=[i for i in ids if positions[i][1]<y0+.025]
   centers=[tuple(sum(f[i*3+k] for i in ids)/len(ids) for k in range(3)) for f in frames]
   heights=sorted(c[1] for c in centers[:-1]);threshold=heights[len(heights)//3]+.01
   speeds=[(a[2]-z[2])*30 for a,z in zip(centers,centers[1:]) if (a[1]+z[1])/2<=threshold and a[2]>z[2]]
   assert speeds, (unit,clip,foot)
   samples.extend(speeds)
  speed=round(sum(samples)/len(samples),6);assert speed>0
  if unit=='cavalry':
   targets=[3.5] if clip=='walk' else [7.0,9.0]
   assert all(.8<=target/speed<=1.3 for target in targets), 'Cavalry playback ratio outside game-speed budget'
  next(a for a in g['animations'] if a['name']==clip)['extras']['speed']=speed
  report[unit][clip]={'speed_m_s':speed,'contact_intervals':len(samples),'contact_speed_rms_variation_m_s':math.sqrt(sum((v-speed)**2 for v in samples)/len(samples))}
 write_glb(path,g,b)
(ROOT/'tools/anim/locomotion.json').write_text(json.dumps(report,indent=2)+'\n')
manifest=json.loads((ROOT/'tools/anim/generation.json').read_text())
for row in manifest:
 p=ROOT/f"public/assets/units/{row['unit']}/animations.glb";row['animation_sha256']=hashlib.sha256(p.read_bytes()).hexdigest();row['bytes']=p.stat().st_size
(ROOT/'tools/anim/generation.json').write_text(json.dumps(manifest,indent=2)+'\n')
