import fs from 'node:fs/promises';import {seed,sourceFixture} from '../core/seed.mjs';
await fs.mkdir('mock',{recursive:true});const s=seed();const docs={};
for(const source of s.sources){const doc=sourceFixture(s,source.id);docs[source.id]=doc;await fs.writeFile(`mock/${source.id}.json`,JSON.stringify(doc,null,2)+'\n');
 if(source.format==='CSV'){const heads=['lot_no','part_number','qty','uom','operation','factory','source_updated_at','promise_date','quality','work_order'];const cols=['id','pn','quantity','unit','stage','factory','observedAt','promisedDate','quality','workOrderId'];const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';await fs.writeFile(`mock/${source.id}.csv`,[heads.join(','),...doc.records.map(r=>cols.map(k=>quote(r[k])).join(','))].join('\n')+'\n');}
}await fs.writeFile('mock/feeds.json',JSON.stringify(docs,null,2)+'\n');console.log('Six independent source fixtures exported, including three vendor CSVs.');
