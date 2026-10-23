"""python3 tools/anim/build.py [--preview] — deterministic independent art pipeline."""
import hashlib,json,subprocess,sys,os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
UNITS=('infantry','spearman','archer','cavalry')
paths=[ROOT/f'public/assets/units/{u}/{u}.glb' for u in UNITS]
before={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
selected=os.environ.get('HEROES_ANIM_UNIT')
protected={ROOT/f'public/assets/units/{u}/animations.glb':hashlib.sha256((ROOT/f'public/assets/units/{u}/animations.glb').read_bytes()).hexdigest() for u in UNITS if selected and u!=selected}
steps=[[sys.executable,'tools/anim/generate.py'],['node','tools/anim/verify.mjs'],[sys.executable,'tools/anim/ground.py'],['node','tools/anim/verify.mjs','--grounded'],[sys.executable,'tools/anim/calibrate.py'],[sys.executable,'tools/anim/validate.py'],['node','tools/anim/verify.mjs','--grounded']]
for command in steps:
 subprocess.run(command,cwd=ROOT,check=True,stdout=subprocess.DEVNULL)
assert all(hashlib.sha256(p.read_bytes()).hexdigest()==before[str(p)] for p in paths),'Art source changed'
assert all(hashlib.sha256(p.read_bytes()).hexdigest()==digest for p,digest in protected.items()),'Non-selected unit animation changed'
if '--preview' in sys.argv:
 with (ROOT/'tools/anim/preview.log').open('w') as log:subprocess.run(['blender','-b','--python','tools/anim/preview.py'],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,check=True)
 subprocess.run(['ffmpeg','-y','-framerate','12','-i','tools/anim/sequence/%03d.png','-filter_complex','[0:v]split[a][b];[a]palettegen[p];[b][p]paletteuse','-loop','0','tools/anim/motion.gif'],cwd=ROOT,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
print(f'PASS: {selected or "all units"} regenerated; 24 clips validated and rebound; art and non-selected GLBs unchanged.')
