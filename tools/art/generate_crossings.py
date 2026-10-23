"""T-013 only. Does not write any unit or unrelated terrain/prop assets.
blender --background --factory-startup --python tools/art/generate_crossings.py
"""
import bpy,math,random,json,hashlib
from pathlib import Path
from mathutils import Vector
R=Path(__file__).resolve().parents[2];A=R/'tools/art';O=R/'public/assets'
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def linear(v):return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
def rgb(h):return tuple(linear(int(h[i:i+2],16)/255) for i in [0,2,4])
def image(name,fun):
 im=bpy.data.images.new(name,width=512,height=512,alpha=False);pix=[]
 for y in range(512):
  for x in range(512):
   c=fun(x/511,y/511);pix.extend((*[12.92*v if v<=.0031308 else 1.055*v**(1/2.4)-.055 for v in c],1))
 im.pixels=pix;im.filepath_raw=str(O/'terrain'/(name+'_albedo.png'));im.file_format='PNG';im.save();return im
rng=random.Random(1305)
grid=[[rng.uniform(-1,1) for x in range(32)] for y in range(32)]
def noise(u,v,n):
 x,y=u*n,v*n;ix,iy=math.floor(x),math.floor(y);fx,fy=x-ix,y-iy;fx=fx*fx*(3-2*fx);fy=fy*fy*(3-2*fy)
 def g(x,y):return grid[y%n][x%n]
 return (g(ix,iy)*(1-fx)+g(ix+1,iy)*fx)*(1-fy)+(g(ix,iy+1)*(1-fx)+g(ix+1,iy+1)*fx)*fy
def variation(u,v):return noise(u,v,4)*.006+noise(u,v,8)*.004+noise(u,v,16)*.002
waterbase=rgb('263F49');fordbase=rgb('819C92')
water=image('water',lambda u,v:tuple(max(.001,c+variation(u,v)*.35) for c in waterbase))
N=17;stones={}
for y in range(N):
 for x in range(N):stones[x,y]=(rng.uniform(.15,.85),rng.uniform(.15,.85),rng.uniform(.2,.43),rng.uniform(.18,.38),rng.choice(['B7B79E','A5AD9A','C6BEA2','96A597']))
def ford(u,v):
 x,y=u*N,v*N;ix,iy=math.floor(x),math.floor(y);nearest=None
 for dy in [-1,0,1]:
  for dx in [-1,0,1]:
   ox,oy,rx,ry,col=stones[(ix+dx)%N,(iy+dy)%N];a=(x-(ix+dx+ox))/rx;b=(y-(iy+dy+oy))/ry;d=a*a+b*b
   if d<1 and (nearest is None or d<nearest[0]):nearest=(d,col,a,b)
 delta=variation(u,v)
 if nearest:
  d,h,a,b=nearest;base=rgb(h);shade=.88+.12*max(0,1-d)+.035*(-a+b)
  return tuple(max(0,c*shade+delta*.3) for c in base)
 return tuple(max(0,c+delta) for c in fordbase)
fordim=image('ford',ford)
# Local Blender Z=0 deck top maps exactly to glTF local Y=0.
verts=[];faces=[];colors=[]
def box(c,sz,h):
 start=len(verts)
 for x,y,z in [(-1,-1,-1),(-1,-1,1),(-1,1,-1),(-1,1,1),(1,-1,-1),(1,-1,1),(1,1,-1),(1,1,1)]:verts.append((c[0]+x*sz[0]/2,c[1]+y*sz[1]/2,c[2]+z*sz[2]/2))
 for face in [(0,4,6,2),(1,3,7,5),(0,1,5,4),(2,6,7,3),(0,2,3,1),(4,5,7,6)]:faces.append(tuple(start+i for i in face));colors.append(h)
# 40 contiguous boards, no gaps in walking plane.
for i in range(40):box((0,-19.5+i,-.225),(10,1,.45),['927853','9E835B','A98C63','967A54'][i%4])
for x in [-3.8,3.8]:box((x,0,-.7),(.5,40,.5),'5F5141')
for y in [-14,-5,5,14]:
 box((0,y,-3.65),(8.8,1.25,4.7),'737A76');box((0,y,-1.1),(10.4,1.6,.4),'95978A')
for y in range(-19,20,4):box((0,y,-.3),(11.2,.45,.2),'68583F')
for x in [-5.4,5.4]:
 for y in range(-19,20,4):box((x,y,.5),(.34,.4,1.45),'68583F')
 for z in [.5,1.05]:box((x,0,z),(.22,40,.22),'AF956D')
mesh=bpy.data.meshes.new('bridge');mesh.from_pydata(verts,[],faces);mesh.update();ob=bpy.data.objects.new('bridge',mesh);bpy.context.collection.objects.link(ob)
mat=bpy.data.materials.new('bridge_vertex');mat.use_nodes=True;bs=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED');bs.inputs['Roughness'].default_value=.94
attr=mesh.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
for p,h in zip(mesh.polygons,colors):
 for li in p.loop_indices:attr.data[li].color=(*rgb(h),1)
vc=mat.node_tree.nodes.new('ShaderNodeVertexColor');vc.layer_name='Color';mat.node_tree.links.new(vc.outputs['Color'],bs.inputs['Base Color']);mesh.materials.append(mat)
bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob
bpy.ops.export_scene.gltf(filepath=str(O/'props/bridge.glb'),export_format='GLB',use_selection=True,export_animations=False)
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(A/'crossings_source.blend'))
# Preview: all 7 surface swatches, top row ford/deep water/bridge at comparable scale.
ob.location=(23,0,0)
def material(name,im):
 m=bpy.data.materials.new(name);m.use_nodes=True;b=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED');b.inputs['Roughness'].default_value=.92
 t=m.node_tree.nodes.new('ShaderNodeTexImage');t.image=im;m.node_tree.links.new(t.outputs['Color'],b.inputs['Base Color']);return m
def plane(name,xy,size,im,z=0,repeat=3):
 bpy.ops.mesh.primitive_plane_add(size=2,location=(xy[0],xy[1],z));o=bpy.context.object;o.name=name;o.scale=(size[0]/2,size[1]/2,1)
 for uv in o.data.uv_layers.active.data:uv.uv*=repeat
 o.data.materials.append(material(name,im));return o
def label(text,x,y,size=1):
 bpy.ops.object.text_add(location=(x,y,.1));o=bpy.context.object;o.data.body=text;o.data.size=size
 m=bpy.data.materials.get('label')
 if not m:
  m=bpy.data.materials.new('label');m.use_nodes=True;b=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED');b.inputs['Base Color'].default_value=(.8,.85,.8,1);b.inputs['Emission Color'].default_value=(.8,.85,.8,1);b.inputs['Emission Strength'].default_value=1
 o.visible_shadow=False
 o.data.materials.append(m)
plane('ford_3x3',(-25,0),(15,30),fordim);label('FORD / PASSABLE',-32,-18)
plane('deep_water_3x3',(-5,0),(15,30),water);label('DEEP WATER / BLOCKED',-13,-18,.8)
# Water plane below bridge for clearance view. Gray-blue basin is visual context only.
plane('bridge_river',(23,0),(15,30),water,z=-3);label('BRIDGE / 10m x 40m',16,-23,.9)
for i,name in enumerate(['grass','forest','rock','sand','water','ford']):
 im=bpy.data.images.load(str(O/'terrain'/(name+'_albedo.png')),check_existing=True)
 plane(name,(i*11-29,-36),(9,9),im);label(name+' 3x3',i*11-33,-42,.85)
# Background and light neutral, clear wet/dry contrast.
bpy.ops.mesh.primitive_plane_add(size=300,location=(0,0,-6.1));floor=bpy.context.object;fm=bpy.data.materials.new('backdrop');fm.use_nodes=True;fb=next(n for n in fm.node_tree.nodes if n.type=='BSDF_PRINCIPLED');fb.inputs['Base Color'].default_value=(*rgb('4F5D60'),1);fb.inputs['Roughness'].default_value=1;floor.data.materials.append(fm)
s=bpy.context.scene;s.world.use_nodes=True;bg=next(n for n in s.world.node_tree.nodes if n.type=='BACKGROUND');bg.inputs['Color'].default_value=(.65,.7,.75,1);bg.inputs['Strength'].default_value=.8
bpy.ops.object.light_add(type='SUN');bpy.context.object.rotation_euler=(.4,-.3,-.3);bpy.context.object.data.energy=2
bpy.ops.object.camera_add(location=(38,-75,95));cam=bpy.context.object;cam.rotation_euler=(Vector((0,-10,-.5))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=100;s.camera=cam
s.render.engine='CYCLES';s.cycles.samples=24;s.render.resolution_x=1800;s.render.resolution_y=1500;s.render.resolution_percentage=100;s.view_settings.view_transform='Standard';s.render.filepath=str(A/'crossings_comparison.png');bpy.ops.render.render(write_still=True)
# Save repeat edge and continuity inspection from generated pixels.
report={}
for im in [water,fordim]:
 px=list(im.pixels);w=512;error=max([abs(px[y*w*4+c]-px[(y*w+w-1)*4+c]) for y in range(w) for c in range(3)]+[abs(px[x*4+c]-px[((w-1)*w+x)*4+c]) for x in range(w) for c in range(3)])
 assert error<1e-5;report[im.name]={'dimensions':[512,512],'opposite_edge_max_error':error}
report['bridge']={'walkable_local_y':0,'walkable_x':[-5,5],'walkable_z':[-20,20],'support_local_y':[-6,-1.3],'railing_outside_walkway':True,'world_placement_height':'director approved: terrain bank height, default 10m; not baked into GLB'}
(A/'crossings_texture_validation.json').write_text(json.dumps(report,indent=2)+'\n')
