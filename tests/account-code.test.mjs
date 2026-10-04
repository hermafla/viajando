import test from 'node:test';
import assert from 'node:assert/strict';
import verify from '../api/account-verify-code.js';
const response=(value,status=200)=>new Response(JSON.stringify(value),{status});
async function request(){const res={code:200,setHeader(){},status(n){this.code=n;return this},json(value){this.data=value;return this}};await verify({method:'POST',body:{email:'test@example.test',code:'123456'}},res);return res}
async function run(fn,job){process.env.SUPABASE_URL='https://database.test';process.env.SUPABASE_SECRET_KEY='test-only';const old=fetch;globalThis.fetch=fn;try{return await job()}finally{globalThis.fetch=old}}
const row={id:'code-test',vence_en:new Date(Date.now()+600000).toISOString(),usado:false};
test('account login consumes a code atomically before issuing a session',async()=>{
  let claimed=false;await run(async(url,options)=>{if(options.method==='PATCH'){assert.ok(url.includes('usado=eq.false'));assert.ok(url.includes('vence_en=gt.'));assert.equal(options.headers.Prefer,'return=representation');claimed=true;return response([row])}return response([row])},async()=>{const answer=await request();assert.equal(answer.code,200);assert.ok(answer.data.token);assert.equal(claimed,true)});
});
test('a failed code update never grants an account session',async()=>{
  await run(async(url,options)=>options.method==='PATCH'?response({},503):response([row]),async()=>{const answer=await request();assert.equal(answer.code,503);assert.equal(answer.data.token,undefined)});
});
test('a code consumed in another request cannot issue a second session',async()=>{
  await run(async(url,options)=>options.method==='PATCH'?response([]):response([row]),async()=>{const answer=await request();assert.equal(answer.code,401);assert.equal(answer.data.token,undefined)});
});
