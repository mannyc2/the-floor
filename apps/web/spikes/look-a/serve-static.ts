import { resolve, sep } from 'node:path';
const root=resolve(process.env.LOOK_BUILD??'work/spikes/look/build');
const server=Bun.serve({hostname:'127.0.0.1',port:Number(process.env.LOOK_PORT??5182),async fetch(request){const pathname=new URL(request.url).pathname;const target=resolve(root,pathname==='/'?'index.html':`.${pathname}`);if(!target.startsWith(root+sep))return new Response('Outside build',{status:403});const file=Bun.file(target);return await file.exists()?new Response(file):new Response('Not found',{status:404});}});
console.log(`Frozen look build ${root} at ${server.url}`);
