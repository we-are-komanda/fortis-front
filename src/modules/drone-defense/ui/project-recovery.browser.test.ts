import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createRequire } from "node:module";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import { createWorkspaceDefenseProject } from "@/shared/lib/defense-project";
import type { DefenseProject } from "@/shared/types/defense-project";

const enabled = process.env.FRC06_BROWSER_TESTS === "true";
let browser: Browser;
let bundle: string;
before(async () => {
  if (!enabled) return;
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve("tsx"))("esbuild");
  const result = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {ConfigProvider} from 'antd';
      import {RuntimeProvider} from './src/shared/ui/runtime-provider';
      import {IdentityBoundary} from './src/shared/ui/identity-boundary';
      import {ProjectWorkspacePage} from './src/modules/workspace/ui/project-workspace-page';
      import {VariantSelector} from './src/modules/drone-defense/ui/variant-selector';
      import {useDefenseProjectStore as projects} from './src/shared/lib/use-defense-project-store';
      import {useDefenseVariantsStore as variants} from './src/modules/drone-defense/domain/use-defense-variants-store';
      import {setAuthenticatedIdentity} from './src/shared/lib/session-state';
      import './src/shared/lib/identity';
      const initial = window.fixture;
      if(!initial.unauthenticated){
        setAuthenticatedIdentity('user-A');
        projects.getState().acceptServerProject(initial.project);
        projects.getState().setLocalDraftsEnabled(true);
        variants.setState({activeVariantId: initial.project.projectId, activeVariantName: initial.project.projectName});
      }
      window.frc06 = {state: () => ({project: projects.getState().project, status: projects.getState().syncStatus,
        error: variants.getState().error, active: variants.getState().activeVariantId}),
        edit: name => projects.getState().replaceProject({...projects.getState().project,projectName:name})};
      function Harness(){const p=projects(s=>s.project); return <><label>Название проекта<input aria-label="Название проекта" value={p.projectName}
        onChange={e=>projects.getState().replaceProject({...projects.getState().project,projectName:e.target.value})}/></label>
        <output aria-label="Текущий проект">{p.projectId}</output><VariantSelector/>{initial.workspace && <ProjectWorkspacePage/>}</>}
      createRoot(document.getElementById('root')).render(<ConfigProvider><RuntimeProvider><IdentityBoundary><Harness/></IdentityBoundary></RuntimeProvider></ConfigProvider>);
    ` },
    bundle: true, write: false, format: "iife", platform: "browser", loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "next-router-fixture", setup(build: { onResolve: (o: {filter: RegExp}, cb: () => unknown) => void; onLoad: (o: {filter: RegExp; namespace: string}, cb: () => unknown) => void }) {
      build.onResolve({filter:/^next\/navigation$/},()=>({path:"router",namespace:"fixture"}));
      build.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:'export const usePathname=()=>"/workspace"; export const useRouter=()=>({push:url=>{window.lastNavigation=url}});',loader:"js"}));
    }}],
  });
  bundle = result.outputFiles[0].text;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); });

function project(id = "P"): DefenseProject {
  return {...createWorkspaceDefenseProject(), projectId:id, enterpriseId:"E", projectName:`Project ${id}`, version:7, source:"backend"};
}
async function fixture(workspace = false, options: { unauthenticated?: boolean; rejectAfterLogout?: boolean } = {}) {
  const page = await browser.newPage({viewport:{width:1280,height:900}});
  page.setDefaultTimeout(3000);
  const server = new Map([['P',project()],['Q',project('Q')]]);
  const requests: string[] = [];
  const creates: {body:string;key:string|null}[] = [];
  const errors: string[] = [];
  let putStatus = 200;
  let getStatus = 200;
  let authHold: Promise<void> | null = null;
  let userId = 'user-A';
  let loggedOut = false;
  let hold: Promise<void> | null = null;
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog', dialog=>{ void dialog.accept(); });
  await page.route('https://fortis.test/**',async route=>{
    const req=route.request(); const url=new URL(req.url()); const path=url.pathname;
    if(path.startsWith('/api/')) requests.push(`${req.method()} ${path}`);
    if(path==='/api/runtime') return route.fulfill({json:{mode:'workspace',localDraftsEnabled:true}});
    if(path==='/api/auth/me') { if(authHold) await authHold; return options.unauthenticated || (loggedOut && options.rejectAfterLogout) ? route.fulfill({status:401,json:{message:'Unauthenticated'}}) : route.fulfill({json:{id:userId}}); }
    if(path==='/api/auth/logout') { loggedOut=true; return route.fulfill({json:{status:'ok'}}); }
    if(path==='/api/v1/enterprises') return route.fulfill({json:{items:[{id:'E',name:'Enterprise E',latitude:55,longitude:37},{id:'F',name:'Enterprise F',latitude:56,longitude:38}],totalItems:2}});
    if(path==='/api/defense/projects' && req.method()==='GET') {
      const enterpriseId=url.searchParams.get('enterpriseId');
      const items=[...server.values()].filter(p=>!enterpriseId || p.enterpriseId===enterpriseId).map(p=>({...p,name:p.projectName}));
      const offset=Number(url.searchParams.get('offset')??0), limit=Number(url.searchParams.get('limit')??50);
      return route.fulfill({json:{items:items.slice(offset,offset+limit),totalItems:items.length}});
    }
    if(path==='/api/defense/projects' && req.method()==='POST') {
      creates.push({body:req.postData()!,key:req.headers()['idempotency-key']??null});
      if(putStatus!==200) return route.fulfill({status:putStatus,json:{message:'Fixture create failed'},headers:{'x-request-id':'fixture-create'}});
      const body=req.postDataJSON(); const next={...JSON.parse(body.projectJson),projectId:'Copy',version:1,source:'backend'};
      server.set('Copy',next);return route.fulfill({json:{...next,name:body.name}});
    }
    if(path.startsWith('/api/defense/projects/')) {
      const id=path.split('/').pop()!;
      if(req.method()==='PUT') {
        if(hold) await hold;
        if(putStatus!==200) return route.fulfill({status:putStatus,json:{message:'Fixture save failed'},headers:{'x-request-id':'fixture-request'}});
        const body=req.postDataJSON(); const current=server.get(id)!;
        const next={...JSON.parse(body.projectJson),projectId:id,enterpriseId:current.enterpriseId,version:current.version!+1,source:'backend'};
        server.set(id,next);return route.fulfill({json:{...next,name:body.name}});
      }
      return getStatus===200 ? route.fulfill({json:server.get(id)}) : route.fulfill({status:getStatus,json:{message:'Fixture access unavailable'}});
    }
    return route.fulfill({contentType:'text/html',body:'<html lang="ru"><body><div id="root"></div></body></html>'});
  });
  const boot=async()=>{
    await page.evaluate(data=>Object.assign(window,{fixture:data}),{project:server.get('P'),workspace,unauthenticated:options.unauthenticated});
    await page.addScriptTag({content:bundle});
    if(!options.unauthenticated)await expect(page.getByRole('button',{name:'Выйти',exact:true})).toBeVisible();
  };
  await page.goto('https://fortis.test/workspace');await boot();
  return {page,server,requests,creates,errors,boot,fail:(status:number)=>{putStatus=status;},denyRead:(status:number)=>{getStatus=status;},hold:(pending:Promise<void>|null)=>{hold=pending;},auth:(pending:Promise<void>|null,id='user-A')=>{authHold=pending;userId=id;}};
}
async function edit(page:Page,name='Unsaved edit'){await page.getByRole('textbox',{name:'Название проекта',exact:true}).fill(name);}
async function openVariants(page:Page){await page.getByTitle('Открыть варианты конфигурации',{exact:true}).click(); await expect(page.getByRole('dialog',{name:'Варианты конфигурации',exact:true})).toBeVisible();}
function variantRow(page:Page,name:string){return page.getByRole('dialog',{name:'Варианты конфигурации',exact:true}).getByRole('listitem').filter({has:page.getByText(name,{exact:true})});}
async function draftKeys(page:Page){return page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('fortis:draft:')));}

test('variant Stay preserves edit; Discard opens target and deletes discarded recovery', {skip:!enabled}, async()=>{
  const f=await fixture();try{
    await edit(f.page);await openVariants(f.page);await variantRow(f.page,'Project Q').getByRole('button',{name:'Загрузить',exact:true}).click();
    await f.page.getByRole('button',{name:'Остаться',exact:true}).click();
    await expect(f.page.getByRole('textbox',{name:'Название проекта',exact:true})).toHaveValue('Unsaved edit');
    await variantRow(f.page,'Project Q').getByRole('button',{name:'Загрузить',exact:true}).click();
    await f.page.getByRole('button',{name:'Отказаться и открыть',exact:true}).click();
    await expect(f.page.getByLabel('Текущий проект',{exact:true})).toHaveText('Q');
    assert.deepEqual(await draftKeys(f.page),[]);
  }finally{await f.page.close();}
});
test('conflict reload asks before replacing the active project', {skip:!enabled}, async()=>{
  const f=await fixture();try{
    await edit(f.page);f.fail(409);await f.page.getByRole('button',{name:'Сохранить',exact:true}).click();
    await openVariants(f.page);f.server.set('P',{...project(),version:8,projectName:'Other writer'});
    await f.page.getByRole('button',{name:'Перезагрузить актуальную версию',exact:true}).click();
    await expect(f.page.getByRole('button',{name:'Отказаться и открыть',exact:true})).toBeVisible();
    await f.page.getByRole('button',{name:'Остаться',exact:true}).click();
    await f.page.getByRole('button',{name:'Перезагрузить актуальную версию',exact:true}).click();
    await f.page.getByRole('button',{name:'Отказаться и открыть',exact:true}).click();
    await expect(f.page.getByRole('textbox',{name:'Название проекта',exact:true})).toHaveValue('Other writer');
  }finally{await f.page.close();}
});
test('enterprise switch while dirty offers Stay and Discard', {skip:!enabled}, async()=>{
  const f=await fixture(true);try{
    await edit(f.page);await f.page.getByRole('button',{name:'Enterprise F',exact:true}).click();
    await expect(f.page.getByRole('dialog',{name:'Есть несохранённые изменения',exact:true})).toBeVisible();
    await f.page.getByRole('button',{name:'Остаться',exact:true}).click();
    await expect(f.page.getByRole('textbox',{name:'Название проекта',exact:true})).toHaveValue('Unsaved edit');
    await f.page.getByRole('button',{name:'Enterprise F',exact:true}).click();
    await f.page.getByRole('button',{name:'Отказаться и продолжить',exact:true}).click();
    assert.deepEqual(await draftKeys(f.page),[]);
  }finally{await f.page.close();}
});
test('logout while dirty offers Stay and Discard before ending session', {skip:!enabled}, async()=>{
  const f=await fixture();try{
    await edit(f.page);await f.page.getByRole('button',{name:'Выйти',exact:true}).click();
    await expect(f.page.getByRole('dialog',{name:'Есть несохранённые изменения',exact:true})).toBeVisible();
    assert.equal(f.requests.includes('POST /api/auth/logout'),false);
    await f.page.getByRole('button',{name:'Остаться',exact:true}).click();
    await expect(f.page.getByRole('textbox',{name:'Название проекта',exact:true})).toHaveValue('Unsaved edit');
    await f.page.getByRole('button',{name:'Выйти',exact:true}).click();
    await f.page.getByRole('button',{name:'Отказаться и выйти',exact:true}).click();
    await f.page.waitForURL('**/login');assert.deepEqual(await draftKeys(f.page),[]);
  }finally{await f.page.close();}
});
test('failed or pending Save cannot navigate; explicit retry confirms before opening target', {skip:!enabled}, async()=>{
  const f=await fixture();let release!:()=>void;try{
    await edit(f.page);await openVariants(f.page);await variantRow(f.page,'Project Q').getByRole('button',{name:'Загрузить',exact:true}).click();
    f.fail(503);await f.page.getByRole('button',{name:'Сохранить и открыть',exact:true}).click();
    await expect(f.page.getByText('Код запроса: fixture-request',{exact:true})).toBeVisible();
    await expect(f.page.getByLabel('Текущий проект',{exact:true})).toHaveText('P');
    f.fail(200);f.hold(new Promise<void>(resolve=>{release=resolve;}));
    await f.page.getByRole('button',{name:'Сохранить и открыть',exact:true}).click();
    await expect(f.page.getByLabel('Текущий проект',{exact:true})).toHaveText('P');
    release();await expect(f.page.getByLabel('Текущий проект',{exact:true})).toHaveText('Q');
    assert.equal(f.server.get('P')?.projectName,'Unsaved edit');assert.equal(f.server.get('P')?.version,8);
    assert.deepEqual(f.errors,[]);
  }catch(error){console.log('Failed transition state',await f.page.locator('body').innerText());await f.page.screenshot({path:'/private/tmp/frc06-transition-failure.png'});throw error;}
  finally{release?.();await f.page.close();}
});

test('failed create retains the name and explicit retry replays the frozen body/key', {skip:!enabled}, async()=>{
  const f=await fixture();try{
    await edit(f.page);await openVariants(f.page);
    const name=f.page.getByPlaceholder('Имя нового варианта…',{exact:true});
    await name.fill('Named copy');f.fail(503);
    await f.page.getByRole('button',{name:'Сохранить как новый',exact:true}).click();
    await expect(f.page.getByText('Код запроса: fixture-create',{exact:true})).toBeVisible();
    await expect(name).toHaveValue('Named copy');
    await f.page.evaluate(()=>{(window as unknown as {frc06:{edit:(name:string)=>void}}).frc06.edit('Newer edit');});
    f.fail(200);await f.page.getByRole('button',{name:'Повторить сохранение',exact:true}).click();
    await expect(f.page.getByLabel('Текущий проект',{exact:true})).toHaveText('Copy');
    assert.equal(f.creates.length,2);assert.deepEqual(f.creates[1],f.creates[0]);assert.ok(f.creates[0].key);
    assert.equal(f.server.get('Copy')?.projectName,'Unsaved edit');assert.equal(f.server.get('P')?.projectName,'Project P');
    await expect(f.page.getByRole('textbox',{name:'Название проекта',exact:true})).toHaveValue('Newer edit');
  }finally{await f.page.close();}
});

test('recovery rechecks access when Restore is clicked, after the offer was displayed', {skip:!enabled}, async()=>{
  const f=await fixture();try{
    await edit(f.page);await f.page.reload();await f.boot();await openVariants(f.page);
    await expect(f.page.getByRole('button',{name:'Восстановить',exact:true})).toBeVisible();
    f.denyRead(404);await f.page.getByRole('button',{name:'Восстановить',exact:true}).click();
    await expect(f.page.getByText('Локальное восстановление недоступно',{exact:true})).toBeVisible();
    await expect(f.page.getByRole('textbox',{name:'Название проекта',exact:true})).toHaveValue('Project P');
    assert.equal(f.requests.some(r=>r.startsWith('PUT')),false);
  }finally{await f.page.close();}
});

test('revoked dirty project still requires an explicit decision before another variant loads', {skip:!enabled}, async()=>{
  const f=await fixture();try{
    await edit(f.page);f.denyRead(404);await openVariants(f.page);
    await expect(f.page.getByText('Локальное восстановление недоступно',{exact:true})).toBeVisible();
    await variantRow(f.page,'Project Q').getByRole('button',{name:'Загрузить',exact:true}).click();
    await expect(f.page.getByRole('dialog',{name:'Есть несохранённые изменения',exact:true})).toBeVisible();
    await f.page.getByRole('button',{name:'Остаться',exact:true}).click();
    await expect(f.page.getByRole('textbox',{name:'Название проекта',exact:true})).toHaveValue('Unsaved edit');
  }finally{await f.page.close();}
});
test('reload keeps saved state until explicit scoped recovery', {skip:!enabled}, async()=>{
  const f=await fixture();try{
    await edit(f.page);await f.page.reload();await f.boot();
    await expect(f.page.getByRole('textbox',{name:'Название проекта',exact:true})).toHaveValue('Project P');
    await openVariants(f.page);await f.page.getByRole('button',{name:'Восстановить',exact:true}).click();
    await expect(f.page.getByRole('textbox',{name:'Название проекта',exact:true})).toHaveValue('Unsaved edit');
    assert.equal(f.requests.filter(r=>r.startsWith('PUT')).length,0);
  }finally{await f.page.close();}
});

test('session recheck hides all protected dialogs and preserves same-user transition state', {skip:!enabled}, async()=>{
  const f=await fixture();let release!:()=>void;try{
    await edit(f.page);await openVariants(f.page);await variantRow(f.page,'Project Q').getByRole('button',{name:'Загрузить',exact:true}).click();
    f.auth(new Promise<void>(resolve=>{release=resolve;}));
    await f.page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await expect(f.page.getByText('Проверяем сессию…',{exact:true})).toBeVisible();
    await expect(f.page.getByRole('dialog',{name:'Есть несохранённые изменения',exact:true})).toBeHidden();
    await expect(f.page.getByRole('dialog',{name:'Варианты конфигурации',exact:true})).toBeHidden();
    release();await expect(f.page.getByRole('button',{name:'Сохранить и открыть',exact:true})).toBeVisible();
    await f.page.getByRole('button',{name:'Остаться',exact:true}).click();
    f.auth(null,'user-B');await f.page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await expect(f.page.getByRole('dialog',{name:'Варианты конфигурации',exact:true})).toBeHidden();
    await expect(f.page.getByRole('textbox',{name:'Название проекта',exact:true})).not.toHaveValue('Unsaved edit');
  }finally{release?.();await f.page.close();}
});

test('logout Save stays on failed save, then leaves only after confirmed retry', {skip:!enabled}, async()=>{
  const f=await fixture();try{
    await edit(f.page);await f.page.getByRole('button',{name:'Выйти',exact:true}).click();f.fail(503);
    await f.page.getByRole('button',{name:'Сохранить и выйти',exact:true}).click();
    await expect(f.page.getByRole('alert').filter({hasText:'Сохранение не подтверждено'})).toBeVisible();
    assert.equal(f.requests.includes('POST /api/auth/logout'),false);
    f.fail(200);await f.page.getByRole('button',{name:'Сохранить и выйти',exact:true}).click();
    await f.page.waitForURL('**/login');assert.equal(f.server.get('P')?.version,8);assert.equal(f.server.get('P')?.projectName,'Unsaved edit');
  }finally{await f.page.close();}
});

test('switching identity clears the previous user logout intent and name', {skip:!enabled}, async()=>{
  const f=await fixture();try{
    await edit(f.page,'Private A project');await f.page.getByRole('button',{name:'Выйти',exact:true}).click();
    await expect(f.page.getByRole('dialog',{name:'Есть несохранённые изменения',exact:true})).toBeVisible();
    f.auth(null,'user-B');await f.page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await expect(f.page.getByRole('textbox',{name:'Название проекта',exact:true})).not.toHaveValue('Private A project');
    await expect(f.page.getByRole('dialog',{name:'Есть несохранённые изменения',exact:true})).toBeHidden();
    await expect(f.page.getByRole('textbox',{name:'Имя нового варианта перед выходом',exact:true})).toHaveCount(0);
    assert.equal(f.requests.includes('POST /api/auth/logout'),false);
  }finally{await f.page.close();}
});

test('enterprise Save keeps selection after failure and switches after confirmed retry', {skip:!enabled}, async()=>{
  const f=await fixture(true);try{
    await edit(f.page);await f.page.getByRole('button',{name:'Enterprise F',exact:true}).click();f.fail(503);
    await f.page.getByRole('button',{name:'Сохранить и продолжить',exact:true}).click();
    await expect(f.page.getByRole('dialog',{name:'Есть несохранённые изменения',exact:true})).toBeVisible();
    await expect(f.page.getByRole('button',{name:'Сохранить и продолжить',exact:true})).toBeEnabled();
    assert.equal(f.server.get('P')?.version,7);
    f.fail(200);await f.page.getByRole('button',{name:'Сохранить и продолжить',exact:true}).click();
    await expect(f.page.getByRole('dialog',{name:'Есть несохранённые изменения',exact:true})).toBeHidden();
    assert.equal(f.server.get('P')?.version,8);
    await expect(f.page.getByText('Для выбранного предприятия пока нет конфигураций. Введите название выше и нажмите «Создать», чтобы перейти к карте.',{exact:true})).toBeVisible();
  }finally{await f.page.close();}
});


test('successful logout never rechecks a known invalid session', {skip:!enabled,timeout:15000}, async()=>{
  const f=await fixture(false,{rejectAfterLogout:true});try{
    await f.page.getByRole('button',{name:'Выйти',exact:true}).click();
    await f.page.waitForURL('https://fortis.test/login');
    assert.equal(f.requests.filter(r=>r==='POST /api/auth/logout').length,1);
    const afterLogout=f.requests.slice(f.requests.indexOf('POST /api/auth/logout')+1);
    assert.equal(afterLogout.includes('GET /api/auth/me'),false);
    await expect(f.page.getByRole('textbox',{name:'Название проекта',exact:true})).toHaveCount(0);
    await expect(f.page.getByRole('button',{name:'Выйти',exact:true})).toHaveCount(0);
    assert.deepEqual(f.errors,[]);
  }finally{await f.page.close();}
});

test('an initially unknown session still checks auth and redirects on its first 401', {skip:!enabled,timeout:15000}, async()=>{
  const f=await fixture(false,{unauthenticated:true});try{
    await f.page.waitForURL('https://fortis.test/login?next=%2Fworkspace');
    assert.equal(f.requests.filter(r=>r==='GET /api/auth/me').length,1);
    assert.equal(f.requests.includes('POST /api/auth/logout'),false);
    await expect(f.page.getByRole('textbox',{name:'Название проекта',exact:true})).toHaveCount(0);
  }finally{await f.page.close();}
});
