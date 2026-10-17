// why does connOverlay lose .show right after a failed connect?
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
  headless: 'new', args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-zygote'] });
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle2', timeout: 45000 });
await new Promise(r => setTimeout(r, 3000));
// instrument before tapping
await page.evaluate(() => {
  window.__log = [];
  const ov = document.getElementById('connOverlay');
  const obs = new MutationObserver(() => window.__log.push({ t: Date.now(), show: ov.classList.contains('show'), title: document.getElementById('connTitle').textContent }));
  obs.observe(ov, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('error', e => window.__log.push({ t: Date.now(), err: e.message }));
});
await page.touchscreen.tap(422, 195);
for (const wait of [500, 1500, 3000, 5000, 8000, 9000, 12000]) {
  await new Promise(r => setTimeout(r, wait === 500 ? 500 : 0));
  const s = await page.evaluate(() => ({ show: document.getElementById('connOverlay').classList.contains('show'), title: document.getElementById('connTitle').textContent, log: window.__log }));
  console.log(wait + 'ms', JSON.stringify(s));
  if (wait === 12000) break;
  await new Promise(r => setTimeout(r, wait === 500 ? 1000 : wait === 1500 ? 1500 : wait === 3000 ? 2000 : wait === 5000 ? 2000 : wait === 8000 ? 1000 : 3000));
}
await browser.close();
