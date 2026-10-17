import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
  headless: 'new', args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-zygote'] });
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle2', timeout: 45000 });
await new Promise(r => setTimeout(r, 3000));
const at = await page.evaluate(() => {
  const el = document.elementFromPoint(422, 195);
  return { tag: el?.tagName, id: el?.id, cls: el?.className?.toString?.().slice(0,40), text: el?.textContent?.slice(0,30) };
});
console.log('element at tap point:', JSON.stringify(at));
await page.touchscreen.tap(422, 195);
await new Promise(r => setTimeout(r, 1000));
const st = await page.evaluate(() => ({
  centerMsg: document.getElementById('center-msg')?.style.display,
  online: document.getElementById('onlineOverlay')?.classList.contains('show'),
  conn: document.getElementById('connOverlay')?.classList.contains('show'),
  connTitle: document.getElementById('connTitle')?.textContent,
}));
console.log('after tap:', JSON.stringify(st));
await browser.close();
