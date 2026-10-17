// 浏览器取证工具：用 Chrome DevTools Protocol 打开页面，回收 console/异常/截图。
// DSH 内置浏览器在本机不可用（缺 Electron 二进制），故直接用系统 Chrome 无头模式。
//
// 用法:
//   node tools/browser-probe.mjs --url http://127.0.0.1:9500/ --shot art-source/evidence/phase0.png --eval "__game.frames"
//
// 退出码 0 = 没有 console error 也没有未捕获异常；1 = 有。
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));
if (!CHROME) { console.error('找不到 Chrome/Edge'); process.exit(2); }

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const url = opt('url');
const shot = opt('shot');
const waitMs = Number(opt('wait', 1500));
const port = Number(opt('port', 9333));
const evals = argv.flatMap((a, i) => (a === '--eval' ? [argv[i + 1]] : []));
// --eval-file 用于承载带引号的复杂脚本，避免命令行转义地狱。
for (const [i, a] of argv.entries()) {
  if (a === '--eval-file') evals.push(readFileSync(argv[i + 1], 'utf8'));
}
if (!url) { console.error('缺少 --url'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// --profile 复用同一个浏览器 profile，让 localStorage 跨两次调用存活（验证"刷新后读档"必须这么做）。
const profileOpt = opt('profile');
const profile = profileOpt ? resolve(profileOpt) : resolve(tmpdir(), `cdp-probe-${Date.now()}`);
const keepProfile = Boolean(profileOpt);
const viewport = opt('viewport', '960x600');
const reloadBetween = argv.includes('--reload-between');
// --emulate 375x812：用 CDP 设备模拟得到真实视口。
// 注意 --window-size 无效——Chrome 桌面窗口有最小宽度（实测 512px），拿不到 375 宽。
const emulate = opt('emulate');

// 关键：必须 detached + 忽略 stdio。否则 Chrome 启动器会随父进程管道一起提前退出。
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run',
  '--no-default-browser-check', '--disable-background-networking',
  // 无头模式默认禁止自动播放，AudioContext 会一直是 suspended；验证音频必须放开这条策略。
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  `--window-size=${viewport.replace('x', ',')}`, 'about:blank',
], { detached: true, stdio: 'ignore' });
chrome.unref();

const cleanup = () => {
  try { execFileSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 已退出 */ }
  if (!keepProfile) { try { rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略 */ } }
};

// 轮询 /json/version，而不是去抢 stderr，避免竞态。
let targets = null;
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/list`);
    const list = await r.json();
    if (list.some((t) => t.type === 'page')) { targets = list; break; }
  } catch { /* 还没起来 */ }
  await sleep(300);
}
if (!targets) { cleanup(); console.error(`等待 CDP 端点超时 (port ${port})`); process.exit(2); }

const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const waiting = new Map();
const consoleErrors = [];
const exceptions = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    exceptions.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    consoleErrors.push(m.params.entry.text);
  }
};
const send = (method, params = {}) => new Promise((res) => {
  const id = ++msgId;
  waiting.set(id, (m) => res(m.result ?? m.error));
  ws.send(JSON.stringify({ id, method, params }));
});

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
if (emulate) {
  const [ew, eh] = emulate.split('x').map(Number);
  await send('Emulation.setDeviceMetricsOverride', {
    width: ew, height: eh, deviceScaleFactor: 2, mobile: true,
  });
}
await send('Page.navigate', { url });
await sleep(waitMs);

const results = {};
for (let i = 0; i < evals.length; i++) {
  const expr = evals[i];
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  results[expr] = r?.result?.value ?? r?.exceptionDetails?.text ?? null;

  // --reload-between：在当前页面刷新后继续跑下一个脚本。
  // 用于验证"刷新后读档"——比另起一次进程更真实，也不会因强杀 Chrome 丢掉未刷盘的 localStorage。
  if (reloadBetween && i < evals.length - 1) {
    await send('Page.navigate', { url });
    await sleep(waitMs);
  }
}
if (shot) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const abs = resolve(shot);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, Buffer.from(r.data, 'base64'));
  results.screenshot = abs;
}

ws.close();
cleanup();
const ok = consoleErrors.length === 0 && exceptions.length === 0;
console.log(JSON.stringify({ url, ok, consoleErrors, exceptions, evalResults: results }, null, 2));
process.exit(ok ? 0 : 1);