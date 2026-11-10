/* Framework-neutral request service. Production auth/store/execution adapters are NOT configured. */
const crypto = require('node:crypto');
const CATALOG = 'https://catalog.example.invalid/';
const hash = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function response(status, body) { return {status,headers:{'Cache-Control':'no-store','Content-Type':'application/json'},body}; }
function createWorkflowService({authenticate,store,manifest,approverSubject,allowedOrigin,enabled=false}={}) {
 return async function handle(request) {
  if (request.method === 'GET') return response(200,{configured:enabled && !!authenticate && !!store && !!manifest && !!approverSubject && !!allowedOrigin,generationAvailable:false,uploadAvailable:false,mode:'not-connected'});
  if (request.method !== 'POST') return response(405,{error:'method-not-allowed'});
  if (!enabled || !authenticate || !store || !manifest || !approverSubject || !allowedOrigin) return response(503,{error:'workflow-not-connected',submitted:false});
  if (request.origin !== allowedOrigin || request.contentType !== 'application/json') return response(403,{error:'invalid-request-origin-or-content-type'});
  if (typeof request.rawBody !== 'string' || Buffer.byteLength(request.rawBody)>16384) return response(413,{error:'body-too-large'});
  let principal;try {principal=await authenticate(request);} catch {return response(503,{error:'identity-provider-unavailable'});}
  if (!principal?.verified || !principal.subject) return response(401,{error:'authentication-required'});
  if (principal.subject!==approverSubject) return response(403,{error:'approver-required'});
  let data;try {data=JSON.parse(request.rawBody);} catch{return response(400,{error:'invalid-json'});}
  if (!data || Array.isArray(data) || typeof data!=='object')return response(400,{error:'invalid-body'});
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(data.requestKey||''))return response(400,{error:'invalid-request-key'});
  const allowed=data.action==='generate'?['action','requestKey','sku','productRevision','templateVersion','count']:['action','requestKey','assetId','outputSha256','version','target'];
  if(Object.keys(data).some(k=>!allowed.includes(k)))return response(400,{error:'unexpected-field'});
  let intent;
  if(data.action==='generate'){
   const product=manifest.products[data.sku];
   if(!product || !product.code || product.identityHold || !product.sourceAssets?.length)return response(409,{error:'product-or-source-unverified'});
   if(data.productRevision!==product.revision || data.templateVersion!==product.templateVersion)return response(409,{error:'stale-product-or-template'});
   if(!Number.isInteger(data.count)||data.count<1||data.count>product.maxImages)return response(400,{error:'invalid-image-count'});
   intent={action:'generate',sku:data.sku,productCode:product.code,productRevision:product.revision,templateVersion:product.templateVersion,count:data.count,sourceAssets:product.sourceAssets,sourceWorkflow:product.sourceWorkflow};
  }else if(data.action==='approve-image'){
   const asset=manifest.assets[data.assetId],product=asset&&manifest.products[asset.sku];
   if(!asset || asset.deleted || !product || product.identityHold || product.code!==asset.productCode)return response(409,{error:'asset-or-product-unavailable'});
   if(data.target!==CATALOG)return response(403,{error:'target-not-allowed'});
   if(!/^[a-f0-9]{64}$/.test(data.outputSha256||'') || data.outputSha256!==asset.outputSha256 || data.version!==asset.version)return response(409,{error:'stale-or-unverified-asset'});
   intent={action:'approve-image',assetId:data.assetId,sku:asset.sku,productCode:asset.productCode,outputSha256:asset.outputSha256,version:asset.version,target:CATALOG};
  }else return response(400,{error:'unknown-action'});
  const idemKey=principal.subject+':'+data.requestKey, requestHash=hash(intent);
  try{
   const receipt=await store.transaction(async tx=>{
    const old=await tx.findReceipt(idemKey);
    if(old){if(old.requestHash!==requestHash)throw Object.assign(new Error('idempotency-key-conflict'),{status:409});return {...old,replayed:true};}
    const receiptId=crypto.randomUUID(),now=new Date().toISOString();
    const record={receiptId,requestHash,actorSubject:principal.subject,createdAt:now,intent,status:'accepted-not-executed',replayed:false};
    // Persistence adapter must commit receipt, approval/request and outbox atomically.
    await tx.saveReceipt(idemKey,record);
    await tx.enqueue({jobId:receiptId,intent,actorSubject:principal.subject,status:'pending',createdAt:now});
    return record;
   });
   return response(202,{receiptId:receipt.receiptId,status:receipt.status,replayed:receipt.replayed,submitted:true,generated:false,uploaded:false,published:false});
  }catch(error){return response(error.status===409?409:503,{error:error.status===409?error.message:'persistence-outcome-unknown',submitted:error.status===409?false:null,retryWithSameRequestKey:true});}
 };
}
module.exports={createWorkflowService,CATALOG};
