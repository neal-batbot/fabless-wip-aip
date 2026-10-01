export const STAGES = ['晶圆制造', '晶圆测试', 'Die 库存', '封装', '成品测试', '质量放行', '成品库存', '客户在途', '已交付'];
export const clone = value => structuredClone(value);
export const dateOnly = value => value.length===10 ? value : new Date(Date.parse(value)+8*3600000).toISOString().slice(0,10);
export function addWorkdays(date, days, calendar = { weekends: [0, 6], holidays: [] }) {
  const d = new Date(`${dateOnly(date)}T00:00:00Z`);
  if (!Number.isFinite(d.getTime()) || !Number.isFinite(days) || days < 0) throw Error('日期或周期无效');
  let n = Math.ceil(days);
  while (n > 0) { d.setUTCDate(d.getUTCDate() + 1); if (!calendar.weekends.includes(d.getUTCDay()) && !calendar.holidays.includes(dateOnly(d.toISOString()))) n--; }
  return dateOnly(d.toISOString());
}
export function expectedUnits(lot) {
  if (['closed', 'shipped', 'paused'].includes(lot.status)) return 0;
  if (!['wafer', 'die', 'pcs'].includes(lot.unit)) throw Error('不支持的数量单位');
  if (lot.unit === 'wafer' && !(lot.grossDiePerWafer > 0)) return null;
  const base = Math.max(0, lot.quantity - (lot.frozen || 0) - (lot.unusable || 0));
  if (lot.quality === 'hold') return 0;
  return Math.floor(base * (lot.unit === 'wafer' ? lot.grossDiePerWafer : 1) * (lot.remainingYield ?? 1));
}
export function estimate(lot, state) {
  if (['closed','shipped','paused'].includes(lot.status)) return { earliest: null, latest: null, conditions: ['该批次已转出或暂停'] };
  if (lot.quality === 'hold') return { earliest: null, latest: null, conditions: ['质量冻结，解除日期待确认'] };
  if(lot.stage!=='成品库存'&&!lot.remainingRoute.length)return {earliest:null,latest:null,conditions:['缺少剩余路线，无法推算交期']};
  let early = dateOnly(state.clock), late = early;
  const conditions = [];
  for (const step of lot.remainingRoute) {
    if (step.confirmedStart) { early = early > step.confirmedStart ? early : step.confirmedStart; late = late > step.confirmedStart ? late : step.confirmedStart; }
    if (!step.confirmedStart) conditions.push(`${step.name}档期未确认`);
    if (!Array.isArray(step.queue) || !Array.isArray(step.duration)) return { earliest: null, latest: null, conditions: [`${step.name}缺少排队或加工周期`] };
    early = addWorkdays(early, step.queue[0] + step.duration[0], state.calendar);
    late = addWorkdays(late, step.queue[1] + step.duration[1], state.calendar);
  }
  if (lot.promisedDate && lot.promiseConfirmed) { early = early > lot.promisedDate ? early : lot.promisedDate; late = late > lot.promisedDate ? late : lot.promisedDate; }
  if (lot.remainingYield < 1) conditions.push('最终良品数量待实测');
  if (lot.quality !== 'released') conditions.push('质量放行待确认');
  return { earliest: early, latest: late, conditions: [...new Set(conditions)] };
}
export function plan(state) {
  const lots = state.lots.map(l => ({ ...l, expected: expectedUnits(l), eta: estimate(l, state) }));
  const available = new Map(lots.map(l => [l.id, l.expected || 0]));
  const rows = [];
  const sorted = [...state.orders].sort((a,b) => a.priority-b.priority || a.due.localeCompare(b.due) || a.id.localeCompare(b.id));
  for (const order of sorted) {
    const shipped = state.shipments.filter(s => s.orderId === order.id).reduce((n,s) => n+s.quantity,0);
    const open = Math.max(0,order.quantity-order.cancelled-shipped);
    let left = open, stock = 0, expected = 0;
    const allocations = [];
    const candidates = lots.filter(l => l.pn === order.pn && (!l.authorizedCustomer || l.authorizedCustomer === order.customerId))
      .sort((a,b) => (a.reservedOrder === order.id ? -1:0)-(b.reservedOrder === order.id ? -1:0) || (a.eta.latest||'9999').localeCompare(b.eta.latest||'9999'));
    for (const lot of candidates) {
      if (lot.reservedOrder && lot.reservedOrder !== order.id) continue;
      const take = Math.min(left, available.get(lot.id));
      if (!take) continue;
      left -= take; available.set(lot.id, available.get(lot.id)-take);
      const onTime = !!lot.eta.latest && lot.eta.latest <= order.due;
      const firm = lot.stage === '成品库存' && lot.quality === 'released';
      if (onTime) { if (firm) stock+=take; else expected+=take; }
      allocations.push({lotId:lot.id,quantity:take,onTime,firm,...lot.eta});
    }
    rows.push({...order,shipped,open,stock,expected,gap:Math.max(0,open-stock-expected),unallocated:left,allocations});
  }
  const forecasts = state.forecasts.filter(f => f.active).map(f => {
    const consumed = state.orders.filter(o => o.customerId===f.customerId && o.projectId===f.projectId && o.pn===f.pn && o.demandMonth===f.month).reduce((n,o)=>n+o.quantity-o.cancelled,0);
    return {...f,consumed,remaining:Math.max(0,f.quantity-consumed)};
  });
  return {orders:rows, forecasts, lots:lots.map(l=>({...l,allocated:(l.expected||0)-available.get(l.id),unallocated:available.get(l.id)})), futureDemand:rows.reduce((n,o)=>n+o.open,0)+forecasts.reduce((n,f)=>n+f.remaining,0)};
}
export function anomalies(state) {
  const output = [];
  const p = plan(state);
  for (const source of state.sources) {
    if (Date.parse(state.clock)-Date.parse(source.observedAt)>source.maxAgeHours*3600000) output.push({key:`stale:${source.id}`,kind:'数据未更新',subject:source.id,reason:`最新源时间 ${source.observedAt}`,owner:'数据对接',nextAction:'联系数据负责人补报；不把缺报解释为停产'});
  }
  for (const lot of p.lots) {
    if (['closed','shipped'].includes(lot.status)) continue;
    const source=state.sources.find(s=>s.id===lot.sourceId);
    const fresh=source && Date.parse(state.clock)-Date.parse(source.observedAt)<=source.maxAgeHours*3600000;
    if(fresh && Date.parse(state.clock)-Date.parse(lot.enteredAt)>lot.maxDwellHours*3600000) output.push({key:`stalled:${lot.id}`,kind:'生产停滞',subject:lot.id,reason:'数据已更新，但本站停留超过阈值',owner:lot.owner,nextAction:'核对设备、物料、质量与排队原因'});
    if(lot.quality==='hold') output.push({key:`hold:${lot.id}`,kind:'质量冻结',subject:lot.id,reason:'冻结供给已排除',owner:lot.owner,nextAction:'取得质量处置与解除条件'});
  }
  for(const order of p.orders) if(order.gap>0) output.push({key:`gap:${order.id}`,kind:'交付缺口',subject:order.id,reason:`到期缺口 ${order.gap} 颗`,owner:order.owner,nextAction:'核对可先发批次与剩余交期，比较调整方案'});
  for(const q of state.quarantine) output.push({key:`conflict:${q.id}`,kind:'待核对',subject:q.entityId,reason:q.reason,owner:'数据对接',nextAction:'保留最后可信状态，核对原始证据'});
  return output;
}
