"""Validate binary glTF data independently of the motion authoring functions."""
import hashlib,json,math,struct
from pathlib import Path
from generate import read_glb,ROOT,UNITS

def values(g,b,index):
 a=g['accessors'][index];v=g['bufferViews'][a['bufferView']];width={'SCALAR':1,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]
 fmt={5126:'f',5123:'H',5121:'B'}[a['componentType']]; size=struct.calcsize(fmt);start=v.get('byteOffset',0)+a.get('byteOffset',0)
 return [struct.unpack_from('<'+fmt*width,b,start+i*v.get('byteStride',width*size)) for i in range(a['count'])]

def validate():
 report={};shared={}
 for unit in UNITS:
  src=ROOT/f'public/assets/units/{unit}/{unit}.glb';original,ob=read_glb(src);g,b=read_glb(src.with_name('animations.glb'))
  assert not any(k in g for k in ('meshes','materials','images','textures','skins'))
  expected=json.loads(json.dumps(original['nodes']))
  for n in expected:n.pop('mesh',None);n.pop('skin',None)
  assert g['nodes']==expected and g['scenes']==original['scenes'],'Skeleton bind hierarchy changed'
  names=[a['name'] for a in g['animations']];assert names==['idle','walk','run','attack','hit','die']
  joints=original['skins'][0]['joints'];root=next(i for i,n in enumerate(g['nodes']) if n['name']=='root')
  assert g['nodes'][root].get('translation',[0,0,0])==[0,0,0]
  rows=[]
  for anim in g['animations']:
   times=values(g,b,anim['samplers'][0]['input']);duration=times[-1][0];n=len(times)
   assert abs(duration-(n-1)/30)<1e-6
   assert all(abs(t[0]-i/30)<1e-6 for i,t in enumerate(times))
   extras=anim['extras']
   if anim['name'] in ('walk','run'):assert math.isfinite(extras['speed']) and extras['speed']>0
   if unit=='cavalry' and anim['name'] in ('walk','run'):
    assert all(.8<=v/extras['speed']<=1.3 for v in ([3.5] if anim['name']=='walk' else [7,9]))
   if anim['name']=='attack':assert abs(extras['hitTime']-(16 if unit=='archer' else 12)/30)<1e-9
   max_seam=0;root_delta=0;channels={};translation_targets=set()
   for c in anim['channels']:
    s=anim['samplers'][c['sampler']];path=c['target']['path'];ni=c['target']['node'];assert path in ('translation','rotation') and ni in joints
    assert ni!=root,'Root channels are forbidden, including constant channels'
    if path=='translation':
     assert g['nodes'][ni]['name']=='hips','Only hips translation is allowed'
     translation_targets.add('hips')
    assert s.get('interpolation')=='LINEAR';v=values(g,b,s['output']);assert len(v)==n
    assert all(math.isfinite(x) for row in v for x in row)
    if path=='rotation':assert all(abs(sum(x*x for x in q)-1)<1e-5 for q in v)
    seam=max(abs(a-z) for a,z in zip(v[0],v[-1]));max_seam=max(max_seam,seam)
    if ni==root:
     default=(0,0,0,1) if path=='rotation' else (0,0,0)
     root_delta=max(root_delta,max(abs(x-y) for row in v for x,y in zip(row,default)))
    channels[g['nodes'][ni]['name']+'.'+path]=v
   assert root_delta==0
   if anim['name'] in ('idle','walk','run'):assert max_seam<1e-6
   if anim['name']=='die':
    assert all(row[-1]==row[-2] for row in channels.values()),'Death must settle'
   if unit!='cavalry' and anim['name']!='attack':
    key=anim['name']
    if key in shared:assert channels==shared[key]
    else:shared[key]=channels
   rows.append({'clip':anim['name'],'duration_s':round(duration,6),'samples':n,'intervals':n-1,'root_delta':root_delta,'root_channels':0,'translation_targets':sorted(translation_targets),'extras':extras,'loop_max_component_delta':max_seam if anim['name'] in ('idle','walk','run') else None})
  prim=original['meshes'][0]['primitives'][0];weights=values(original,ob,prim['attributes']['WEIGHTS_0'])
  influences=max(sum(x>0 for x in w) for w in weights);assert influences<=4
  assert not any('WEIGHTS_1' in p['attributes'] for m in original['meshes'] for p in m['primitives'])
  assert sum(r['duration_s'] for r in rows)<=6
  report[unit]={'bones':len(joints),'max_influences':influences,'bind_hierarchy_exact':True,'total_s':round(sum(r['duration_s'] for r in rows),6),'clips':rows,'source_sha256':hashlib.sha256(src.read_bytes()).hexdigest()}
 out=ROOT/'tools/anim/validation.json';out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
if __name__=='__main__':validate()
