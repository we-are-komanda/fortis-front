/* eslint-disable @typescript-eslint/no-require-imports -- Local hardware performance evidence, no external services. */
const {chromium,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
(async()=>{
  const b=await chromium.launch({headless:false});
  try{
    const p=await b.newPage({viewport:{width:1440,height:900}});
    const root=p.locator('[data-scenario-workspace]');
    await p.goto((process.env.SCN01_URL||'http://127.0.0.1:3128')+'/prototype?view=scenario-modeling');
    await expect(root.getByRole('button',{name:'Начать просмотр',exact:true})).toBeEnabled({timeout:30000});
    const renderer=await root.locator('canvas').evaluate(c=>{const g=c.getContext('webgl2'),e=g.getExtension('WEBGL_debug_renderer_info');return g.getParameter(e.UNMASKED_RENDERER_WEBGL);});
    const result={browser:b.version(),cpu:os.cpus()[0].model,memoryGiB:os.totalmem()/2**30,headless:false,renderer,viewport:{width:1440,height:900},samples:[]};
    for(const mode of ['playback','comparison']){
      if(mode==='comparison')await root.getByRole('button',{name:'Сравнение',exact:true}).click();
      await root.getByRole('button',{name:'В начало',exact:true}).click();
      await root.getByRole('button',{name:'Воспроизвести',exact:true}).click();
      const stats=await p.evaluate(()=>new Promise(resolve=>{
        const a=[];const s=performance.now();let previous=s;
        const tick=now=>{a.push(now-previous);previous=now;if(now-s<60000)requestAnimationFrame(tick);else{a.sort((a,b)=>a-b);const el=document.querySelector('[data-scenario-workspace]');resolve({wallMs:now-s,frames:a.length,medianFrameMs:a[a.length>>1],p95FrameMs:a[Math.floor(a.length*.95)],maxFrameMs:a.at(-1),over50ms:a.filter(v=>v>50).length,timeMs:Number(el.dataset.timeMs),status:el.dataset.status,hidden:document.hidden,view:el.querySelector('[data-view]').dataset.view});}};requestAnimationFrame(tick);
      }));
      result.samples.push({mode,...stats});
      fs.writeFileSync(path.resolve('../docs/fortis-scenario-spec/evidence/hardware-performance.json'),JSON.stringify(result,null,2));
      if(stats.status!=='playing'||stats.view!=='3d'||stats.timeMs<59000)throw new Error('Hardware run interrupted: '+JSON.stringify(stats));
      await root.getByRole('button',{name:'Пауза',exact:true}).click();
      console.log(mode,JSON.stringify(stats));
    }
  }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
