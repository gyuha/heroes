"""blender -b --python tools/anim/preview.py
Render actual GLTFLoader + AnimationMixer CPU-skinned vertex samples.
"""
import bpy,json,math,sys
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'tools/anim';data=json.loads((OUT/'poses.json').read_text())
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=12
s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG';s.view_settings.view_transform='Standard'
s.world.use_nodes=True;bg=next(n for n in s.world.node_tree.nodes if n.type=='BACKGROUND');bg.inputs['Color'].default_value=(.55,.6,.65,1);bg.inputs['Strength'].default_value=.8
bpy.ops.object.light_add(type='AREA',location=(-5,-8,18));bpy.context.object.data.energy=2300;bpy.context.object.data.size=10
bpy.ops.object.camera_add(location=(8,-16,20));cam=bpy.context.object;cam.data.type='ORTHO';s.camera=cam
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.015))
ground=bpy.context.object
floor=bpy.data.materials.new('floor');floor.diffuse_color=(.46,.5,.53,1);ground.data.materials.append(floor)
ink=bpy.data.materials.new('ink');ink.use_nodes=True
ink_bs=next(n for n in ink.node_tree.nodes if n.type=='BSDF_PRINCIPLED');ink_bs.inputs['Base Color'].default_value=(.005,.008,.012,1);ink_bs.inputs['Roughness'].default_value=1
materials={}
for unit in data:
 m=bpy.data.materials.new(unit);m.use_nodes=True;nodes=m.node_tree.nodes;bs=next(n for n in nodes if n.type=='BSDF_PRINCIPLED');bs.inputs['Roughness'].default_value=.85
 t=nodes.new('ShaderNodeTexImage');t.image=bpy.data.images.load(str(ROOT/'tools/art/unit_palette.png'));t.image.alpha_mode='CHANNEL_PACKED';t.interpolation='Closest'
 mix=nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[2].default_value=(.017,.205,.39,1)
 for out,node,inp in [(t.outputs['Alpha'],mix,0),(t.outputs['Color'],mix,1),(mix.outputs[0],bs,'Base Color')]:m.node_tree.links.new(out,node.inputs[inp])
 materials[unit]=m

def verts(values):return [(values[i],-values[i+2],values[i+1]) for i in range(0,len(values),3)]
def object_at(unit,clip,f,x,y):
 d=data[unit];p=d['clips'][clip]['frames'][f];mesh=bpy.data.meshes.new(unit);inds=d['indices'];faces=[inds[i:i+3] for i in range(0,len(inds),3)];mesh.from_pydata(verts(p),[],faces);mesh.materials.append(materials[unit]);uv=mesh.uv_layers.new(name='UVMap')
 for poly in mesh.polygons:
  for li in poly.loop_indices:
   vi=mesh.loops[li].vertex_index;uv.data[li].uv=d['uv'][vi*2:vi*2+2]
 ob=bpy.data.objects.new(unit,mesh);bpy.context.collection.objects.link(ob);ob.location=(x,y,0);return ob

def label(text,x,y,size=.25):
 bpy.ops.object.text_add(location=(x,y,.02));o=bpy.context.object;o.data.body=text;o.data.size=size;o.data.materials.append(ink);return o

def aim(target,scale):
 cam.location=Vector(target)+Vector((0,-13,20));cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=scale

if '--attack-sheet' in sys.argv or '--death-sheet' in sys.argv:
 for row,(unit,d) in enumerate(data.items()):
  death_view='--death-sheet' in sys.argv
  hit=23 if death_view else (16 if unit=='archer' else 12)
  for col,f in enumerate([0,9,15,23,30] if death_view else [0,hit-3,hit,hit+3,24]):
   object_at(unit,'die' if death_view else 'attack',f,col*4,row*4.5)
   label(f'{unit} f{f}'+(' EVENT' if f==hit else ''),col*4-1.4,row*4.5-1.5,.25)
 label('D-015 / RIGHT = -X (_l) / LEFT = +X (_r)',-1,16.5,.34)
 aim((8,7,.8),25);s.render.resolution_x=1700;s.render.resolution_y=1250
 s.render.filepath=str(OUT/('death_handedness_sheet.png' if death_view else 'attack_handedness_sheet.png'));bpy.ops.render.render(write_still=True)
 sys.exit(0)

for unit,d in data.items():
 if '--game-speeds' in sys.argv or '--motion-only' in sys.argv: continue
 if '--unit' in sys.argv and unit!=sys.argv[sys.argv.index('--unit')+1]: continue
 objects=[]
 for row,(clip,c) in enumerate(d['clips'].items()):
  n=len(c['frames'])-1
  sample_frames=[0,round(n*.125),round(n*.25),round(n*.375),n] if unit=='cavalry' and clip in ('walk','run') else [0,round(n*.25),round(n*.5),round(n*.75),n]
  for col,f in enumerate(sample_frames):
   objects.append(object_at(unit,clip,f,col*3.7,row*4.2));objects.append(label(f'{clip}  f{f}',col*3.7-1.25,row*4.2-1.5))
 objects.append(label(unit.upper()+' / 30 FPS / ACTUAL GLTF SKINNING',-1,25,.4))
 aim((7.3,11,.5),29);s.render.resolution_x=1500;s.render.resolution_y=1700;s.render.filepath=str(OUT/f'{unit}_sheet.png');bpy.ops.render.render(write_still=True)
 for ob in objects:bpy.data.objects.remove(ob,do_unlink=True)
if '--sheets-only' in sys.argv: sys.exit(0)
# Animated 4 x 3 grid: walk/run/attack, all four units. Each clip has its own clock.
objects=[]
game_view='--game-speeds' in sys.argv
speeds=json.loads((OUT/'locomotion.json').read_text())
for row,unit in enumerate(['cavalry'] if game_view else data):
 for col,clip in enumerate(['walk','run','run'] if game_view else ['walk','run','attack']):
  ob=object_at(unit,clip,0,col*4.3,row*4);rate=([3.5,7,9][col]/speeds[unit][clip]['speed_m_s']) if game_view else 1
  objects.append((ob,unit,clip,rate))
  label((f'{[3.5,7,9][col]}m/s  x{rate:.3f}' if game_view else unit+' / '+clip),col*4.3-1.5,row*4-1.5,.25)
aim((4.5,6,.5),20);s.render.resolution_x=960;s.render.resolution_y=960;s.cycles.samples=8
if game_view:
 aim((4.5,0,.6),13.5);s.render.resolution_x=960;s.render.resolution_y=400
if '--quick-motion' in sys.argv:
 s.cycles.samples=2
 if not game_view: s.render.resolution_x=720;s.render.resolution_y=720
seq=OUT/('cavalry_speed_sequence' if game_view else 'sequence');seq.mkdir(exist_ok=True)
for frame in range(24):
 t=frame/12
 for ob,unit,clip,rate in objects:
  c=data[unit]['clips'][clip];f=min(len(c['frames'])-1,round(((t*rate)%c['duration'])*30))
  for v,co in zip(ob.data.vertices,verts(c['frames'][f])):v.co=co
  ob.data.update()
 s.render.filepath=str(seq/f'{frame:03}.png');bpy.ops.render.render(write_still=True)
print('PREVIEW_COMPLETE')
