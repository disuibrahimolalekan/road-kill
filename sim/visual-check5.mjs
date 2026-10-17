// Final: waking countdown visible long enough to screenshot, retry button works
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';
const OUT = '/sdcard/Road kill/screenshots'; mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
  headless: 'new', args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-zygote'] });
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await page.goto('http://127.0.0.1:5199/?server=ws://10.255.255.1:8130', { waitUntil: 'networkidle2', timeout: 45000 });
await new Promise(r => setTimeout(r, 3000));
await page.touchscreen.tap(422, 195);
await new Promise(r => setTimeout(r, 2000));
await page.screenshot({ path: OUT + '/interaction-1-connecting.png' });
await new Promise(r => setTimeout(r, 4500)); // waking
await page.screenshot({ path: OUT + '/interaction-2-waking.png' });
await new Promise(r => setTimeout(r, 1800)); // failed
await page.screenshot({ path: OUT + '/interaction-3-failed.png' });
const st = await page.evaluate(() => ({ title: document.getElementById('connTitle').textContent, retry: getComputedStyle(document.getElementById('connRetryBtn')).display }));
console.log('failed-state:', JSON.stringify(st));
// click retry → connecting again
await page.evaluate(() => document.getElementById('connRetryBtn').click());
await new Promise(r => setTimeout(r, 800));
const back = await page.evaluate(() => ({ title: document.getElementById('connTitle').textContent, show: document.getElementById('connOverlay').classList.contains('show') }));
console.log('after-retry:', JSON.stringify(back));
await page.screenshot({ path: OUT + '/interaction-4-retry.png' });
await browser.close();
