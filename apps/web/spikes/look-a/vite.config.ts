import { defineConfig } from 'vite';
export default defineConfig({root:'apps/web/spikes/look-a',build:{outDir:process.env.LOOK_BUILD_OUT??'../../../../work/spikes/look/build',emptyOutDir:true},server:{host:'127.0.0.1',port:5181,strictPort:true}});
