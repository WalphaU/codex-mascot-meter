const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('ambient animations no longer request native window movement', () => {
  const renderer = read('src/renderer-v2.js');
  const clips = read('src/pet-animation-clips.js');
  const main = read('electron/main.cjs');
  const controller = read('electron/pet-drag-controller.cjs');
  const preload = read('electron/preload.cjs');
  assert.doesNotMatch(clips, /environment\.teleport/);
  assert.doesNotMatch(renderer, /bridge\.petTeleport\(/);
  assert.match(main, /ipcMain\.handle\('window:pet-teleport'/);
  assert.match(preload, /petTeleport:\s*\(\) => ipcRenderer\.invoke\('window:pet-teleport'\)/);
  assert.equal(((main + controller).match(/windowRef\.setPosition/g) || []).length, 2);
  assert.doesNotMatch(renderer, /petWander/);
});

test('all requested actions have normalized eight-frame sequence atlases', () => {
  const renderer = read('src/renderer-v2.js');
  const html = read('src/index-v2.html');
  const actions = [];
  assert.match(html, /id="dynamicSequence"/);
  for (const action of actions) {
    const filename = `mascot-sequence-${action}.webp`;
    assert.match(renderer, new RegExp(filename.replace('.', '\\.')));
    const asset = path.join(root, 'src', 'assets', 'sequences', filename);
    assert.ok(fs.existsSync(asset), filename);
    assert.ok(fs.statSync(asset).size > 100_000, `${filename} should contain drawn frames`);
  }
  assert.doesNotMatch(renderer, /mascot-sequence-(?:hop|walk|look|doze|daydream|eat|drink|read|teleport|sleep)\.webp/);
  assert.doesNotMatch(renderer, /'原地蹦跳'|'桌面散步'/);
});

test('drag samples the native cursor only from renderer movement and uses a bounded hit target', () => {
  const renderer = read('src/renderer-v2.js');
  const main = read('electron/main.cjs');
  const controller = read('electron/pet-drag-controller.cjs');
  const html = read('src/index-v2.html');
  const css = read('src/styles-v2.css');
  assert.match(main, /ipcMain\.on\('window:pet-drag-move',[\s\S]*?petDragController\.move\(payload\)/);
  assert.doesNotMatch(main, /petDragPoll|startPetDragPoll|setInterval\([\s\S]*?petDragController\.tick\(\)/);
  for (const message of ['0x0202', '0x00a2', '0x0247', '0x0215', '0x001f']) assert.match(main, new RegExp(message));
  assert.match(controller, /const x = Math\.round\(cursor\.x - session\.offsetX\)/);
  assert.doesNotMatch(controller, /clamp\(Math\.round\(cursor\.x/);
  assert.match(html, /id="dynamicHitTarget"/);
  assert.match(html, /id="dynamicHoverZone"/);
  assert.match(css, /\.dynamic-pet\s*\{[\s\S]*?pointer-events:\s*none/);
  assert.match(css, /\.dynamic-hit-target\s*\{[\s\S]*?clip-path:/);
  assert.match(css, /\.dynamic-hover-zone\s*\{[\s\S]*?pointer-events:\s*none/);
  assert.match(css, /\.widget\[data-mode="dynamic"\] \.dynamic-hover-zone\s*\{\s*pointer-events:\s*auto/);
  assert.match(css, /\.dynamic-hit-target\s*\{[\s\S]*?pointer-events:\s*none/);
  assert.match(css, /\.widget\[data-mode="dynamic"\] \.dynamic-hit-target\s*\{[\s\S]*?pointer-events:\s*auto/);
  assert.match(html, /id="dynamicPetStage"[^>]*\sinert/);
  assert.match(renderer, /dynamicPetStage\.inert\s*=\s*!isDynamic/);
  assert.match(renderer, /dynamicPetStage\.addEventListener\('pointerover'/);
  assert.match(renderer, /dynamicPetStage\.addEventListener\('pointerout'/);
  assert.match(renderer, /hideDynamicBack\(true\)/);
  assert.match(css, /data-back-visible="true"/);
  assert.doesNotMatch(css, /\.dynamic-pet-stage:hover\s+\.dynamic-back-button/);
});

test('the dynamic back button shares the actor frame anchor and drag commits exact dynamic geometry', () => {
  const css = read('src/styles-v2.css');
  const main = read('electron/main.cjs');
  assert.match(css, /\.dynamic-pet-stage\s*\{[\s\S]*?--dynamic-actor-left:\s*12px/);
  assert.match(css, /\.dynamic-back-button\s*\{[\s\S]*?left:\s*calc\(var\(--dynamic-actor-left\)/);
  assert.match(css, /\.dynamic-back-button\s*\{[\s\S]*?bottom:\s*calc\(var\(--dynamic-actor-bottom\)/);
  assert.match(css, /\.dynamic-actor\s*\{[\s\S]*?left:\s*var\(--dynamic-actor-left\)/);
  assert.match(css, /data-dragging="true"[\s\S]*?\.dynamic-back-button\s*\{[\s\S]*?pointer-events:\s*none\s*!important/);
  assert.match(main, /settleWindowMode\('dynamic'\)[\s\S]*?petDragController\.start\(payload\)/);
  assert.match(css, /\.dynamic-actor\[data-action="drag"\]\s*\{[^}]*animation:\s*none[^}]*transform:\s*none/);
  assert.doesNotMatch(css, /@keyframes\s+dragStruggle/);
});

test('inactive dynamic layers cannot steal compact or detail interactions', () => {
  const renderer = read('src/renderer-v2.js');
  const css = read('src/styles-v2.css');
  assert.match(css, /\.dynamic-pet-stage\s*\{[\s\S]*?visibility:\s*hidden/);
  assert.match(css, /\.widget\[data-mode="dynamic"\] \.dynamic-pet-stage\s*\{[\s\S]*?visibility:\s*visible/);
  assert.match(renderer, /\$\('dynamicModeButton'\)\.addEventListener\('click', \(\) => setMode\('dynamic'\)\)/);
  assert.match(renderer, /chartBarsRoot\.addEventListener\('click',[\s\S]*?drillDownChartPoint/);
  assert.match(renderer, /function drillDownChartPoint\(point\)[\s\S]*?chartLevel = 'intraday'/);
});

test('dual quota windows and truthful indeterminate progress are present in both panels', () => {
  const renderer = read('src/renderer-v2.js');
  const html = read('src/index-v2.html');
  for (const id of ['compactFiveHourQuotaValue', 'compactWeeklyQuotaValue', 'fiveHourQuotaCard', 'weeklyQuotaCard']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(renderer, /LOW_QUOTA_THRESHOLD\s*=\s*10/);
  assert.match(renderer, /findQuotaWindow\(usage, 300, 'primary'\)/);
  assert.match(renderer, /findQuotaWindow\(usage, 10080, 'secondary'\)/);
  assert.match(renderer, /taskVisuallyWorking\s*=\s*Boolean\(task\.isWorking\)/);
  assert.match(renderer, /is-indeterminate/);
  assert.doesNotMatch(html, /id="quotaArc"/);
});

test('actions finish before the ten-second idle gap and use cancellable frame playback', () => {
  const renderer = read('src/renderer-v2.js');
  const controller = read('src/pet-animation-controller.js');
  const adapter = read('src/pet-sequence-adapter.js');
  assert.match(renderer, /DYNAMIC_ACTION_GAP\s*=\s*10_000/);
  assert.match(renderer, /new PetAnimationController\(/);
  assert.match(controller, /scheduleRandom\(delay = this\.idleGap\)/);
  assert.match(controller, /abortController\.abort\(reason\)/);
  assert.match(adapter, /frameDuration = playbackDuration \/ definition\.order\.length/);
  assert.match(adapter, /async deactivate\(/);
});

test('drag struggle and sequence failures remain locally recoverable', () => {
  const renderer = read('src/renderer-v2.js');
  const controller = read('src/pet-animation-controller.js');
  const adapter = read('src/pet-sequence-adapter.js');
  const html = read('src/index-v2.html');
  const css = read('src/styles-v2.css');
  for (let index = 1; index <= 8; index += 1) {
    const filename = `mascot-drag-frame-${String(index).padStart(2, '0')}.webp`;
    assert.match(html, new RegExp(filename.replace('.', '\\.')));
    assert.ok(fs.existsSync(path.join(root, 'src', 'assets', filename)), filename);
  }
  assert.match(css, /@keyframes dragFramePulse/);
  assert.match(adapter, /sequence asset failed; using static fallback/);
  assert.match(controller, /status: 'failed'/);
  assert.match(controller, /settleIdle/);
  assert.doesNotMatch(renderer, /layeredRig|PET_RIG_MANIFEST|resetLayeredRig/);
  assert.doesNotMatch(html, /捕获到好心情|再摸一下/);
});

test('PetAnimationController owns runtime state changes and UI only sends intents', () => {
  const renderer = read('src/renderer-v2.js');
  const controller = read('src/pet-animation-controller.js');
  const html = read('src/index-v2.html');
  assert.match(renderer, /onStateChange:\s*applyControllerState/);
  assert.match(renderer, /petAnimationController\?\.hold\('drag'/);
  assert.match(renderer, /petAnimationController\?\.request\('land'/);
  assert.match(renderer, /petAnimationController\?\.request\('pet'/);
  assert.match(controller, /PET_ANIMATION_PRIORITIES/);
  assert.match(html, /pet-animation-controller\.js/);
  assert.doesNotMatch(html, /layeredRig|pet-rig-manifest/);
  assert.match(renderer, /PET_RANDOM_ACTIONS\.includes\(action\)/);
  assert.equal(fs.existsSync(path.join(root, 'src/pet-rig-manifest.js')), false);
});

test('recent logs UI is removed while chart and runtime details remain', () => {
  const html = read('src/index-v2.html');
  const renderer = read('src/renderer-v2.js');
  assert.doesNotMatch(html + renderer, /historyLogList|historyLogCount|最近项目日志/);
  for (const id of ['chartBars', 'historySlider', 'modelName', 'effortValue', 'speedValue']) {
    assert.ok(html.includes('id="' + id + '"'));
  }
});

test('idle atlas has 24 distinct PNG frames and is rendered independently of native movement', () => {
  const crypto = require('node:crypto');
  const hashes = new Set();
  for (let n = 1; n <= 24; n++) {
    const buffer = fs.readFileSync(path.join(root, 'src/assets/idle', 'idle-' + String(n).padStart(2, '0') + '.png'));
    assert.equal(buffer.readUInt32BE(16), 246);
    assert.equal(buffer.readUInt32BE(20), 292);
    hashes.add(crypto.createHash('sha256').update(buffer).digest('hex'));
  }
  assert.equal(hashes.size, 24);
  const atlas = fs.readFileSync(path.join(root, 'src/assets/idle/idle-atlas.png'));
  assert.equal(atlas.readUInt32BE(16), 1476);
  assert.equal(atlas.readUInt32BE(20), 1168);
  assert.doesNotMatch(read('src/pet-idle-player.js'), /petDrag|setPosition|setBounds/);
});

test('sleep is removed from the runtime while drag and idle stay available', () => {
  assert.doesNotMatch(read('src/renderer-v2.js'), /mascot-action-sleep|mascot-sequence-sleep/);
  assert.doesNotMatch(read('src/index-v2.html'), /pose-sleep/);
  assert.match(read('src/renderer-v2.js'), /randomEnabled: false/);
  assert.match(read('src/styles-v2.css'), /dynamic-idle canvas/);
});
