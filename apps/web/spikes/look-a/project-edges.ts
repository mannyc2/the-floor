import * as THREE from 'three';
import { ProjectionGenerator } from 'three-edge-projection';
import { chromium } from '@playwright/test';
import { mkdir,writeFile } from 'node:fs/promises';
import { defaults,makeScene,cameraFor } from './scene';
const output='work/spikes/look/edge-projection/002';await mkdir(output,{recursive:true});
const material=new THREE.MeshBasicMaterial(),data=makeScene(defaults,material);
const browser=await chromium.launch({headless:true});
try{for(const rung of ['district','works','machine']) {
  const selected=rung==='district'?'district':rung==='works'?'works':'machine';
  const camera=cameraFor({rung:selected,width:480,height:360});
  const transform=new THREE.Matrix4().makeRotationX(-Math.PI/2).multiply(camera.matrixWorldInverse);
  const scene=new THREE.Scene();
  for(const mesh of data.meshes){const count=mesh instanceof THREE.InstancedMesh?mesh.count:1;for(let i=0;i<count;i++){const instance=new THREE.Matrix4();if(mesh instanceof THREE.InstancedMesh)mesh.getMatrixAt(i,instance);const geometry=mesh.geometry.clone().applyMatrix4(instance).applyMatrix4(transform);scene.add(new THREE.Mesh(geometry,material));}}
  const generator=new ProjectionGenerator();generator.angleThreshold=35;generator.includeIntersectionEdges=true;
  const start=performance.now(),iterator=generator.generate(scene);let result=iterator.next();while(!result.done)result=iterator.next();
  const geometry=result.value.visibleEdges.getLineGeometry(),points=geometry.getAttribute('position');
  const scale=480/(camera.right-camera.left),lines:string[]=[];
  for(let i=0;i<points.count;i+=2){const x1=(points.getX(i)-camera.left)*scale,y1=(points.getZ(i)+camera.top)*scale,x2=(points.getX(i+1)-camera.left)*scale,y2=(points.getZ(i+1)+camera.top)*scale;lines.push(`M${x1.toFixed(5)},${y1.toFixed(5)}L${x2.toFixed(5)},${y2.toFixed(5)}`);}
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360"><rect width="480" height="360" fill="white"/><path d="${lines.join('')}" fill="none" stroke="black" stroke-width="1" stroke-linecap="butt"/></svg>`;
  await writeFile(`${output}/${rung}.svg`,svg);await writeFile(`${output}/${rung}.json`,JSON.stringify({rung,projection_ms:performance.now()-start,segments:points.count/2,camera:camera.projectionMatrix.toArray(),generator:{angleThreshold:35,includeIntersectionEdges:true}},null,2));
  for(const dpr of [1,2,3]){const page=await browser.newPage({viewport:{width:480,height:360},deviceScaleFactor:dpr});await page.setContent(`<style>body{margin:0}</style>${svg}`);await page.screenshot({path:`${output}/${rung}-${dpr}.png`});await page.close();}
  console.log(`Projected ${rung}: ${points.count/2} visible line segments`);
}}finally{await browser.close();}
