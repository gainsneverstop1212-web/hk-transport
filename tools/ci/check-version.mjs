// 港住走 · 出版本前檢查：js/core.js 嘅 APP_VER 同 sw.js 嘅 SHELL 版本號要一樣，
// 同埋 sw.js 要預先快取嘅檔案全部存在、每個 js/*.js 都有列入（唔係冇網開唔到 app）
// 用法：node tools/ci/check-version.mjs
import {readFileSync, existsSync, readdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => readFileSync(join(root, p), 'utf8');
const errs = [];

const core = read('js/core.js'), sw = read('sw.js');
const appVer = +(/export const APP_VER\s*=\s*(\d+)/.exec(core) || [])[1];
const shellVer = +(/const SHELL\s*=\s*'hkgo-shell-v(\d+)'/.exec(sw) || [])[1];
if (!appVer) errs.push('喺 js/core.js 搵唔到 APP_VER');
if (!shellVer) errs.push("喺 sw.js 搵唔到 SHELL = 'hkgo-shell-vNN'");
if (appVer && shellVer && appVer !== shellVer) errs.push(`版本號唔一致：js/core.js APP_VER = ${appVer}，sw.js SHELL = v${shellVer}（兩個要一齊改）`);

const list = /const FILES\s*=\s*\[([\s\S]*?)\];/.exec(sw);
if (!list) errs.push('喺 sw.js 搵唔到 FILES 清單');
else {
  const files = [...list[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  for (const f of files) if (f !== './' && !existsSync(join(root, f))) errs.push(`sw.js FILES 有 ${f}，但個檔案唔存在（service worker 會裝唔到）`);
  for (const f of readdirSync(join(root, 'js')).filter(f => f.endsWith('.js')))
    if (!files.includes('./js/' + f)) errs.push(`js/${f} 冇列入 sw.js 嘅 FILES（冇網時會開唔到）`);
}

if (errs.length) { console.error('✗ 版本檢查唔合格：\n  - ' + errs.join('\n  - ')); process.exit(1); }
console.log(`✓ 版本檢查合格：第 ${appVer} 版，sw.js 快取清單齊全`);
