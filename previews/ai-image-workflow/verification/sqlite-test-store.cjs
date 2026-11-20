// LOCAL TEST ADAPTER ONLY. Vercel/serverless local disks are not a durable production database.
const {DatabaseSync}=require('node:sqlite');
function openTestStore(file){
 const db=new DatabaseSync(file);let tail=Promise.resolve();
 db.exec('CREATE TABLE IF NOT EXISTS receipts (key TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, data TEXT NOT NULL);');
 const api={close:()=>db.close(),count:()=>Number(db.prepare('SELECT COUNT(*) AS n FROM outbox').get().n)};
 api.transaction=fn=>{
  const run=tail.then(async()=>{
   db.exec('BEGIN IMMEDIATE');
   try{
    const result=await fn({
     findReceipt:key=>{const r=db.prepare('SELECT data FROM receipts WHERE key=?').get(key);return r?JSON.parse(r.data):null},
     saveReceipt:(key,value)=>db.prepare('INSERT INTO receipts(key,data) VALUES (?,?)').run(key,JSON.stringify(value)),
     enqueue:value=>db.prepare('INSERT INTO outbox(id,data) VALUES (?,?)').run(value.jobId,JSON.stringify(value))
    });db.exec('COMMIT');return result;
   }catch(e){db.exec('ROLLBACK');throw e;}
  });tail=run.catch(()=>{});return run;
 };
 return api;
}
module.exports={openTestStore};
