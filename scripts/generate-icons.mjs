// Rasterize the editable vector mark into Chrome-compatible PNG sizes.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const directory = new URL('../public/icons/', import.meta.url);
await mkdir(directory, { recursive: true });
const svg = await readFile(new URL('mark.svg', directory), 'utf8');
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of [16, 32, 48, 128, 512]) {
    const data = await page.evaluate(async ({ svg, size }) => {
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
      canvas.getContext('2d').drawImage(image, 0, 0, size, size);
      return canvas.toDataURL('image/png').split(',')[1];
    }, { svg, size });
    await writeFile(new URL(`icon-${size}.png`, directory), Buffer.from(data, 'base64'));
  }
} finally { await browser.close(); }
console.log('Generated 16, 32, 48, 128 and 512px Autofill OS icons.');
