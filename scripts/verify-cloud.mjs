// Credentials arrive through hidden stdin and are never saved or logged.
process.stdin.setRawMode?.(true);process.stdin.resume();process.stdin.setEncoding('utf8');console.log('Ready for hidden site access JSON.');
let buffer='';
process.stdin.on('data',async chunk=>{buffer+=chunk;if(!buffer.includes('\n'))return;process.stdin.removeAllListeners('data');process.stdin.pause();
try{const {url,token}=JSON.parse(buffer.trim());buffer='';const request=async(path,body)=>{const r=await fetch(new URL(path,url),{method:body?'POST':'GET',headers:{'OAI-Sites-Authorization':`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error(`HTTP ${r.status}: ${(await r.text()).slice(0,150)}`);return r.json();};
const before=await request('/api/state');if(before.state.sources.some(s=>s.connector!=='mock'))throw Error('非mock来源，停止演示验证');
const now=new Date().toISOString();const command={type:'tick',at:now};const key=`cloud-tick:${now.slice(0,16)}`;
if(Date.parse(before.state.clock)>Date.parse(now))throw Error('模拟业务时钟在未来，不倒退');
const written=await request('/api/command',{key,command});const duplicate=await request('/api/command',{key,command});const after=await request('/api/state');
console.log(JSON.stringify({beforeRevision:before.revision,afterRevision:after.revision,write:written,duplicate:duplicate.duplicate,runCount:after.state.runs.length,sourceCount:after.state.sources.length,persistence:'D1 read/write/readback confirmed'}));
}catch(e){console.error(e.message);process.exitCode=1;}finally{process.stdin.setRawMode?.(false);process.stdin.destroy();}});
