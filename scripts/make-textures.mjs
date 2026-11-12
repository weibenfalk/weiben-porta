// Renders the three noise textures (brushed aluminium, wood grain, plastic grain) to small grey WebP files in public/tex/.
// They used to be SVG feTurbulence backgrounds, which WebKit repaints on the CPU and which made phones hot and laggy.
// Each texture is blended with `overlay`, and overlay is linear in the blend colour with 50% grey as neutral, so the
// original opacity is baked in as  v = 0.5 + (c - 0.5) * alpha  and the files are opaque. The look is unchanged.
//
//   needs playwright and Google Chrome:  npm i --no-save playwright && node scripts/make-textures.mjs
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const out = process.argv[2] || 'public/tex';
mkdirSync(out, { recursive: true });
const svg = (w, h, freq, oct, seed, alpha, stitch) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" preserveAspectRatio="none" viewBox="0 0 ${w} ${h}"><filter id="f" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${oct}" seed="${seed}"${stitch ? " stitchTiles='stitch'" : ''}/><feColorMatrix type="matrix" values=".33 .33 .33 0 0 .33 .33 .33 0 0 .33 .33 .33 0 0 0 0 0 0 ${alpha}"/></filter><rect width="100%" height="100%" filter="url(#f)"/></svg>`;
const TEX = {
  brushed: [1400, 900, '0.004 0.9', 3, 7, 0.75, false],
  wood: [96, 1100, '0.32 0.006', 4, 11, 0.9, false],
  grain: [600, 600, '0.85 0.85', 2, 5, 0.6, true],
};
const b = await chromium.launch({ channel: 'chrome' });
const page = await b.newPage();
for (const [name, [w, h, freq, oct, seed, alpha, stitch]] of Object.entries(TEX)) {
  const b64 = await page.evaluate(async ([markup, w, h]) => {
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
    await img.decode();
    const c = new OffscreenCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h), px = d.data;
    for (let i = 0; i < px.length; i += 4) {
      const v = Math.round(127.5 + (px[i] - 127.5) * (px[i + 3] / 255));
      px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255;
    }
    g.putImageData(d, 0, 0);
    const blob = await c.convertToBlob({ type: 'image/webp', quality: 0.85 });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, [svg(w, h, freq, oct, seed, alpha, stitch), w, h]);
  const buf = Buffer.from(b64, 'base64');
  writeFileSync(`${out}/${name}.webp`, buf);
  console.log(name, `${w}x${h}`, (buf.length / 1024).toFixed(0) + ' KB');
}
await b.close();
