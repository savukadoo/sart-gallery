// Real preview screenshots: included artwork, isolated storage, no personal library.
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

assert(process.env.SART_TEST_URL, 'Run with tools/run_browser_checks.py --screenshots');
const output = new URL('../design/screenshots/', import.meta.url);
await fs.mkdir(output, {recursive:true});
const browser = await chromium.launch({headless:true,...(process.env.SART_CHROME?{executablePath:process.env.SART_CHROME}:{})});
try {
  const context = await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1});
  const page = await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(process.env.SART_TEST_URL+'/preview/');
  await page.locator('.collection-card').first().waitFor();
  await page.evaluate(()=>document.fonts.ready);
  await page.waitForFunction(()=>[...document.querySelectorAll('img')].every(i=>i.complete&&i.naturalWidth>0));
  await page.screenshot({path:fileURLToPath(new URL('collections.jpg',output)),type:'jpeg',quality:88});
  await page.locator('[data-action="open-collection"][data-id="light-water"]').click();
  await page.locator('.art-card').first().click();
  await page.waitForFunction(()=>document.querySelector('.canvas img')?.naturalWidth>0);
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.player-controls')).opacity==='1');
  await page.locator('[data-action="mat"]').click();
  await page.locator('[data-look-tab="mat"]').click();
  await page.locator('[data-matte="paper"]').click();
  await page.locator('button[data-mat-style="bevel"]').click();
  await page.locator('[data-look-tab="frame"]').click();
  await page.locator('button[data-frame="teak"]').click();
  await page.locator('[data-focus="mat-done"]').click();
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.querySelector('#dialog').open);
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.player-controls')).opacity==='0'&&getComputedStyle(document.querySelector('#toast')).opacity==='0');
  await page.screenshot({path:fileURLToPath(new URL('artwork.jpg',output)),type:'jpeg',quality:88});
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.player-controls')).opacity==='1');
  await page.locator('[data-action="mat"]').click();
  await page.locator('[data-look-tab="mat"]').click();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#toast')).opacity==='0');
  await page.screenshot({path:fileURLToPath(new URL('frame-and-mat.jpg',output)),type:'jpeg',quality:88});
  assert.deepEqual(errors,[]);
  console.log('Captured three real preview screenshots with no personal library or TV connection.');
} finally { await browser.close(); }
