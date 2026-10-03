import {clone,plan,dateOnly,addWorkdays} from './planning.mjs';
const check=(v,m)=>{if(!v)throw Error(m);};
export const CASE_STATES={new:'待分析',running:'分析中',review:'待人工决策',vendor:'待工厂确认',tracking:'执行跟踪',verify:'待结果核验',closed:'已关闭'};
export function initAip(s){s.aip??={cases:[],runs:[],requests:[]};return s.aip;}
// Include all competing supply and demand. Audit and AIP writes cannot invalidate their own evidence.
export function evidence(s){return {clock:s.clock,lots:clone(s.lots),orders:clone(s.orders),shipments:clone(s.shipments),sources:clone(s.sources),calendar:clone(s.calendar),parts:clone(s.parts),routes:clone(s.routes)};}
const signature=s=>JSON.stringify(evidence(s));
export function refreshAip(s){
 const a=initAip(s),p=plan(s);
 for(const o of p.orders.filter(o=>o.gap>0)){
  const old=a.cases.find(c=>c.orderId===o.id&&c.status!=='closed');
  if(old){if(old.currentGap!==o.gap){old.trigger={at:s.clock,kind:'交付缺口变化',beforeGap:old.currentGap,afterGap:o.gap,evidence:o.allocations};old.history.push({time:s.clock,text:`交付缺口由 ${old.currentGap} 变为 ${o.gap} 颗`});}old.currentGap=o.gap;old.lastSeen=s.clock;if(['new','review'].includes(old.status))old.lotIds=o.allocations.map(x=>x.lotId);continue;}
  a.cases.push({id:`CASE-${a.cases.length+1}`,orderId:o.id,lotIds:o.allocations.map(x=>x.lotId),title:`${o.id} 交付缺口协调`,owner:o.owner,status:'new',createdAt:s.clock,lastSeen:s.clock,trigger:{kind:'交付缺口',at:s.clock,evidence:o.allocations},currentGap:o.gap,nextCheck:s.clock,history:[],runIds:[]});
 }
 for(const c of a.cases){c.currentGap=p.orders.find(o=>o.id===c.orderId)?.gap??0;c.overdue=c.status!=='closed'&&Date.parse(c.nextCheck)<=Date.parse(s.clock);if(c.status==='tracking'&&s.receipts.some(r=>c.lotIds.includes(r.lotId)))c.status='verify';}
}
function log(s,c,text){c.history.push({time:s.clock,text});}
function candidates(s,c,expedite){
 const p=plan(s),o=p.orders.find(o=>o.id===c.orderId);
 const base=p.orders.map(o=>({orderId:o.id,beforeGap:o.gap,afterGap:o.gap}));
 const plans=[{id:'keep',name:'维持原计划',changes:base,condition:'协商剩余交期；保留现有工厂安排',lotIds:c.lotIds,patches:[],available:true},{id:'split',name:'现货先发',changes:base,condition:`可先发 ${o.stock} 颗；不改变总缺口，仍需协调剩余交期`,lotIds:o.allocations.filter(x=>x.firm).map(x=>x.lotId),patches:[],available:o.allowPartial&&o.stock>0}];
 if(c.lotIds.includes('FT-01')&&s.lots.find(x=>x.id==='FT-01')?.status==='active'&&s.lots.find(x=>x.id==='FT-02')?.status==='active'){
  const alternate=clone(s);expedite(alternate);const after=plan(alternate);
  plans.push({id:'expedite',name:'测试档期加急',changes:p.orders.map(o=>({orderId:o.id,beforeGap:o.gap,afterGap:after.orders.find(x=>x.id===o.id).gap})),condition:'需工厂确认 ATE-A 档期；被挤占订单由采购负责人一并审核',lotIds:['FT-01','FT-02'],patches:alternate.lots.filter(l=>['FT-01','FT-02'].includes(l.id)).map(l=>({id:l.id,remainingRoute:l.remainingRoute,promisedDate:l.promisedDate,promiseConfirmed:true})),available:true});
 }
 plans.push({id:'investigate',name:'其他合格工厂',changes:[],condition:'缺少资格、测试程序与产能证据；仅列调查方向',lotIds:[],patches:[],available:false});
 return plans.map(x=>({...x,cost:null}));
}
export function aipCommand(s,cmd,{expedite}){
 const a=initAip(s),c=a.cases.find(x=>x.id===cmd.caseId);check(c,'处理事项不存在');const getRun=()=>a.runs.find(r=>r.id===c.runIds.at(-1));
 const fresh=r=>check(r&&r.signature===signature(s),'业务证据已变化，请重新分析后审核');
 if(cmd.type==='aip_start'){
  check(!['tracking','closed'].includes(c.status),'当前事项需先完成工厂反馈或执行复核');
  if(c.status==='vendor'){const old=a.requests.find(q=>q.id===c.requestId);if(old)old.status='superseded';log(s,c,'业务重新分析，原模拟协调请求撤回');}
  const r={id:`AIP-${a.runs.length+1}`,caseId:c.id,at:s.clock,snapshot:evidence(s),signature:signature(s),steps:[],status:'running',plans:[]};a.runs.push(r);c.runIds.push(r.id);c.status='running';c.error=null;log(s,c,'启动模拟编排；读取不可变业务快照');return r;
 }
 const r=getRun();
 if(cmd.type==='aip_step'){
  check(c.status==='running'&&r?.status==='running','没有待执行分析');check(cmd.index===r.steps.filter(x=>x.status==='succeeded').length,'步骤已执行或顺序不正确');
  const names=['读取订单与批次','核对来源与约束','计算供需影响','生成并验证候选方案'];const tools=['read_business_snapshot','validate_evidence','allocate_supply_and_estimate','compare_candidate_plans'];
  const i=cmd.index;check(i<4,'分析已经结束');const started=Date.now();
  try{
   check(!cmd.simulateFailure,'模拟工具暂不可用，请重试分析');fresh(r);
   const p=plan(s),o=p.orders.find(x=>x.id===c.orderId);check(o,'订单不存在');
   let output;
   if(i===0)output={orderId:o.id,lotIds:c.lotIds,open:o.open,sourceTimes:s.sources.map(x=>({id:x.id,observedAt:x.observedAt}))};
   if(i===1){const stale=s.sources.filter(x=>Date.parse(s.clock)-Date.parse(x.observedAt)>x.maxAgeHours*3600000);check(!stale.length,`来源过期：${stale.map(x=>x.id).join('、')}；请同步后重算`);check(!s.quarantine.length,'存在待核对来源记录，请核实后重算');output={allowPartial:o.allowPartial,qualityHolds:p.lots.filter(x=>x.quality==='hold').map(x=>x.id),units:'wafer / die / pcs 分开核算'};}
   if(i===2)output={open:o.open,stock:o.stock,expected:o.expected,gap:o.gap,allocations:o.allocations};
   if(i===3){r.plans=candidates(s,c,expedite);output=r.plans;r.status='succeeded';c.status='review';}
   r.steps.push({index:i,name:names[i],tool:tools[i],inputs:[c.orderId,...c.lotIds],at:s.clock,durationMs:Date.now()-started,status:'succeeded',output});
  }catch(e){r.steps.push({index:i,name:names[i],tool:tools[i],at:s.clock,status:'failed',error:e.message});r.status='failed';c.status='review';c.error=e.message;log(s,c,e.message);}
  return r;
 }
 if(cmd.type==='aip_approve'){
  check(c.status==='review'&&r?.status==='succeeded','请先完成分析');fresh(r);const p=r.plans.find(p=>p.id===cmd.planId);check(p?.available,'方案当前不可执行');check(typeof cmd.reason==='string'&&cmd.reason.trim().length>0&&cmd.reason.length<=1000,'需要审核理由');
  c.selectedPlan=p.id;c.approval={at:s.clock,reason:cmd.reason,runId:r.id};c.error=null;
  const q={id:`REQ-${a.requests.length+1}`,caseId:c.id,runId:r.id,plan:clone(p),status:'approved',at:s.clock};a.requests.push(q);c.requestId=q.id;c.status='vendor';c.nextCheck=new Date(Date.parse(s.clock)+6*3600000).toISOString();log(s,c,'内部审核通过，尚未提交工厂');return q;
 }
 const q=a.requests.find(q=>q.id===c.requestId);
 if(cmd.type==='aip_submit'){check(c.status==='vendor'&&q?.status==='approved','请求不是待提交状态');fresh(r);q.status='submitted';q.submittedAt=s.clock;log(s,c,'已模拟提交协调请求，等待工厂确认');return q;}
 if(cmd.type==='aip_reply'){
  check(c.status==='vendor'&&q?.status==='submitted','请先提交协调请求');check(['accepted','rejected','partial'].includes(cmd.reply),'工厂反馈无效');check(typeof cmd.note==='string'&&cmd.note.trim()&&cmd.note.length<=1000,'请记录反馈依据');fresh(r);
  q.status=cmd.reply;q.reply={at:s.clock,note:cmd.note};log(s,c,`工厂反馈：${cmd.reply}；${cmd.note}`);
  if(cmd.reply==='rejected'){c.status='review';c.error='工厂拒绝，请重新选择或重新分析';return q;}
  if(cmd.reply==='partial'){
   check(q.plan.id==='expedite','仅加急方案支持档期部分接受');check(/^\d{4}-\d{2}-\d{2}$/.test(cmd.date)&&Number.isFinite(Date.parse(cmd.date))&&cmd.date>=dateOnly(s.clock),'请填写有效的工厂替代日期');
   const v=clone(q.plan);v.id=`partial-${q.id}`;v.name='工厂替代档期';v.condition=`工厂仅接受 ${cmd.date} 回货，需重新审核影响`;
   v.patches=v.patches.map(l=>l.id==='FT-01'?{...l,promisedDate:cmd.date,remainingRoute:[{name:'工厂替代档期（mock）',queue:[0,0],duration:[0,0],confirmedStart:cmd.date}]}:l);
   const alt=clone(s);for(const patch of v.patches)Object.assign(alt.lots.find(l=>l.id===patch.id),patch);const p=plan(alt);v.changes=plan(s).orders.map(o=>({orderId:o.id,beforeGap:o.gap,afterGap:p.orders.find(x=>x.id===o.id).gap}));r.plans.push(v);c.status='review';c.error='工厂提出替代日期，原计划未生效；请审核替代方案';return q;
  }
  for(const patch of q.plan.patches)Object.assign(s.lots.find(l=>l.id===patch.id),clone(patch));
  c.status='tracking';c.executionBaseline={receipts:s.receipts.map(x=>x.id),shipments:s.shipments.map(x=>x.id)};c.executionStarted=s.clock;c.lotIds=[...new Set([...c.lotIds,...q.plan.lotIds])];c.nextCheck=new Date(Date.parse(s.clock)+6*3600000).toISOString();log(s,c,'模拟工厂已接受；确认计划更新，尚未回货或出货');return q;
 }
 if(cmd.type==='aip_recheck'){
  check(['tracking','verify','vendor'].includes(c.status),'当前状态无需执行复核');
  const o=plan(s).orders.find(x=>x.id===c.orderId),receipts=s.receipts.filter(x=>!c.executionBaseline?.receipts.includes(x.id)&&c.lotIds.includes(x.lotId)&&s.lots.find(l=>l.id===x.lotId)?.pn===o.pn&&(!c.executionStarted||Date.parse(x.time)>=Date.parse(c.executionStarted))),shipments=s.shipments.filter(x=>!c.executionBaseline?.shipments.includes(x.id)&&x.orderId===c.orderId&&(!c.executionStarted||Date.parse(x.time)>=Date.parse(c.executionStarted)));
  c.verification={signature:signature(s),at:s.clock,receipts:clone(receipts),shipments:clone(shipments),gap:o.gap,open:o.open,actual:receipts.reduce((n,x)=>n+x.quantity,0),expected:r?.snapshot.lots.filter(l=>receipts.some(x=>x.lotId===l.id)).reduce((n,x)=>n+Math.floor(x.quantity*(x.remainingYield??1)),0)||0};
  if(c.status!=='vendor'&&(receipts.length||shipments.length))c.status='verify';c.nextCheck=new Date(Date.parse(s.clock)+6*3600000).toISOString();log(s,c,receipts.length||shipments.length?'已读取实际回货与出货，等待人工核验':'尚无实际结果；继续跟进，不自动结案');return c.verification;
 }
 if(cmd.type==='aip_close'){
  check(c.status==='verify'&&c.verification,'需先读取实际结果');check(c.verification.signature===signature(s),'业务证据已变化，请重新复核');check(c.verification.receipts.length||c.verification.shipments.length,'没有实际凭证');check(cmd.reason?.trim()&&cmd.reason.length<=1000,'请记录核验结论及剩余缺口交接');

  c.status='closed';c.closedAt=s.clock;log(s,c,`实际结果已核验：${cmd.reason}`);return c;
 }
 throw Error('不支持的 AIP 操作');
}
