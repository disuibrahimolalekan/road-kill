// Connection states with NO server reachable (baked prod URL will fail fast here)
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';
const OUT = '/sdcard/Road kill/screenshots'; mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
  headless: 'new', args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-zygote'] });
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle2', timeout: 45000 });
await new Promise(r => setTimeout(r, 3500));
const conn = () => page.evaluate(() => ({ show: document.getElementById('connOverlay')?.classList.contains('show'), title: document.getElementById('connTitle')?.textContent, sub: document.getElementById('connSub')?.textContent, count: document.getElementById('connCount')?.textContent, retry: getComputedStyle(document.getElementById('connRetryBtn')).display }));
await page.touchscreen.tap(422, 195);
await new Promise(r => setTimeout(r, 2500));
console.log('A', JSON.stringify(await conn())); await page.screenshot({ path: OUT + '/interaction-1-connecting.png' });
await new Promise(r => setTimeout(r, 4000));
console.log('B', JSON.stringify(await conn())); await page.screenshot({ path: OUT + '/interaction-2-waking.png' });
await new Promise(r => setTimeout(r, 16000));
console.log('C', JSON.stringify(await conn())); await page.screenshot({ path: OUT + '/interaction-3-failed.png' });
// retry button click → back to connecting
await page.evaluate(() => document.getElementById('connRetryBtn').click());
await new Promise(r => setTimeout(r, 1200));
console.log('D', JSON.stringify(await conn())); 
await browser.close();
