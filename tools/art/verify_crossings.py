import bpy,json,math
from pathlib import Path
R=Path(__file__).resolve().parents[2];report={};means={}
def lin(v):return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
for name in ['ford','water']:
 im=bpy.data.images.load(str(R/'public/assets/terrain'/(name+'_albedo.png')),check_existing=False);assert tuple(im.size)==(512,512);px=list(im.pixels);w=512
 err=max([abs(px[y*w*4+c]-px[(y*w+w-1)*4+c]) for y in range(w) for c in range(3)]+[abs(px[x*4+c]-px[((w-1)*w+x)*4+c]) for x in range(w) for c in range(3)])
 assert err<1e-5;assert all(px[i]==1 for i in range(3,len(px),4))
 lum=sum(.2126*lin(px[i])+.7152*lin(px[i+1])+.0722*lin(px[i+2]) for i in range(0,len(px),4))/(w*w);means[name]=lum
 report[name]={'dimensions':[512,512],'saved_png_opposite_edge_error':err,'mean_linear_luminance':lum,'bytes':Path(im.filepath).stat().st_size}
assert means['ford']/means['water']>3;report['ford_water_luminance_ratio']=means['ford']/means['water']
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False);bpy.ops.import_scene.gltf(filepath=str(R/'public/assets/props/bridge.glb'))
obs=[o for o in bpy.context.scene.objects if o.type=='MESH'];assert len(obs)==1
ob=obs[0];assert not ob.modifiers and len(ob.data.materials)==1 and not any(o.type=='ARMATURE' for o in bpy.context.scene.objects)
# glTF import converts to Blender Z-up, world placement remains identity.
assert ob.location.length<1e-6 and all(abs(v-1)<1e-6 for v in ob.scale)
report['bridge_reimport']='pass';(R/'tools/art/crossings_roundtrip_validation.json').write_text(json.dumps(report,indent=2)+'\n');print(report)
