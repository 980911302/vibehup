import fs from 'node:fs';
import path from 'node:path';

/**
 * 静态导出后修正「同名目录遮蔽同名 html」：
 * /work、/context 既有 work.html/context.html，又有 work/、context/ 子目录；
 * Fastify static 命中目录后找不到 index.html，会回退根 index.html。
 * 把同名 html 复制成目录 index.html，干净 URL 才能正确落到页面。
 */
const out = path.resolve('out');
for (const base of ['work', 'context']) {
  const html = path.join(out, `${base}.html`);
  const dir = path.join(out, base);
  if (fs.existsSync(html) && fs.existsSync(dir)) {
    fs.copyFileSync(html, path.join(dir, 'index.html'));
    console.log(`[postbuild] ${base}/index.html`);
  }
}
