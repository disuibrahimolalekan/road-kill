import { readFileSync } from 'fs';
import { PNG } from 'pngjs';
const files = ['phone-844x390-landscape.png','phone-390x844-portrait.png','phone-800x360-landscape.png','phone-360x800-portrait.png','tablet-1280x800.png'];
const dir = '/sdcard/Road kill/screenshots/';
for (const f of files) {
  const png = PNG.sync.read(readFileSync(dir + f));
  let colorful = 0, total = png.width * png.height;
  const seen = new Set();
  for (let i = 0; i < png.data.length; i += 397 * 4) { // sparse sample
    const r = png.data[i], g = png.data[i+1], b = png.data[i+2];
    const lum = 0.3*r + 0.6*g + 0.1*b;
    const sat = Math.max(r,g,b) - Math.min(r,g,b);
    if (lum > 24 && sat > 18) colorful++;
    seen.add(((r>>4)<<8)|((g>>4)<<4)|(b>>4));
  }
  const samples = Math.ceil(png.data.length / (397*4));
  console.log(f.padEnd(30), 'colorful%:', (100*colorful/samples).toFixed(1), 'distinct-colors:', seen.size);
}
