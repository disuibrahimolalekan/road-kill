// Waking-state test: a server IP that blackholes (connects but never responds)
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';
const OUT = '/sdcard/Road kill/screenshots'; mkdirSync(OUT, { recursive: true });
// blackhole: 10.255.255.1 — unroutable, TCP hangs until timeout
const browser = await puppeteer.launch({ executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
  headless: 'new', args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-zygote'] });
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await page.goto('http://127.0.0.1:5199/?server=ws://10.255.255.1:8130', { waitUntil: 'networkidle2', timeout: 45000 });
await new Promise(r => setTimeout(r, 3000));
const conn = () => page.evaluate(() => ({ show: document.getElementById('connOverlay')?.classList.contains('show'), title: document.getElementById('connTitle')?.textContent, count: document.getElementById('connCount')?.textContent, retry: getComputedStyle(document.getElementById('connRetryBtn')).display }));
await page.touchscreen.tap(422, 195);
await new Promise(r => setTimeout(r, 2500));
console.log('A-connecting', JSON.stringify(await conn()));
await new Promise(r => setTimeout(r, 4000)); // >4s → should flip to WAKING + countdown
console.log('B-waking   ', JSON.stringify(await conn())); await page.screenshot({ path: OUT + '/interaction-2-waking.png' });
await new Promise(r => setTimeout(r, 6000));
console.log('C-counting ', JSON.stringify(await conn()));
await new Promise(r => setTimeout(r, 20000));
console.log('D-timeout  ', JSON.stringify(await conn())); await page.screenshot({ path: OUT + '/interaction-3-failed.png' });
await browser.close();
