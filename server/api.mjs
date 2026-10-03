import {Store} from './store.mjs';
import {answerQuestion} from './agent.mjs';
export async function api(request,db,options={}){
 const url=new URL(request.url);const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
 try{
  const workspace=url.searchParams.get('workspace')||'demo';
  if(!/^(demo|scenario-[a-zA-Z0-9-]{1,80})$/.test(workspace))throw Error('无效演示空间');
  const store=new Store(db,workspace);
  if(request.method==='GET'&&url.pathname==='/api/state')return json(await store.view());
  if(request.method==='POST'&&url.pathname==='/api/ask'){
   const origin=request.headers.get('origin');if(origin&&origin!==url.origin)return json({error:'请求来源不匹配'},403);
   const raw=await request.text();if(raw.length>5000)return json({error:'问题过长'},413);
   const {question}=JSON.parse(raw);return json(await answerQuestion(question,(await store.read()).state,{apiKey:options.apiKey}));
  }
  if(request.method==='POST'&&url.pathname==='/api/command'){
   const origin=request.headers.get('origin');if(origin&&origin!==url.origin)return json({error:'请求来源不匹配'},403);
   if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'需要JSON'},415);
   const raw=await request.text();if(raw.length>300000)return json({error:'单次请求过大'},413);
   const {key,command}=JSON.parse(raw);return json(await store.execute(key,command));
  }
  return json({error:'不存在的接口'},404);
 }catch(e){return json({error:e.message},e.message==='持久化服务不可用'?503:400);}
}
