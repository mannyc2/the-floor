import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readdir } from 'node:fs/promises';
const runtime = process.env.LOOK_PLAYWRIGHT_MODULE ?? '/Users/chriscarroll/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(runtime).href);
const root = resolve('docs/spikes/evidence/look/references');
const groups = process.argv.slice(2);
const escape = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const group of groups) {
    const folder = resolve(root, group, '001');
    const candidates = (await readdir(folder)).filter((name) => /^candidate-\d\d\.png$/.test(name)).sort();
    if (candidates.length !== 12) throw new Error(`Expected 12 images for ${group}, got ${candidates.length}`);
    const cards = [];
    for (const name of candidates) {
      const screening = await Bun.file(resolve(folder, name.replace('.png', '.screening.json'))).json();
      const labels = [];
      if (screening.perspective.status === 'rejected_by_heuristic') labels.push('P: convergence');
      if (screening.orange.count !== 1) labels.push(`O: ${screening.orange.count} regions`);
      if (screening.ocr.flagged_tokens.length > 0) labels.push(`T: ${screening.ocr.flagged_tokens.length} OCR flags`);
      if (screening.nonopaque_pixels > 0) labels.push('A: transparency');
      const status = labels.length > 0 ? labels.join(' / ') : 'No automatic flags';
      cards.push(`<article><a href="${escape(name)}"><img src="${escape(name)}" alt="${escape(group)} candidate ${name.slice(10, 12)}"></a><div class="caption"><b>${name.slice(10, 12)}</b><span>${escape(status)}</span></div></article>`);
    }
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escape(group)} candidates</title><style>*{box-sizing:border-box}body{margin:0;background:#f1efe9;color:#252a31;font-family:Arial,sans-serif;padding:32px}h1{font-size:38px;margin:0 0 10px}p{font-size:22px;margin:0 0 24px;line-height:1.35}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}article{background:#fff;border:1px solid #c6c8ca;min-width:0}img{display:block;width:100%;height:${group.startsWith('screen') ? '365' : '625'}px;object-fit:contain;background:#f6f5f1}.caption{padding:12px 14px;min-height:62px;display:flex;gap:15px;align-items:center;font-size:18px;line-height:1.3}.caption b{font-size:28px}.caption span{max-width:520px}footer{font-size:19px;margin-top:22px;line-height:1.4}</style><h1>${escape(group.replace('-', ' / ').toUpperCase())} · 12 reference candidates</h1><p>All independent generated originals retained. Automatic screening only; Claude shortlist and owner picks pending.</p><div class="grid">${cards.join('')}</div><footer>P = edge-convergence heuristic · O = palette-mask orange components · T = OCR glyph flags · A = unexpected transparency.<br>Flags can include false positives. No automatic result establishes orthographic projection, artistic quality or approval.</footer></html>`;
    await Bun.write(resolve(folder, 'contact-sheet.html'), html);
    const page = await browser.newPage({ viewport: { width: 2048, height: 1200 }, deviceScaleFactor: 1 });
    await page.route('**/*', (route) => /^(file|data):/.test(route.request().url()) ? route.continue() : route.abort());
    await page.goto(pathToFileURL(resolve(folder, 'contact-sheet.html')).href);
    await page.locator('img').first().waitFor();
    await page.evaluate(async () => { await Promise.all([...document.images].map((img) => img.decode())); await document.fonts.ready; });
    await page.screenshot({ path: resolve(folder, 'contact-sheet.png'), fullPage: true });
    await page.close();
    console.log(JSON.stringify({ group, candidates: candidates.length, width: 2048, playwright: (await import(pathToFileURL(resolve(runtime, '..', 'package.json')).href, { with: { type: 'json' } })).default.version }));
  }
} finally { await browser.close(); }
