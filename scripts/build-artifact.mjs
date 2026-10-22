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
<script>${js}</script>
`;
mkdirSync(path.join(root, 'dist'), { recursive: true });
writeFileSync(path.join(root, 'dist/sparkles.html'), html);
console.log('dist/sparkles.html', (html.length / 1024).toFixed(0) + ' KB');
