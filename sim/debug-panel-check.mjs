// Debug panel: 3 taps on top-left corner opens it; shows all required fields
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';
const OUT = '/sdcard/Road kill/screenshots'; mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
  headless: 'new', args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-zygote'] });
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await page.goto('http://127.0.0.1:5199/?server=ws://10.255.255.1:8130', { waitUntil: 'networkidle2', timeout: 45000 });
await new Promise(r => setTimeout(r, 2500));
await page.touchscreen.tap(40, 35); await page.touchscreen.tap(40, 35); await page.touchscreen.tap(40, 35);
await new Promise(r => setTimeout(r, 1200));
const st = await page.evaluate(() => {
  const p = document.getElementById('debugPanel');
  return { open: p.classList.contains('show'), text: p.textContent };
});
console.log('panel-open:', st.open); console.log(st.text);
await page.screenshot({ path: OUT + '/debug-panel.png' });
await browser.close();
