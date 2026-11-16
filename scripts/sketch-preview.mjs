// 预览手绘风卡片封面：根据卡片文本自动选场景，不写数据库、不影响正式卡片。
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {planSketch, renderSketch} from '../server/card-sketch.mjs';

const outDir = path.resolve('work/icon-prototype/sketch');
const samples = [
  {
    name: '01-translation',
    card: {
      title: '翻译《私有化部署模型 API 使用安全告知书》',
      problem: '把安全告知书翻译成英文，术语要统一，保留原文格式和编号。',
      skills: ['翻译', '文档整理']
    },
    design: {paper: '#FFF9EF', accent: '#C25B2E'}
  },
  {
    name: '02-electric-review',
    card: {
      title: '低压配电柜二次回路图纸审阅',
      problem: '新人画的低压配电柜二次回路图，需要老师傅按规范和安全要求审阅，指出接线和标注问题。',
      skills: ['电气', '图纸审阅', '低压配电']
    }
  },
  {
    name: '03-plc-training',
    card: {
      title: '新员工 PLC 基础培训',
      problem: '给新入职同事做一次 PLC 基础培训，需要课程材料、练习和现场演示。',
      skills: ['培训', 'PLC', '自动化']
    }
  },
  {
    name: '04-data-report',
    card: {
      title: '月度能耗数据复盘',
      problem: '汇总各车间一个月的能耗数据，做趋势分析并找出异常点。',
      skills: ['数据分析', '报表']
    }
  },
  {
    name: '05-collab',
    card: {
      title: '跨部门协作梳理审批流程',
      problem: '和财务、采购一起梳理报销审批流程，找出卡点并给改进建议。',
      skills: ['协作', '流程梳理']
    }
  },
  {
    name: '06-review',
    card: {
      title: '设备操作手册校对',
      problem: '帮忙校对设备操作手册里的步骤和术语，标出前后不一致的地方。',
      skills: ['审阅', '文档']
    }
  }
];

await mkdir(outDir, {recursive: true});
for (const sample of samples) {
  const scene = planSketch(sample.card, sample.design || {});
  const svg = renderSketch(scene);
  await writeFile(path.join(outDir, sample.name + '.svg'), svg);
  await sharp(Buffer.from(svg)).png().toFile(path.join(outDir, sample.name + '.png'));
  await sharp(Buffer.from(svg)).resize(320, 74, {fit: 'cover'}).png().toFile(path.join(outDir, sample.name + '-thumb.png'));
  console.log(sample.name, '=>', scene.objects.map(object => object.kind).join(', '),
    (svg.length / 1024).toFixed(1) + 'KB');
}
