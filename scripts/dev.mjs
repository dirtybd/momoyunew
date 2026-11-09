import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
try{process.loadEnvFile(new URL('../.env',import.meta.url));}catch(e){if(e.code!=='ENOENT')throw e;}
const autoOpen = process.argv.includes('--open');
const url = 'http://127.0.0.1:5174/';
async function ready() {
  try {
    const [health, page] = await Promise.all([
      fetch(url + 'api/health', {signal: AbortSignal.timeout(1000)}),
      fetch(url, {signal: AbortSignal.timeout(1000)})
    ]);
    return health.ok && (await health.json()).ok === true && page.ok && (await page.text()).includes('摸摸鱼');
  } catch { return false; }
}
async function openBrowser() {
  console.log(`网站已就绪：${url}`);
  if (process.platform !== 'win32') { console.log('请在浏览器中打开上方网址。'); return; }
  await new Promise(resolve => {
    const browser = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'Stop'; Start-Process -FilePath '${url}'`], {stdio: 'ignore', windowsHide: true});
    const finish = success => {
      console.log(success ? '已请求默认浏览器打开。若未显示，请手动打开上方网址。' : '未能自动打开浏览器，请手动打开上方网址。');
      resolve();
    };
    browser.once('error', () => finish(false));
    browser.once('exit', code => finish(code === 0));
  });
}
if (autoOpen && await ready()) {
  console.log(`摸摸鱼已经在运行，打开 ${url}`);
  await openBrowser();
} else {
if (!existsSync(new URL('../server/index.mjs', import.meta.url))) {
  console.error('后端文件尚未就绪：server/index.mjs');
  process.exit(1);
}
const commands = [
  ...(process.env.CARD_TOOL_SECRET?[['--env-file-if-exists=.env', 'scripts/card-tool.mjs']]:[]),
  ['--env-file-if-exists=.env', 'server/index.mjs'],
  ['node_modules/vite/bin/vite.js']
];
const children = commands.map(args => spawn(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true }));
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code || 0); });
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
if (autoOpen) {
  const deadline = Date.now() + 30000;
  while (!stopping && Date.now() < deadline) {
    if (await ready()) { await openBrowser(); break; }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  if (!stopping && Date.now() >= deadline) console.log(`浏览器未自动打开，请稍后访问 ${url}`);
}
}
