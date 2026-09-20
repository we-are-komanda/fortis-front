import assert from "node:assert/strict";
import {test} from "node:test";
import {GET} from "@/app/api/runtime/route";
test("persistent drafts follow delivery policy and invalid policy fails closed",async()=>{
 const oldMode=process.env.FORTIS_RUNTIME_MODE;const oldFlag=process.env.FORTIS_LOCAL_DRAFTS_ENABLED;
 try{
 process.env.FORTIS_RUNTIME_MODE="workspace";delete process.env.FORTIS_LOCAL_DRAFTS_ENABLED;
 assert.deepEqual(await GET().json(),{mode:"workspace",localDraftsEnabled:false});
 process.env.FORTIS_LOCAL_DRAFTS_ENABLED="true";assert.equal((await GET().json()).localDraftsEnabled,true);
 process.env.FORTIS_LOCAL_DRAFTS_ENABLED="false";assert.equal((await GET().json()).localDraftsEnabled,false);
 process.env.FORTIS_LOCAL_DRAFTS_ENABLED="typo";assert.equal(GET().status,503);
 delete process.env.FORTIS_LOCAL_DRAFTS_ENABLED;process.env.FORTIS_RUNTIME_MODE="demo";assert.equal((await GET().json()).localDraftsEnabled,true);
 }finally{if(oldMode===undefined)delete process.env.FORTIS_RUNTIME_MODE;else process.env.FORTIS_RUNTIME_MODE=oldMode;if(oldFlag===undefined)delete process.env.FORTIS_LOCAL_DRAFTS_ENABLED;else process.env.FORTIS_LOCAL_DRAFTS_ENABLED=oldFlag;}
});
