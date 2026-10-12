import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import type {} from './svg-stall-page';

const output = process.env.SVG_OUTPUT ?? 'work/spikes/look/svg-stall/002';
const base = process.env.LOOK_URL ?? 'http://127.0.0.1:5181';
const headed = process.env.SVG_HEADED === '1';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: !headed, args: ['--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader'] });
const errors: string[] = [], messages: { type: string; text: string }[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 600, height: 570 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { messages.push({ type: message.type(), text: message.text() }); if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${base}/svg-stall.html`);
  await page.waitForFunction(() => window.svgRoute?.ready || window.svgRoute?.error);
  const state = await page.evaluate(() => ({ error: window.svgRoute.error, images: window.svgRoute.images, validation: window.svgRoute.validation }));
  if (state.error) throw new Error(state.error);
  if (state.images.length !== 6 || state.images.some(image => !image.renderer.toLowerCase().includes('swiftshader'))) throw new Error('Missing route image or unverified renderer');
  if (errors.length) throw new Error(errors.join('\n'));
  if (headed) {
    await page.bringToFront(); await page.screenshot({ path: `${output}/headed-comparison.png` });
    await writeFile(`${output}/headed.json`, JSON.stringify({ status: 'passed', browser: browser.version(), images: state.images, errors }, null, 2) + '\n');
  } else {
    const variants = [], frames = new Map<string, { png: PNG; sha256: string }>();
    for (const image of state.images) {
      const bytes = await page.locator(`#${image.id} canvas`).screenshot({ path: `${output}/${image.id}-64.png` });
      const png = PNG.sync.read(bytes);
      if (png.width !== 64 || png.height !== 64) throw new Error('Thumbnail dimensions differ from64px');
      frames.set(image.id, { png, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    await page.screenshot({ path: `${output}/comparison.png` });
    await page.evaluate(() => window.svgRoute.mask(true));
    const masks = new Map<string, PNG>();
    for (const image of state.images) { const bytes = await page.locator(`#${image.id} canvas`).screenshot({ path: `${output}/${image.id}-edges-64.png` }); masks.set(image.id, PNG.sync.read(bytes)); }
    for (const variant of [0, 1, 2]) {
      const a = frames.get(`three-${variant}`), b = frames.get(`svg-${variant}`), ma = masks.get(`three-${variant}`), mb = masks.get(`svg-${variant}`);
      if (!a || !b || !ma || !mb) throw new Error('Missing comparison frames');
      let changed = 0, maxDelta = 0, edgeChanged = 0, intersection = 0, union = 0;
      for (let index = 0; index < a.png.data.length; index += 4) {
        let delta = 0;
        for (let channel = 0; channel < 4; channel++) delta = Math.max(delta, Math.abs((a.png.data[index + channel] ?? 0) - (b.png.data[index + channel] ?? 0)));
        if (delta) changed++; maxDelta = Math.max(maxDelta, delta);
        const edgeA = (ma.data[index] ?? 255) < 128, edgeB = (mb.data[index] ?? 255) < 128;
        if (edgeA !== edgeB) edgeChanged++; if (edgeA && edgeB) intersection++; if (edgeA || edgeB) union++;
      }
      variants.push({ variant, changed_color_pixels: changed, max_channel_delta: maxDelta, changed_edge_pixels: edgeChanged, edge_iou: union ? intersection / union : null, three_sha256: a.sha256, svg_sha256: b.sha256 });
    }
    await writeFile(`${output}/render-report.json`, JSON.stringify({ status: 'measured', browser: browser.version(), canvas: { width: 64, height: 64, dpr: 1 }, technique: 'B', theme: 'day', ...state, variants, errors, messages }, null, 2) + '\n');
    console.log(JSON.stringify(variants, null, 2));
  }
  await page.evaluate(() => window.svgRoute.dispose()); await page.close();
} finally { await browser.close(); }
