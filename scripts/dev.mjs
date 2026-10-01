import http from 'node:http';import fs from 'node:fs';import path from 'node:path';
import {localDb} from './local-db.mjs';import {api} from '../server/api.mjs';
fs.mkdirSync('.sites-runtime',{recursive:true});const db=localDb('.sites-runtime/wip.sqlite');const port=Number(process.env.WIP_PORT||4317);
const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.json':'application/json'};
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,`http://127.0.0.1:${port}`);
 if(url.pathname.startsWith('/api/')){const chunks=[];for await(const c of req)chunks.push(c);const r=await api(new Request(url,{method:req.method,headers:req.headers,...(req.method!=='GET'?{body:Buffer.concat(chunks)}:{})}),db);res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));return;}
 let file=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).slice(1);let root='web';if(file.startsWith('legacy/')){root='legacy';file=file.slice(7)||'index.html';}
 const resolved=path.resolve(root,file);if(!resolved.startsWith(path.resolve(root)+path.sep)){res.writeHead(403);res.end();return;}
 if(!fs.existsSync(resolved)){res.writeHead(404);res.end('Not found');return;}
 res.writeHead(200,{'Content-Type':types[path.extname(file)]||'text/plain'});res.end(fs.readFileSync(resolved));
 }catch(e){res.writeHead(500);res.end(e.message);}});
server.listen(port,'127.0.0.1',()=>console.log(`WIP workbench http://127.0.0.1:${port}`));
