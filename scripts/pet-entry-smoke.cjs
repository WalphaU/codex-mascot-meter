const {app,BrowserWindow}=require('electron');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
app.setPath('userData',path.join(os.tmpdir(),'codex-pet-entry-'+process.pid));
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
  const windowRef=new BrowserWindow({show:false,frame:false,width:270,height:320,
    webPreferences:{contextIsolation:false,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});
  windowRef.webContents.setFrameRate(60);
  try {
    await windowRef.loadFile(path.join(__dirname,'../src/index-v2.html'));
    const result=await windowRef.webContents.executeJavaScript(`(async()=>{
      const controller=window.__codexPetAnimationController, player=controller.idlePlayer;
      const actor=document.getElementById('dynamicActor'), rig=document.getElementById('dynamicRig');
      const image=document.querySelector('.pose-idle');
      const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      await player.preload(); await image.decode();
      const originalPreload=player.preload;
      // Hold first-frame readiness to reproduce slow cold-start decoding.
      player.ready=false;
      let release;
      player.preload=()=>new Promise(resolve=>{ release=()=>{player.ready=true;resolve(true);}; });
      setMode('dynamic');
      const first={state:controller.state,pose:actor.dataset.pose,
        fallback:getComputedStyle(image).opacity,rig:getComputedStyle(rig).opacity,
        src:image.getAttribute('src'),animation:getComputedStyle(actor).animationName};
      await pause(240);
      const waiting={state:controller.state,rig:getComputedStyle(rig).opacity,
        fallback:getComputedStyle(image).opacity};
      release(); await pause(80);
      const ready=actor.dataset.idleActive==='true';
      player.preload=originalPreload;
      // Repeat transitions must never re-enter the old intro, including immediate exits.
      const repeats=[];
      for(let i=0;i<10;i++) {
        setMode('compact');setMode('dynamic');
        repeats.push(controller.state==='idle' && actor.dataset.idleActive==='true');
      }
      controller.setReducedMotion(true);
      const reduced=getComputedStyle(image).opacity==='1' && getComputedStyle(rig).opacity==='0';
      controller.setReducedMotion(false);
      player.failed=true;player.setActive(false);
      setMode('compact');setMode('dynamic');
      const failed=getComputedStyle(image).opacity==='1' && getComputedStyle(rig).opacity==='0';
      setMode('compact');player.failed=false;
      return {first,waiting,ready,repeats,reduced,failed};
    })()`);
    assert.equal(result.first.state,'idle');
    assert.equal(result.first.pose,'idle');
    assert.equal(result.first.fallback,'1');
    assert.equal(result.first.rig,'0');
    assert.equal(result.first.animation,'none');
    assert.equal(result.first.src,'./assets/idle/idle-01.png');
    assert.deepEqual(result.waiting,{state:'idle',rig:'0',fallback:'1'});
    assert.equal(result.ready,true);
    assert.ok(result.repeats.every(Boolean));
    assert.equal(result.reduced,true);assert.equal(result.failed,true);
    console.log(JSON.stringify(result,null,2));
  } finally { windowRef.destroy(); }
}).then(()=>app.quit()).catch(error=>{console.error(error);app.exit(1);});
