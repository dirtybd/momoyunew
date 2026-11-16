import { defineConfig } from 'vite';
import path from 'node:path';

// 默认监听所有网卡，同一内网的其他人可用 http://<本机内网IP>:5174/ 访问。
// 只想本机访问时，在 .env 里设置 MOMOYU_HOST=127.0.0.1。
const host = process.env.MOMOYU_HOST || '0.0.0.0';

export default defineConfig({
  root: path.resolve('frontend'),
  server: {
    host,
    port: 5174,
    strictPort: true,
    // 内网其他机器可能用主机名访问，关闭 Vite 的 Host 白名单。
    allowedHosts: true,
    // Keep the browser Host so the backend's same-origin check also works in development.
    proxy: { '/api': { target: 'http://127.0.0.1:8788', changeOrigin: false } }
  },
  build: { outDir: path.resolve('dist'), emptyOutDir: true }
});
