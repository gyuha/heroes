"""Blender round-trip, texture edge and skin deformation checks."""
import bpy,json,math
from pathlib import Path
R=Path(__file__).resolve().parents[2]; results={}
for p in sorted((R/'public/assets/units').glob('*/*.glb')):
 if p.name=='animations.glb':continue
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 bpy.ops.import_scene.gltf(filepath=str(p))
 meshes=[o for o in bpy.context.scene.objects if o.type=='MESH' and any(m.type=='ARMATURE' for m in o.modifiers)]; arms=[o for o in bpy.context.scene.objects if o.type=='ARMATURE'];assert len(meshes)==len(arms)==1
 ob,arm=meshes[0],arms[0]
 image=next(n.image for n in ob.data.materials[0].node_tree.nodes if n.type=='TEX_IMAGE');image.alpha_mode='CHANNEL_PACKED';embedded=list(image.pixels)
 assert tuple(image.size)==(256,256) and embedded[21*4+3]==1 and embedded[63*4+3]==0 and embedded[105*4]>0
 assert all(abs(t)<1e-6 for t in ob.location) and all(abs(t-1)<1e-6 for t in ob.scale)
 deps=bpy.context.evaluated_depsgraph_get(); ev=ob.evaluated_get(deps); mesh=ev.to_mesh();before=[v.co.copy() for v in mesh.vertices];ev.to_mesh_clear()
 bone=arm.pose.bones['forearm_l'];bone.rotation_mode='XYZ';bone.rotation_euler.x=.3;bpy.context.view_layer.update()
 ev=ob.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=ev.to_mesh();changed=sum((v.co-before[i]).length>1e-5 for i,v in enumerate(mesh.vertices));ev.to_mesh_clear();assert changed>0
 results[p.stem]={'import':'pass','embedded_palette_mask':'pass','forearm_pose_changed_vertices':changed,'root_origin':list(arm.data.bones['root'].head_local)}
for p in sorted((R/'public/assets/terrain').glob('*.png')):
 im=bpy.data.images.load(str(p),check_existing=False);assert tuple(im.size)==(512,512);px=list(im.pixels);w=h=512
 error=max([abs(px[(y*w)*4+c]-px[(y*w+w-1)*4+c]) for y in range(h) for c in range(3)]+[abs(px[x*4+c]-px[((h-1)*w+x)*4+c]) for x in range(w) for c in range(3)])
 assert error<1e-5; results[p.name]={'dimensions':[512,512],'opposite_edge_max_error':error}
im=bpy.data.images.load(str(R/'tools/art/unit_palette.png'),check_existing=False);im.alpha_mode='CHANNEL_PACKED';px=list(im.pixels)
assert tuple(im.size)==(256,256)
assert px[25*4+3]==1 and px[76*4+3]==0 and px[127*4]>0
results['palette']={'dimensions':[256,256],'alpha_mask':'pass','neutral_rgb_preserved':'pass'}
(R/'tools/art/roundtrip_validation.json').write_text(json.dumps(results,indent=2)+'\n');print(results)
