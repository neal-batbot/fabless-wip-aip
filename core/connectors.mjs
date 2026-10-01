// A connector returns an envelope; it never edits allocations, orders, or canonical lots.
export function parseCsv(text){
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
 else if(c===','&&!quoted){row.push(cell);cell='';}else if(c==='\n'&&!quoted){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}else cell+=c;}
 if(quoted)throw Error('CSV引号未闭合');if(cell||row.length){row.push(cell);rows.push(row);}const [headers,...data]=rows;return data.filter(r=>r.some(Boolean)).map(r=>{if(r.length!==headers.length)throw Error('CSV列数不一致');return Object.fromEntries(headers.map((h,i)=>[h,r[i]]));});
}
export function vendorCsvEnvelope(text,{sourceId,eventId,observedAt},knownLots){
 return {sourceId,eventId,observedAt,records:parseCsv(text).map(r=>{
  const base=knownLots.find(l=>l.id===r.lot_no);
  // Route comes from the approved master, not a vendor's free text. Unknown IDs remain isolated.
  return {...structuredClone(base||{}),entity:'lot',id:r.lot_no,pn:r.part_number||null,quantity:Number(r.qty),unit:r.uom,stage:r.operation,factory:r.factory,observedAt:r.source_updated_at,promisedDate:r.promise_date,quality:r.quality,workOrderId:r.work_order};
 })};
}
