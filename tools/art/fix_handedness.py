"""D-015 one-time model migration. No animation files or bone changes."""
import json,struct,copy,hashlib
from pathlib import Path
R=Path(__file__).resolve().parents[2];report={}
FORM={5126:'f',5123:'H',5121:'B',5125:'I'};WIDTH={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
def accessor(j,b,index):
 a=j['accessors'][index];v=j['bufferViews'][a['bufferView']];f=FORM[a['componentType']];n=WIDTH[a['type']];start=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',struct.calcsize(f)*n)
 return [list(struct.unpack_from('<'+f*n,b,start+i*stride)) for i in range(a['count'])],lambda rows:[struct.pack_into('<'+f*n,b,start+i*stride,*row) for i,row in enumerate(rows)]
for name in ['infantry','spearman','archer','cavalry']:
 p=R/f'public/assets/units/{name}/{name}.glb';d=p.read_bytes();n=struct.unpack_from('<I',d,12)[0];j=json.loads(d[20:20+n]);b=bytearray(d[28+n:]);original=copy.deepcopy(j);pr=j['meshes'][0]['primitives'][0];a=pr['attributes']
 assert not j['meshes'][0].get('extras',{}).get('d015_equipment_reflected'),'Already migrated; do not run twice'
 bones=j['skins'][0]['joints'];ids={j['nodes'][node]['name']:i for i,node in enumerate(bones)};left,right=ids['hand_l'],ids['hand_r']
 pos,putpos=accessor(j,b,a['POSITION']);norm,putnorm=accessor(j,b,a['NORMAL']);joints,putjoints=accessor(j,b,a['JOINTS_0']);weights,_=accessor(j,b,a['WEIGHTS_0']);indices,putindices=accessor(j,b,pr['indices'])
 selected=[i for i,row in enumerate(joints) if any(k in [left,right] and w>0 for k,w in zip(row,weights[i]))];chosen=set(selected)
 before={side:[min(pos[i][0] for i in selected if joints[i][0]==ids[side]),max(pos[i][0] for i in selected if joints[i][0]==ids[side])] for side in ['hand_l','hand_r'] if any(joints[i][0]==ids[side] for i in selected)}
 for i in selected:
  pos[i][0]*=-1;norm[i][0]*=-1
  joints[i]=[right if k==left else left if k==right else k for k in joints[i]]
 for i in range(0,len(indices),3):
  which=[indices[i+k][0] in chosen for k in range(3)];assert all(which) or not any(which)
  if all(which):indices[i+1],indices[i+2]=indices[i+2],indices[i+1]
 putpos(pos);putnorm(norm);putjoints(joints);putindices(indices)
 assert 'TANGENT' not in a
 ac=j['accessors'][a['POSITION']];ac['min']=[min(v[k] for v in pos) for k in range(3)];ac['max']=[max(v[k] for v in pos) for k in range(3)]
 j['meshes'][0].setdefault('extras',{})['d015_equipment_reflected']=True
 assert j['nodes']==original['nodes'] and j['skins']==original['skins'] and j['scenes']==original['scenes']
 after={side:[min(pos[i][0] for i in selected if joints[i][0]==ids[side]),max(pos[i][0] for i in selected if joints[i][0]==ids[side])] for side in ['hand_l','hand_r'] if any(joints[i][0]==ids[side] for i in selected)}
 for side,extent in after.items():assert extent[1]<0 if side=='hand_l' else extent[0]>0
 js=json.dumps(j,separators=(',',':')).encode();js+=b' '*((-len(js))%4);out=struct.pack('<III',0x46546c67,2,28+len(js)+len(b))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(b),0x004e4942)+b;p.write_bytes(out)
 report[name]={'equipment_vertices':len(selected),'before_hand_x_bounds':before,'after_hand_x_bounds':after,'nodes_skins_scenes_unchanged':True,'changed_accessors':['POSITION','NORMAL','JOINTS_0','indices'],'weights_values_unchanged':True,'uv_palette_unchanged':True,'bytes':len(out)}
(R/'tools/art/handedness_correction.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
