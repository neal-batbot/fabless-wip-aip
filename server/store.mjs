import {initialState,transition,snapshot} from '../core/engine.mjs';
export class Store {
 constructor(db,id='demo'){if(!db)throw Error('持久化服务不可用');this.db=db;this.id=id;}
 async read(){
  await this.db.prepare('INSERT OR IGNORE INTO wip_workspaces (id,revision,state_json,updated_at) VALUES (?,0,?,?)').bind(this.id,JSON.stringify(initialState()),new Date().toISOString()).run();
  const row=await this.db.prepare('SELECT revision,state_json FROM wip_workspaces WHERE id=?').bind(this.id).first();
  return {revision:row.revision,state:JSON.parse(row.state_json)};
 }
 async view(){const x=await this.read();return snapshot(x.state,x.revision);}
 async execute(key,command){
  if(typeof key!=='string'||!/^[a-zA-Z0-9:._-]{1,180}$/.test(key))throw Error('需要有效幂等键');
  const encoded=JSON.stringify(command);
  for(let attempt=0;attempt<5;attempt++){
   const previous=await this.db.prepare('SELECT payload_json FROM wip_events WHERE workspace_id=? AND event_key=?').bind(this.id,key).first();
   if(previous){const p=JSON.parse(previous.payload_json);if(p.command!==encoded)throw Error('幂等键已用于不同操作');return {...p.result,duplicate:true};}
   const current=await this.read();const output=transition(current.state,command);const revision=current.revision+1;
   const result={revision,result:output.result};const eventId=crypto.randomUUID();const time=new Date().toISOString();
   // D1 batch is transactional. Insert only against the revision we read; update only if this exact event won.
   await this.db.batch([
    this.db.prepare('INSERT OR IGNORE INTO wip_events (id,workspace_id,event_key,kind,payload_json,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM wip_workspaces WHERE id=? AND revision=?)').bind(eventId,this.id,key,command.type,JSON.stringify({command:encoded,result}),time,this.id,current.revision),
    this.db.prepare('UPDATE wip_workspaces SET state_json=?,revision=?,updated_at=? WHERE id=? AND revision=? AND EXISTS (SELECT 1 FROM wip_events WHERE id=?)').bind(JSON.stringify(output.state),revision,time,this.id,current.revision,eventId),
   ]);
   const saved=await this.db.prepare('SELECT payload_json FROM wip_events WHERE id=?').bind(eventId).first();if(saved)return result;
  }
  throw Error('状态正被其他操作更新，请使用相同操作键重试');
 }
}
