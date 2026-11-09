import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';

mkdirSync('work', { recursive: true });
const data = mkdtempSync(resolve('work/e2e-data-'));
const child = spawn(process.execPath, ['server/index.mjs'], {
  stdio: 'inherit', windowsHide: true,
  env: { ...process.env, PORT: '8791', HOST: '127.0.0.1', DATA_DIR: data, DIFY_API_KEY: process.env.MOMOYU_DIFY_LIVE === '1' ? (process.env.DIFY_API_KEY || '') : '' }
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
child.on('error', e => { console.error(e.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
