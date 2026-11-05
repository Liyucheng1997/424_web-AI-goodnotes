// 导出 PDF / PNG、生成书库缩略图（Canvas 渲染，与屏幕上的 SVG 共用同一套几何）
import { jsPDF } from 'jspdf';
import { PAGE_W, PAGE_H, drawTemplate } from './canvas/templates.js';
import { drawElement } from './canvas/ink.js';
import { ensureFont } from './canvas/text.js';

async function fontsFor(pages) {
  const keys = new Set();
  let sample = '';
  for (const p of pages)
    for (const el of p.elements)
      if (el.type === 'text') {
        keys.add(el.font);
        if (sample.length < 6000) sample += el.text;
      }
  await Promise.all([...keys].map((k) => ensureFont(k, sample || undefined)));
}

export async function renderPageCanvas(page, scale = 2) {
  const c = document.createElement('canvas');
  c.width = Math.round(PAGE_W * scale);
  c.height = Math.round(PAGE_H * scale);
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  drawTemplate(ctx, page.template, page.paper);
  for (const el of page.elements) await drawElement(ctx, el);
  return c;
}

export async function exportPDF(pages, title = '笔记', onProgress) {
  await fontsFor(pages);
  const pdf = new jsPDF({ unit: 'px', format: [PAGE_W, PAGE_H], hotfixes: ['px_scaling'], compress: true });
  for (let i = 0; i < pages.length; i++) {
    onProgress?.(i + 1, pages.length);
    const c = await renderPageCanvas(pages[i], 2);
    if (i > 0) pdf.addPage([PAGE_W, PAGE_H], 'portrait');
    pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, PAGE_W, PAGE_H);
  }
  pdf.save(`${title || '笔记'}.pdf`);
}

export async function exportPNG(page, name = '页面') {
  await fontsFor([page]);
  const c = await renderPageCanvas(page, 2);
  const a = document.createElement('a');
  a.href = c.toDataURL('image/png');
  a.download = `${name}.png`;
  a.click();
}

export async function thumbnail(page) {
  await fontsFor([page]);
  const c = await renderPageCanvas(page, 0.32);
  return c.toDataURL('image/jpeg', 0.8);
}
