// Integration adapter for Vercel. Fail closed until separately approved services are connected.
const {createWorkflowService}=require('./workflow-service.cjs');
const handle=createWorkflowService();
module.exports=async function handler(req,res){
 const result=await handle({method:req.method});
 for(const [key,value] of Object.entries(result.headers))res.setHeader(key,value);
 res.status(result.status).json(result.body);
};
