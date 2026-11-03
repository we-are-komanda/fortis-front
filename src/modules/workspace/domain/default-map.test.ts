import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { openDefaultMap, TEST_ENTERPRISE_ID } from "./default-map";
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });

test("existing project opens without creating or overwriting data", async () => {
 globalThis.fetch = async (input, init) => {
  assert.equal(init?.method ?? "GET", "GET");
  assert.match(String(input), new RegExp(TEST_ENTERPRISE_ID));
  return Response.json({items:[{projectId:"saved",enterpriseId:TEST_ENTERPRISE_ID,version:3}], totalItems:1});
 };
 assert.equal(await openDefaultMap(), "saved");
});
test("concurrent entry creates once and lost response retries exactly the same payload", async () => {
 const writes: {body: unknown; key: string | null}[] = [];
 let loseResponse = true;
 globalThis.fetch = async (_input, init) => {
  if (init?.method !== "POST") return Response.json({items:[],totalItems:0});
  writes.push({body:init.body,key:new Headers(init.headers).get("Idempotency-Key")});
  if (loseResponse) throw new Error("connection lost");
  return Response.json({projectId:"created",enterpriseId:TEST_ENTERPRISE_ID,version:1});
 };
 const a=openDefaultMap(), b=openDefaultMap();
 assert.equal(a,b);
 await assert.rejects(a);
 loseResponse=false;
 assert.equal(await openDefaultMap(),"created");
 assert.equal(writes.length,2);
 assert.deepEqual(writes[0],writes[1]);
});
test("list errors never create a replacement project", async () => {
 globalThis.fetch=async (_input,init)=>{assert.notEqual(init?.method,"POST");return new Response(null,{status:503});};
 await assert.rejects(openDefaultMap());
});
