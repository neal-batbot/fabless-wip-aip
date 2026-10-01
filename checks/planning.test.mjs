import test from 'node:test';
import assert from 'node:assert/strict';
import {plan, expectedUnits, estimate, anomalies} from '../core/planning.mjs';
const base=()=>({clock:'2026-10-01T09:00:00+08:00',calendar:{weekends:[0,6],holidays:[]},shipments:[],sources:[],quarantine:[],forecasts:[],orders:[],lots:[]});
const lot=(extra={})=>({id:'FT1',pn:'PN-A',quantity:100,unit:'pcs',stage:'成品库存',quality:'released',remainingYield:1,status:'active',remainingRoute:[],...extra});
const order=(extra={})=>({id:'SO1',customerId:'C1',projectId:'P1',pn:'PN-A',quantity:60,cancelled:0,due:'2026-10-02',demandMonth:'2026-10',priority:1,...extra});
test('预测100万/订单60万/出货20万：未来覆盖80万',()=>{
 const s=base();s.orders=[order({quantity:600000})];s.shipments=[{orderId:'SO1',quantity:200000}];s.forecasts=[{customerId:'C1',projectId:'P1',pn:'PN-A',month:'2026-10',quantity:1000000,active:true}];
 const p=plan(s);assert.equal(p.orders[0].open,400000);assert.equal(p.forecasts[0].remaining,400000);assert.equal(p.futureDemand,800000);
});
test('不同订单不能重复使用同一批供给；冻结量排除',()=>{
 const s=base();s.lots=[lot({frozen:20})];s.orders=[order(),order({id:'SO2'})];const p=plan(s);
 assert.equal(p.orders[0].stock,60);assert.equal(p.orders[1].stock,20);assert.equal(p.orders[1].gap,40);assert.equal(p.lots[0].allocated,80);
});
test('质量冻结、已转出、不同完整PN不能覆盖需求',()=>{
 const s=base();s.lots=[lot({quality:'hold'}),lot({id:'X',status:'closed'}),lot({id:'Y',pn:'PN-B'})];s.orders=[order()];assert.equal(plan(s).orders[0].gap,60);
});
test('晶圆片数需转换且缺失转换率不能猜测',()=>{
 assert.equal(expectedUnits(lot({quantity:2,unit:'wafer',grossDiePerWafer:5000,remainingYield:0.9})),9000);
 assert.equal(expectedUnits(lot({unit:'wafer'})),null);
});
test('交期累加工序排队/加工并跳过非工作日，未知路线返回待确认',()=>{
 const s=base();const l=lot({remainingRoute:[{name:'测试',queue:[1,2],duration:[1,2]}]});const e=estimate(l,s);
 assert.equal(e.earliest,'2026-10-05');assert.equal(e.latest,'2026-10-07');assert.ok(e.conditions.length);
 assert.equal(estimate(lot({remainingRoute:[{name:'测试'}]}),s).latest,null);
});
test('缺报不冒充生产停滞；新鲜来源才能判断停滞',()=>{
 const s=base();s.sources=[{id:'OSAT',observedAt:'2026-09-28T09:00:00+08:00',maxAgeHours:24}];s.lots=[lot({sourceId:'OSAT',enteredAt:'2026-09-27T09:00:00+08:00',maxDwellHours:48})];
 assert.deepEqual(anomalies(s).map(a=>a.kind),['数据未更新']);s.sources[0].observedAt=s.clock;assert.deepEqual(anomalies(s).map(a=>a.kind),['生产停滞']);
});
