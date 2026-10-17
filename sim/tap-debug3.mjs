import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
  headless: 'new', args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-zygote'] });
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle2', timeout: 45000 });
await new Promise(r => setTimeout(r, 2500));
const out = await page.evaluate(async () => {
  const ov = document.getElementById('connOverlay');
  const log = [];
  const t0 = Date.now();
  // call connectNet path directly: simulate the same sequence
  try {
    // instrument showConnState via DOM observation
    const obs = new MutationObserver(() => log.push((Date.now()-t0)+'ms show=' + ov.classList.contains('show') + ' ' + document.getElementById('connTitle').textContent + '/' + (document.getElementById('connSub').textContent||'').slice(0,40)));
    obs.observe(ov, { attributes: true, attributeFilter: ['class'] });
    // find connectNet through the module — not exposed; instead dispatch a click on body like the game does
    document.body.click();
    await new Promise(r => setTimeout(r, 12000));
    obs.disconnect();
  } catch (e) { log.push('ERR ' + e.message); }
  return { log, finalShow: ov.classList.contains('show'), title: document.getElementById('connTitle').textContent, sub: document.getElementById('connSub').textContent, retry: getComputedStyle(document.getElementById('connRetryBtn')).display, netStatus: document.getElementById('netStatus') ? document.getElementById('netStatus').textContent : null };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
