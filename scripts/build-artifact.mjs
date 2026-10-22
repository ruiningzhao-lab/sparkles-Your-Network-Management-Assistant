// Builds dist/sparkles.html: the whole app as one self-contained page for claude.ai.
// Run: node scripts/build-artifact.mjs
import { build } from 'esbuild';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const out = await build({
  entryPoints: [path.join(root, 'artifact/main.ts')],
  bundle: true, minify: true, format: 'iife', write: false, target: 'es2020',
  alias: { '@': root }, loader: { '.json': 'json' }, legalComments: 'none',
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync(path.join(root, 'app/globals.css'), 'utf8');
const name = process.env.NEXT_PUBLIC_APP_NAME || 'Sparkles';
const html = `<title>${name}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700&family=Figtree:wght@400;500;600;700&family=Kalam:wght@400&display=swap">
<style>${css}</style>
<svg id="map" role="img" aria-label="World map of your network"></svg>
<div class="top">
  <div class="brandcol"><div class="brand float"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 1.5l2.3 6.4 6.7 .3-5.3 4.1 1.9 6.5L12 15l-5.6 3.8 1.9-6.5L3 8.2l6.7-.3z" fill="var(--accent)"/></svg> ${name}</div></div>
  <div class="center">
    <form class="prompt float" id="askForm">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l1.9 5.6L19.5 9l-5.6 1.9L12 16.5l-1.9-5.6L4.5 9l5.6-1.4z" fill="currentColor"/><circle cx="19" cy="18" r="2" fill="currentColor"/></svg>
      <input id="askIn" placeholder="What do you want to do? Sparkles will find the people." autocomplete="off" aria-label="What do you want to do?">
      <button class="btn go" type="submit">Map it</button>
    </form>
    <div class="filters"><div class="seg float" role="group" aria-label="Circles" id="modes"></div><div id="layers" style="display:flex;gap:6px"></div><div id="lensSlot"></div></div>
  </div>
</div>
<div class="bottom">
  <div class="brow"><div class="stats float" id="stats"></div>
    <div class="zoombox"><button id="zin" aria-label="Zoom in">+</button><button id="zout" aria-label="Zoom out">−</button><button id="zhome" aria-label="Show the whole world" title="Whole world">⌂</button></div></div>
  <div class="strip" id="strip" aria-label="Maps and ideas"></div>
</div>
<aside class="panel float" id="panel"><button class="handle" id="handle" aria-label="Expand panel"><i></i></button><div class="tabs" role="tablist" id="tabs"></div><div class="pbody" id="pbody"></div></aside>
<input type="file" id="csvIn" accept=".csv,text/csv" hidden>
<datalist id="cityList"></datalist>
<div class="tip" id="tip" hidden></div>
<div id="layer"></div>
<script>${js}</script>
`;
mkdirSync(path.join(root, 'dist'), { recursive: true });
writeFileSync(path.join(root, 'dist/sparkles.html'), html);
console.log('dist/sparkles.html', (html.length / 1024).toFixed(0) + ' KB');
