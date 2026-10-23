"""Deterministic LOD1, skeleton/skin/material/palette copied from current LOD0.
python3 tools/art/generate_lod1.py
Only writes *_lod1.glb and tools/art/lod1_generation.json.
"""
import copy,hashlib,json,math,struct
from pathlib import Path
R=Path(__file__).resolve().parents[2];UNITS=['infantry','spearman','archer','cavalry']
def read(p):
 d=p.read_bytes();n=struct.unpack_from('<I',d,12)[0];return json.loads(d[20:20+n]),d[28+n:]
def view(j,b,index):
 v=j['bufferViews'][index];o=v.get('byteOffset',0);return b[o:o+v['byteLength']]
def sub(a,b):return tuple(x-y for x,y in zip(a,b))
def cross(a,b):return (a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
def norm(a):
 n=math.sqrt(sum(v*v for v in a));assert n>1e-10;return tuple(v/n for v in a)
class Geometry:
 def __init__(self,ids):self.ids=ids;self.pos=[];self.nor=[];self.uv=[];self.joints=[];self.weights=[];self.indices=[];self.parts=[]
 def shape(self,name,v,faces,col,bone):
  start=len(self.indices); vertex_start=len(self.pos)
  for face in faces:
   normal=norm(cross(sub(v[face[1]],v[face[0]]),sub(v[face[2]],v[face[0]])))
   begin=len(self.pos)
   for i in face:
    self.pos.append(v[i]);self.nor.append(normal);self.uv.append(((col*42+21)/256,.5))
    bn=bone[i] if isinstance(bone,list) else bone;self.joints.append((self.ids[bn],0,0,0));self.weights.append((1,0,0,0))
   for i in range(1,len(face)-1):self.indices.extend([begin,begin+i,begin+i+1])
  self.parts.append({'name':name,'vertex_start':vertex_start,'vertex_end':len(self.pos),'triangles':(len(self.indices)-start)//3,'palette_cell':col})
 def box(self,name,c,s,col,bone):
  v=[tuple(c[k]+t[k]*s[k]/2 for k in range(3)) for t in [(-1,-1,-1),(-1,-1,1),(-1,1,-1),(-1,1,1),(1,-1,-1),(1,-1,1),(1,1,-1),(1,1,1)]]
  self.shape(name,v,[(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)],col,bone)
 def octa(self,name,c,s,col,bone,top_z=None):
  v=[(c[0]+s[0],c[1],c[2]),(c[0]-s[0],c[1],c[2]),(c[0],c[1]+s[1],c[2]),(c[0],c[1]-s[1],c[2]),(c[0],c[1],c[2]+s[2]),(c[0],c[1],c[2]-s[2])]
  if top_z is not None:v[2]=(c[0],c[1]+s[1],top_z)
  self.shape(name,v,[(2,4,0),(2,0,5),(2,5,1),(2,1,4),(3,0,4),(3,5,0),(3,1,5),(3,4,1)],col,bone)
 def tetra(self,name,c,s,col,bone):
  v=[(c[0]-s[0],c[1]-s[1],c[2]+s[2]),(c[0]+s[0],c[1]-s[1],c[2]+s[2]),(c[0],c[1]-s[1],c[2]-s[2]),(c[0],c[1]+s[1],c[2])]
  self.shape(name,v,[(0,2,1),(0,1,3),(1,2,3),(2,0,3)],col,bone)
 def prism(self,name,a,b,ra,rb,col,bone):
  d=norm(sub(b,a));u=norm(cross(d,(0,0,1) if abs(d[2])<.9 else (0,1,0)));w=cross(d,u);v=[]
  for c,r in [(a,ra),(b,rb)]:
   for i in range(3):
    angle=2*math.pi*i/3;v.append(tuple(c[k]+math.cos(angle)*r[0]*u[k]+math.sin(angle)*r[1]*w[k] for k in range(3)))
  self.shape(name,v,[(0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)],col,bone)
report={}
for name in UNITS:
 p=R/f'public/assets/units/{name}/{name}.glb';src,b=read(p);j=copy.deepcopy(src);skin=src['skins'][0];ids={src['nodes'][n]['name']:i for i,n in enumerate(skin['joints'])};g=Geometry(ids);off=.65 if name=='cavalry' else 0
 def c(x,y,z):return (x,y+off,z)
 g.box('cloth_torso',c(0,1.16,0),(.48,.49,.3),0,'chest')
 # Eight-triangle head prism: a front/back ridge keeps height under camera rotation.
 hw=.155 if name=='archer' else .19;hy=1.84 if name=='archer' else 1.87;hz=.11 if name=='archer' else .16
 head=[c(-hw,1.48,-.12),c(hw,1.48,-.12),c(0,hy,-hz),c(-hw,1.48,.15),c(hw,1.48,.15),c(0,hy,hz)]
 before=len(g.uv)
 g.shape('helmet_or_hood',head,[(3,4,5),(0,2,1),(0,1,4,3),(0,3,5,2),(1,2,5,4)],4 if name=='archer' else 3,'head')
 for i in range(before,before+3):g.uv[i]=((2*42+21)/256,.5)
 g.tetra('waist',c(0,.87,0),(.2,.07,.14),1,'hips')
 g.tetra('cape',c(0,1.11,-.22),(.25,.31,.04),0,'chest')
 for side,x in [('l',-.34),('r',.34)]:
  g.tetra('arm_'+side,c(x,1.15,.025),(.095,.25,.11),0,['forearm_'+side]*3+['upper_arm_'+side])
 for side,x in [('l',-.14),('r',.14)]:
  # Cross-section taper, top follows thigh and foot ring follows foot; 1 influence.
  g.prism('leg_'+side,c(x,.83,.06),c(x,0,.06),(.105,.125),(.11,.19),1,['thigh_'+side]*3+['foot_'+side]*3)
 if name=='infantry':
  g.box('shield',c(.46,1.1,.24),(.44,.65,.1),0,'hand_r')
  g.prism('sword',c(-.44,1.1,.15),c(-.44,1.78,.15),(.09,.028),(.015,.015),3,'hand_l')
  g.tetra('sword_guard',c(-.44,1.09,.15),(.18,.04,.045),3,'hand_l')
 elif name in ['spearman','cavalry']:
  top=2.51 if name=='spearman' else 2.08
  g.prism('spear_shaft',c(-.46,.1 if name=='spearman' else .5,.15),c(-.46,top,.15),(.055,.05),(.055,.05),4,'hand_l')
  g.octa('spear_tip',c(-.46,top+.14,.15),(.07,.14,.04),3,'hand_l')
  if name=='spearman':g.box('narrow_shield',c(.46,1.08,.22),(.26,.7,.08),0,'hand_r')
 else:
  points=[c(.42,.62,.25),c(.65,.89,.25),c(.65,1.38,.25),c(.42,1.64,.25)]
  for i in range(3):
   radius=(.043,.04)  # keep the original attack/die clearance envelope
   g.prism('bow_'+str(i),points[i],points[i+1],radius,radius,4,'hand_r')
  g.shape('bow_string',[c(.405,.62,.25),c(.435,.62,.25),c(.435,1.64,.25),c(.405,1.64,.25)],[(0,1,2,3),(3,2,1,0)],2,'hand_r')
 if name=='cavalry':
  # 24-triangle faceted horse body: two 6-point rings and top/bottom caps.
  v=[(0,1.48,0)]
  for yy in [1.22,.86]:
   for i in range(6):
    a=i*math.tau/6+.2;v.append((math.cos(a)*.4,yy,math.sin(a)*.8))
  v.append((0,.66,0));faces=[]
  for i in range(6):
   k=(i+1)%6;faces.extend([(0,1+k,1+i),(1+i,1+k,7+k,7+i),(13,7+i,7+k)])
  g.shape('horse_body',v,faces,5,'horse_body')
  g.prism('horse_neck',(0,1.15,.5),(0,1.88,.94),(.22,.21),(.15,.16),5,'horse_head')
  g.box('horse_muzzle',(0,1.8,1.14),(.3,.3,.36),5,'horse_head')
  for x in [-.13,.13]:g.tetra('horse_ear',(x,2.02,.89),(.05,.12,.05),5,'horse_head')
  for i,(x,z) in enumerate([(-.27,.52),(.27,.52),(-.27,-.56),(.27,-.56)]):g.prism('horse_leg_'+str(i),(x,.96,z),(x,0,z),(.14,.15),(.08,.11),5,'horse_leg_'+str(i))
  g.tetra('horse_tail',(0,.94,-.96),(.07,.27,.19),4,'horse_body')
  g.box('saddle_cloth',(0,1.4,0),(.8,.13,.64),0,'horse_body')
  for x in [-.4,.4]:g.shape('barding',[(x,.94,-.28),(x,1.38,-.28),(x,1.38,.34),(x,.94,.34)],[(0,1,2,3)] if x>0 else [(3,2,1,0)],0,'horse_body')
 # Replace all geometry storage. Preserve exact nodes/skin matrices/material/palette.
 ibm=view(src,b,src['accessors'][skin['inverseBindMatrices']]['bufferView']);oldaccess=copy.deepcopy(src['accessors'][skin['inverseBindMatrices']]);oldoffset=oldaccess.get('byteOffset',0)
 ibm=ibm[oldoffset:oldoffset+oldaccess['count']*64]
 image=view(src,b,src['images'][0]['bufferView']);j['bufferViews']=[];j['accessors']=[];chunks=[];offset=0
 def addview(data,target=None):
  global offset
  pad=(-offset)%4;chunks.append(b'\0'*pad);offset+=pad;v={'buffer':0,'byteOffset':offset,'byteLength':len(data)}
  if target:v['target']=target
  j['bufferViews'].append(v);chunks.append(data);offset+=len(data);return len(j['bufferViews'])-1
 vi=addview(ibm);oldaccess['bufferView']=vi;oldaccess.pop('byteOffset',None);j['accessors'].append(oldaccess);j['skins'][0]['inverseBindMatrices']=0
 j['images'][0]['bufferView']=addview(image)
 def attr(rows,kind,component=5126,target=34962,bounds=False):
  fmt={5126:'f',5123:'H'}[component];data=b''.join(struct.pack('<'+fmt*len(row),*row) for row in rows);vi=addview(data,target);ac={'bufferView':vi,'componentType':component,'count':len(rows),'type':kind}
  if bounds:ac.update(min=[min(v[k] for v in rows) for k in range(len(rows[0]))],max=[max(v[k] for v in rows) for k in range(len(rows[0]))])
  j['accessors'].append(ac);return len(j['accessors'])-1
 attrs={'POSITION':attr(g.pos,'VEC3',bounds=True),'NORMAL':attr(g.nor,'VEC3'),'TEXCOORD_0':attr(g.uv,'VEC2'),'JOINTS_0':attr(g.joints,'VEC4',5123),'WEIGHTS_0':attr(g.weights,'VEC4')}
 index=attr([(i,) for i in g.indices],'SCALAR',5123,34963)
 j['meshes']=[{'name':name+'_lod1','primitives':[{'attributes':attrs,'indices':index,'material':0,'mode':4}],'extras':{'lod':1,'handedness':'D-015'}}]
 binary=b''.join(chunks);j['buffers']=[{'byteLength':len(binary)}];binary+=b'\0'*((-len(binary))%4)
 assert j['nodes']==src['nodes'] and j['scenes']==src['scenes'];assert len(g.indices)//3<=(180 if name=='cavalry' else 80)
 js=json.dumps(j,separators=(',',':')).encode();js+=b' '*((-len(js))%4);data=struct.pack('<III',0x46546c67,2,len(js)+len(binary)+28)+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(binary),0x004e4942)+binary
 out=p.with_name(name+'_lod1.glb');out.write_bytes(data)
 report[name]={'file':str(out.relative_to(R)),'triangles':len(g.indices)//3,'vertices':len(g.pos),'bones':len(ids),'used_bones':len(set(i[0] for i in g.joints)),'max_influences':1,'bytes':len(data),'parts':g.parts,'source_sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
(R/'tools/art/lod1_generation.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:{x:v[x] for x in ['triangles','vertices','bones','used_bones','bytes']} for k,v in report.items()},indent=2))
