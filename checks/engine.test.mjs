import test from 'node:test';import assert from 'node:assert/strict';
import {initialState,transition,previewExpedite,snapshot} from '../core/engine.mjs';
import {plan} from '../core/planning.mjs';import {Store} from '../server/store.mjs';import {localDb} from '../scripts/local-db.mjs';
const act=(s,c)=>transition(s,c).state;
test('测试延期反查客户项目，加急改善本单且暴露被挤占订单',()=>{
 let s=initialState();const before=plan(s).orders.find(o=>o.id==='SO-1001-1');assert.equal(before.gap,30000);
 s=act(s,{type:'sync',scenario:'delay'});const delayed=plan(s).orders.find(o=>o.id==='SO-1001-1');assert.equal(delayed.gap,80000);assert.equal(delayed.customerId,'C-XM');assert.equal(delayed.projectId,'P-PHONE');assert.ok(s.recommendations.find(r=>r.orderId===delayed.id).text.includes('20000'));
 const preview=previewExpedite(s);assert.ok(preview.changes.find(c=>c.orderId==='SO-1002-1').afterGap>0);
 assert.throws(()=>act(s,{type:'expedite'}),/确认/);s=act(s,{type:'expedite',confirmed:true});assert.equal(plan(s).orders.find(o=>o.id==='SO-1001-1').gap,30000);assert.equal(plan(s).orders.find(o=>o.id==='SO-1002-1').gap,20000);
});
test('回货转换不重复供给；出货减少未交；签收不二次减订单',()=>{
 let s=initialState();const before=plan(s).lots.reduce((a,l)=>a+(l.expected||0),0);
 s=act(s,{type:'receipt',lotId:'FT-01',quantity:49000,released:true});assert.equal(plan(s).lots.reduce((a,l)=>a+(l.expected||0),0),before-1000);
 assert.throws(()=>act(s,{type:'receipt',lotId:'FT-01',quantity:49000,released:true}),/不可回货/);
 assert.equal(plan(s).lots.find(l=>l.id==='FG-FT-01').eta.earliest,'2026-10-01');
 s=act(s,{type:'ship',lotId:'FG-FT-01',orderId:'SO-1001-1',quantity:49000});assert.equal(plan(s).orders.find(o=>o.id==='SO-1001-1').open,51000);
 s=act(s,{type:'delivered',shipmentId:s.shipments[0].id});assert.equal(plan(s).orders.find(o=>o.id==='SO-1001-1').open,51000);
});
test('跨厂直发与普通出货使用相同分配上限',()=>{let s=initialState();s=act(s,{type:'ship',lotId:'FG-02',orderId:'SO-1004-1',quantity:8000});assert.equal(s.shipments[0].source,'工厂直发');assert.equal(plan(s).orders.find(o=>o.id==='SO-1004-1').open,0);assert.throws(()=>act(s,{type:'ship',lotId:'FG-01',orderId:'SO-1002-1',quantity:1000}),/超过/);});
test('冲突/未归因隔离，不覆盖可信批次；重复run不产生重复异常',()=>{
 let s=initialState();const old=s.lots.find(l=>l.id==='FT-01');s=act(s,{type:'sync',scenario:'conflict',runKey:'once'});assert.equal(s.lots.find(l=>l.id==='FT-01').quantity,old.quantity);assert.ok(s.quarantine.some(q=>q.entityId==='UNKNOWN-LOT'));
 const count=s.issues.length;const runs=s.runs.length;s=act(s,{type:'sync',scenario:'conflict',runKey:'once'});assert.equal(s.issues.length,count);assert.equal(s.runs.length,runs);
 s=act(s,{type:'sync',scenario:'conflict',runKey:'next-run'});assert.equal(s.issues.length,count,'不同run的相同异常仍合并');
});
test('拆并数量守恒、暂停排除供给、跨厂流转与返工可追溯',()=>{
 let s=initialState();s=act(s,{type:'split',lotId:'AS-01',quantity:10000,childId:'AS-01-S1'});assert.equal(s.lots.filter(l=>l.id.startsWith('AS-01')).reduce((n,l)=>n+l.quantity,0),30000);
 s=act(s,{type:'merge',lotIds:['AS-01','AS-01-S1']});assert.equal(s.lots.find(l=>l.id==='AS-01').quantity,30000);
 s=act(s,{type:'pause',lotId:'AS-01'});assert.equal(plan(s).lots.find(l=>l.id==='AS-01').expected,0);s=act(s,{type:'pause',lotId:'AS-01'});s=act(s,{type:'transfer',lotId:'AS-01'});assert.equal(s.lots.find(l=>l.id==='AS-01').sourceId,'test');
 s=act(s,{type:'rework',lotId:'AS-01'});assert.equal(s.lots.find(l=>l.id==='AS-01').status,'rework');assert.ok(s.history.length>=5);
});
test('共享Die投料扣减一次；错误PN拒绝',()=>{
 let s=initialState();assert.throws(()=>act(s,{type:'release',lotId:'DIE-01',pn:'SC3215-Q24-TR',quantity:10000}),/不兼容/);
 s=act(s,{type:'release',lotId:'DIE-01',pn:'SC6820-S8-TR',quantity:10000});assert.equal(s.lots.find(l=>l.id==='DIE-01').quantity,50000);assert.equal(s.lots.at(-1).quantity,10000);assert.equal(s.lots.at(-1).pn,'SC6820-S8-TR');
});
test('晶圆投产→CP→实测Die→PN投料：单位转换不保留重复供给',()=>{
 let s=initialState();s=act(s,{type:'wafer_start',pn:'SC6820-S8-TR',wafers:2});const id=s.lots.at(-1).id;
 s=act(s,{type:'wafer_test',lotId:id});s=act(s,{type:'die_receipt',lotId:id,quantity:11000,released:true});assert.equal(plan(s).lots.find(l=>l.id===id).expected,0);
 const die=s.lots.at(-1);assert.equal(die.unit,'die');assert.equal(die.quantity,11000);s=act(s,{type:'release',lotId:die.id,pn:'SC6820-S8-TR',quantity:9000});assert.equal(s.lots.find(l=>l.id===die.id).quantity,2000);assert.equal(s.lots.at(-1).routeId,'R-S8');
});
test('调度日期可配置，同一日多次tick只执行一次，月采购准确触发',()=>{
 let s=initialState();s=act(s,{type:'tick'});assert.equal(s.runs.length,1);s=act(s,{type:'tick'});assert.equal(s.runs.length,1);
 s=act(s,{type:'tick',at:'2026-10-05T10:00:00+08:00'});assert.ok(s.runs.find(r=>r.key==='schedule:wafer:2026-10-05'));assert.ok(s.runs.find(r=>r.key==='schedule:weekly:2026-10-05'));
});
test('数据库幂等持久化：不同客户端重放同一出货键无重复记账',async()=>{
 const db=localDb(':memory:');const first=new Store(db),second=new Store(db);const cmd={type:'ship',lotId:'FG-02',orderId:'SO-1004-1',quantity:8000};
 const a=await first.execute('shipment-once',cmd);const b=await second.execute('shipment-once',cmd);assert.equal(a.revision,b.revision);assert.equal(b.duplicate,true);assert.equal((await second.view()).state.shipments.length,1);
 await assert.rejects(()=>second.execute('shipment-once',{type:'sync'}),/不同操作/);db.close();
});
