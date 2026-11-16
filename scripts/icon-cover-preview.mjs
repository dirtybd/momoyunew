// 用自动挑选的图标渲染几张卡片封面预览（不写入数据库，不影响正式卡片）。
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {pickIcons, renderIconArtwork} from '../server/card-icons.mjs';

const outDir = path.resolve('work/icon-prototype');
const samples = [
  {
    name: 'electric-drawing',
    card: {
      title: '配电柜二次回路图纸审阅',
      problem: '新人画的低压配电柜二次回路图，需要老师傅按规范和安全要求帮忙审阅，指出接线和标注问题。',
      skills: ['电气', '图纸审阅', '低压配电']
    },
    design: {paper: '#f4ead8', accent: '#c4553d', sky: '#163b34', ink: '#211f1c'}
  },
  {
    name: 'translation',
    card: {
      title: '设备操作手册翻译成英文',
      problem: '把 30 页设备操作手册和表格术语翻译成英文，术语要统一。',
      skills: ['英文翻译', '文档整理']
    },
    design: {paper: '#eef0e6', accent: '#3f6b5a', sky: '#20302b', ink: '#1f241f'}
  },
  {
    name: 'training',
    card: {
      title: '新员工 PLC 培训',
      problem: '给新入职同事做一次 PLC 基础培训，需要课程材料和练习。',
      skills: ['培训', 'PLC', '自动化']
    },
    design: {paper: '#f7efe2', accent: '#b0662f', sky: '#2b241d', ink: '#241d17'}
  }
];

await mkdir(outDir, {recursive: true});
for (const sample of samples) {
  const icons = pickIcons(sample.card, 3);
  const svg = renderIconArtwork(sample.design, icons);
  await writeFile(path.join(outDir, sample.name + '.svg'), svg);
  await sharp(Buffer.from(svg), {density: 144}).resize(1200, 400).png().toFile(path.join(outDir, sample.name + '.png'));
  await sharp(Buffer.from(svg)).resize(320, 74, {fit: 'cover', position: 'centre'}).png().toFile(path.join(outDir, sample.name + '-thumb.png'));
  console.log(sample.name, '=>', icons.join(', '));
}
