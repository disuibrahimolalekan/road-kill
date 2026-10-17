import puppeteer from 'puppeteer-core';
const CH='/data/data/com.termux/files/usr/bin/chromium-browser';
const try_ = async (label, args) => {
  try {
    const b = await puppeteer.launch({ executablePath: CH, headless:'new', args:['--no-sandbox','--no-zygote',...args] });
    const p = await b.newPage();
    // two contexts at once (renderer + our probe), like the real page
    const gl = await p.evaluate(() => { const a=document.createElement('canvas').getContext('webgl'); const b=document.createElement('canvas').getContext('webgl'); return a&&b ? a.getParameter(a.VERSION) : null; });
    await b.close(); console.log(label,'=>',gl);
  } catch(e){ console.log(label,'LAUNCH FAIL',e.message.slice(0,80)); }
};
await try_('reuse-one',['--use-gl=swiftshader','--enable-unsafe-swiftshader']);
await try_('no-zygote-off',['--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-zygote']);
