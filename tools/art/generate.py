"""Run: blender --background --python tools/art/generate.py (Blender 5.2)."""
import bpy, math, json, struct, random, sys
sys.path.insert(0,str(__import__("pathlib").Path(__file__).resolve().parent))
from color_io import srgb
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/assets'; ART=ROOT/'tools/art'
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
def linear(v):
    return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
def color(hexcode):
    return tuple(linear(int(hexcode[i:i+2],16)/255) for i in (0,2,4))
# Blender XY ground, -Y front, Z up; export converts to glTF Y up, Z front.
PALETTE=[(200,200,200,255),(40,50,61,0),(230,220,196,0),(135,150,156,0),(101,80,68,0),(174,125,83,0)]
img=bpy.data.images.new('unit_palette',width=256,height=256,alpha=True)
img.alpha_mode='CHANNEL_PACKED'
pixels=[]
for y in range(256):
 for x in range(256):
  c=PALETTE[min(5,x//42)]; pixels.extend([t/255 for t in c[:3]]+[c[3]/255])
img.pixels=pixels; img.filepath_raw=str(ART/'unit_palette.png'); img.file_format='PNG'; img.save(); img.pack()
mat=bpy.data.materials.new('unit_palette'); mat.use_nodes=True
bs=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'); bs.inputs['Metallic'].default_value=0; bs.inputs['Roughness'].default_value=.85
tex=mat.node_tree.nodes.new('ShaderNodeTexImage'); tex.image=img; tex.interpolation='Closest'; mat.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
BONES=[('root',None,(0,0,0)),('hips','root',(0,0,.86)),('spine','hips',(0,0,1.08)),('chest','spine',(0,0,1.3)),('head','chest',(0,0,1.53)),('upper_arm_l','chest',(-.3,0,1.35)),('forearm_l','upper_arm_l',(-.43,-.04,1.13)),('hand_l','forearm_l',(-.44,-.12,.97)),('upper_arm_r','chest',(.3,0,1.35)),('forearm_r','upper_arm_r',(.43,-.04,1.13)),('hand_r','forearm_r',(.44,-.12,.97)),('thigh_l','hips',(-.14,0,.83)),('shin_l','thigh_l',(-.14,0,.44)),('foot_l','shin_l',(-.14,-.04,.12)),('thigh_r','hips',(.14,0,.83)),('shin_r','thigh_r',(.14,0,.44)),('foot_r','shin_r',(.14,-.04,.12))]
class Builder:
 def __init__(self): self.v=[]; self.f=[]; self.cols=[]; self.groups=[]
 def box(self,c,s,col,bone='root',angle=0):
  start=len(self.v)
  for x,y,z in [(-1,-1,-1),(-1,-1,1),(-1,1,-1),(-1,1,1),(1,-1,-1),(1,-1,1),(1,1,-1),(1,1,1)]:
   x,y,z=x*s[0]/2,y*s[1]/2,z*s[2]/2
   self.v.append((c[0]+x*math.cos(angle)+z*math.sin(angle),c[1]+y,c[2]-x*math.sin(angle)+z*math.cos(angle))); self.groups.append(bone)
  for face in [(0,4,6,2),(1,3,7,5),(0,1,5,4),(2,6,7,3),(0,2,3,1),(4,5,7,6)]: self.f.append(tuple(start+i for i in face)); self.cols.append(col)
 def shape(self,vertices,faces,col,bone='root'):
  start=len(self.v); self.v.extend(vertices); self.groups.extend([bone]*len(vertices))
  for face in faces:self.f.append(tuple(start+i for i in face));self.cols.append(col)
 def segment(self,a,b,width_a,width_b,col,bone='root'):
  a,b=Vector(a),Vector(b); q=(b-a).to_track_quat('Z','Y');verts=[]
  for center,w in [(a,width_a),(b,width_b)]:
   for x,y in [(-1,-1),(1,-1),(1,1),(-1,1)]:verts.append(center+q@Vector((x*w[0]/2,y*w[1]/2,0)))
  self.shape(verts,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],col,bone)
 def gem(self,c,scale,col,bone='root',phase=0):
  verts=[(c[0],c[1],c[2]+scale[2])]
  for z,r in [(.4,.84),(-.45,.85)]:
   for i in range(6):
    a=i*math.tau/6+phase;verts.append((c[0]+math.cos(a)*scale[0]*r,c[1]+math.sin(a)*scale[1]*r,c[2]+z*scale[2]))
  verts.append((c[0],c[1],c[2]-scale[2]));faces=[]
  for i in range(6):
   k=(i+1)%6;faces.extend([(0,1+i,1+k),(1+i,7+i,7+k,1+k),(13,7+k,7+i)])
  self.shape(verts,faces,col,bone)
 def object(self,name,material,rig=None):
  mesh=bpy.data.meshes.new(name); mesh.from_pydata(self.v,[],self.f); mesh.update(); ob=bpy.data.objects.new(name,mesh); bpy.context.collection.objects.link(ob); mesh.materials.append(material)
  uv=mesh.uv_layers.new(name='palette')
  for p,c in zip(mesh.polygons,self.cols):
   p.use_smooth = self.groups[p.vertices[0]].startswith(('thigh_', 'shin_', 'upper_arm_', 'forearm_'))
   for loop in p.loop_indices: uv.data[loop].uv=((c*42+21)/256,.5)
  if rig:
   for bn in rig.data.bones:
    g=ob.vertex_groups.new(name=bn.name); inds=[i for i,b in enumerate(self.groups) if b==bn.name]
    if inds:g.add(inds,1,'REPLACE')
   mod=ob.modifiers.new('skin','ARMATURE'); mod.object=rig; ob.parent=rig
  return ob

def rig(name,mounted):
 arm=bpy.data.armatures.new(name+'_skeleton'); ob=bpy.data.objects.new(name+'_rig',arm); bpy.context.collection.objects.link(ob); bpy.context.view_layer.objects.active=ob; ob.select_set(True); bpy.ops.object.mode_set(mode='EDIT')
 extra=[('horse_body','root',(0,0,.95)),('horse_head','horse_body',(0,-.85,1.3))]+[(f'horse_leg_{i}','horse_body',(x,y,.65)) for i,(x,y) in enumerate([(-.22,-.65),(.22,-.65),(-.22,.65),(.22,.65)])]
 for bn,parent,p in BONES+(extra if mounted else []):
  b=arm.edit_bones.new(bn); offset=.65 if mounted and bn!='root' and not bn.startswith('horse_') else 0; b.head=(p[0],p[1],p[2]+offset); b.tail=b.head+Vector((0,0,.12))
  if parent:b.parent=arm.edit_bones[parent]
 bpy.ops.object.mode_set(mode='OBJECT'); ob.select_set(False); return ob
units=[]
for name in ['infantry','spearman','archer','cavalry']:
 mounted=name=='cavalry'; r=rig(name,mounted); b=Builder(); off=.65 if mounted else 0
 def box(c,s,col,bone,angle=0): b.box((c[0],c[1],c[2]+off),s,col,bone,angle)
 box((0,0,1.16),(.48,.3,.49),0,'chest'); box((0,.19,1.12),(.5,.08,.62),0,'chest')
 box((0,0,.85),(.4,.29,.18),1,'hips'); box((0,-.02,1.57),(.31,.3,.3),2,'head')
 if name=='archer':
  b.segment((0,.015,1.65+off),(0,.015,1.84+off),(.4,.37),(.23,.25),4,'head')
 else:
  b.shape([(-.2,-.18,1.68+off),(.2,-.18,1.68+off),(.2,.19,1.68+off),(-.2,.19,1.68+off),(0,-.16,1.87+off),(0,.16,1.87+off)],[(0,1,4),(3,5,2),(0,4,5,3),(1,2,5,4),(0,3,2,1)],3,'head')
  for x in [-.17,.17]:box((x,-.015,1.55),(.065,.27,.24),3,'head')
 for side,x in [('l',-.14),('r',.14)]:
  box((x,0,.65),(.19,.23,.38),1,'thigh_'+side); box((x,0,.29),(.17,.2,.34),1,'shin_'+side); box((x,-.07,.07),(.2,.36,.14),1,'foot_'+side)
 for side,x in [('l',-.34),('r',.34)]:
  box((x,0,1.26),(.19,.24,.3),0,'upper_arm_'+side); box((x*1.22,-.07,1.02),(.16,.2,.25),2,'forearm_'+side)
 if name=='infantry':
  box((-.46,-.24,1.1),(.44,.1,.65),0,'hand_l'); box((-.46,-.3,1.1),(.08,.025,.51),2,'hand_l'); b.segment((.44,-.15,1.12+off),(.44,-.15,1.78+off),(.18,.055),(.035,.035),3,'hand_r')
  box((.44,-.15,1.09),(.36,.09,.075),3,'hand_r');box((.44,-.15,.99),(.08,.08,.17),4,'hand_r')
 elif name in ['spearman','cavalry']:
  box((.46,-.15,1.35),(.065,.065,2.5 if not mounted else 1.7),4,'hand_r'); box((.46,-.15,2.65 if not mounted else 2.22),(.14,.07,.28),3,'hand_r')
  if not mounted:
   verts=[(x,y,z) for y in [-.27,-.18] for x,z in [(-.59,1.42),(-.33,1.42),(-.33,.92),(-.46,.72),(-.59,.92)]]
   b.shape(verts,[(0,4,3,2,1),(5,6,7,8,9)]+[(i,(i+1)%5,(i+1)%5+5,i+5) for i in range(5)],0,'hand_l')
 else:
  for z,x,a in [(.65,-.48,-.6),(.88,-.62,-.25),(1.13,-.65,0),(1.38,-.62,.25),(1.61,-.48,.6)]: box((x,-.25,z),(.065,.075,.28),4,'hand_l',a)
  box((-.4,-.25,1.13),(.025,.025,1.12),2,'hand_l'); box((.2,.25,1.2),(.17,.18,.49),4,'chest')
 if mounted:
  b.gem((0,.02,1.05),(.47,.95,.43),5,'horse_body',.2)
  b.segment((0,-.5,1.15),(0,-.94,1.88),(.43,.42),(.28,.33),5,'horse_head')
  b.segment((0,-.9,1.87),(0,-1.28,1.69),(.32,.34),(.24,.29),5,'horse_head')
  for x in [-.13,.13]:b.segment((x,-.86,1.95),(x,-.9,2.16),(.11,.12),(.045,.07),5,'horse_head')
  b.segment((0,-.39,1.45),(0,-.83,1.99),(.13,.16),(.1,.12),4,'horse_head')
  for i,(x,y) in enumerate([(-.27,-.52),(.27,-.52),(-.27,.56),(.27,.56)]):
   bone='horse_leg_'+str(i); knee=(x,y+(.08 if i<2 else -.12),.44)
   b.segment((x,y,.98),knee,(.24,.3),(.14,.16),5,bone)
   b.segment(knee,(x,y,.08),(.14,.16),(.09,.11),5,bone)
   b.box((x,y-.035,.065),(.15,.22,.13),4,bone)
  b.segment((0,.72,1.19),(0,1.13,.68),(.17,.2),(.1,.13),4,'horse_body')
  b.box((0,0,1.4),(.8,.64,.13),0,'horse_body')
  for x in [-.4,.4]:b.box((x,.04,1.16),(.045,.62,.44),0,'horse_body')
 # D-015: legacy suffixes are opposite anatomical sides; reflect equipment only.
 for i,bone in enumerate(b.groups):
  if bone in ['hand_l','hand_r']:
   x,y,z=b.v[i];b.v[i]=(-x,y,z);b.groups[i]='hand_r' if bone=='hand_l' else 'hand_l'
 for i,face in enumerate(b.f):
  if all(b.groups[k] in ['hand_l','hand_r'] for k in face):b.f[i]=tuple(reversed(face))
 ob=b.object(name,mat,r); units.append((name,ob,r))
 bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); r.select_set(True); bpy.context.view_layer.objects.active=ob
 dest=OUT/'units'/name; dest.mkdir(parents=True,exist_ok=True)
 bpy.ops.export_scene.gltf(filepath=str(dest/(name+'.glb')),export_format='GLB',use_selection=True,export_animations=False,export_yup=True,export_texcoords=True,export_normals=True,export_skins=True)
# Water/ford owned by generate_crossings.py (D-009); do not overwrite them here.
# Periodic multiscale lattice noise: no preferred direction, exact edge match.
def noise_grid(seed):
 rng=random.Random(seed); return [[rng.uniform(-1,1) for x in range(32)] for y in range(32)]
def noise(grid,u,v,n):
 x,y=u*n,v*n;ix,iy=math.floor(x),math.floor(y);fx,fy=x-ix,y-iy
 fx=fx*fx*(3-2*fx);fy=fy*fy*(3-2*fy)
 def g(a,b):return grid[b%n][a%n]
 return (g(ix,iy)*(1-fx)+g(ix+1,iy)*fx)*(1-fy)+(g(ix,iy+1)*(1-fx)+g(ix+1,iy+1)*fx)*fy
for seed,(name,h) in enumerate([('grass','78866A'),('forest','3F5C4E'),('rock','788087'),('sand','A28362')]):
 im=bpy.data.images.new(name,width=512,height=512,alpha=False);base=color(h);pix=[];grids=[noise_grid(seed*19+k) for k in range(4)]
 for y in range(512):
  for x in range(512):
   delta=sum(noise(g,x/511,y/511,n)*amp for g,n,amp in zip(grids,[4,8,16,32],[.009,.005,.003,.0015]))
   pix.extend([srgb(max(0,min(1,c+delta))) for c in base]+[1])
 im.pixels=pix;dest=OUT/'terrain';dest.mkdir(parents=True,exist_ok=True);im.filepath_raw=str(dest/(name+'_albedo.png'));im.file_format='PNG';im.save()
# Vertex color props, no textures.
pm=bpy.data.materials.new('prop_vertex'); pm.use_nodes=True; pb=next(n for n in pm.node_tree.nodes if n.type=='BSDF_PRINCIPLED'); pb.inputs['Roughness'].default_value=.9
vc=pm.node_tree.nodes.new('ShaderNodeVertexColor'); vc.layer_name='Color'; pm.node_tree.links.new(vc.outputs['Color'],pb.inputs['Base Color'])
props=[]
for name in ['broadleaf','conifer','boulder']:
 b=Builder()
 if name=='boulder':
  b.gem((-.25,0,.56),(.93,.75,.63),0,phase=.18);b.gem((.57,.14,.36),(.65,.58,.4),1,phase=.65)
 else:
  b.box((0,0,1.1),(.25,.25,2.2),2)
  if name=='broadleaf':
   for c,sz in [((-.5,.12,2.45),(1.05,.93,1.05)),((.55,-.12,2.52),(.94,.85,.97)),((.03,.25,3.08),(.9,.82,.9))]:b.gem(c,sz,0,phase=.2)
  else:
   for z,w in [(1.65,1.6),(2.3,1.2),(2.9,.7)]:b.gem((0,0,z),(w*.6,w*.6,.78),1)
 ob=b.object(name,pm); attr=ob.data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
 colors=['61755B','3F5C4E','655044'] if name!='boulder' else ['788087','A2A49D','655044']
 for poly,ci in zip(ob.data.polygons,b.cols):
  for li in poly.loop_indices:attr.data[li].color=(*color(colors[ci]),1)
 # Props do not carry palette UVs.
 ob.data.uv_layers.remove(ob.data.uv_layers[0]); bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
 dest=OUT/'props'; dest.mkdir(parents=True,exist_ok=True); bpy.ops.export_scene.gltf(filepath=str(dest/(name+'.glb')),use_selection=True,export_format='GLB',export_animations=False); props.append(ob)
# Export source, then render actual meshes with the same alpha-mask formula.
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ART/'army_source.blend'))
for ob in props:ob.hide_render=True
for name,ob,r in units:ob.hide_render=True
scene=bpy.context.scene
scene.render.engine='CYCLES'; scene.cycles.samples=32
scene.render.resolution_x=1600; scene.render.resolution_y=1050; scene.render.resolution_percentage=100
scene.world.color=(.3,.3,.3); scene.view_settings.view_transform='Standard'
for row,team in enumerate(['247DA8','E4A33B']):
 m=mat.copy(); shader=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED'); t=next(n for n in m.node_tree.nodes if n.type=='TEX_IMAGE')
 mix=m.node_tree.nodes.new('ShaderNodeMixRGB'); mix.blend_type='MULTIPLY'; mix.inputs[2].default_value=(*color(team),1); m.node_tree.links.new(t.outputs['Alpha'],mix.inputs[0]); m.node_tree.links.new(t.outputs['Color'],mix.inputs[1]); m.node_tree.links.new(mix.outputs[0],shader.inputs['Base Color'])
 for i,(name,ob,r) in enumerate(units):
  clone=ob.copy(); clone.data=ob.data.copy(); clone.parent=None; clone.modifiers.clear(); clone.hide_render=False; clone.location=(i*2.5-3.75,row*3.8,0); clone.data.materials.clear(); clone.data.materials.append(m); bpy.context.collection.objects.link(clone)
  bpy.ops.object.text_add(location=(i*2.5-4.3,row*3.8-1.3,.02)); label=bpy.context.object; label.data.body=name.upper(); label.data.size=.22
bpy.ops.mesh.primitive_plane_add(size=200); ground=bpy.context.object; ground.location.z=-.02
floor=bpy.data.materials.new('ground'); floor.diffuse_color=(*color('CFD4CE'),1); ground.data.materials.append(floor)
bpy.ops.object.light_add(type='AREA',location=(-3,-4,10)); bpy.context.object.data.energy=1600; bpy.context.object.data.shape='DISK'; bpy.context.object.data.size=8
bpy.ops.object.camera_add(location=(6,-12,12)); cam=bpy.context.object; cam.rotation_euler=(Vector((0,1.6,.7))-cam.location).to_track_quat('-Z','Y').to_euler(); cam.data.type='ORTHO'; cam.data.ortho_scale=14.5; scene.camera=cam
scene.render.filepath=str(ART/'unit_comparison.png'); bpy.ops.render.render(write_still=True)
