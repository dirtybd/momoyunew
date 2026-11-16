# 图标素材许可

- 来源：Lucide — https://github.com/lucide-icons/lucide
- 许可：ISC，允许复制、修改、分发和商用，保留版权与许可声明即可
- 许可全文：`LUCIDE-LICENSE.txt`
- 版本：`lucide-static` 1.71.0，2026-11-11 导出
- 文件：
  - `catalog.json`：2350 个图标，统一 24×24 viewBox，圆头线条，内联 SVG 内容
  - `keywords.json`：卡片中文/英文关键词到图标名称的映射（本项目自建）
  - `LUCIDE-LICENSE.txt`：Lucide 的 ISC 许可原文
- 生成方式：把 `lucide-static` 包解压到 `work/icon-src/lucide`，再执行 `npm run icons:build`
- 使用方式：后端 `server/card-icons.mjs` 把图标内联进卡片封面 SVG；运行时不再访问网络
