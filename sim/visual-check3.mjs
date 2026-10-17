// Full connection-state test against an UNREACHABLE server (?server= override)
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';
const OUT = '/sdcard/Road kill/screenshots'; mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
  headless: 'new', args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-zygote'] });
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await page.goto('http://127.0.0.1:5199/?server=ws://127.0.0.1:9999', { waitUntil: 'networkidle2', timeout: 45000 });
await new Promise(r => setTimeout(r, 3000));
const conn = () => page.evaluate(() => ({ show: document.getElementById('connOverlay')?.classList.contains('show'), title: document.getElementById('connTitle')?.textContent, sub: (document.getElementById('connSub')?.textContent||'').slice(0,60), count: document.getElementById('connCount')?.textContent, retry: getComputedStyle(document.getElementById('connRetryBtn')).display }));
await page.touchscreen.tap(422, 195);
await new Promise(r => setTimeout(r, 2000));
console.log('A-connecting', JSON.stringify(await conn())); await page.screenshot({ path: OUT + '/interaction-1-connecting.png' });
await new Promise(r => setTimeout(r, 4500));
console.log('B-waking   ', JSON.stringify(await conn())); await page.screenshot({ path: OUT + '/interaction-2-waking.png' });
await new Promise(r => setTimeout(r, 5500));
console.log('C-after8s  ', JSON.stringify(await conn()));
await new Promise(r => setTimeout(r, 9000));
console.log('D-failed   ', JSON.stringify(await conn())); await page.screenshot({ path: OUT + '/interaction-3-failed.png' });
await browser.close();
