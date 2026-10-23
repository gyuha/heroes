"""Native 1920x1080 perspective LOD comparisons: vertical FOV50, pitch50deg.
blender --background --factory-startup --python tools/art/preview_lod1.py
"""
import bpy,math,json
from pathlib import Path
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
R=Path(__file__).resolve().parents[2];A=R/'tools/art';O=R/'public/assets';UNITS=['infantry','spearman','archer','cavalry']
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=32;s.render.resolution_x=1920;s.render.resolution_y=1080;s.render.resolution_percentage=100;s.view_settings.view_transform='Standard'
s.world.use_nodes=True;bg=next(n for n in s.world.node_tree.nodes if n.type=='BACKGROUND');bg.inputs['Color'].default_value=(.7,.7,.7,1);bg.inputs['Strength'].default_value=.8
materials=[];meshes={};objects=[]
def linear(v):return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
def color(h):return tuple(linear(int(h[i:i+2],16)/255) for i in [0,2,4])
for unit in UNITS:
 for lod in [0,1]:
  prior=set(bpy.data.objects);path=O/'units'/unit/(unit+('_lod1' if lod else '')+'.glb');bpy.ops.import_scene.gltf(filepath=str(path));created=set(bpy.data.objects)-prior
  ob=next(o for o in created if o.type=='MESH' and any(m.type=='ARMATURE' for m in o.modifiers));mesh=bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()));meshes[unit,lod]=mesh
  image=next(n.image for n in ob.data.materials[0].node_tree.nodes if n.type=='TEX_IMAGE');image.alpha_mode='CHANNEL_PACKED'
  for team,h in enumerate(['247DA8','E4A33B']):
   m=bpy.data.materials.new(unit+str(lod)+str(team));m.use_nodes=True;bs=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED');bs.inputs['Roughness'].default_value=.85
   tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image;tex.interpolation='Closest'
   mix=m.node_tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[2].default_value=(*color(h),1)
   for out,node,inp in [(tex.outputs['Alpha'],mix,0),(tex.outputs['Color'],mix,1),(mix.outputs[0],bs,'Base Color')]:m.node_tree.links.new(out,node.inputs[inp])
   materials.append((m,bs));clone=bpy.data.objects.new(unit+f'_lod{lod}_team{team}',mesh.copy());bpy.context.collection.objects.link(clone);clone.data.materials.clear();clone.data.materials.append(m);clone.location=((UNITS.index(unit)-1.5)*10+(lod-.5)*3,(-1 if team==0 else 1)*7,0);objects.append((clone,unit,lod,team))
  for obj in created:bpy.data.objects.remove(obj,do_unlink=True)
bpy.ops.mesh.primitive_plane_add(size=2000);ground=bpy.context.object;ground.location.z=-.01
m=bpy.data.materials.new('terrain');m.use_nodes=True;bs=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED');bs.inputs['Roughness'].default_value=1;tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(O/'terrain/grass_albedo.png'));m.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color']);ground.data.materials.append(m);materials.append((m,bs))
for uv in ground.data.uv_layers.active.data:uv.uv*=500
bpy.ops.object.light_add(type='SUN');bpy.context.object.rotation_euler=(.4,-.35,-.3);bpy.context.object.data.energy=2;bpy.context.object.data.angle=.15
bpy.ops.object.camera_add();cam=bpy.context.object;cam.data.type='PERSP';cam.data.sensor_fit='VERTICAL';cam.data.sensor_height=24;cam.data.lens=12/math.tan(math.radians(25));cam.data.clip_start=.1;cam.data.clip_end=3000;s.camera=cam
ink=bpy.data.materials.new('caption');ink.use_nodes=True;bs=next(n for n in ink.node_tree.nodes if n.type=='BSDF_PRINCIPLED');bs.inputs['Base Color'].default_value=(.015,.015,.015,1);bs.inputs['Emission Color'].default_value=(.015,.015,.015,1);bs.inputs['Emission Strength'].default_value=1
captions=[]
def text(body,x,y,pixels=18):
 bpy.ops.object.text_add();ob=bpy.context.object;ob.parent=cam;ob.location=(x,y,-1);ob.rotation_euler=(0,0,0);ob.data.body=body;ob.data.size=2*math.tan(math.radians(25))*pixels/1080;ob.data.materials.append(ink);ob.visible_shadow=False;captions.append(ob)
def screen_text(body,xy,pixels=16):
 halfy=math.tan(math.radians(25));halfx=halfy*1920/1080;text(body,(xy[0]-.5)*2*halfx,(xy[1]-.5)*2*halfy,pixels)
report={'renderer':'Blender Cycles; not game FPS benchmark','resolution':[1920,1080],'vertical_fov_degrees':50,'pitch_degrees':50,'arrangement':'each unit: LOD0 left / LOD1 right; blue near row, ochre far row','images':{}}
for dist in [35,150,300]:
 target=Vector((0,0,.8));cam.location=target+Vector((0,-math.cos(math.radians(50))*dist,math.sin(math.radians(50))*dist));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();bpy.context.view_layer.update()
 for ob in captions:bpy.data.objects.remove(ob,do_unlink=True)
 captions=[]
 screen_text(f'{dist}m | LOD0 LEFT / LOD1 RIGHT | 50deg vertical FOV | 1920 x 1080 native pixels',(.025,.95),22)
 screen_text('Blue front row / Ochre rear row | INF infantry, SPR spearman, ARC archer, CAV cavalry | bind pose / native scale',(.025,.915),18)
 measurements=[]
 for ob,unit,lod,team in objects:
  points=[world_to_camera_view(s,cam,ob.matrix_world@v.co) for v in ob.data.vertices];height=(max(p.y for p in points)-min(p.y for p in points))*1080;measurements.append({'unit':unit,'lod':lod,'team':team,'height_px_including_weapon':height})
  p=world_to_camera_view(s,cam,ob.location+Vector((0,0,3.3)))
  screen_text(str(lod),(p.x-.003,p.y+.005),12)
 for index,unit in enumerate(UNITS):
  p=world_to_camera_view(s,cam,Vector(((index-1.5)*10,7,4.9)));screen_text(['INF','SPR','ARC','CAV'][index],(p.x-.008,p.y+.01),14)
 stem=f'lod1_{dist}m' if dist!=35 else 'lod1_closeup'
 s.render.filepath=str(A/(stem+'.png'));bpy.ops.render.render(write_still=True)
 report['images'][stem+'.png']={'camera_to_target_distance_m':dist,'measurements':measurements}
 if dist!=35:
  conversions=[]
  for mat,shader in materials:
   link=next(l for l in mat.node_tree.links if l.to_node==shader and l.to_socket==shader.inputs['Base Color']);out=link.from_socket;mat.node_tree.links.remove(link);bw=mat.node_tree.nodes.new('ShaderNodeRGBToBW');mat.node_tree.links.new(out,bw.inputs[0]);mat.node_tree.links.new(bw.outputs[0],shader.inputs['Base Color']);conversions.append((mat,shader,out,bw))
  s.render.filepath=str(A/(stem+'_gray.png'));bpy.ops.render.render(write_still=True)
  for mat,shader,out,bw in conversions:mat.node_tree.nodes.remove(bw);mat.node_tree.links.new(out,shader.inputs['Base Color'])
(A/'lod1_preview_measurements.json').write_text(json.dumps(report,indent=2)+'\n')
