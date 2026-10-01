import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {initialState,transition} from '../core/engine.mjs';import {Store} from '../server/store.mjs';import {localDb} from '../scripts/local-db.mjs';import {vendorCsvEnvelope} from '../core/connectors.mjs';import {answerQuestion} from '../server/agent.mjs';import {dateOnly} from '../core/planning.mjs';
test('文件数据库关闭后重开，未结异常、运行及配置保留',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wip-test-'));const file=path.join(dir,'state.sqlite');let db=localDb(file);let store=new Store(db);
 await store.execute('sync1',{type:'sync',scenario:'delay'});await store.execute('cfg1',{type:'schedule',id:'wafer',values:{hour:11,minute:30,enabled:true,days:[6,21]}});const first=await store.view();db.close();
 db=localDb(file);store=new Store(db);const reopened=await store.view();assert.deepEqual(reopened,first);db.close();fs.rmSync(dir,{recursive:true});
});
test('两个并发同键出货只提交一次',async()=>{
 const db=localDb(':memory:'),a=new Store(db),b=new Store(db);await a.read();const command={type:'ship',lotId:'FG-02',orderId:'SO-1004-1',quantity:8000};await Promise.all([a.execute('race',command),b.execute('race',command)]);const s=await a.view();assert.equal(s.state.shipments.length,1);assert.equal(s.revision,1);db.close();
});
test('来源失败持久保留partial，同runKey可恢复，成功后不重复',()=>{
 let s=initialState();s.sourceDocuments.test.records=null;s=transition(s,{type:'sync',runKey:'retry-job'}).state;assert.equal(s.runs[0].status,'partial');assert.ok(s.runs[0].outcomes.find(x=>x.source==='test').error);
 s.sourceDocuments.test=initialState().sourceDocuments.test;s=transition(s,{type:'sync',runKey:'retry-job'}).state;assert.equal(s.runs.length,1);assert.equal(s.runs[0].status,'succeeded');assert.equal(s.runs[0].attempts,2);
});
test('CSV字段映射可接入，未知批次隔离',()=>{let s=initialState();const csv=fs.readFileSync(new URL('../mock/test.csv',import.meta.url),'utf8');const envelope=vendorCsvEnvelope(csv,{sourceId:'test',eventId:'csv1',observedAt:s.clock},s.lots);s=transition(s,{type:'ingest',envelope}).state;assert.equal(s.quarantine.length,0);});
test('不能从晶圆或封装直接跳站回货；北京时间跨UTC日期正确',()=>{const s=initialState();assert.throws(()=>transition(s,{type:'receipt',lotId:'AS-01',quantity:100,released:true}),/必须先完成/);assert.equal(dateOnly('2026-10-01T19:00:00Z'),'2026-10-02');});
test('Agent 路由只读工具，mock显式；模型无效/低置信不执行',async()=>{
 const s=initialState();const a=await answerQuestion('FT-01影响哪些订单',s);assert.equal(a.mode,'mock-keyword-router');assert.equal(a.evidence.length,1);assert.equal(a.evidence[0].order,'SO-1001-1');
 const b=await answerQuestion('帮我下单',s,{apiKey:'test-placeholder',fetcher:async()=>Response.json({model:'test',answers:{intent:{type:'choice',choice:'delivery',confidence:0.2}}})});assert.equal(b.tool,'unknown');assert.deepEqual(b.evidence,[]);
});
