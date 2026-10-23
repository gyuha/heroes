// LOD1 specialization of tools/anim/verify.mjs; original animation files remain read-only.
// Actual GLTFLoader / AnimationMixer binding + CPU skinning. Texture pixels are
// irrelevant to this check, so a loader plugin returns Texture without DOM decode.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { AnimationMixer, LoopOnce, Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const root=new URL('../../',import.meta.url);
const loader=new GLTFLoader();
loader.register(()=>({name:'HEADLESS_TEXTURE',loadTexture:()=>Promise.resolve(new Texture())}));
async function read(path){const b=fs.readFileSync(new URL(path,root));return loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');}
const report={},preview={};
for(const unit of ['infantry','spearman','archer','cavalry']){
 const model=await read(`public/assets/units/${unit}/${unit}_lod1.glb`);
 const animation=await read(`public/assets/units/${unit}/animations.glb`);
 const mesh=model.scene.getObjectByProperty('isSkinnedMesh',true);assert(mesh);
 assert.deepEqual(animation.animations.map(c=>c.name),['idle','walk','run','attack','hit','die']);
 const mixer=new AnimationMixer(model.scene), g=mesh.geometry, v=new Vector3();
 const bind=Array.from(g.attributes.position.array);
 const rest=mesh.skeleton.bones.map(b=>[...b.position.toArray(),...b.quaternion.toArray()]);
 const unitPreview={indices:Array.from(g.index.array),uv:Array.from(g.attributes.uv.array),clips:{}};
 report[unit]=[];
 for(const clip of animation.animations){
  const extras=animation.parser.json.animations.find(a=>a.name===clip.name).extras;
  if(process.argv.includes('--grounded')){
   if(['walk','run'].includes(clip.name))assert(Number.isFinite(extras.speed)&&extras.speed>0);
   if(clip.name==='attack')assert(Math.abs(extras.hitTime-(unit==='archer'?16:12)/30)<1e-9);
  }
  assert(clip.tracks.every(t=>t.name!=='root.position'&&t.name!=='root.quaternion'&&(!t.name.endsWith('.position')||t.name==='hips.position')));
  // Every track must resolve by bone name on the art model, without retargeting.
  for(const t of clip.tracks){assert(model.scene.getObjectByName(t.name.slice(0,t.name.lastIndexOf('.'))),t.name);}
  mixer.stopAllAction();const action=mixer.clipAction(clip).setLoop(LoopOnce,1);action.clampWhenFinished=true;action.play();
  const frames=[];let maxDisplacement=0,minY=Infinity,maxY=-Infinity,minBone=null,minIndex=null;
  for(let f=0;f<=Math.round(clip.duration*30);f++){
   mixer.setTime(Math.min(clip.duration,f/30));model.scene.updateMatrixWorld(true);mesh.skeleton.update();
   const positions=[];
   for(let i=0;i<g.attributes.position.count;i++){
    v.fromBufferAttribute(g.attributes.position,i);mesh.applyBoneTransform(i,v);v.applyMatrix4(mesh.matrixWorld);
    assert(Number.isFinite(v.x+v.y+v.z));if(v.y<minY){minY=v.y;minIndex=i;minBone=mesh.skeleton.bones[g.attributes.skinIndex.getX(i)].name;}maxY=Math.max(maxY,v.y);
    maxDisplacement=Math.max(maxDisplacement,Math.hypot(v.x-bind[i*3],v.y-bind[i*3+1],v.z-bind[i*3+2]));
    positions.push(...v.toArray());
   }
   frames.push(positions);
  }
  assert(maxDisplacement>.001,`${unit}/${clip.name} did not animate`);
  unitPreview.clips[clip.name]={duration:clip.duration,frames};
  report[unit].push({clip:clip.name,extras,tracks:clip.tracks.length,samples:frames.length,max_vertex_displacement_m:maxDisplacement,min_y_m:minY,min_bone:minBone,min_vertex:minIndex,max_y_m:maxY});
 }
 mixer.stopAllAction();
 for(let i=0;i<mesh.skeleton.bones.length;i++){const b=mesh.skeleton.bones[i];const now=[...b.position.toArray(),...b.quaternion.toArray()];assert(now.every((v,j)=>Math.abs(v-rest[i][j])<1e-6),'Cancelled action left a stale pose');}
 if(process.argv.includes('--grounded'))assert(report[unit].every(c=>c.min_y_m>=-1e-6),'Ground penetration');
 preview[unit]=unitPreview;
}
fs.writeFileSync(new URL('tools/art/lod1_roundtrip.json',root),JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(new URL('tools/art/lod1_poses.json',root),JSON.stringify(preview));
console.log(JSON.stringify(report,null,2));
