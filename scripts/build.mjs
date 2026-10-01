import fs from 'node:fs/promises';import path from 'node:path';import {build} from 'esbuild';
await fs.rm('dist',{recursive:true,force:true});await fs.mkdir('dist/.openai',{recursive:true});await fs.mkdir('.sites-runtime',{recursive:true});
const assets={};for(const root of ['web','legacy'])for(const name of await fs.readdir(root)){
 const file=path.join(root,name);if(!(await fs.stat(file)).isFile())continue;
 const route=root==='web'?`/${name}`:`/legacy/${name}`;assets[route]={body:await fs.readFile(file,'utf8'),type:name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'};
}assets['/']=assets['/index.html'];assets['/legacy/']=assets['/legacy/index.html'];
await fs.writeFile('.sites-runtime/assets.mjs',`export default ${JSON.stringify(assets)};`);
await build({entryPoints:['server/worker.mjs'],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'dist/server/index.js'});
await fs.copyFile('.openai/hosting.json','dist/.openai/hosting.json');await fs.cp('drizzle','dist/.openai/drizzle',{recursive:true});
console.log('Worker built with embedded UI, preserved legacy demo, D1 migrations.');
