/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in browser acceptance, matching existing live scripts. */
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const base = process.env.SCN01_URL || 'http://127.0.0.1:3128';
const out = process.env.SCN01_OUTPUT || path.resolve('../docs/fortis-scenario-spec/evidence');
const seconds = Number(process.env.SCN01_PERF_SECONDS || 60);

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const headless = process.env.SCN01_HEADED !== 'true';
  const browser = await chromium.launch({headless});
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    window.__scnMetrics = { contexts: 0, lost: 0, visibility: new Set(), frames: new Set() };
    const requestFrame = window.requestAnimationFrame.bind(window), cancelFrame = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = fn => {const id=requestFrame(now=>{window.__scnMetrics.frames.delete(id);fn(now);});window.__scnMetrics.frames.add(id);return id;};
    window.cancelAnimationFrame = id => {window.__scnMetrics.frames.delete(id);cancelFrame(id);};
    const getContext = HTMLCanvasElement.prototype.getContext;
    const seen = new WeakSet();
    HTMLCanvasElement.prototype.getContext = function (...args) {
      const result = getContext.apply(this, args);
      if (result && /webgl/.test(args[0]) && !seen.has(result)) {
        seen.add(result); window.__scnMetrics.contexts++;
        this.addEventListener('webglcontextlost', () => window.__scnMetrics.lost++);
      }
      return result;
    };
    const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document);
    document.addEventListener = (name, fn, opts) => { if (name === 'visibilitychange') window.__scnMetrics.visibility.add(fn); return add(name, fn, opts); };
    document.removeEventListener = (name, fn, opts) => { if (name === 'visibilitychange') window.__scnMetrics.visibility.delete(fn); return remove(name, fn, opts); };
    // Test-only inspection of React's current tree; no production debug endpoint or store export.
    window.__scnRead = () => {
      const el = document.querySelector('main');
      let fiber = el[Object.keys(el).find(key => key.startsWith('__reactFiber'))];
      while (fiber.return) fiber = fiber.return;
      fiber = fiber.stateNode.current;
      let store, camera;
      const visit = node => {
        if (!node) return;
        let hook = node.memoizedState;
        while (hook && typeof hook === 'object') {
          if (hook.memoizedState?.replaceProject && hook.memoizedState?.project) store = hook.memoizedState;
          hook = hook.next;
        }
        if (node.memoizedProps?.viewState?.longitude !== undefined) camera = node.memoizedProps.viewState;
        visit(node.child); visit(node.sibling);
      };
      visit(fiber); return { store, camera };
    };
  });
  const page = await context.newPage();
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push({ method: request.method(), url: request.url() }));
  const root = page.locator('[data-scenario-workspace]');
  const button = name => root.getByRole('button', { name, exact: true });
  const time = async () => Number(await root.getAttribute('data-time-ms'));
  const shot = name => page.screenshot({ path: path.join(out, name + '.png'), fullPage: true });
  const seek = async value => root.getByRole('slider', { name: 'Учебное время' }).fill(String(value));
  const ready = async () => { await expect(button('Начать просмотр')).toBeEnabled({ timeout: 30000 }); };
  const result = { browser: browser.version(), platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0].model, memoryGiB: Math.round(os.totalmem()/2**30), reducedMotion: true, headless, seconds, acceptance: [] };
  try {
    const noGl = await browser.newContext({viewport:{width:1280,height:720}});
    await noGl.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/.test(type)?null:original.call(this,type,...args);};});
    const fallback = await noGl.newPage();
    await fallback.goto(base+'/prototype?view=scenario-modeling');
    await expect(fallback.locator('[data-scenario-workspace] [data-view]')).toHaveAttribute('data-view','2d',{timeout:30000});
    await expect(fallback.getByRole('button',{name:'Начать просмотр',exact:true})).toBeEnabled();
    await fallback.screenshot({path:path.join(out,'initial-webgl-fallback-1280.png'),fullPage:true});
    await noGl.close();
    result.initialWebGLFallback='PASS: WebGL unavailable at initial entry, automatic 2D and enabled start';
    const opened = Date.now();
    await page.goto(base + '/prototype?view=scenario-modeling');
    await ready();
    result.coldOpenMs = Date.now() - opened;
    result.renderer = await root.locator('canvas').evaluate(c=>{const gl=c.getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);});
    result.initialAssets=await page.evaluate(()=>performance.getEntriesByType('resource').filter(e=>e.name.includes('/_next/')).map(e=>({url:new URL(e.name).pathname,transferSize:e.transferSize,encodedBodySize:e.encodedBodySize}))); 
    await shot('preparation-1440');
    assert.equal(await time(), 0);
    await expect(root.getByText('Учебная площадка · синтетические данные', { exact: false }).first()).toBeVisible();
    assert.equal(await page.getByRole('heading',{name:'Моя карта',exact:true}).count(),1,'direct entry contains only the exercise library, no project map');
    assert.equal(requests.filter(r=>r.url.includes('/api/defense/facilities')).length,0);
    result.acceptance.push('A03');
    await button('Начать просмотр').click();
    await page.waitForTimeout(300);
    await button('Пауза').click();
    const paused = await time(); await page.waitForTimeout(250); assert.equal(await time(), paused);
    await root.getByRole('combobox', { name: 'Скорость просмотра' }).selectOption('4');
    assert.equal(await time(), paused);
    await seek(105000); assert.equal(await time(), 105000);
    await shot('playback-1440');
    await seek(240000); await expect(root).toHaveAttribute('data-status', 'ended');
    await button('Повторить').click(); await page.waitForTimeout(100); await button('Пауза').click(); assert.ok(await time() < 10000);
    await button('В начало').click(); assert.equal(await time(), 0);
    result.acceptance.push('A05', 'A06');
    await seek(105000); await button('Сравнение').click();
    assert.equal(await time(), 105000);
    for (const [left, right] of [['exercise-north','exercise-east'], ['exercise-north','exercise-southwest'], ['exercise-east','exercise-southwest']]) {
      await root.getByRole('combobox', { name: 'Правая запись' }).selectOption(right);
      await root.getByRole('combobox', { name: 'Левая запись' }).selectOption(left);
      assert.equal(await time(), 105000);
      assert.equal(await root.getByRole('combobox', { name: 'Правая запись' }).locator('option[value="' + left + '"]').evaluate(el=>el.disabled),true);
      assert.equal(await root.locator('canvas').count(), 1);
    }
    await shot('comparison-1440');
    await button('AI-черновик').click();
    await expect(root.getByText('Подключение NeuralDeep — следующий этап. Модель ещё не выбрана.')).toBeVisible();
    await shot('ai-status-1440');
    await button('Закрыть AI-панель').click();
    await button('2D').click(); assert.equal(await time(), 105000);
    await root.getByLabel('Дорожки', { exact: true }).uncheck();
    assert.equal(await root.locator('svg[role="img"] circle').count() > 0, true);
    await root.getByLabel('Дорожки', { exact: true }).check();
    await button('3D').click();
    await expect(root.locator('canvas')).toBeVisible();
    await button('Просмотр').click(); await button('Воспроизвести').click();
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect(root).toHaveAttribute('data-status', 'paused');
    const background = await time(); await page.waitForTimeout(250); assert.equal(await time(), background);
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
    assert.equal(await time(), background);
    await root.locator('canvas').evaluate(canvas => canvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
    await expect(button('Открыть в 2D')).toBeVisible();
    assert.equal(await time(), background);
    await shot('fallback-1440'); await button('Открыть в 2D').click();
    assert.equal(await time(), background); await expect(root.locator('svg[role="img"]')).toBeVisible();
    result.acceptance.push('A07', 'A08', 'A09 (visibility event)', 'A10', 'A11');
    for (const [width, height] of [[1280,720],[390,844]]) {
      await page.setViewportSize({ width, height }); await button('Сравнение').click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await shot('comparison-' + width);
      if(width===390){await root.getByRole('combobox',{name:'Левая запись'}).scrollIntoViewIfNeeded();await shot('comparison-390-controls');}
      await root.getByRole('slider').focus(); await page.keyboard.press('Home'); assert.equal(await time(), 0);
      await page.keyboard.press('End'); assert.equal(await time(), 240000);
      assert.ok(await root.getByRole('slider').evaluate(el => getComputedStyle(el).outlineStyle !== 'none'));
    }
    await page.setViewportSize({width:1440,height:900});
    await page.evaluate(() => { localStorage.setItem('theme', 'dark'); document.documentElement.classList.add('dark'); });
    await shot('comparison-dark');
    await page.evaluate(() => { localStorage.setItem('theme', 'light'); document.documentElement.classList.remove('dark'); });
    result.acceptance.push('A12');
    // Real current project: unsaved changes, revision and selection, then ten complete entry/exit cycles.
    await button('К карте').click();
    await expect(page.getByRole('heading', { name: 'Моя карта', exact: true })).toBeVisible();
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      const s = window.__scnRead().store;
      s.replaceProject({ ...s.project, projectName: 'SCN-01 unsaved synthetic fixture', version: 7 });
      s.selectObject(s.project.placedObjects[0]?.id || 'scn01-selection');
    });
    await page.waitForTimeout(200);
    const before = await page.evaluate(() => {
      const {store:s,camera} = window.__scnRead();
      window.__scnBeforeProject = s.project;
      return { project: s.project, syncStatus:s.syncStatus, businessRevision:s.businessRevision, selectedObjectId:s.selectedObjectId, camera, storage: {...localStorage} };
    });
    const enter = page.getByRole('link', {name:/Сценарии/});
    for(let i=0;i<10;i++) {
      await enter.click(); await ready(); await button('Начать просмотр').click();
      await button('К карте').click(); await expect(root).toHaveCount(0);
      await page.waitForTimeout(650);
      const after = await page.evaluate(() => {
        const {store:s,camera} = window.__scnRead();
        return { project:s.project,syncStatus:s.syncStatus,businessRevision:s.businessRevision,selectedObjectId:s.selectedObjectId,camera,storage:{...localStorage},sameProject:s.project===window.__scnBeforeProject };
      });
      assert.equal(after.sameProject, true); delete after.sameProject; assert.deepEqual(after, before);
    }
    result.resources = await page.evaluate(() => ({ ...window.__scnMetrics, visibility: window.__scnMetrics.visibility.size, frames: window.__scnMetrics.frames.size, activeContexts: window.__scnMetrics.contexts-window.__scnMetrics.lost }));
    assert.ok(result.resources.activeContexts <= 3, JSON.stringify(result.resources));
    assert.equal(result.resources.visibility,0);
    assert.ok(result.resources.frames<=3,JSON.stringify(result.resources));
    result.acceptance.push('A02', 'A13');
    // Measure real wall time on the production scene; no fixed-time simulation.
    await enter.click(); await ready();
    result.performance = [];
    await root.getByRole('combobox', {name:'Скорость просмотра'}).selectOption('1');
    for(const mode of ['playback','comparison']) {
      if(mode==='comparison') await button('Сравнение').click();
      await button('В начало').click(); await button('Воспроизвести').click();
      const stats = await page.evaluate(duration => new Promise(resolve => {
        const deltas=[]; let start=performance.now(), previous=start;
        const frame=now=>{deltas.push(now-previous);previous=now;if(now-start<duration)requestAnimationFrame(frame);else {deltas.sort((a,b)=>a-b);resolve({wallMs:now-start,frames:deltas.length,medianFrameMs:deltas[Math.floor(deltas.length*.5)],p95FrameMs:deltas[Math.floor(deltas.length*.95)],maxFrameMs:deltas.at(-1),over50ms:deltas.filter(d=>d>50).length});}};
        requestAnimationFrame(frame);
      }),seconds*1000);
      await button('Пауза').click(); result.performance.push({mode,...stats});
    }
    const writes = requests.filter(r=>!['GET','HEAD'].includes(r.method) && /\/api\//.test(r.url));
    const ai = requests.filter(r=>/neuraldeep|\/ai[/?]/i.test(r.url));
    assert.deepEqual(writes, []); assert.deepEqual(ai, []);
    result.requests = {businessWrites:writes,ai, total:requests.length};
    result.assets = await page.evaluate(() => performance.getEntriesByType('resource').filter(e=>e.initiatorType==='script'||e.name.includes('/_next/')).map(e=>({url:new URL(e.name).pathname, transferSize:e.transferSize, encodedBodySize:e.encodedBodySize})));
    assert.deepEqual(errors, []);
    result.acceptance.push('A14'); result.pageErrors=errors;
    fs.writeFileSync(path.join(out,'browser-result.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify({...result,assets:result.assets.length,initialAssets:result.initialAssets.length},null,2));
  } catch(error) { await shot('failure').catch(()=>{}); fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({message:String(error),errors,result},null,2));throw error; }
  finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
