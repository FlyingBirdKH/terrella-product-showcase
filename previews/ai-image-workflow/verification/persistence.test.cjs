const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openTestStore}=require('./sqlite-test-store.cjs');
test('receipt and queue survive closing and reopening disk database',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'terrella-workflow-')),file=path.join(dir,'test.sqlite');let store=openTestStore(file);
 await store.transaction(async tx=>{await tx.saveReceipt('key',{receiptId:'receipt1'});await tx.enqueue({jobId:'receipt1'})});store.close();
 store=openTestStore(file);assert.deepEqual(await store.transaction(tx=>tx.findReceipt('key')),{receiptId:'receipt1'});assert.equal(store.count(),1);store.close();
});
test('failure between receipt and event rolls back both',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'terrella-workflow-'));const store=openTestStore(path.join(dir,'test.sqlite'));
 await assert.rejects(()=>store.transaction(async tx=>{await tx.saveReceipt('key',{receiptId:'r1'});throw new Error('simulated interruption')}));
 assert.equal(await store.transaction(tx=>tx.findReceipt('key')),null);assert.equal(store.count(),0);store.close();
});
test('duplicate outbox id cannot create second queued event',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'terrella-workflow-'));const store=openTestStore(path.join(dir,'test.sqlite'));
 await store.transaction(tx=>tx.enqueue({jobId:'r1'}));await assert.rejects(()=>store.transaction(tx=>tx.enqueue({jobId:'r1'})));assert.equal(store.count(),1);store.close();
});
