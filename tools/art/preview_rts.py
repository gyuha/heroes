"""Render shipped GLBs at measured 24px/12px, not resized screenshots."""
import bpy,math,json,random
from pathlib import Path
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
R=Path(__file__).resolve().parents[2];A=R/'tools/art';O=R/'public/assets'
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def linear(v):return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
def rgb(h):return tuple(linear(int(h[i:i+2],16)/255) for i in [0,2,4])
meshes={};materials={};bounds={}
for name in ['infantry','spearman','archer','cavalry']:
 prior=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(O/'units'/name/(name+'.glb')))
 imported=set(bpy.data.objects)-prior;ob=next(o for o in imported if o.type=='MESH' and any(m.type=='ARMATURE' for m in o.modifiers))
 dep=bpy.context.evaluated_depsgraph_get();mesh=bpy.data.meshes.new_from_object(ob.evaluated_get(dep));meshes[name]=mesh
 # Actual GLB image, with data-channel alpha independent from opacity.
 image=next(n.image for n in ob.data.materials[0].node_tree.nodes if n.type=='TEX_IMAGE');image.alpha_mode='CHANNEL_PACKED'
 for team,h in enumerate(['247DA8','E4A33B']):
  m=bpy.data.materials.new(name+str(team));m.use_nodes=True;bs=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED');bs.inputs['Roughness'].default_value=.85
  t=m.node_tree.nodes.new('ShaderNodeTexImage');t.image=image;t.interpolation='Closest'
  mix=m.node_tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[2].default_value=(*rgb(h),1)
  for out,node,inp in [(t.outputs['Alpha'],mix,0),(t.outputs['Color'],mix,1),(mix.outputs[0],bs,'Base Color')]:m.node_tree.links.new(out,node.inputs[inp])
  materials[name,team]=m
 for obj in imported:bpy.data.objects.remove(obj,do_unlink=True)
# 192 soldiers, 96 per faction, all 4 classes, mixed contact zone.
rng=random.Random(42);soldiers=[]
for y in range(12):
 for x in range(16):
  team=0 if x<6 else (1 if x>9 else (x+y)%2);name=['infantry','spearman','archer','cavalry'][(x+3*y)%4]
  ob=bpy.data.objects.new(name,meshes[name]);bpy.context.collection.objects.link(ob);ob.location=((x-7.5)*1.55+rng.uniform(-.1,.1),(y-5.5)*2.15+rng.uniform(-.1,.1),.015)
  ob.rotation_euler.z=(math.pi/2 if team==0 else -math.pi/2)+rng.uniform(-.16,.16)
  # Object material override keeps underlying geometry shared.
  if not ob.data.materials:ob.data.materials.append(materials[name,team])
  ob.material_slots[0].link='OBJECT';ob.material_slots[0].material=materials[name,team];soldiers.append((ob,team,name))
# Broad real texture bands: grass, sand, rock, forest, water, tiled at 4m.
for i,name in enumerate(['forest','grass','sand','rock','water']):
 lo,hi=[(-500,-18),(-18,-6),(-6,6),(6,18),(18,500)][i]
 bpy.ops.mesh.primitive_plane_add(size=2,location=((lo+hi)/2,0,0));ob=bpy.context.object;ob.scale=((hi-lo)/2,500,1)
 for uv in ob.data.uv_layers.active.data:uv.uv.x*=(hi-lo)/4;uv.uv.y*=250
 m=bpy.data.materials.new(name);m.use_nodes=True;bs=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED');bs.inputs['Roughness'].default_value=.95
 t=m.node_tree.nodes.new('ShaderNodeTexImage');t.image=bpy.data.images.load(str(O/'terrain'/(name+'_albedo.png')));m.node_tree.links.new(t.outputs['Color'],bs.inputs['Base Color']);ob.data.materials.append(m)
bpy.ops.object.light_add(type='SUN',location=(-10,-15,30));sun=bpy.context.object;sun.rotation_euler=(.45,-.35,-.4);sun.data.energy=2;sun.data.angle=.15
bpy.ops.object.camera_add(location=(25,-34,42));cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,.8))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=80
s=bpy.context.scene;s.camera=cam;s.render.engine='CYCLES';s.cycles.samples=24;s.render.resolution_x=1200;s.render.resolution_y=800;s.render.resolution_percentage=100;s.world.use_nodes=True;bg=next(n for n in s.world.node_tree.nodes if n.type=='BACKGROUND');bg.inputs['Color'].default_value=(.65,.7,.75,1);bg.inputs['Strength'].default_value=.8;s.view_settings.view_transform='Standard'
bpy.context.view_layer.update()
# Reference is complete standing infantry projected bounding box at scene center.
ref=bpy.data.objects.new('measurement_infantry',meshes['infantry']);bpy.context.collection.objects.link(ref);ref.hide_render=True
bpy.context.view_layer.update()
def height():
 points=[world_to_camera_view(s,cam,ref.matrix_world@v.co) for v in ref.data.vertices]
 return (max(p.y for p in points)-min(p.y for p in points))*s.render.resolution_y
report={'soldiers':192,'team_counts':[sum(t==i for _,t,_ in soldiers) for i in [0,1]],'source':'shipped GLB reimport, evaluated bind pose','images':{}}
for target in [24,12]:
 cam.data.ortho_scale*=height()/target;bpy.context.view_layer.update();pixels=height();path=A/f'rts_{target}px.png';s.render.filepath=str(path);bpy.ops.render.render(write_still=True)
 report['images'][path.name]={'reference_infantry_projected_height_px':pixels,'orthographic_scale':cam.data.ortho_scale,'resolution':[1200,800]}
 if target==24:
  # Display-space Rec.709 gray of the exact rendered color image.
  im=bpy.data.images.load(str(path),check_existing=False);px=list(im.pixels)
  for i in range(0,len(px),4):
   # Linear pixel luminance, saved through the image's sRGB transform.
   v=.2126*px[i]+.7152*px[i+1]+.0722*px[i+2];px[i:i+3]=[v,v,v]
  im.pixels=px;im.filepath_raw=str(A/'rts_24px_gray.png');im.file_format='PNG';im.save()
(A/'rts_measurements.json').write_text(json.dumps(report,indent=2)+'\n')
