import JSZip from 'jszip';
import sharp from 'sharp';

// 卡片助手只拿文件名和摘要：摘要在本地生成，最多 240 字，绝不把完整文件内容
// 交给模型。这样卡片设计不必等 Dify 下载、解析附件，也不会因为材料太大而变慢。
export const DIGEST_LIMIT = 240;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'log']);
const MEDIA_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'mp4', 'webm', 'mov', 'avi', 'mkv']);

const collapse = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const extension = name => String(name ?? '').split('.').pop()?.toLowerCase() || '';

function decodeXml(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const xmlText = xml => collapse(decodeXml(String(xml).replace(/<[^>]+>/g, ' ')));

function excerpt(value, limit = DIGEST_LIMIT) {
  const text = collapse(value);
  if (!text) return null;
  return text.length > limit ? text.slice(0, limit) + '…' : text;
}

async function zipEntry(bytes, path) {
  try {
    const zip = await JSZip.loadAsync(bytes);
    const entry = zip.file(path);
    return entry ? await entry.async('string') : null;
  } catch {
    return null;
  }
}

async function docxDigest(bytes, limit) {
  const xml = await zipEntry(bytes, 'word/document.xml');
  return xml ? excerpt(xmlText(xml), limit) : null;
}

async function pptxDigest(bytes, limit) {
  try {
    const zip = await JSZip.loadAsync(bytes);
    const slides = Object.keys(zip.files)
      .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => Number(a.match(/(\d+)/)?.[1] || 0) - Number(b.match(/(\d+)/)?.[1] || 0));
    if (!slides.length) return null;
    const xml = await zip.file(slides[0]).async('string');
    return excerpt(xmlText(xml), limit);
  } catch {
    return null;
  }
}

async function workbookDigest(bytes) {
  const xml = await zipEntry(bytes, 'xl/workbook.xml');
  if (!xml) return null;
  const names = [...xml.matchAll(/<sheet\b[^>]*\bname="([^"]+)"/g)].map(match => decodeXml(match[1]));
  return names.length ? `工作表：${names.join('、')}` : null;
}

async function imageDigest(bytes) {
  try {
    const {width, height, format} = await sharp(bytes, {limitInputPixels: 40000000}).metadata();
    if (!width || !height) return null;
    return `${format || '图片'} ${width}×${height}`;
  } catch {
    return null;
  }
}

// 返回 {name,size,kind,summary}。summary 为空表示只能给名称，调用方不得编造内容。
export async function attachmentDigest(file, {limit = DIGEST_LIMIT} = {}) {
  const name = String(file?.name ?? '');
  const bytes = file?.bytes;
  const base = {name, size: bytes?.length || 0};
  if (!bytes?.length) return {...base, kind: 'unknown', summary: null};
  const ext = extension(name);
  try {
    if (file?.isImage || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) {
      return {...base, kind: 'image', summary: await imageDigest(bytes)};
    }
    if (MEDIA_EXTENSIONS.has(ext)) return {...base, kind: 'media', summary: null};
    if (TEXT_EXTENSIONS.has(ext)) {
      if (bytes.length > MAX_TEXT_BYTES) return {...base, kind: 'text', summary: null, truncated: true};
      return {...base, kind: 'text', summary: excerpt(bytes.toString('utf8'), limit)};
    }
    if (ext === 'docx') return {...base, kind: 'document', summary: await docxDigest(bytes, limit)};
    if (ext === 'pptx') return {...base, kind: 'presentation', summary: await pptxDigest(bytes, limit)};
    if (ext === 'xlsx' || ext === 'xlsm') return {...base, kind: 'workbook', summary: await workbookDigest(bytes)};
    return {...base, kind: 'binary', summary: null};
  } catch {
    return {...base, kind: 'unknown', summary: null};
  }
}

export async function attachmentDigests(files = []) {
  return Promise.all((files || []).map(file => attachmentDigest(file)));
}
