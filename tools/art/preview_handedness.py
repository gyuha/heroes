"""Render actual AnimationMixer samples, before/after equipment-handedness repair."""
import bpy,json,math,sys
from pathlib import Path
from mathutils import Vector
A=Path(__file__).resolve().parent
before=json.loads((A/'handedness_before_poses.json').read_text());after_path=A/'handedness_after_poses.json';after=json.loads(after_path.read_text()) if after_path.exists() else None
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=20;s.render.resolution_x=1800 if after and '--bind-only' not in sys.argv else 1000;s.render.resolution_y=1700;s.render.resolution_percentage=100;s.view_settings.view_transform='Standard'
s.world.use_nodes=True;bg=next(n for n in s.world.node_tree.nodes if n.type=='BACKGROUND');bg.inputs['Color'].default_value=(.6,.65,.7,1);bg.inputs['Strength'].default_value=.8
m=bpy.data.materials.new('palette');m.use_nodes=True;bs=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED');bs.inputs['Roughness'].default_value=.85
tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(A/'unit_palette.png'));tex.image.alpha_mode='CHANNEL_PACKED';tex.interpolation='Closest'
mix=m.node_tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[2].default_value=(.017,.205,.39,1)
for out,node,inp in [(tex.outputs['Alpha'],mix,0),(tex.outputs['Color'],mix,1),(mix.outputs[0],bs,'Base Color')]:m.node_tree.links.new(out,node.inputs[inp])
ink=bpy.data.materials.new('ink');ink.use_nodes=True;ib=next(n for n in ink.node_tree.nodes if n.type=='BSDF_PRINCIPLED');ib.inputs['Base Color'].default_value=(.008,.012,.016,1);ib.inputs['Roughness'].default_value=1
for row,unit in enumerate(['infantry','spearman','archer','cavalry']):
 samples=[('BEFORE START',before,0),('BEFORE HIT',before,16 if unit=='archer' else 12)]
 if after:samples=[samples[0],('AFTER START',after,0)] if '--bind-only' in sys.argv else [samples[0],('AFTER START',after,0),samples[1],('AFTER HIT',after,16 if unit=='archer' else 12)]
 for col,(name,data,f) in enumerate(samples):
  d=data[unit];v=d['clips']['attack']['frames'][f];verts=[(v[i],-v[i+2],v[i+1]) for i in range(0,len(v),3)];idx=d['indices'];mesh=bpy.data.meshes.new(unit);mesh.from_pydata(verts,[],[idx[i:i+3] for i in range(0,len(idx),3)]);uv=mesh.uv_layers.new()
  for p in mesh.polygons:
   for li in p.loop_indices:
    vi=mesh.loops[li].vertex_index;uv.data[li].uv=d['uv'][vi*2:vi*2+2]
  ob=bpy.data.objects.new(unit,mesh);bpy.context.collection.objects.link(ob);ob.data.materials.append(m);ob.location=(col*3.5,row*4.6,0)
  bpy.ops.object.text_add(location=(col*3.5-1.25,row*4.6-1.75,.02));o=bpy.context.object;o.data.body=f'{unit}\n{name} f{f}';o.data.size=.22;o.data.materials.append(ink)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.02));floor=bpy.data.materials.new('floor');floor.diffuse_color=(.65,.68,.69,1);bpy.context.object.data.materials.append(floor)
bpy.ops.object.light_add(type='AREA',location=(-3,-6,15));bpy.context.object.data.energy=2000;bpy.context.object.data.size=10
center=Vector((5.2 if after and '--bind-only' not in sys.argv else 1.7,6.8,1));bpy.ops.object.camera_add(location=center+Vector((3,-16,20)));cam=bpy.context.object;cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=22;s.camera=cam
s.render.filepath=str(A/('handedness_position_comparison.png' if '--bind-only' in sys.argv else ('handedness_comparison.png' if after else 'handedness_before.png')));bpy.ops.render.render(write_still=True)
