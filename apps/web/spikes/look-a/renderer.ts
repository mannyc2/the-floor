import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { Config, makeScene, names, tokenColor } from './scene';

const vertex = `attribute float _SURFACE; attribute float _MAT; varying vec3 n; varying float sid; varying float mat;
void main(){vec4 p=vec4(position,1.); n=normalize(normalMatrix*normal);sid=_SURFACE;mat=_MAT;
#ifdef USE_INSTANCING
p=instanceMatrix*p;
#endif
gl_Position=projectionMatrix*modelViewMatrix*p;}`;
const colorFragment = `uniform vec3 palette[17]; uniform int mask; varying vec3 n; varying float mat;
void main(){int index=int(mat+.5); if(index>=13){float light=dot(normalize(n),normalize(vec3(-.4,.8,.45)));index=light>.65?16:light>.1?15:light>-.5?14:13;} gl_FragColor=vec4(mask==1?vec3(1.):palette[index],1.);
#include <colorspace_fragment>
}`;
const dataFragment = `uniform int mode;varying vec3 n;varying float sid;
void main(){float id=floor(sid+.5); vec3 encoded=vec3(mod(id,256.),mod(floor(id/256.),256.),floor(id/65536.))/255.;gl_FragColor=vec4(mode==0?normalize(n)*.5+.5:encoded,1.);}`;
const screenVertex = `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;
const screenFragment = `uniform sampler2D colors;uniform sampler2D data;uniform sampler2D depths;uniform vec2 pixel;uniform vec2 edgeSpan;uniform vec3 lineColor;uniform float lineOpacity;uniform int mode;uniform int mask;varying vec2 vUv;
float testEdge(vec2 direction){vec4 a=texture2D(data,vUv);vec4 b=texture2D(data,vUv+direction*pixel);float d=abs(texture2D(depths,vUv).r-texture2D(depths,vUv+direction*pixel).r);float feature=mode==0?step(.3,length(a.rgb-b.rgb)):step(.001,length(a.rgb-b.rgb));return max(feature,step(.0012,d));}
void main(){float edge=max(max(testEdge(vec2(edgeSpan.y,0.)),testEdge(vec2(-edgeSpan.x,0.))),max(testEdge(vec2(0.,edgeSpan.y)),testEdge(vec2(0.,-edgeSpan.x))));vec3 base=texture2D(colors,vUv).rgb;gl_FragColor=vec4(mask==1?vec3(1.-edge):mix(base,lineColor,edge*lineOpacity),1.);
#include <colorspace_fragment>
}`;

interface Segment { a: THREE.Vector3; b: THREE.Vector3; normals: THREE.Vector3[] }
export function conditionalEdges(geometry: THREE.BufferGeometry, view: THREE.Vector3): number[] {
  const points = geometry.getAttribute('position'), edges = new Map<string, Segment>();
  const key = (p: THREE.Vector3) => `${Math.round(p.x*1e6)},${Math.round(p.y*1e6)},${Math.round(p.z*1e6)}`;
  for (let i=0;i<points.count;i+=3) {
    const a=new THREE.Vector3().fromBufferAttribute(points,i),b=new THREE.Vector3().fromBufferAttribute(points,i+1),c=new THREE.Vector3().fromBufferAttribute(points,i+2);
    const n=b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    for (const [p,q] of [[a,b],[b,c],[c,a]]) {
      if (!p || !q) continue;
      const edgeKey=[key(p),key(q)].sort().join('|'), previous=edges.get(edgeKey);
      if(previous) previous.normals.push(n); else edges.set(edgeKey,{a:p,b:q,normals:[n]});
    }
  }
  const result:number[]=[];
  for(const edge of edges.values()) {
    const first=edge.normals[0],second=edge.normals[1];
    if(!first) continue;
    // With the fixed orthographic camera, face-sign selection is exact; camera changes regenerate this buffer.
    const hard=!second || first.dot(second)<Math.cos(35*Math.PI/180);
    const silhouette=second && first.dot(view)*second.dot(view)<=0;
    if(hard || silhouette) result.push(...edge.a.toArray(),...edge.b.toArray());
  }
  return result;
}

export function createRenderer(config:Config,host:HTMLElement) {
  const renderer=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});
  renderer.setPixelRatio(config.dpr);renderer.setSize(config.width,config.height);renderer.info.autoReset=false;
  renderer.setClearColor(tokenColor('ground',config.theme));host.prepend(renderer.domElement);
  const palette=names.map(name=>new THREE.Color(tokenColor(name,config.theme)));
  const material=new THREE.ShaderMaterial({vertexShader:vertex,fragmentShader:colorFragment,uniforms:{palette:{value:palette},mask:{value:0}},polygonOffset:config.technique==='C',polygonOffsetFactor:1,polygonOffsetUnits:1});
  const dataMaterial=new THREE.ShaderMaterial({vertexShader:vertex,fragmentShader:dataFragment,uniforms:{mode:{value:config.technique==='A'?0:1}}});
  const data=makeScene(config,material);
  const size=new THREE.Vector2(config.width*config.dpr,config.height*config.dpr);
  const colorTarget=new THREE.WebGLRenderTarget(size.x,size.y,{minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
  colorTarget.texture.colorSpace=THREE.SRGBColorSpace;
  const dataTarget=new THREE.WebGLRenderTarget(size.x,size.y,{minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
  dataTarget.depthTexture=new THREE.DepthTexture(size.x,size.y,THREE.UnsignedIntType);
  // Integer spans split odd widths asymmetrically; half-texel nearest sampling made DPR1/3 outlines too wide.
  const screenMaterial=new THREE.ShaderMaterial({vertexShader:screenVertex,fragmentShader:screenFragment,depthTest:false,depthWrite:false,uniforms:{colors:{value:colorTarget.texture},data:{value:dataTarget.texture},depths:{value:dataTarget.depthTexture},pixel:{value:new THREE.Vector2(1/size.x,1/size.y)},edgeSpan:{value:new THREE.Vector2(Math.floor(config.dpr/2),Math.ceil(config.dpr/2))},lineColor:{value:new THREE.Color(tokenColor('line',config.theme))},lineOpacity:{value:config.theme==='night'?.7:1},mode:{value:config.technique==='A'?0:1},mask:{value:0}}});
  const screenScene=new THREE.Scene(),quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),screenMaterial);screenScene.add(quad);
  const screenCamera=new THREE.Camera();
  const lineGeometry=new LineSegmentsGeometry();
  // LineSegments2 resets resolution to the logical viewport, so this value is already in CSS pixels.
  const lineMaterial=new LineMaterial({color:tokenColor('line',config.theme),linewidth:1,depthTest:true,depthWrite:false,transparent:config.theme==='night',opacity:config.theme==='night'?.7:1});
  lineMaterial.resolution.set(size.x,size.y);
  const positions:number[]=[];
  if(config.technique==='C') {
    const view=new THREE.Vector3();data.camera.getWorldDirection(view);
    for(const mesh of data.meshes) {
      const edges=conditionalEdges(mesh.geometry,view),count=mesh instanceof THREE.InstancedMesh?mesh.count:1;
      for(let instance=0;instance<count;instance++) {
        const matrix=new THREE.Matrix4();if(mesh instanceof THREE.InstancedMesh) mesh.getMatrixAt(instance,matrix);
        for(let index=0;index<edges.length;index+=3) {const p=new THREE.Vector3(edges[index],edges[index+1],edges[index+2]).applyMatrix4(matrix);positions.push(p.x,p.y,p.z);}
      }
    }
    lineGeometry.setPositions(positions);
    const lines=new LineSegments2(lineGeometry,lineMaterial);lines.frustumCulled=false;lines.renderOrder=1;data.scene.add(lines);
  }
  const gl=renderer.getContext();
  const debug=gl.getExtension('WEBGL_debug_renderer_info');
  const gpuRenderer:unknown=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
  let mask=false;
  function draw() {
    renderer.info.reset();const start=performance.now();
    if(config.technique==='C') {
      renderer.setRenderTarget(null);renderer.setClearColor(mask?'white':tokenColor('ground',config.theme));
      renderer.render(data.scene,data.camera);data.scene.overrideMaterial=null;
    } else {
      renderer.setRenderTarget(colorTarget);renderer.setClearColor(tokenColor('ground',config.theme));renderer.render(data.scene,data.camera);
      renderer.setRenderTarget(dataTarget);renderer.setClearColor(0);data.scene.overrideMaterial=dataMaterial;renderer.render(data.scene,data.camera);data.scene.overrideMaterial=null;
      renderer.setRenderTarget(null);renderer.render(screenScene,screenCamera);
    }
    return {cpuMs:performance.now()-start,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles};
  }
  return {renderer,data,draw,context:gl,waitForGPU:async()=>{
      if(!(gl instanceof WebGL2RenderingContext))throw new Error('Expected WebGL2 completion fence');
      const fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);if(!fence)throw new Error('Could not create completion fence');gl.flush();
      try{for(let attempt=0;attempt<2000;attempt++){const status=gl.clientWaitSync(fence,0,0);if(status===gl.ALREADY_SIGNALED||status===gl.CONDITION_SATISFIED)return;if(status===gl.WAIT_FAILED)throw new Error('GPU completion fence failed');await new Promise<void>(resolve=>setTimeout(resolve,1));}throw new Error('GPU completion fence timed out');}finally{gl.deleteSync(fence);}
    },gpuTime:async():Promise<number|undefined>=>undefined,rendererString:typeof gpuRenderer==='string'?gpuRenderer:'unknown',targetBytes:config.technique==='C'?0:size.x*size.y*16,lineBufferBytes:positions.length*4,
    mask(value:boolean){mask=value;const uniform=screenMaterial.uniforms.mask;if(uniform)uniform.value=value?1:0;const surface=material.uniforms.mask;if(surface)surface.value=value?1:0;lineMaterial.color.set(value?'black':tokenColor('line',config.theme));lineMaterial.opacity=value?1:config.theme==='night'?.7:1;draw();},
    dispose(){renderer.dispose();renderer.domElement.remove();data.geometries.forEach(geometry=>geometry.dispose());material.dispose();dataMaterial.dispose();lineGeometry.dispose();lineMaterial.dispose();colorTarget.dispose();dataTarget.dispose();screenMaterial.dispose();quad.geometry.dispose();}
  };
}
