const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const sample = {
  ok: true,
  timestamp: Date.now(),
  project: { name: 'codex额度显示', path: 'C:\\Work\\codex额度显示', sessions: 4 },
  state: 'working',
  task: {
    isWorking: true,
    isDone: false,
    model: 'gpt-5.6-sol',
    progress: { percent: 58, completed: 2, total: 5, activeStep: '实现桌面悬浮窗与实时数据桥' }
  },
  usage: {
    remainingPercent: 89,
    usedPercent: 11,
    resetsAt: Date.now() + 4.2 * 24 * 60 * 60 * 1000,
    totalTokens: 1_147_175,
    currentTokens: 85_689,
    deltaTokens: 12_480,
    inputTokens: 1_141_041,
    cachedTokens: 1_057_024
  }
};

(async () => {
  const browserCandidates = [
    process.env.CODEX_CAPTURE_BROWSER,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    chromium.executablePath()
  ].filter(Boolean);
  const executablePath = browserCandidates.find((candidate) => fs.existsSync(candidate));
  const browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage({ viewport: { width: 432, height: 680 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((value) => {
    window.codexMeter = {
      getSnapshot: async () => value,
      onSnapshot: () => () => {},
      minimize: () => {},
      close: () => {},
      togglePin: async () => true,
      setExpanded: () => {}
    };
  }, sample);
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'src', 'index.html')).href);
  await page.waitForTimeout(900);
  const output = path.join(__dirname, '..', 'artifacts', 'widget-preview.png');
  await page.screenshot({ path: output, omitBackground: true });
  const audit = await page.evaluate(() => ({
    state: document.querySelector('.widget')?.dataset.state,
    quota: document.querySelector('#quotaValue')?.textContent,
    progress: document.querySelector('#progressPercent')?.textContent,
    total: document.querySelector('#totalTokens')?.textContent,
    bodyOverflow: getComputedStyle(document.body).overflow,
    widgetRect: document.querySelector('.widget')?.getBoundingClientRect().toJSON()
  }));
  console.log(JSON.stringify({ audit, errors }, null, 2));
  await browser.close();
  if (errors.length) process.exitCode = 1;
})();
