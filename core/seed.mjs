// All entities and process parameters are synthetic. October 2026 is a demo calendar, not a factory calendar.
export const CLOCK = '2026-10-01T09:00:00+08:00';
const step=(name,days,extra={})=>({name,queue:[0,0],duration:[days,days],confirmedStart:'2026-10-01',...extra});
const route=(test=1)=>[step('成品测试',test),step('质量放行',1),step('运输',1)];
export const SOURCES = [
 {id:'crm',name:'CRM 客户与项目',format:'JSON',maxAgeHours:48},
 {id:'erp',name:'ERP/OA 订单与库存',format:'JSON',maxAgeHours:24},
 {id:'foundry',name:'远景晶圆周报',format:'CSV',maxAgeHours:168},
 {id:'assembly',name:'华成封装 WIP',format:'CSV',maxAgeHours:24},
 {id:'test',name:'启明测试 WIP',format:'CSV',maxAgeHours:24},
 {id:'manual',name:'运营人工确认',format:'JSON',maxAgeHours:48},
];
export function seed() {
 const customers=[{id:'C-XM',name:'小米（mock）'},{id:'C-BC',name:'北辰电子（mock）'},{id:'C-QH',name:'青禾智能（mock）'}];
 const projects=[{id:'P-PHONE',customerId:'C-XM',name:'手机电源平台',stage:'量产爬坡'},{id:'P-BAND',customerId:'C-XM',name:'手环充电平台',stage:'量产'},{id:'P-AUDIO',customerId:'C-BC',name:'桌面音箱',stage:'量产'},{id:'P-SENSOR',customerId:'C-QH',name:'环境传感器',stage:'试产'}];
 const parts=[{id:'SC6820-Q32-TR',die:'D6820',package:'QFN32',routeId:'R-Q32'},{id:'SC6820-S8-TR',die:'D6820',package:'SOP8',routeId:'R-S8'},{id:'SC3215-Q24-TR',die:'D3215',package:'QFN24',routeId:'R-Q24'},{id:'SC9102-WLCSP-TR',die:'D9102',package:'WLCSP',routeId:'R-WLCSP'}];
 const dealers=[{id:'D-A',name:'安联渠道（mock）',customers:['C-XM'],stockMonths:1.2},{id:'D-B',name:'汇芯渠道（mock）',customers:['C-BC','C-QH'],stockMonths:2}];
 const orders=[
  {id:'SO-1001-1',customerId:'C-XM',projectId:'P-PHONE',pn:parts[0].id,customerPo:'CPO-XM-1001',dealerId:'D-A',quantity:100000,cancelled:0,due:'2026-10-07',demandMonth:'2026-10',priority:1,owner:'陈悦',allowPartial:true},
  {id:'SO-1002-1',customerId:'C-BC',projectId:'P-AUDIO',pn:parts[2].id,customerPo:'CPO-BC-1002',dealerId:'D-B',quantity:20000,cancelled:0,due:'2026-10-07',demandMonth:'2026-10',priority:2,owner:'林浩',allowPartial:true},
  {id:'SO-1003-1',customerId:'C-XM',projectId:'P-BAND',pn:parts[1].id,customerPo:'CPO-XM-1003',dealerId:'D-A',quantity:40000,cancelled:0,due:'2026-10-16',demandMonth:'2026-10',priority:3,owner:'周宁',allowPartial:false},
  {id:'SO-1004-1',customerId:'C-QH',projectId:'P-SENSOR',pn:parts[3].id,customerPo:'CPO-QH-1004',dealerId:'D-B',quantity:8000,cancelled:0,due:'2026-10-08',demandMonth:'2026-10',priority:4,owner:'王蕾',allowPartial:true},
 ];
 const mk=(id,pn,quantity,stage,sourceId,extra={})=>({id,pn,die:parts.find(p=>p.id===pn)?.die||'D6820',quantity,unit:'pcs',stage,sourceId,factory:SOURCES.find(s=>s.id===sourceId)?.name.split(' ')[0]||'中心仓',quality:'pending',frozen:0,unusable:0,status:'active',remainingYield:1,remainingRoute:route(),promisedDate:'2026-10-07',promiseConfirmed:false,observedAt:CLOCK,enteredAt:'2026-09-30T09:00:00+08:00',maxDwellHours:96,owner:'林浩',version:1,workOrderId:`WO-${id}`,sourceRecord:id,...extra});
 const lots=[
  mk('FG-01',parts[0].id,20000,'成品库存','erp',{factory:'中心仓',quality:'released',remainingRoute:[],reservedOrder:'SO-1001-1'}),
  mk('FT-01',parts[0].id,50000,'成品测试','test',{remainingRoute:route(),reservedOrder:'SO-1001-1',resource:'ATE-A'}),
  mk('AS-01',parts[0].id,30000,'封装','assembly',{remainingRoute:[step('封装',2),...route()],reservedOrder:'SO-1001-1',resource:'ATE-A',promisedDate:'2026-10-09'}),
  mk('FT-02',parts[2].id,20000,'成品测试','test',{remainingRoute:route(),reservedOrder:'SO-1002-1',resource:'ATE-A'}),
  mk('FG-02',parts[3].id,8000,'成品库存','test',{factory:'启明测试',quality:'released',remainingRoute:[step('直发运输',1)],reservedOrder:'SO-1004-1'}),
  mk('AS-02',parts[1].id,18000,'封装','assembly',{remainingRoute:[step('封装',2),...route(2)],remainingYield:0.98}),
  mk('WF-01',null,12,'晶圆制造','foundry',{unit:'wafer',grossDiePerWafer:6000,remainingYield:0.85,remainingRoute:[step('晶圆制造',8),step('晶圆测试',2),step('封装',3),...route(2)],promisedDate:'2026-10-28',compatiblePns:parts.slice(0,2).map(p=>p.id)}),
  mk('CP-01',null,4,'晶圆测试','foundry',{unit:'wafer',grossDiePerWafer:6000,remainingYield:0.9,remainingRoute:[step('晶圆测试',2),step('封装',3),...route()],compatiblePns:parts.slice(0,2).map(p=>p.id)}),
  mk('DIE-01',null,60000,'Die 库存','foundry',{unit:'die',remainingYield:0.98,remainingRoute:[step('封装',3),...route()],compatiblePns:parts.slice(0,2).map(p=>p.id)}),
  mk('HOLD-01',parts[2].id,10000,'成品测试','test',{quality:'hold',frozen:10000,enteredAt:'2026-09-24T09:00:00+08:00'}),
  mk('RW-01',parts[1].id,5000,'封装','assembly',{status:'rework',remainingRoute:[step('返工',2),...route()],remainingYield:0.9,enteredAt:'2026-09-23T09:00:00+08:00'}),
 ];
 return {schemaVersion:1,clock:CLOCK,calendar:{weekends:[0,6],holidays:[],label:'mock 五日工作制；真实工厂日历待确认'},customers,projects,parts,dealers,orders,lots,
  routes:[{id:'R-Q32',steps:[step('封装',3),...route(1)]},{id:'R-S8',steps:[step('封装',2),...route(2)]},{id:'R-Q24',steps:[step('封装',3),...route(2)]},{id:'R-WLCSP',steps:[step('封装',2),...route(3)]}],
  forecasts:[{id:'FC-V2',version:2,active:true,customerId:'C-XM',projectId:'P-PHONE',pn:parts[0].id,month:'2026-10',quantity:160000},{id:'FC-V1',version:1,active:false,customerId:'C-XM',projectId:'P-PHONE',pn:parts[0].id,month:'2026-10',quantity:200000},{id:'FC-BAND',version:1,active:true,customerId:'C-XM',projectId:'P-BAND',pn:parts[1].id,month:'2026-10',quantity:60000}],
  purchaseOrders:lots.filter(l=>l.stage!=='成品库存').map(l=>({id:`PPO-${l.id}`,workOrderId:l.workOrderId,lotId:l.id,supplier:l.factory,kind:l.unit==='wafer'?'晶圆采购':'外协加工',quantity:l.quantity,unit:l.unit})),
  sources:SOURCES.map(s=>({...s,observedAt:CLOCK,ingestedAt:CLOCK,version:1,connector:'mock'})),shipments:[],lineage:[],quarantine:[],issues:[],history:[],feedback:[],runs:[],receipts:[],seen:[],syncIndex:0,
  schedules:[{id:'morning',name:'晨间 WIP',hour:9,minute:0,frequency:'daily',enabled:true},{id:'afternoon',name:'急件复核',hour:15,minute:0,frequency:'daily',enabled:true},{id:'weekly',name:'周供需计划',hour:9,minute:30,frequency:'weekly',weekday:1,enabled:true},{id:'wafer',name:'晶圆采购建议',hour:10,minute:0,frequency:'monthly',days:[5,20],enabled:true}],
  execution:{mode:'mock-rules',timezone:'Asia/Shanghai',notifications:'仅工作台，不向外部发送',scheduler:'待启动本地调度器；演示推进不依赖浏览器计时器'},recommendations:[]};
}

export function sourceFixture(state,sourceId,{scenario='normal',index=state.syncIndex+1}={}) {
 const envelope={sourceId,eventId:`${sourceId}:${scenario}:${index}`,observedAt:state.clock,version:index+1,records:[]};
 if(sourceId==='crm') envelope.records=[...state.customers.map(x=>({entity:'customer',...x})),...state.projects.map(x=>({entity:'project',...x})),...state.forecasts.map(x=>({entity:'forecast',...x}))];
 else if(sourceId==='erp') envelope.records=[...state.orders.map(x=>({entity:'order',...x})),...state.lots.filter(l=>l.sourceId==='erp').map(x=>({entity:'lot',...x}))];
 else if(sourceId==='manual') envelope.records=state.feedback.map(x=>({entity:'feedback',...x}));
 else envelope.records=state.lots.filter(l=>l.sourceId===sourceId).map(x=>({entity:'lot',...x,observedAt:state.clock}));
 // Once initialized, read the independent upstream fixture, not canonical business tables.
 if(state.sourceDocuments?.[sourceId])envelope.records=structuredClone(state.sourceDocuments[sourceId].records).map(r=>r.entity==='lot'?{...r,observedAt:state.clock}:r);
 if(scenario==='stale' && sourceId==='assembly') envelope.observedAt='2026-09-27T09:00:00+08:00';
 if(scenario==='delay' && sourceId==='test') envelope.records=envelope.records.map(x=>x.id==='FT-01'?{...x,promisedDate:'2026-10-12',promiseConfirmed:true,remainingRoute:route(4)}:x);
 if(scenario==='conflict' && sourceId==='test') {envelope.records=envelope.records.filter(r=>r.id!=='UNKNOWN-LOT'&&!(r.id==='FT-01'&&r.quantity<0));envelope.records.push({entity:'lot',id:'FT-01',quantity:-20}, {entity:'lot',id:'UNKNOWN-LOT',pn:'UNKNOWN-PN',quantity:500});}
 return envelope;
}
