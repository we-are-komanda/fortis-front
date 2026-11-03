import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createRequire } from "node:module";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import { createWorkspaceDefenseProject } from "@/shared/lib/defense-project";
import type { DefenseProject } from "@/shared/types/defense-project";

const enabled = process.env.FRC03_BROWSER_TESTS === "true";
let browser: Browser;
let bundle: string;
before(async () => {
  if (!enabled) return;
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve("tsx"))("esbuild");
  const result = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {RuntimeProvider} from './src/shared/ui/runtime-provider';
      import {ProjectBoundary} from './src/shared/ui/project-boundary';
      import {ProjectWorkspacePage} from './src/modules/workspace/ui/project-workspace-page';
      import {VariantSelector} from './src/modules/drone-defense/ui/variant-selector';
      import {useDefenseProjectStore as projects} from './src/shared/lib/use-defense-project-store';
      import {useDefenseVariantsStore as variants} from './src/modules/drone-defense/domain/use-defense-variants-store';
      import {setAuthenticatedIdentity} from './src/shared/lib/session-state';
      import './src/shared/lib/identity';
      setAuthenticatedIdentity(window.fixture.userId);
      projects.getState().acceptServerProject(window.fixture.project);
      variants.setState({activeVariantId:window.fixture.project.projectId,activeVariantName:window.fixture.project.projectName});
      const replacements=[];
      projects.subscribe((next,previous)=>{if(next.project!==previous.project)replacements.push(next.project.projectId)});
      window.frc03={state:()=>({project:projects.getState().project,baseline:projects.getState().savedProject,
        active:variants.getState().activeVariantId,status:projects.getState().syncStatus,replacements,
        navigation:window.lastNavigation??null}),edit:()=>projects.getState().replaceProject({...projects.getState().project,projectName:'Dirty existing project'})};
      createRoot(document.getElementById('root')).render(<RuntimeProvider><ProjectBoundary><VariantSelector/><ProjectWorkspacePage/></ProjectBoundary></RuntimeProvider>);
    ` },
    bundle: true, write: false, format: "iife", platform: "browser", loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "next-router-fixture", setup(build: { onResolve: (o: {filter: RegExp}, cb: () => unknown) => void; onLoad: (o: {filter: RegExp; namespace: string}, cb: () => unknown) => void }) {
      build.onResolve({filter:/^next\/navigation$/},()=>({path:"router",namespace:"fixture"}));
      build.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:'export const usePathname=()=>"/workspace"; const router={push:url=>{window.lastNavigation=url}}; export const useRouter=()=>router;',loader:"js"}));
    }}],
  });
  bundle = result.outputFiles[0].text;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); });

function project(id = "P", enterpriseId = "E1"): DefenseProject {
  return { ...createWorkspaceDefenseProject(), projectId:id, enterpriseId, projectName:`Project ${id}`, version:7, source:"backend" };
}
function enterprise(id:string) { return {id,name:`Enterprise ${id}`,latitude:55,longitude:37,status:"active"}; }
function deferred() { let release!:()=>void; const promise=new Promise<void>(resolve=>{release=resolve;}); return {promise,release}; }
type FixtureOptions = { enterprises?: ReturnType<typeof enterprise>[]; projects?: DefenseProject[]; initialListHold?: Promise<void> };
async function fixture(options: FixtureOptions = {}) {
  const page=await browser.newPage({viewport:{width:1280,height:1000}});
  page.setDefaultTimeout(4000);
  const server=new Map((options.projects ?? [project(),project("Q")]).map(p=>[p.projectId,p]));
  const control={enterprises:options.enterprises ?? [enterprise("E1"),enterprise("E2")],userId:"user-A",createStatus:200,readStatus:200,enterpriseStatus:200,listStatus:200,createHold:null as Promise<void>|null};
  const requests:{method:string;path:string;query:string}[]=[];
  const creates:{body:string;key:string|null}[]=[];
  const errors:string[]=[];
  const listHolds=new Map<string,Promise<void>>();
  if(options.initialListHold)listHolds.set("E1:0",options.initialListHold);
  page.on("pageerror",error=>errors.push(error.message));
  await page.route("https://fortis.test/**",async route=>{
    const req=route.request();const url=new URL(req.url());const path=url.pathname;
    if(path.startsWith("/api/"))requests.push({method:req.method(),path,query:url.search});
    if(path==="/api/runtime")return route.fulfill({json:{mode:"workspace",localDraftsEnabled:false}});
    if(path==="/api/auth/me")return route.fulfill({json:{id:control.userId}});
    if(path==="/api/v1/enterprises") {
      if(control.enterpriseStatus!==200)return route.fulfill({status:control.enterpriseStatus,json:{message:"Enterprise access unavailable"}});
      const id=url.searchParams.get("id");if(id)return route.fulfill({json:control.enterprises.find(e=>e.id===id)});
      const offset=Number(url.searchParams.get("offset")??0);const limit=Number(url.searchParams.get("limit")??100);
      return route.fulfill({json:{items:control.enterprises.slice(offset,offset+limit),totalItems:control.enterprises.length}});
    }
    if(path==="/api/defense/projects"&&req.method()==="GET") {
      const enterpriseId=url.searchParams.get("enterpriseId");const offset=Number(url.searchParams.get("offset")??0);const limit=Number(url.searchParams.get("limit")??50);
      const items=[...server.values()].filter(p=>!enterpriseId||p.enterpriseId===enterpriseId).map(p=>({...p,name:p.projectName}));
      const status=control.listStatus;const hold=listHolds.get(`${enterpriseId}:${offset}`);if(hold)await hold;
      if(status!==200)return route.fulfill({status,json:{message:"Project list unavailable"}});
      return route.fulfill({json:{items:items.slice(offset,offset+limit),totalItems:items.length}});
    }
    if(path==="/api/defense/projects"&&req.method()==="POST") {
      creates.push({body:req.postData()!,key:req.headers()["idempotency-key"]??null});
      if(control.createHold)await control.createHold;
      if(control.createStatus!==200)return route.fulfill({status:control.createStatus,json:{message:"Creation unavailable"}});
      const body=req.postDataJSON();const next={...JSON.parse(body.projectJson),projectId:"Created",enterpriseId:body.enterpriseId,version:1,source:"backend"};
      server.set(next.projectId,next);return route.fulfill({json:{...next,name:body.name}});
    }
    if(path.startsWith("/api/defense/projects/")) {
      if(control.readStatus!==200)return route.fulfill({status:control.readStatus,json:{message:"Project unavailable"}});
      const id=decodeURIComponent(path.split("/").pop()!);const found=server.get(id);
      return found?route.fulfill({json:found}):route.fulfill({status:404,json:{message:"Project unavailable"}});
    }
    return route.fulfill({contentType:"text/html",body:'<html lang="ru"><body><div id="root"></div></body></html>'});
  });
  const boot=async()=>{
    await page.evaluate(data=>Object.assign(window,{fixture:data}),{project:project("Existing"),userId:control.userId});
    await page.addScriptTag({content:bundle});
    await expect(page.getByRole("heading",{name:"Предприятие и конфигурация",exact:true})).toBeVisible();
  };
  await page.goto("https://fortis.test/workspace");await boot();
  return {page,server,control,requests,creates,errors,listHolds,boot};
}
async function state(page:Page) { return page.evaluate(()=> (window as unknown as {frc03:{state:()=>{project:DefenseProject;baseline:DefenseProject;active:string;status:string;replacements:string[];navigation:string|null}}}).frc03.state()); }
function projectButton(page:Page,id:string) { return page.getByRole("button").filter({has:page.getByText(`Project ${id}`,{exact:true})}); }
const createButton=(page:Page)=>page.getByRole("button",{name:"Создать",exact:true});
const nameInput=(page:Page)=>page.getByRole("textbox",{name:"Название конфигурации",exact:true});

test("WS01 empty enterprise never falls back to another enterprise rows or comparison options",{skip:!enabled,timeout:20000},async()=>{
  const f=await fixture();try{
    await expect(projectButton(f.page,"P")).toBeVisible();
    await f.page.getByRole("button",{name:"Enterprise E2",exact:true}).click();
    await expect(f.page.getByText(/Для выбранного предприятия пока нет конфигураций/)).toBeVisible();
    await expect(projectButton(f.page,"P")).toHaveCount(0);
    assert.equal(await f.page.locator("select option[value='P']").count(),0);
    assert.ok(f.requests.some(r=>r.path==="/api/defense/projects"&&new URLSearchParams(r.query).get("enterpriseId")==="E2"));
  }finally{await f.page.close();}
});
test("WS02/03 no membership prevents create; Refresh discovers a new authorized assignment",{skip:!enabled,timeout:20000},async()=>{
  const f=await fixture({enterprises:[]});try{
    await expect(f.page.getByText("Нет доступных предприятий.",{exact:true})).toBeVisible();
    await expect(createButton(f.page)).toBeDisabled();
    assert.equal(f.requests.some(r=>r.path==="/api/defense/projects"),false);
    f.control.enterprises=[enterprise("E2")];await f.page.getByRole("button",{name:"Обновить",exact:true}).click();
    await expect(f.page.getByRole("button",{name:"Enterprise E2",exact:true})).toBeVisible();await expect(createButton(f.page)).toBeEnabled();
    assert.equal(f.creates.length,0);assert.deepEqual(f.errors,[]);
  }finally{await f.page.close();}
});
test("WS04/09 pending and failed create preserve current context; unchanged retry commits server context once",{skip:!enabled,timeout:20000},async()=>{
  const f=await fixture();const hold=deferred();try{
    await expect(createButton(f.page)).toBeEnabled();await nameInput(f.page).fill("First E2 configuration");
    await f.page.getByRole("button",{name:"Enterprise E2",exact:true}).click();
    const original=await state(f.page);f.control.createHold=hold.promise;f.control.createStatus=503;
    await createButton(f.page).click();await expect.poll(()=>f.creates.length).toBe(1);await expect(createButton(f.page)).toBeDisabled();
    assert.deepEqual(await state(f.page),original);
    hold.release();await expect(createButton(f.page)).toBeEnabled();
    assert.deepEqual(await state(f.page),original);await expect(nameInput(f.page)).toHaveValue("First E2 configuration");
    f.control.createStatus=200;f.control.createHold=null;await createButton(f.page).click();
    await expect.poll(async()=>(await state(f.page)).navigation).toBe("/prototype?projectId=Created");
    const saved=await state(f.page);assert.equal(saved.project.projectId,"Created");assert.equal(saved.active,"Created");assert.equal(saved.project.version,1);assert.equal(saved.project.enterpriseId,"E2");
    assert.deepEqual(saved.replacements,["Created"]);assert.deepEqual(f.creates[1],f.creates[0]);assert.ok(f.creates[0].key);
    const payload=JSON.parse(f.creates[0].body);assert.equal(payload.enterpriseId,"E2");assert.equal(JSON.parse(payload.projectJson).placedObjects.length,0);
    assert.deepEqual(f.errors,[]);
  }finally{hold.release();await f.page.close();}
});
test("WS05 late previous enterprise response cannot populate the newly selected empty enterprise",{skip:!enabled,timeout:20000},async()=>{
  const hold=deferred();const f=await fixture({initialListHold:hold.promise});try{
    await expect.poll(()=>f.requests.filter(r=>r.path==="/api/defense/projects").length).toBeGreaterThan(0);
    await f.page.getByRole("button",{name:"Enterprise E2",exact:true}).click();
    await expect(f.page.getByText(/Для выбранного предприятия пока нет конфигураций/)).toBeVisible();
    const response=f.page.waitForResponse(r=>new URL(r.url()).searchParams.get("enterpriseId")==="E1");hold.release();await response;
    await expect(projectButton(f.page,"P")).toHaveCount(0);assert.equal(await f.page.locator("select option[value='P']").count(),0);
  }finally{hold.release();await f.page.close();}
});
test("WS06 all 121 scoped projects are reachable by server pagination and enterprise switch resets the page",{skip:!enabled,timeout:20000},async()=>{
  const f=await fixture({projects:Array.from({length:121},(_,i)=>project(String(i+1).padStart(3,"0")))});try{
    await expect(projectButton(f.page,"001")).toBeVisible();await expect(projectButton(f.page,"051")).toHaveCount(0);
    await f.page.getByRole("button",{name:"Следующая страница",exact:true}).click();await expect(projectButton(f.page,"051")).toBeVisible();await expect(projectButton(f.page,"001")).toHaveCount(0);
    await f.page.getByRole("button",{name:"Следующая страница",exact:true}).click();await expect(projectButton(f.page,"121")).toBeVisible();await expect(f.page.getByRole("button",{name:"Следующая страница",exact:true})).toBeDisabled();
    await f.page.getByRole("button",{name:"Предыдущая страница",exact:true}).click();await expect(projectButton(f.page,"051")).toBeVisible();
    await f.page.getByRole("button",{name:"Enterprise E2",exact:true}).click();await expect(f.page.getByText(/Для выбранного предприятия пока нет конфигураций/)).toBeVisible();
    const queries=f.requests.filter(r=>r.path==="/api/defense/projects").map(r=>new URLSearchParams(r.query));
    assert.ok(queries.some(q=>q.get("enterpriseId")==="E1"&&q.get("offset")==="100"&&q.get("limit")==="50"));
    assert.ok(queries.some(q=>q.get("enterpriseId")==="E2"&&q.get("offset")==="0"));
  }finally{await f.page.close();}
});
test("WS07 revoked open cannot navigate using the previously active project",{skip:!enabled,timeout:20000},async()=>{
  const f=await fixture();try{
    await expect(projectButton(f.page,"P")).toBeVisible();const before=await state(f.page);f.control.readStatus=404;
    await projectButton(f.page,"P").click();await expect.poll(()=>f.requests.filter(r=>r.path==="/api/defense/projects/P").length).toBe(1);
    await expect(f.page.getByText(/Project unavailable/)).toBeVisible();
    const after=await state(f.page);assert.equal(after.navigation,null);assert.deepEqual(after.project,before.project);assert.equal(after.active,before.active);
  }finally{await f.page.close();}
});
test("WS08 whitespace name never sends POST and preserves the user's input",{skip:!enabled,timeout:20000},async()=>{
  const f=await fixture();try{
    await expect(createButton(f.page)).toBeEnabled();await nameInput(f.page).fill("   ");
    if(await createButton(f.page).isEnabled())await createButton(f.page).click();
    await expect(nameInput(f.page)).toHaveValue("   ");assert.equal(f.creates.length,0);assert.equal((await state(f.page)).navigation,null);
  }finally{await f.page.close();}
});
test("WS13 failed enterprise refresh clears stale rows and cannot look like an authorized empty state",{skip:!enabled,timeout:20000},async()=>{
  const f=await fixture();try{
    await expect(projectButton(f.page,"P")).toBeVisible();f.control.enterpriseStatus=503;await f.page.getByRole("button",{name:"Обновить",exact:true}).click();
    await expect(f.page.getByRole("alert").filter({hasText:/предприяти/})).toBeVisible();await expect(createButton(f.page)).toBeDisabled();await expect(projectButton(f.page,"P")).toHaveCount(0);
    await expect(f.page.getByText("Нет доступных предприятий.",{exact:true})).toHaveCount(0);
  }finally{await f.page.close();}
});

test("WS05 obsolete pagination response cannot restore rows after enterprise switch",{skip:!enabled,timeout:20000},async()=>{
  const f=await fixture({projects:Array.from({length:70},(_,i)=>project(String(i+1).padStart(3,"0")))});const hold=deferred();try{
    await expect(projectButton(f.page,"001")).toBeVisible();f.listHolds.set("E1:50",hold.promise);
    await f.page.getByRole("button",{name:"Следующая страница",exact:true}).click();
    await expect.poll(()=>f.requests.some(r=>r.path==="/api/defense/projects"&&new URLSearchParams(r.query).get("offset")==="50")).toBe(true);
    await f.page.getByRole("button",{name:"Enterprise E2",exact:true}).click();await expect(f.page.getByText(/Для выбранного предприятия пока нет конфигураций/)).toBeVisible();
    const response=f.page.waitForResponse(r=>new URL(r.url()).searchParams.get("offset")==="50");hold.release();await response;
    await expect(projectButton(f.page,"051")).toHaveCount(0);assert.equal(await f.page.locator("select option[value='051']").count(),0);
  }finally{hold.release();await f.page.close();}
});
test("WS13 failed project list is an error, never an empty successful enterprise",{skip:!enabled,timeout:20000},async()=>{
  const f=await fixture();try{
    await expect(projectButton(f.page,"P")).toBeVisible();f.control.listStatus=503;
    await f.page.getByRole("button",{name:"Enterprise E2",exact:true}).click();
    await expect(f.page.getByText(/Project list unavailable/)).toBeVisible();
    await expect(f.page.getByText(/Для выбранного предприятия пока нет конфигураций/)).toHaveCount(0);
    await expect(projectButton(f.page,"P")).toHaveCount(0);
  }finally{await f.page.close();}
});

test("shared variants modal renders a project list failure rather than an empty success",{skip:!enabled,timeout:20000},async()=>{
  const f=await fixture();try{
    await expect(projectButton(f.page,"P")).toBeVisible();f.control.listStatus=503;
    await f.page.getByTitle("Открыть варианты конфигурации",{exact:true}).click();
    const dialog=f.page.getByRole("dialog",{name:"Варианты конфигурации",exact:true});
    await expect(dialog.getByText(/Project list unavailable/)).toBeVisible();
    await expect(dialog.getByText(/пока нет/i)).toHaveCount(0);
  }finally{await f.page.close();}
});

test("WS14 enterprise beyond the first hundred remains reachable and scoped",{skip:!enabled,timeout:20000},async()=>{
  const f=await fixture({enterprises:Array.from({length:121},(_,i)=>enterprise(`E${i+1}`))});try{
    await expect(f.page.getByRole("button",{name:"Enterprise E121",exact:true})).toBeVisible();
    await f.page.getByRole("button",{name:"Enterprise E121",exact:true}).click();
    await expect(f.page.getByText(/Для выбранного предприятия пока нет конфигураций/)).toBeVisible();
    await expect.poll(()=>f.requests.some(r=>r.path==="/api/defense/projects"&&new URLSearchParams(r.query).get("enterpriseId")==="E121")).toBe(true);
    assert.ok(f.requests.some(r=>r.path==="/api/v1/enterprises"&&new URLSearchParams(r.query).get("offset")==="100"));
    await expect(createButton(f.page)).toBeEnabled();await expect(projectButton(f.page,"P")).toHaveCount(0);
  }finally{await f.page.close();}
});
test("WS08 name limit counts Unicode code points: 121 is rejected and 120 survives intact",{skip:!enabled,timeout:20000},async()=>{
  const f=await fixture();try{
    await expect(createButton(f.page)).toBeEnabled();const valid="😀".repeat(120),invalid=valid+"😀";
    await nameInput(f.page).fill(invalid);await expect(nameInput(f.page)).toHaveValue(invalid);await expect(createButton(f.page)).toBeDisabled();assert.equal(f.creates.length,0);
    await nameInput(f.page).fill(valid);await expect(createButton(f.page)).toBeEnabled();await createButton(f.page).click();
    await expect.poll(async()=>(await state(f.page)).navigation).toBe("/prototype?projectId=Created");
    assert.equal(f.creates.length,1);assert.equal(JSON.parse(f.creates[0].body).name,valid);assert.equal(f.server.get("Created")?.projectName,valid);
  }finally{await f.page.close();}
});
