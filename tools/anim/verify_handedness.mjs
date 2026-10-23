// D-015 integration check: actual shipped art + AnimationMixer bone poses.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {AnimationMixer,LoopOnce,Texture,Vector3,Quaternion} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const root=new URL('../../',import.meta.url);
const baseline=JSON.parse(fs.readFileSync(new URL('tools/anim/t014b_baseline.json',root)));
const loader=new GLTFLoader().register(()=>({name:'HEADLESS_TEXTURE',loadTexture:()=>Promise.resolve(new Texture())}));
async function load(path){const b=fs.readFileSync(new URL(path,root));return loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');}
const report={};
for(const unit of ['infantry','spearman','archer','cavalry']){
 const artPath=`public/assets/units/${unit}/${unit}.glb`;
 const model=await load(artPath),animation=await load(`public/assets/units/${unit}/animations.glb`);
 const sha=crypto.createHash('sha256').update(fs.readFileSync(new URL(artPath,root))).digest('hex');
 assert.equal(sha,baseline[unit].source_sha256,'Art changed during integration check; rerun with current art');
 assert.deepEqual(model.parser.json.nodes.map(n=>{const {isBone,...rest}=n;return rest;}),baseline[unit].nodes);
 for(const a of animation.parser.json.animations){
  assert.deepEqual(a.extras,baseline[unit].clips[a.name].extras,'Metadata changed');
  assert.equal(animation.parser.json.accessors[a.samplers[0].input].count,baseline[unit].clips[a.name].intervals+1);
 }
 const mesh=model.scene.getObjectByProperty('isSkinnedMesh',true),g=mesh.geometry;
 const groups={};
 for(let i=0;i<g.attributes.position.count;i++){
  const bi=g.attributes.skinIndex.getX(i),name=mesh.skeleton.bones[bi].name;
  if(!['hand_l','hand_r'].includes(name))continue;
  const x=g.attributes.position.getX(i);(groups[name]??=[]).push({i,x});
 }
 for(const name of Object.keys(groups))assert(groups[name].every(v=>name==='hand_l'?v.x<0:v.x>0),'Equipment on wrong side');
 if(unit==='archer'){assert(groups.hand_r?.length>0);assert(!groups.hand_l?.length,'Bow must be in anatomical left hand');}
 else assert(groups.hand_l?.length>0,'Sword/lance missing from anatomical right');
 if(['infantry','spearman'].includes(unit))assert(groups.hand_r?.length>0,'Shield missing from anatomical left');
 const mixer=new AnimationMixer(model.scene),clip=animation.animations.find(c=>c.name==='attack');
 const action=mixer.clipAction(clip).setLoop(LoopOnce,1);action.clampWhenFinished=true;action.play();
 const eventFrame=unit==='archer'?16:12,frames=[0,eventFrame-3,eventFrame,eventFrame+3,24];const samples=[];
 for(const frame of frames){
  mixer.setTime(frame/30);model.scene.updateMatrixWorld(true);mesh.skeleton.update();
  const bones={};
  for(const name of ['upper_arm_l','forearm_l','hand_l','upper_arm_r','forearm_r','hand_r']){
   const bone=mesh.skeleton.bones.find(b=>b.name===name);bones[name]={local_quaternion:bone.quaternion.toArray(),world_position:bone.getWorldPosition(new Vector3()).toArray()};
  }
  const equipment={};
  for(const [name,vertices] of Object.entries(groups)){
   const points=vertices.map(({i})=>mesh.applyBoneTransform(i,new Vector3().fromBufferAttribute(g.attributes.position,i)));
   equipment[name]={vertices:points.length,centroid:points.reduce((a,p)=>a.add(p),new Vector3()).multiplyScalar(1/points.length).toArray()};
  }
  samples.push({frame,bones,equipment});
 }
 const start=new Quaternion().fromArray(samples[0].bones.upper_arm_l.local_quaternion);
 const event=new Quaternion().fromArray(samples[2].bones.upper_arm_l.local_quaternion);
 const rightMotion=start.angleTo(event);assert(rightMotion>.15,'Right upper arm did not move at event');
 assert(samples[2].bones.upper_arm_l.world_position[0]<0,'Anatomical right shoulder must stay -X');
 const drawMotion=new Quaternion().fromArray(samples[0].bones.forearm_l.local_quaternion).angleTo(new Quaternion().fromArray(samples[2].bones.forearm_l.local_quaternion));
 if(unit==='archer')assert(drawMotion>.2,'Right draw arm did not move');
 const die=animation.animations.find(c=>c.name==='die');mixer.stopAllAction();
 const deathAction=mixer.clipAction(die).setLoop(LoopOnce,1);deathAction.clampWhenFinished=true;deathAction.play();
 const deathMinY={};
 for(let f=0;f<=30;f++){
  mixer.setTime(f/30);model.scene.updateMatrixWorld(true);mesh.skeleton.update();
  for(const [name,vertices] of Object.entries(groups)){
   for(const {i} of vertices){const p=mesh.applyBoneTransform(i,new Vector3().fromBufferAttribute(g.attributes.position,i));deathMinY[name]=Math.min(deathMinY[name]??Infinity,p.y);}
  }
 }
 assert(Object.values(deathMinY).every(y=>y>=-1e-6),'Death equipment penetrates ground');
 report[unit]={death_equipment_min_y_m:deathMinY,source_sha256:sha,bind_nodes_unchanged:true,metadata_and_frame_counts_preserved:true,event_frame:eventFrame,right_upper_arm_motion_rad:rightMotion,right_forearm_motion_rad:drawMotion,
 equipment_bind_bounds:Object.fromEntries(Object.entries(groups).map(([n,vs])=>[n,{vertices:vs.length,min_x:Math.min(...vs.map(v=>v.x)),max_x:Math.max(...vs.map(v=>v.x))}])),samples};
}
fs.writeFileSync(new URL('tools/anim/handedness.json',root),JSON.stringify(report,null,2)+'\n');
console.log('PASS: corrected art bindings, right attack/draw arm, left shield/bow, unchanged extras and frame counts (4 units)');
