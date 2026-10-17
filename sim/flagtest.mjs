import puppeteer from 'puppeteer-core';
const try_ = async (args) => {
  const b = await puppeteer.launch({ executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser', headless: 'new', args: ['--no-sandbox','--no-zygote',...args] });
  const p = await b.newPage();
  const gl = await p.evaluate(() => { const c=document.createElement('canvas'); const g=c.getContext('webgl2')||c.getContext('webgl'); return g ? (g.getParameter(g.VERSION)+' | '+(g.getParameter(g.RENDERER)||'')) : null; });
  await b.close(); console.log(JSON.stringify(args), '=>', gl);
};
await try_(['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']);
await try_(['--use-gl=swiftshader','--enable-unsafe-swiftshader']);
await try_(['--enable-webgl-swiftshader','--ignore-gpu-blocklist']);
