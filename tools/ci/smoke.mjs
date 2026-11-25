// 港住走 · 開機測試：用冇畫面嘅 Chromium 開 app，逐個分頁㩒一次，有 JavaScript 錯誤就唔合格
// 用法：node tools/ci/smoke.mjs            （真係下載全港路線資料，要上網）
//       node tools/ci/smoke.mjs --fake-db  （用細細份假資料，唔使連 data.hkbus.app）
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {dirname, join, extname, normalize} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const {chromium} = createRequire(import.meta.url)('playwright');   // CommonJS 載入，咁樣全域安裝嘅 playwright 都用到

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FAKE = process.argv.includes('--fake-db');
const DATA_URL = 'https://data.hkbus.app/routeFareList.min.json';
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json'};

// 細細個靜態伺服器（GitHub Pages 咁樣原檔照出）
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  if (path.startsWith('..')) { res.writeHead(403).end(); return; }
  const file = join(root, path || 'index.html');
  try {
    const body = await readFile(file.endsWith('/') ? file + 'index.html' : file);
    res.writeHead(200, {'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Date': new Date().toUTCString()});
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

// 假資料：一條九巴線、兩個站，喺中環附近
const fakeDb = {
  holidays: [], serviceDayMap: {},
  stopList: {
    S1: {location: {lat: 22.2820, lng: 114.1580}, name: {zh: '中環碼頭', en: 'Central Pier'}},
    S2: {location: {lat: 22.2850, lng: 114.1520}, name: {zh: '上環站', en: 'Sheung Wan Station'}},
  },
  routeList: {
    '1+1+中環+上環': {route: '1', co: ['kmb'], bound: {kmb: 'O'}, serviceType: '1', orig: {zh: '中環', en: 'Central'}, dest: {zh: '上環', en: 'Sheung Wan'}, stops: {kmb: ['S1', 'S2']}, fares: ['5.0'], freq: null, jt: '10', gtfsId: '1', nlbId: null, seq: 2},
  },
};

const errors = [];
const own = u => u.startsWith(base);
const browser = await chromium.launch();
const ctx = await browser.newContext({
  locale: 'zh-HK', timezoneId: 'Asia/Hong_Kong', viewport: {width: 390, height: 844},
  geolocation: {latitude: 22.2819, longitude: 114.1582}, permissions: ['geolocation'],
});
if (FAKE) await ctx.route(DATA_URL, r => r.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(fakeDb)}));

async function open(path, label){
  const page = await ctx.newPage();
  const tag = m => `[${label}] ${m}`;
  // 冇被捉住嘅例外同 promise reject
  page.on('pageerror', e => errors.push(tag(e.stack || e.message)));
  // console.error：外面伺服器失敗（實時到站、天氣等）唔計，自己 app 嘅錯就計
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text(), src = m.location()?.url || '';
    if (/^Failed to load resource/.test(t) && !own(src)) return;
    errors.push(tag(`console.error: ${t}${src ? ` (${src})` : ''}`));
  });
  // 自己嘅檔案 404／500（例如 import 咗一個唔存在嘅 js）
  page.on('response', r => { if (own(r.url()) && r.status() >= 400) errors.push(tag(`HTTP ${r.status()} ${r.url().slice(base.length - 1)}`)); });
  page.on('requestfailed', r => { if (own(r.url())) errors.push(tag(`載入失敗 ${r.url().slice(base.length - 1)}: ${r.failure()?.errorText}`)); });
  await page.goto(base + path, {waitUntil: 'load'});
  return page;
}

try {
  const page = await open('index.html', 'index');
  // 等全港路線資料載入完（#boot 會被移除）；載入失敗會即刻顯示「載入唔到」，唔使等夠 90 秒
  const ok = await page.waitForFunction(() => !document.getElementById('boot') || /載入唔到|Could not load/.test(document.getElementById('boot').textContent), null, {timeout: 90000}).then(() => page.evaluate(() => !document.getElementById('boot'))).catch(() => false);
  if (!ok) {
    const msg = await page.locator('#boot').innerText().catch(() => '');
    errors.push(`[index] 路線資料載入唔到，app 停咗喺開機畫面：${msg.replace(/\s+/g, ' ').slice(0, 200)}` +
      (FAKE ? '' : '\n    （如果係 data.hkbus.app 暫時壞咗，可以遲啲 re-run，或者用 --fake-db）'));
  }
  if (!await page.locator('#boot').count()) {
    const tabs = await page.locator('#tabs [data-tab]').evaluateAll(bs => bs.map(b => b.dataset.tab));
    if (!tabs.length) errors.push('[index] 底部分頁冇出到');
    for (const pass of ['中文', 'English']) {
      for (const t of tabs) {
        await page.click(`#tabs [data-tab="${t}"]`);
        await page.waitForTimeout(1500);
        if (await page.locator(`#v-${t}`).count() && await page.locator(`#v-${t}`).isHidden()) errors.push(`[index] 㩒咗「${t}」分頁但係 #v-${t} 冇顯示`);
      }
      if (pass === '中文') { await page.click('#langBtn'); await page.waitForTimeout(800); }
    }
    console.log(`  已經試過分頁：${tabs.join('、')}（中英文各一次）`);
  }
  const share = await open('share.html', 'share');
  await share.waitForTimeout(3000);
} finally {
  await browser.close();
  server.close();
}

if (errors.length) { console.error(`✗ 開機測試唔合格，有 ${errors.length} 個錯誤：\n  - ` + errors.join('\n  - ')); process.exit(1); }
console.log('✓ 開機測試合格：app 開到，冇 JavaScript 錯誤');
