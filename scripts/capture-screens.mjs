import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import path from 'path';

const base = process.argv[2] || 'http://localhost:4390';
const outDir = process.argv[3];
const prefix = process.argv[4] || 'shot';

if (!outDir) {
  console.error('Usage: node capture-screens.mjs <url> <outDir> [prefix]');
  process.exit(1);
}

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
});

async function shots(ctx, tag) {
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('#map', { timeout: 30000 });
  await page.waitForTimeout(800);

  await page.screenshot({ path: path.join(outDir, `${prefix}-${tag}-today-desktop.png`), fullPage: false });

  await page.locator('.rail [data-tab="people"]').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, `${prefix}-${tag}-people-desktop.png`), fullPage: false });

  const row = page.locator('.row[data-person]').first();
  if (await row.count()) {
    await row.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(outDir, `${prefix}-${tag}-person-desktop.png`), fullPage: false });
  }

  await page.close();
}

async function mobileShots(ctx, tag) {
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('#map', { timeout: 30000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, `${prefix}-${tag}-today-mobile.png`), fullPage: false });
  await page.locator('#tabs [data-tab="people"], .tabs [data-tab="people"]').first().click({ timeout: 5000 }).catch(() =>
    page.locator('.rail [data-tab="people"]').click()
  );
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, `${prefix}-${tag}-people-mobile.png`), fullPage: false });
  await page.close();
}

await shots(desktop, 'today');
await mobileShots(mobile, 'today');
await browser.close();
console.log('Saved to', outDir);
