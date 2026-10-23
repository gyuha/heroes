"""Measure visible team-mask pixels, not hidden/internal triangle surface area."""
from pathlib import Path
import sys
exec((Path(__file__).resolve().parent/'preview_lod1.py').read_text().split('for dist in [35,150,300]:')[0])
ground.hide_render=True;s.render.film_transparent=True;bg.inputs['Strength'].default_value=0
for mat,shader in materials:
 if mat.name=='terrain':continue
 t=next(n for n in mat.node_tree.nodes if n.type=='TEX_IMAGE');em=mat.node_tree.nodes.new('ShaderNodeEmission');mat.node_tree.links.new(t.outputs['Alpha'],em.inputs['Color']);out=next(n for n in mat.node_tree.nodes if n.type=='OUTPUT_MATERIAL');mat.node_tree.links.new(em.outputs[0],out.inputs['Surface'])
target=Vector((0,0,.8));dist=150;cam.location=target+Vector((0,-math.cos(math.radians(50))*dist,math.sin(math.radians(50))*dist));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();bpy.context.view_layer.update()
s.render.filepath=str(A/'lod1_team_mask.png')
if '--reuse-mask' not in sys.argv:bpy.ops.render.render(write_still=True)
im=bpy.data.images.load(str(A/'lod1_team_mask.png'),check_existing=False);pixels=list(im.pixels);width,height=im.size;areas={}
for ob,unit,lod,team in objects:
 points=[world_to_camera_view(s,cam,ob.matrix_world@v.co) for v in ob.data.vertices];x0=max(0,math.floor(min(p.x for p in points)*width)-2);x1=min(width,math.ceil(max(p.x for p in points)*width)+2);y0=max(0,math.floor(min(p.y for p in points)*height)-2);y1=min(height,math.ceil(max(p.y for p in points)*height)+2)
 area=sum(linear(pixels[(y*width+x)*4])*pixels[(y*width+x)*4+3] for y in range(y0,y1) for x in range(x0,x1))
 areas[unit,lod,team]=area
report={}
for unit in UNITS:
 report[unit]=[]
 for team in [0,1]:
  a,b=areas[unit,0,team],areas[unit,1,team];report[unit].append({'team':team,'lod0_visible_mask_pixels':a,'lod1_visible_mask_pixels':b,'lod1_to_lod0_ratio':b/a})
(A/'lod1_mask_validation.json').write_text(json.dumps({'distance_m':150,'method':'flat alpha-mask emission, black neutral pixels, sRGB-decoded RGB sum times alpha coverage, identical 50deg perspective camera','units':report},indent=2)+'\n')
print(report)
