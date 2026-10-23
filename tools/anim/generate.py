"""Python 3, no external dependencies. Read art GLBs; write skeleton-only clips."""
import copy, hashlib, json, math, struct, os
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
UNITS = ('infantry', 'spearman', 'archer', 'cavalry')
FRAMES = dict(idle=36, walk=30, run=24, attack=24, hit=9, die=30)
FPS = 30
SELECTED_UNITS = (os.environ['HEROES_ANIM_UNIT'],) if os.environ.get('HEROES_ANIM_UNIT') else UNITS
assert all(u in UNITS for u in SELECTED_UNITS)
REFERENCE_SPEEDS = {u: {'walk': 1.809891, 'run': 3.931617} for u in UNITS}
REFERENCE_SPEEDS['cavalry'] = {'walk': 3.600272, 'run': 7.175335}

def read_glb(path):
    data = path.read_bytes()
    assert data[:4] == b'glTF'
    size = struct.unpack_from('<I', data, 12)[0]
    return json.loads(data[20:20+size]), data[28+size:]

def write_glb(path, doc, binary):
    doc['buffers'] = [{'byteLength': len(binary)}]
    js = json.dumps(doc, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    binary += b'\0' * (-len(binary) % 4)
    payload = struct.pack('<II', len(js), 0x4E4F534A)+js+struct.pack('<II', len(binary), 0x004E4942)+binary
    path.write_bytes(struct.pack('<4sII', b'glTF', 2, 12+len(payload))+payload)

def quat(x=0, y=0, z=0):
    x,y,z = [math.radians(v)/2 for v in (x,y,z)]
    a,b,c,d,e,f = math.cos(x),math.sin(x),math.cos(y),math.sin(y),math.cos(z),math.sin(z)
    return [b*c*e-a*d*f, a*d*e+b*c*f, a*c*f-b*d*e, a*c*e+b*d*f]

def smooth(t):
    t=max(0,min(1,t)); return t*t*(3-2*t)

def envelope(t, points):
    for (a,x),(b,y) in zip(points,points[1:]):
        if t<=b: return x+(y-x)*smooth((t-a)/(b-a))
    return points[-1][1]

def pose(unit, clip, frame, count):
    t=frame/count; p=math.tau*t
    r={}; loc={}
    def rot(n,x=0,y=0,z=0): r[n]=(x,y,z)
    mounted=unit=='cavalry'
    if clip=='idle':
        rot('chest',1.5*math.sin(p)); rot('head',0,2*math.sin(p))
        loc['hips']=(0,.008*(1-math.cos(p)),0)
        if mounted: rot('horse_head',2*math.sin(p))
    elif clip in ('walk','run'):
        run=clip=='run'; amp=34 if run else 22
        if not mounted:
            loc['hips']=(0,(.04 if run else .018)*(1-math.cos(2*p)),0)
            rot('chest',-8 if run else -3,4*math.sin(p))
            for side,phase in [('l',p),('r',p+math.pi)]:
                s=math.sin(phase)
                rot('thigh_'+side,amp*s)
                rot('shin_'+side, -(42 if run else 25)*max(0,-s))
                rot('foot_'+side,-amp*.35*s)
                rot('upper_arm_'+side,-amp*.45*s)
                rot('forearm_'+side,-12)
        else:
            p *= 2  # two diagonal trot / gallop strides inside the unchanged clip duration
            bob=(.055 if run else .025)*(1-math.cos(2*p))
            loc['hips']=(0,bob*.7,0)
            rot('horse_body',0,2*math.sin(p))
            rot('horse_head',4*math.sin(p)); rot('chest',-10+(4 if run else 2)*math.sin(p))
            for i in range(4):
                phase=p+([0,.3,2.5,2.8][i] if run else [0,math.pi,math.pi,0][i])
                rot('horse_leg_'+str(i),(46 if run else 31)*math.sin(phase),0,-25 if i%2==0 else 25)
            for side in ('l','r'):
                rot('thigh_'+side,0,0,18 if side=='l' else -18)
                rot('shin_'+side,-18); rot('upper_arm_'+side,-24)
    elif clip=='attack':
        strike=envelope(t,[(0,0),(.28,-.35),(.5,1),(.65,1), (1,0)])
        rot('chest',-8*strike,18*strike)
        if unit=='infantry':
            rot('upper_arm_r',-90*strike,0,-12*strike)
            rot('forearm_r',-30*strike); rot('hand_r',190*strike)
            rot('upper_arm_l',-18*strike)
        elif unit in ('spearman','cavalry'):
            # Rotate the vertical weapon into a forward thrust; wrist compensates arm.
            ready=envelope(t,[(0,0),(.25,1),(.7,1),(1,0)])
            rot('upper_arm_r',-55*ready-18*strike)
            rot('forearm_r',-15*ready+10*strike)
            rot('hand_r',160*ready+8*strike)
            rot('spine',-6*strike)
        else:
            aim=envelope(t,[(0,0),(.25,1),(.70,1),(1,0)])
            draw=envelope(t,[(0,0),(.25,.4),(.58,1),(.67,.25),(1,0)])
            rot('chest',0,-15*aim)
            rot('upper_arm_l',-85*aim,0,8*aim)
            rot('forearm_l',-8*aim); rot('hand_l',93*aim)
            rot('upper_arm_r',-75*aim,0,-35*draw)
            rot('forearm_r',0,0,-80*draw)
            rot('head',0,12*aim)
    elif clip=='hit':
        recoil=envelope(t,[(0,0),(.22,1),(1,0)])
        rot('chest',18*recoil,0,-7*recoil); rot('head',-12*recoil)
        loc['hips']=(0,-.035*recoil,-.035*recoil)
        if mounted: rot('horse_head',-10*recoil)
    elif clip=='die':
        fall=envelope(t,[(0,0),(.2,.08),(.75,1),(1,1)])
        rot('hips',0,0,88*fall); loc['hips']=(.12*fall,-(.70 if mounted else .64)*fall,0)
        rot('chest',0,0,8*fall); rot('head',-12*fall)
        rot('upper_arm_r',0,0,-35*fall); rot('upper_arm_l',0,0,40*fall)
        if mounted:
            rot('horse_body',0,0,82*fall)
            rot('horse_head',-15*fall,0,35*fall)
            for i in range(4): rot('horse_leg_'+str(i),(100 if i<2 else -100)*math.sin(math.pi*fall),0,(-25 if i%2==0 else 25)+60*math.sin(math.pi*fall))
    if mounted:
        for i in range(4): r.setdefault('horse_leg_'+str(i),(0,0,-25 if i%2==0 else 25))
        for side in ('l','r'):
            r.setdefault('thigh_'+side,(0,0,18 if side=='l' else -18))
            r.setdefault('shin_'+side,(-18,0,0))
    # D-015: _l is anatomical RIGHT (-X), _r is anatomical LEFT (+X).
    # In a sagittal reflection Rx stays, Ry/Rz reverse. Do not swap gait arms:
    # their symmetric counter-swing must remain opposite the unchanged legs.
    if clip=='die':
        reflected={}
        for name,(x,y,z) in r.items():
            if name.endswith(('_l','_r')):
                name=name[:-2]+('_r' if name.endswith('_l') else '_l')
            elif name.startswith('horse_leg_'):
                name='horse_leg_'+str(int(name[-1])^1)
            reflected[name]=(x,-y,-z)
        r=reflected
        loc={name:(-x,y,z) for name,(x,y,z) in loc.items()}
    elif clip=='attack':
        reflected={}
        for name,(x,y,z) in r.items():
            if name.startswith(('upper_arm_','forearm_','hand_')):
                name=name[:-2]+('_r' if name.endswith('_l') else '_l')
                reflected[name]=(x,-y,-z)
            elif clip=='attack' and name in ('spine','chest','head'):
                reflected[name]=(x,-y,-z)
            else:
                reflected[name]=(x,y,z)
        r=reflected
    return r,loc

def generate(unit):
    source=ROOT/f'public/assets/units/{unit}/{unit}.glb'
    original,_=read_glb(source)
    # Keep every node index, transform and child link verbatim. Mesh carrier becomes an empty.
    nodes=copy.deepcopy(original['nodes'])
    for n in nodes:
        n.pop('mesh',None); n.pop('skin',None)
    doc={'asset':{'version':'2.0','generator':'heroes tools/anim/generate.py'},'scene':original.get('scene',0),
         'scenes':copy.deepcopy(original['scenes']),'nodes':nodes,'accessors':[],'bufferViews':[],'animations':[]}
    binary=bytearray()
    def accessor(values, kind):
        width={'SCALAR':1,'VEC3':3,'VEC4':4}[kind]; flat=[v for row in values for v in (row if isinstance(row,(list,tuple)) else [row])]
        offset=len(binary); binary.extend(struct.pack('<'+'f'*len(flat),*flat))
        vi=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(flat)*4})
        ai=len(doc['accessors']); a={'bufferView':vi,'componentType':5126,'count':len(values),'type':kind}
        if kind=='SCALAR':a.update(min=[min(flat)],max=[max(flat)])
        doc['accessors'].append(a); return ai
    joints=original['skins'][0]['joints']
    assert all('matrix' not in nodes[i] and nodes[i].get('rotation',[0,0,0,1])==[0,0,0,1] for i in joints), 'Authoring requires identity rest rotations; update motion conversion for new rig'
    for clip,count in FRAMES.items():
        anim={'name':clip,'samplers':[],'channels':[],'extras':{'fps':FPS,'intervals':count,'loop':clip in ('idle','walk','run')}}
        if clip in ('walk','run'): anim['extras']['speed']=REFERENCE_SPEEDS[unit][clip]  # recalibrated from final skinned contact trajectories by build.py
        if clip=='attack': anim['extras']['hitTime']=(16 if unit=='archer' else 12)/FPS
        times=accessor([f/FPS for f in range(count+1)],'SCALAR')
        poses=[pose(unit,clip,0 if f==count and clip in ('idle','walk','run') else f,count) for f in range(count+1)]
        for ni in joints:
            name=nodes[ni]['name']
            if name=='root': continue
            rotations=[quat(*r.get(name,(0,0,0))) for r,l in poses]
            translations=[tuple(a+b for a,b in zip(nodes[ni].get('translation',[0,0,0]),l.get(name,(0,0,0)))) for r,l in poses]
            for path,values,kind in [('rotation',rotations,'VEC4'),('translation',translations,'VEC3')]:
                if path=='translation' and name!='hips': continue
                si=len(anim['samplers']);anim['samplers'].append({'input':times,'output':accessor(values,kind),'interpolation':'LINEAR'})
                anim['channels'].append({'sampler':si,'target':{'node':ni,'path':path}})
        doc['animations'].append(anim)
    dest=source.with_name('animations.glb');write_glb(dest,doc,bytes(binary))
    return {'unit':unit,'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'animation_sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'bytes':dest.stat().st_size}

if __name__=='__main__':
    prior=json.loads((ROOT/'tools/anim/generation.json').read_text()) if (ROOT/'tools/anim/generation.json').exists() else []
    updated={u:generate(u) for u in SELECTED_UNITS}
    report=[updated[u] if u in updated else next(r for r in prior if r['unit']==u) for u in UNITS]
    (ROOT/'tools/anim/generation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
