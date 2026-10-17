// Interaction test: tap center → connection states should cycle; verify connOverlay shows
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'fs';
const OUT = '/sdcard/Road kill/screenshots'; mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
  headless: 'new', args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-zygote'] });
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle2', timeout: 45000 });
await new Promise(r => setTimeout(r, 3500));
// 1. tap the canvas (first tap → fullscreen attempt + connect)
await page.touchscreen.tap(422, 195);
await new Promise(r => setTimeout(r, 1500));
const connecting = await page.evaluate(() => ({ conn: document.getElementById('connOverlay')?.classList.contains('show'), title: document.getElementById('connTitle')?.textContent }));
await page.screenshot({ path: OUT + '/interaction-1-connecting.png' });
// 2. wait for the waking state (>4s) since no server is running locally
await new Promise(r => setTimeout(r, 5000));
const waking = await page.evaluate(() => ({ conn: document.getElementById('connOverlay')?.classList.contains('show'), title: document.getElementById('connTitle')?.textContent, count: document.getElementById('connCount')?.textContent }));
await page.screenshot({ path: OUT + '/interaction-2-waking.png' });
// 3. wait for failure state + retry button
await new Promise(r => setTimeout(r, 14000));
const failed = await page.evaluate(() => ({ conn: document.getElementById('connOverlay')?.classList.contains('show'), title: document.getElementById('connTitle')?.textContent, retry: getComputedStyle(document.getElementById('connRetryBtn')).display }));
await page.screenshot({ path: OUT + '/interaction-3-failed.png' });
console.log(JSON.stringify({ connecting, waking, failed }, null, 1));
await browser.close();
