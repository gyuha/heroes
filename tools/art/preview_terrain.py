import bpy
from pathlib import Path
from mathutils import Vector
R=Path(__file__).resolve().parents[2];bpy.ops.wm.open_mainfile(filepath=str(R/'tools/art/army_source.blend'))
for o in bpy.context.scene.objects:o.hide_render=True
for i,n in enumerate(['broadleaf','conifer','boulder']):o=bpy.data.objects[n];o.hide_render=False;o.location=(i*3-3,2,0)
for i,n in enumerate(['grass','forest','rock','sand','water']):
 bpy.ops.mesh.primitive_plane_add(size=2,location=(i*2.2-4.4,-2,0));o=bpy.context.object
 
 for uv in o.data.uv_layers.active.data:uv.uv*=3
 m=bpy.data.materials.new(n);m.use_nodes=True;bs=next(t for t in m.node_tree.nodes if t.type=='BSDF_PRINCIPLED');bs.inputs['Roughness'].default_value=.9
 t=m.node_tree.nodes.new('ShaderNodeTexImage');t.image=bpy.data.images.load(str(R/'public/assets/terrain'/(n+'_albedo.png')));m.node_tree.links.new(t.outputs['Color'],bs.inputs['Base Color']);o.data.materials.append(m)
 bpy.ops.object.text_add(location=(i*2.2-5,-3.4,.01));bpy.context.object.data.body=n+' 3x3';bpy.context.object.data.size=.25
bpy.ops.object.light_add(type='AREA',location=(-3,-4,10));bpy.context.object.data.energy=2000;bpy.context.object.data.size=8
bpy.ops.object.camera_add(location=(5,-10,12));cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,1))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=17
s=bpy.context.scene;s.camera=cam;s.world.color=(.35,.35,.35);s.render.engine='CYCLES';s.cycles.samples=24;s.render.resolution_x=1400;s.render.resolution_y=900;s.render.resolution_percentage=100;s.view_settings.view_transform='Standard';s.render.filepath=str(R/'tools/art/terrain_comparison.png');bpy.ops.render.render(write_still=True)
