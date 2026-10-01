import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
export function localDb(filename){
 const sqlite=new DatabaseSync(filename);sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
 sqlite.exec('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
 for(const name of fs.readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort()){
  if(!sqlite.prepare('SELECT name FROM local_migrations WHERE name=?').get(name)){sqlite.exec('BEGIN');try{sqlite.exec(fs.readFileSync(new URL(`../drizzle/${name}`,import.meta.url),'utf8'));sqlite.prepare('INSERT INTO local_migrations VALUES (?)').run(name);sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}
 }
 const prepare=sql=>{let args=[];const statement={bind(...a){args=a;return statement;},async first(){return sqlite.prepare(sql).get(...args)||null;},runSync(){return sqlite.prepare(sql).run(...args);},async run(){return statement.runSync();}};return statement;};
 return {prepare,async batch(statements){sqlite.exec('BEGIN IMMEDIATE');try{const rows=statements.map(s=>s.runSync());sqlite.exec('COMMIT');return rows;}catch(e){sqlite.exec('ROLLBACK');throw e;}},close:()=>sqlite.close()};
}
