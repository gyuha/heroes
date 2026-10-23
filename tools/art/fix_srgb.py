"""One-time migration. Repairs PNGs and embedded images without mesh re-export.
Idempotent: already-correct terrain is left unchanged. Unit PNG only is replaced.
"""
import json,struct,hashlib,copy
from pathlib import Path
from color_io import *
R=Path(__file__).resolve().parents[2];A=R/'tools/art'
def parse(d):
 n=struct.unpack_from('<I',d,12)[0];return json.loads(d[20:20+n]),d[28+n:]
def view(j,b,i):v=j['bufferViews'][i];return b[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]
def sig(j,b):
 imgviews={im['bufferView'] for im in j.get('images',[])};metadata=copy.deepcopy(j)
 for v in metadata['bufferViews']:v.pop('byteOffset',None);v.pop('byteLength',None)
 metadata.pop('buffers',None)
 return hashlib.sha256(json.dumps(metadata,sort_keys=True).encode()+b''.join(view(j,b,i) for i in range(len(j['bufferViews'])) if i not in imgviews)).hexdigest()
report={'terrain':{},'palette':{},'invariants':{}}
for name,h in TERRAIN_SRGB.items():
 p=R/'public/assets/terrain'/f'{name}_albedo.png';d=p.read_bytes();before=hexmean(d);target=[int(h[i:i+2],16) for i in [0,2,4]];w,hh,ch,px=png_read(d)
 if max(abs(a-b) for a,b in zip(mean_rgb(d),target))>4:
  for i in range(len(px)):
   if i%ch<3:px[i]=round(min(1,srgb(px[i]/255))*255)
  p.write_bytes(png_write(w,hh,ch,px))
 report['terrain'][name]={'before':before,'after':hexmean(p.read_bytes()),'guide':'#'+h}
new=palette_png();(A/'unit_palette.png').write_bytes(new)
animations={str(p.relative_to(R)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (R/'public/assets/units').rglob('animations.glb')}
for p in sorted((R/'public/assets/units').glob('*/*.glb')):
 if p.name=='animations.glb':continue
 j,b=parse(p.read_bytes());old_sig=sig(j,b);iv=j['images'][0]['bufferView'];oldpng=view(j,b,iv);oldw,oldh,ch,px=png_read(oldpng)
 report['palette'][p.parent.name]={'before_cells':['#'+''.join(f'{v:02X}' for v in px[(21+i*42)*ch:(21+i*42)*ch+3]) for i in range(6)],'after_cells':['#'+''.join(f'{v:02X}' for v in c[:3]) for c in PALETTE]}
 chunks=[];offset=0
 for i,v in enumerate(j['bufferViews']):
  data=new if i==iv else view(j,b,i);pad=(-offset)%4;chunks.append(b'\0'*pad);offset+=pad;v['byteOffset']=offset;v['byteLength']=len(data);chunks.append(data);offset+=len(data)
 newbin=b''.join(chunks);j['buffers'][0]['byteLength']=len(newbin);newbin+=b'\0'*((-len(newbin))%4)
 assert sig(j,newbin)==old_sig
 js=json.dumps(j,separators=(',',':')).encode();js+=b' '*((-len(js))%4)
 out=struct.pack('<III',0x46546c67,2,28+len(js)+len(newbin))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(newbin),0x004e4942)+newbin
 p.write_bytes(out);jj,bb=parse(out);assert sig(jj,bb)==old_sig;validate_palette(view(jj,bb,iv));report['invariants'][p.parent.name]={'geometry_skin_nodes_accessors_materials_unchanged':True,'sha256_excluding_embedded_image':old_sig}
assert all(hashlib.sha256((R/p).read_bytes()).hexdigest()==h for p,h in animations.items());report['animations_sha256_unchanged']=animations
(A/'srgb_correction.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
