import {test} from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import sharp from 'sharp';
import {attachmentDigest, attachmentDigests} from '../server/attachment-digest.mjs';

const zip = async entries => {
  const archive = new JSZip();
  for (const [name, text] of Object.entries(entries)) archive.file(name, text);
  return archive.generateAsync({type: 'nodebuffer'});
};

test('文本、Word、PPT 和 Excel 生成短摘要，不返回完整内容', async () => {
  const text = '设备操作说明：断电后才能打开柜门。'.repeat(40);
  const textDigest = await attachmentDigest({name: '说明.txt', bytes: Buffer.from(text)});
  assert.equal(textDigest.kind, 'text');
  assert.ok(textDigest.summary.length <= 241);
  assert.ok(textDigest.summary.endsWith('…'));

  const docx = await zip({'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>设备清单 &amp; 要求</w:t></w:r></w:p></w:body></w:document>'});
  const docxDigest = await attachmentDigest({name: '需求.docx', bytes: docx});
  assert.equal(docxDigest.kind, 'document');
  assert.equal(docxDigest.summary, '设备清单 & 要求');

  const pptx = await zip({'ppt/slides/slide2.xml': '<p:sld><a:t>第二页</a:t></p:sld>', 'ppt/slides/slide1.xml': '<p:sld><a:t>项目汇报</a:t></p:sld>'});
  const pptxDigest = await attachmentDigest({name: '汇报.pptx', bytes: pptx});
  assert.equal(pptxDigest.kind, 'presentation');
  assert.equal(pptxDigest.summary, '项目汇报');

  const xlsx = await zip({'xl/workbook.xml': '<workbook><sheets><sheet name="User Texts"/><sheet name="汇总"/></sheets></workbook>'});
  const xlsxDigest = await attachmentDigest({name: '项目文本.xlsx', bytes: xlsx});
  assert.equal(xlsxDigest.kind, 'workbook');
  assert.equal(xlsxDigest.summary, '工作表：User Texts、汇总');
});

test('图片只给尺寸，视频和无法解析的二进制不给内容', async () => {
  const png = await sharp({create: {width: 12, height: 8, channels: 3, background: '#ff8a32'}}).png().toBuffer();
  const image = await attachmentDigest({name: '截图.png', bytes: png, isImage: true});
  assert.equal(image.kind, 'image');
  assert.equal(image.summary, 'png 12×8');

  assert.equal((await attachmentDigest({name: '演示.mp4', bytes: Buffer.from('video')})).summary, null);
  assert.equal((await attachmentDigest({name: '图纸.dwg', bytes: Buffer.from('binary')})).summary, null);
  assert.equal((await attachmentDigest({name: '空.txt', bytes: Buffer.alloc(0)})).summary, null);
  assert.equal((await attachmentDigest({name: '损坏.docx', bytes: Buffer.from('not a zip')})).summary, null);
});

test('批量摘要保持文件顺序和名称', async () => {
  const list = await attachmentDigests([
    {name: 'a.txt', bytes: Buffer.from('第一份')},
    {name: 'b.bin', bytes: Buffer.from('binary')},
  ]);
  assert.deepEqual(list.map(item => item.name), ['a.txt', 'b.bin']);
  assert.equal(list[0].summary, '第一份');
  assert.equal(list[1].summary, null);
});
