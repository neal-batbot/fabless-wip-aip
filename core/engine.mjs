import {clone,plan,anomalies,expectedUnits,addWorkdays,STAGES,dateOnly} from './planning.mjs';
import {seed,sourceFixture} from './seed.mjs';
import sourceDocuments from '../mock/feeds.json' with {type:'json'};
const ensure=(ok,msg)=>{if(!ok)throw Error(msg);};
const positive=n=>Number.isSafeInteger(n)&&n>0;
function audit(s,kind,subject,detail){s.history.push({id:`EV-${s.history.length+1}`,time:s.clock,kind,subject,detail});}
function issueRefresh(s) {
 const current=anomalies(s);const keys=new Set(current.map(x=>x.key));
 for(const old of s.issues) if(!keys.has(old.key)&&old.status!=='resolved'){old.status='resolved';old.resolvedAt=s.clock;}
 for(const a of current){const old=s.issues.find(x=>x.key===a.key);if(old){Object.assign(old,a,{lastSeen:s.clock});if(old.status==='resolved'){old.status='open';old.reopened=(old.reopened||0)+1;}}else s.issues.push({...a,id:`ISS-${s.issues.length+1}`,status:'open',firstSeen:s.clock,lastSeen:s.clock,nextCheck:s.clock,notes:[]});}
 const p=plan(s);
 s.recommendations=p.orders.filter(o=>o.gap>0).map(o=>({id:`REC-${o.id}`,orderId:o.id,customerId:o.customerId,projectId:o.projectId,owner:o.owner,kind:'交付协调',evidence:o.allocations,
 text:o.allowPartial?`先确认 ${o.stock} 颗现货和 ${o.expected} 颗到期预计供给；剩余 ${o.gap} 颗需确认后续批次或协商交期。`:`该订单不允许分批；到期缺口 ${o.gap} 颗，需统一协调交期。`,status:'建议，未对外承诺'}));
 for(const f of p.forecasts.filter(f=>f.remaining>0))s.recommendations.push({id:`REC-${f.id}`,kind:'投料评估',customerId:f.customerId,projectId:f.projectId,text:`${f.pn} 剩余预测 ${f.remaining} 颗；需核对共享 Die、良率和产能，不能直接转为采购订单。`,evidence:[{forecast:f.id,version:f.version,consumed:f.consumed}],status:'建议，未下单'});
}
function ingest(s,envelope){
 const source=s.sources.find(x=>x.id===envelope.sourceId);ensure(source,'未知数据源');ensure(typeof envelope.eventId==='string'&&envelope.eventId.length<200,'缺少源事件键');
 const key=`source:${source.id}:${envelope.eventId}`;if(s.seen.includes(key))return {duplicate:true,accepted:0};
 ensure(Number.isFinite(Date.parse(envelope.observedAt)),'无效源时间');ensure(Array.isArray(envelope.records)&&envelope.records.length<=1000,'每批最多1000条');
 const reject=(r,reason)=>{const id=`${envelope.eventId}:${r.id||'envelope'}:${reason}`;if(!s.quarantine.some(q=>q.id===id))s.quarantine.push({id,entityId:r.id||source.id,sourceId:source.id,reason,observedAt:envelope.observedAt,raw:clone(r)});};
 if(Date.parse(envelope.observedAt)<Date.parse(source.observedAt)){reject(envelope,'源快照倒退，保留可信快照');s.seen.push(key);return {accepted:0,rejected:envelope.records.length};}
 if(Date.parse(envelope.observedAt)>Date.parse(s.clock)+300000){reject(envelope,'源时间在未来，待核对');s.seen.push(key);return {accepted:0,rejected:envelope.records.length};}
 let accepted=0;const counts={};for(const r of envelope.records)counts[r.id]=(counts[r.id]||0)+1;
 for(const r of envelope.records){
  if(counts[r.id]>1){reject(r,'同一快照重复主键，数量或状态存在冲突');continue;}
  const mappings={customer:['customers','crm'],project:['projects','crm'],forecast:['forecasts','crm'],order:['orders','erp'],lot:['lots',null],feedback:['feedback','manual']};
  const map=mappings[r.entity];if(!map){reject(r,'不支持的实体');continue;}
  const old=s[map[0]].find(x=>x.id===r.id);
  if(!old){reject(r,'未归因：未知主键，禁止自动分摊');continue;}
  if((map[1]&&map[1]!==source.id)||(r.entity==='lot'&&old.sourceId!==source.id)){reject(r,'非权威数据源，需人工核对');continue;}
  if(r.entity==='lot'){
   if(!Number.isSafeInteger(r.quantity)||r.quantity<0||r.unit!==old.unit||r.pn!==old.pn||!STAGES.includes(r.stage)||!Array.isArray(r.remainingRoute)){reject(r,'数量/单位/PN/路线无效');continue;}
   if(r.quantity!==old.quantity||r.stage!==old.stage||r.status!==old.status){reject(r,'数量或工序改变需要可核对的转移/拆并事件');continue;}
   const allowed=['observedAt','promisedDate','promiseConfirmed','remainingRoute'];
   const changed=allowed.some(k=>JSON.stringify(old[k])!==JSON.stringify(r[k]));
   const before=Object.fromEntries(allowed.map(k=>[k,clone(old[k]??null)]));
   for(const k of allowed)if(r[k]!==undefined)old[k]=clone(r[k]);
   old.version=(old.version||0)+1;if(changed)audit(s,'来源更新',old.id,{eventId:envelope.eventId,sourceId:source.id,version:old.version,before,after:Object.fromEntries(allowed.map(k=>[k,clone(old[k]??null)]))});
  }else if(JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k])=>k!=='entity')))!==JSON.stringify(old)){
   // Order/forecast changes require separate validated business events, never blind object overwrite.
   reject(r,'主数据或订单变更需独立核对，当前版本保留');continue;
  }
  accepted++;
 }
 source.observedAt=envelope.observedAt;source.ingestedAt=s.clock;source.version++;s.seen.push(key);audit(s,'数据接入',source.id,{accepted,rejected:envelope.records.length-accepted,eventId:envelope.eventId});
 return {accepted,rejected:envelope.records.length-accepted};
}
export function dueSlots(s,at=s.clock){
 const local=new Date(Date.parse(at)+8*3600000);const day=local.toISOString().slice(0,10);const minutes=local.getUTCHours()*60+local.getUTCMinutes();
 return s.schedules.filter(x=>x.enabled&&minutes>=x.hour*60+x.minute&&(x.frequency!=='weekly'||local.getUTCDay()===x.weekday)&&(x.frequency!=='monthly'||x.days.includes(local.getUTCDate())))
 .map(x=>({...x,key:`schedule:${x.id}:${day}`}));
}
export function previewExpedite(s){
 const before=plan(s);const afterState=clone(s);applyExpedite(afterState);const after=plan(afterState);
 return {resource:'ATE-A',constraint:'mock 单机测试档期；仅交换 FT-01 与 FT-02 的确认窗口。未确认不生效。',changes:before.orders.map(o=>({orderId:o.id,customerId:o.customerId,beforeGap:o.gap,afterGap:after.orders.find(a=>a.id===o.id).gap})).filter(o=>o.beforeGap!==o.afterGap)};
}
function applyExpedite(s){
 const a=s.lots.find(l=>l.id==='FT-01'),b=s.lots.find(l=>l.id==='FT-02');
 ensure(a?.status==='active'&&b?.status==='active'&&a.resource===b.resource,'批次已转出或不共享资源，不能套用演示方案');
 a.remainingRoute=[{name:'加急测试/质量/运输',queue:[0,0],duration:[2,2],confirmedStart:dateOnly(s.clock)}];a.promisedDate=addWorkdays(s.clock,2,s.calendar);a.promiseConfirmed=true;
 b.remainingRoute=[{name:'被占用档期后的测试/质量/运输',queue:[3,3],duration:[3,3],confirmedStart:dateOnly(s.clock)}];b.promisedDate=addWorkdays(s.clock,6,s.calendar);b.promiseConfirmed=true;
}
export function transition(input,command){
 const s=clone(input);ensure(command&&typeof command.type==='string','缺少命令类型');let result={};
 const find=id=>{const l=s.lots.find(x=>x.id===id);ensure(l,'批次不存在');return l;};
 switch(command.type){
 case 'sync':{
  const scenario=command.scenario||'normal';ensure(['normal','delay','stale','conflict'].includes(scenario),'未知同步场景');
  const runKey=command.runKey||`manual:${s.syncIndex+1}`;const old=s.runs.find(r=>r.key===runKey);if(old&&old.status==='succeeded')return {state:s,result:{...old,duplicate:true}};
  s.syncIndex++;const outcomes=[];
  for(const source of s.sources){try{const document=sourceFixture(s,source.id,{scenario,index:s.syncIndex});if(s.sourceDocuments)s.sourceDocuments[source.id]=clone(document);outcomes.push({source:source.id,...ingest(s,document)});}catch(e){outcomes.push({source:source.id,error:e.message});}}
  result={key:runKey,time:s.clock,kind:command.kind||'即时同步',status:outcomes.some(o=>o.error)?'partial':'succeeded',outcomes,scenario,attempts:(old?.attempts||0)+1};if(old)Object.assign(old,result);else s.runs.push(result);break;
 }
 case 'ingest':result=ingest(s,command.envelope);break;
 case 'advance':{
  const d=new Date(Date.parse(s.clock)+ (command.hours||6)*3600000);ensure(Number.isFinite(d.getTime())&&(command.hours||6)>0&&(command.hours||6)<=744,'推进小时数需为1–744');s.clock=d.toISOString();result={clock:s.clock};break;
 }
 case 'tick':{
  if(command.at){ensure(Number.isFinite(Date.parse(command.at))&&Date.parse(command.at)>=Date.parse(s.clock),'调度时间不能倒退');s.clock=command.at;}
  const slots=dueSlots(s);result={executed:[]};
  for(const slot of slots)if(!s.runs.some(r=>r.key===slot.key&&r.status==='succeeded')){const next=transition(s,{type:'sync',runKey:slot.key,kind:slot.name});Object.assign(s,next.state);result.executed.push(slot.key);}
  s.execution.lastTick=s.clock;break;
 }
 case 'schedule':{
  const x=s.schedules.find(x=>x.id===command.id);ensure(x,'计划不存在');const v=command.values;
  ensure(Number.isInteger(v.hour)&&v.hour>=0&&v.hour<24&&Number.isInteger(v.minute)&&v.minute>=0&&v.minute<60,'时间无效');
  if(x.frequency==='monthly')ensure(Array.isArray(v.days)&&v.days.length===2&&new Set(v.days).size===2&&v.days.every(d=>Number.isInteger(d)&&d>=1&&d<=28),'每月两次日期须为两个不同的1–28日');
  Object.assign(x,{hour:v.hour,minute:v.minute,enabled:!!v.enabled,...(x.frequency==='monthly'?{days:v.days}: {})});audit(s,'调度配置',x.id,{...x});break;
 }
 case 'expedite':{
  ensure(command.confirmed===true,'必须明确确认模拟工厂已接受');const impact=previewExpedite(s);applyExpedite(s);s.feedback.push({id:`FB-${s.feedback.length+1}`,time:s.clock,kind:'工厂接受加急（mock）',impact,nextCheck:addWorkdays(s.clock,1,s.calendar)});audit(s,'加急确认','FT-01',impact);result=impact;break;
 }
 case 'receipt':{
  const l=find(command.lotId);ensure(!['closed','shipped','paused'].includes(l.status)&&l.quality!=='hold','批次不可回货');ensure(l.stage!=='成品库存','已是成品库存');ensure(positive(command.quantity)&&command.quantity<=Math.floor(l.quantity*(l.unit==='wafer'?l.grossDiePerWafer:1)),'回货数量超出物料数量');
  ensure(['成品测试','质量放行'].includes(l.stage)&&l.unit==='pcs','必须先完成晶圆/封装路线，才可登记成品回货');
  ensure(command.released===true,'必须提供模拟质量放行确认');
  const id=`FG-${l.id}`;ensure(!s.lots.some(x=>x.id===id),'该批次已回货');
  const actual=command.quantity;l.status='closed';s.lots.push({...clone(l),id,quantity:actual,unit:'pcs',stage:'成品库存',factory:'中心仓',sourceId:'erp',quality:'released',status:'active',frozen:0,unusable:0,remainingYield:1,remainingRoute:[],promisedDate:null,promiseConfirmed:false,enteredAt:s.clock,observedAt:s.clock,reservedOrder:l.reservedOrder,parentId:l.id});
  s.receipts.push({id:`RC-${s.receipts.length+1}`,lotId:l.id,inventoryId:id,quantity:actual,time:s.clock});s.lineage.push({kind:'回货',parents:[l.id],children:[id],quantity:actual,unit:'pcs',time:s.clock});audit(s,'实际回货',l.id,{inventoryId:id,quantity:actual});result={inventoryId:id};break;
 }
 case 'ship':{
  const l=find(command.lotId);const o=plan(s).orders.find(o=>o.id===command.orderId);ensure(o,'订单不存在');ensure(l.stage==='成品库存'&&l.quality==='released'&&l.status==='active','仅可发已放行成品');
  const alloc=o.allocations.find(a=>a.lotId===l.id);ensure(positive(command.quantity)&&command.quantity<=o.open&&command.quantity<=(alloc?.quantity||0),'超过该订单可分配数量');
  ensure(o.allowPartial||command.quantity===o.open,'订单不允许分批');l.quantity-=command.quantity;if(l.quantity===0)l.status='shipped';
  const ship={id:`SHIP-${s.shipments.length+1}`,lotId:l.id,orderId:o.id,quantity:command.quantity,time:s.clock,status:'在途',source:l.factory==='中心仓'?'仓库发货':'工厂直发'};s.shipments.push(ship);audit(s,ship.source,l.id,ship);result=ship;break;
 }
 case 'delivered':{const x=s.shipments.find(x=>x.id===command.shipmentId);ensure(x,'出货记录不存在');x.status='已签收';x.receivedAt=s.clock;audit(s,'客户签收',x.id,{quantity:x.quantity});break;}
 case 'split':{
  const l=find(command.lotId);ensure(l.status==='active'&&positive(command.quantity)&&command.quantity<l.quantity,'拆分数量必须小于在制数量');const id=command.childId;ensure(typeof id==='string'&&/^[A-Za-z0-9-]{1,50}$/.test(id)&&!s.lots.some(x=>x.id===id),'子批次编号无效或重复');
  ensure(!l.frozen&&!l.unusable,'含冻结或损失量的批次需先处理质量数量');l.quantity-=command.quantity;s.lots.push({...clone(l),id,quantity:command.quantity,parentId:l.id});s.lineage.push({kind:'拆分',parents:[l.id],children:[id],quantity:command.quantity,unit:l.unit,time:s.clock});audit(s,'拆分',l.id,{child:id,quantity:command.quantity});break;
 }
 case 'merge':{
  ensure(Array.isArray(command.lotIds)&&command.lotIds.length===2&&new Set(command.lotIds).size===2,'请选择两个不同批次');const [a,b]=command.lotIds.map(find);
  ensure(a.status==='active'&&b.status==='active'&&['pn','die','unit','stage','factory','quality','reservedOrder','sourceId'].every(k=>a[k]===b[k])&&JSON.stringify(a.remainingRoute)===JSON.stringify(b.remainingRoute),'仅同PN/Die/单位/工序/工厂/质量/预留/路线批次可合并');
  a.quantity+=b.quantity;a.frozen+=b.frozen;a.unusable+=b.unusable;b.status='closed';s.lineage.push({kind:'合并',parents:[b.id],children:[a.id],quantity:b.quantity,unit:b.unit,time:s.clock});audit(s,'合并',a.id,{from:b.id,quantity:b.quantity});break;
 }
 case 'pause':{const l=find(command.lotId);ensure(l.status==='active'||l.status==='paused','当前状态不可切换暂停');l.status=l.status==='paused'?'active':'paused';audit(s,'暂停/恢复',l.id,{status:l.status});break;}
 case 'rework':{const l=find(command.lotId);ensure(l.status==='active'&&l.quality!=='hold'&&l.unit==='pcs'&&['封装','成品测试'].includes(l.stage),'仅可对未冻结封装/测试批次登记返工');l.status='rework';l.remainingRoute.unshift({name:'返工复测',queue:[0,1],duration:[1,2]});audit(s,'返工',l.id,{route:l.remainingRoute});break;}
 case 'transfer':{const l=find(command.lotId);ensure(l.status==='active'&&l.stage==='封装','仅模拟封装完成转测试');l.stage='成品测试';l.factory='启明测试';l.sourceId='test';l.enteredAt=s.clock;l.remainingRoute=l.remainingRoute.filter(x=>x.name!=='封装');audit(s,'跨厂流转',l.id,{to:l.factory});break;}
 case 'release':{
  const l=find(command.lotId);const part=s.parts.find(x=>x.id===command.pn);ensure(l.stage==='Die 库存'&&l.status==='active'&&l.unit==='die'&&l.quality!=='hold','仅可对可用Die库存投料');ensure(part&&part.die===l.die&&l.compatiblePns.includes(part.id),'PN与Die或路线不兼容');ensure(positive(command.quantity)&&command.quantity<=l.quantity-l.frozen-l.unusable,'投料数量不足');
  const master=(s.routes||seed().routes).find(r=>r.id===part.routeId);ensure(master,'加工路线缺失');
  const id=`REL-${s.lineage.length+1}`;l.quantity-=command.quantity;s.lots.push({...clone(l),id,pn:part.id,quantity:command.quantity,unit:'pcs',stage:'封装',sourceId:'assembly',factory:'华成封装',parentId:l.id,enteredAt:s.clock,workOrderId:`WO-${id}`,routeId:part.routeId,remainingRoute:clone(master.steps),promisedDate:null,promiseConfirmed:false});s.purchaseOrders.push({id:`PPO-${id}`,workOrderId:`WO-${id}`,lotId:id,supplier:'华成封装',kind:'模拟加工投料',quantity:command.quantity,unit:'die'});s.lineage.push({kind:'投料',parents:[l.id],children:[id],quantity:command.quantity,unit:'die',pn:part.id,time:s.clock});audit(s,'模拟投料',l.id,{child:id,pn:part.id,quantity:command.quantity});result={lotId:id};break;
 }
 case 'followup':{const x=s.issues.find(x=>x.id===command.issueId);ensure(x,'异常不存在');ensure(typeof command.note==='string'&&command.note.trim().length>0&&command.note.length<=1000,'请填写1–1000字反馈');ensure(Number.isFinite(Date.parse(command.nextCheck)),'复核时间无效');x.notes.push({time:s.clock,note:command.note});x.nextCheck=command.nextCheck;x.status='following';audit(s,'异常跟进',x.id,{note:command.note,nextCheck:x.nextCheck});break;}
 case 'agent_review':{
  ensure(typeof command.text==='string'&&command.text.length>0&&command.text.length<=4000,'分析需为1–4000字');
  const candidates=[...s.orders,...s.lots,...s.issues,...s.sources].map(x=>x.id);
  ensure(Array.isArray(command.evidenceIds)&&command.evidenceIds.length>0&&command.evidenceIds.every(id=>candidates.includes(id)),'分析必须引用存在的订单、批次、来源或异常');
  s.agentReviews??=[];s.agentReviews.push({id:`REVIEW-${s.agentReviews.length+1}`,time:s.clock,text:command.text,evidenceIds:command.evidenceIds,status:'Agent建议，待人工复核'});audit(s,'Agent分析','review',{evidenceIds:command.evidenceIds});break;
 }
 default:throw Error('不支持的操作');
 }
 // Explicit simulated factory/ERP events also update the mock upstream document, so the next
 // feed confirms the event. Ordinary sync never constructs upstream facts from canonical state.
 if(['expedite','receipt','ship','delivered','split','merge','pause','rework','transfer','release'].includes(command.type)&&s.sourceDocuments){
  for(const source of s.sources){
   const doc=s.sourceDocuments[source.id];
   doc.records=doc.records.filter(r=>r.entity!=='lot');
   doc.records.push(...s.lots.filter(l=>l.sourceId===source.id).map(l=>({entity:'lot',...clone(l)})));
  }
 }
 issueRefresh(s);
 if(command.type==='sync'){
  const r=s.runs.find(r=>r.key===result.key);const p=plan(s);
  r.summary={riskOrders:p.orders.filter(o=>o.gap>0).map(o=>({id:o.id,gap:o.gap,customerId:o.customerId})),dueFollowups:s.issues.filter(i=>i.status!=='resolved'&&Date.parse(i.nextCheck)<=Date.parse(s.clock)).map(i=>i.id),forecastRemaining:p.forecasts.reduce((n,f)=>n+f.remaining,0),recommendationIds:s.recommendations.map(r=>r.id)};result=r;
 }
 return {state:s,result};
}
export function initialState(){const s=seed();s.sourceDocuments=clone(sourceDocuments);issueRefresh(s);return s;}
export function snapshot(s,revision){return {state:s,revision,plan:plan(s),expedite:s.lots.find(x=>x.id==='FT-01')?.status==='active'&&s.lots.find(x=>x.id==='FT-02')?.status==='active'?previewExpedite(s):null};}
