import { chromium } from 'playwright';
import { mkdirSync, readdirSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';

const OUT =
  '/Users/ruining/Library/Application Support/Cursor/AgentStores/cursor_agent_stores/bc-973198fb-c18b-4837-a1d3-4317f5df3d52/files/media/sparkles-demo.mp4';
const VIDEO_DIR = '/tmp/sparkles-demo-vid';

mkdirSync(path.dirname(OUT), { recursive: true });
mkdirSync(VIDEO_DIR, { recursive: true });
try {
  unlinkSync(OUT);
} catch {
  /* ok */
}

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: VIDEO_DIR, size: { width: 1440, height: 900 } },
});
const page = await context.newPage();

const pause = (ms) => page.waitForTimeout(ms);

await page.goto('http://localhost:4390/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#map', { timeout: 60000 });
await page.waitForFunction(
  () => document.querySelector('#modes [data-mode="founders"]') && !document.querySelector('#pbody [aria-busy="true"]'),
  { timeout: 120000 },
);

if (!(await page.locator('.demo-badge').isVisible().catch(() => false))) {
  const tryDemo = page.locator('[data-act="trydemo"]');
  if (await tryDemo.isVisible().catch(() => false)) {
    await tryDemo.click();
    await page.waitForSelector('.demo-badge', { timeout: 30000 }).catch(() => {});
  }
}

await page.locator('[role="tab"][data-tab="today"]').click().catch(() => {});
await pause(2500);

for (const mode of ['founders', 'filmmakers', 'investors', 'engineers']) {
  await page.locator(`#modes [data-mode="${mode}"]`).click();
  await pause(2800);
}

const map = page.locator('#map');
const box = await map.boundingBox();
if (box) {
  const cx = box.x + box.width * 0.58;
  const cy = box.y + box.height * 0.42;
  await page.mouse.move(cx, cy);
  await page.mouse.click(cx, cy);
}
for (let i = 0; i < 9; i++) {
  await page.locator('#zin').click();
  await pause(450);
}
await pause(2500);
for (let i = 0; i < 9; i++) {
  await page.locator('#zout').click();
  await pause(350);
}
await page.locator('#zhome').click();
await pause(2000);

const person = page.locator('#pbody [data-person]').first();
await person.waitFor({ state: 'visible', timeout: 15000 });
await person.click();
await pause(4500);

const video = page.video();
await context.close();
await browser.close();

const webmPath = await video.path();
execSync(
  `ffmpeg -y -i "${webmPath}" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "${OUT}"`,
  { stdio: 'pipe' },
);

const duration = execSync(
  `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${OUT}"`,
  { encoding: 'utf8' },
).trim();

console.log(`OUT=${OUT}`);
console.log(`DURATION=${duration}`);
