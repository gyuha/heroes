"""Sync editable Blender source only; no GLB or animations exports."""
import bpy,bmesh
from pathlib import Path
A=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(A/'army_source.blend'))
for name in ['infantry','spearman','archer','cavalry']:
 ob=bpy.data.objects[name];mesh=ob.data
 assert not ob.get('d015_equipment_reflected'),'Already migrated source'
 groups={ob.vertex_groups[n].index:n for n in ['hand_l','hand_r']};selected={}
 for v in mesh.vertices:
  for g in v.groups:
   if g.group in groups and g.weight>0:selected[v.index]=(groups[g.group],g.weight)
 for i,(old,w) in selected.items():
  mesh.vertices[i].co.x*=-1;ob.vertex_groups[old].remove([i]);ob.vertex_groups['hand_r' if old=='hand_l' else 'hand_l'].add([i],w,'REPLACE')
 bm=bmesh.new();bm.from_mesh(mesh);bm.verts.ensure_lookup_table();bm.verts.index_update()
 bmesh.ops.reverse_faces(bm,faces=[f for f in bm.faces if all(v.index in selected for v in f.verts)]);bm.to_mesh(mesh);bm.free();mesh.update();ob['d015_equipment_reflected']=True
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(A/'army_source.blend'))
