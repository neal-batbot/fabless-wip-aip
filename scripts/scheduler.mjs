// Real Node process, independent of browsers. Sources are mock; notifications stay in the workbench.
import {Store} from '../server/store.mjs';import {localDb} from './local-db.mjs';import fs from 'node:fs';
fs.mkdirSync('.sites-runtime',{recursive:true});const store=new Store(localDb('.sites-runtime/wip.sqlite'));
const once=process.argv.includes('--once');const interval=Number(process.env.WIP_TICK_MS||60000);
async function tick(){const now=new Date().toISOString();try{const result=await store.execute(`tick:${now.slice(0,16)}`,{type:'tick',at:now});console.log(JSON.stringify({at:now,...result}));}catch(e){console.error(JSON.stringify({at:now,error:e.message,retry:'next tick'}));}}
await tick();if(!once)setInterval(tick,interval);
