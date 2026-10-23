"""Refresh packed source palette and unit comparison, without exporting models."""
import bpy
from pathlib import Path
R=Path(__file__).resolve().parents[2];ART=R/'tools/art'
bpy.ops.wm.open_mainfile(filepath=str(ART/'army_source.blend'))
img=bpy.data.images.get('unit_palette');img.alpha_mode='CHANNEL_PACKED'
# Load corrected file; do not call reload on packed stale pixels.
correct=bpy.data.images.load(str(ART/'unit_palette.png'),check_existing=False);img.pixels=list(correct.pixels);img.pack();bpy.data.images.remove(correct)
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(ART/'army_source.blend'))
props=[bpy.data.objects[n] for n in ['broadleaf','conifer','boulder']]
units=[(n,bpy.data.objects[n],bpy.data.objects[n+'_rig']) for n in ['infantry','spearman','archer','cavalry']]
mat=bpy.data.materials['unit_palette']
from mathutils import Vector
import math
def linear(v):return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
def color(h):return tuple(linear(int(h[i:i+2],16)/255) for i in [0,2,4])
source=(ART/'generate.py').read_text();exec(source[source.index('for ob in props:ob.hide_render=True'):])
