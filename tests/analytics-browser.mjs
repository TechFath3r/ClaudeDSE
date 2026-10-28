// Optional local browser QA. Uses an existing Playwright installation, no downloads.
// All non-loopback requests are intercepted; Google transport is MOCKED, never forwarded.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tests/analytics-browser.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const imported = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const { chromium } = imported.default || imported;
const root = resolve('dist');
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    if (!extname(path)) path += '/index.html';
    const body = await readFile(path);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}), args: ['--disable-background-networking'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const google = [], blocked = [], errors = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (url.hostname === 'www.googletagmanager.com' && url.pathname === '/gtag/js') {
      google.push(url.toString());
      return route.fulfill({ contentType: 'text/javascript', body: '/* Mocked Google transport: intentionally no real Google library. */' });
    }
    blocked.push(url.origin); return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/');
  const notice = page.locator('#analytics-notice');
  await notice.waitFor({ state: 'visible' });
  assert.equal(google.length, 0);
  const geometry = await notice.boundingBox();
  assert.ok(geometry.y >= 0 && geometry.y + geometry.height <= 845, JSON.stringify(geometry));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const accept = notice.getByRole('button', { name: 'Accept analytics' });
  const reject = notice.getByRole('button', { name: 'Reject analytics' });
  assert.deepEqual(await accept.evaluate(e => [getComputedStyle(e).backgroundColor, getComputedStyle(e).borderColor]), await reject.evaluate(e => [getComputedStyle(e).backgroundColor, getComputedStyle(e).borderColor]));
  await reject.click(); await notice.waitFor({ state: 'hidden' });
  await page.reload(); await page.waitForLoadState('networkidle');
  assert.equal(await notice.isVisible(), false); assert.equal(google.length, 0);
  await page.locator('footer [data-cookie-settings]').click();
  await accept.click();
  await page.waitForLoadState('networkidle');
  assert.equal(google.length, 1);
  const event = await page.evaluate(() => window.dataLayer.map(x => Array.from(x)).find(x => x[0] === 'event'));
  assert.equal(event[1], 'page_view'); assert.equal(event[2].page_location, origin + '/');
  assert.equal(event[2].page_referrer, '');
  await context.addCookies([{ name: '_ga', value: 'synthetic', url: origin }, { name: '_ga_BL5KVVGNMX', value: 'synthetic', url: origin }]);
  await page.locator('footer [data-cookie-settings]').click();
  await Promise.all([page.waitForEvent('load'), reject.click()]);
  await page.waitForLoadState('networkidle');
  assert.equal(google.length, 1);
  assert.equal(await page.evaluate(() => window['ga-disable-G-BL5KVVGNMX']), true);
  assert.equal((await context.cookies()).some(c => c.name.startsWith('_ga')), false);
  // Accept on sensitive/unsupported URLs must not even request the mocked library.
  for (const suffix of ['?email=synthetic%40example.test', '?utm_source=synthetic%40example.test', '?utm_source=google&utm_campaign=synthetic-secret', '?utm_source=google&token=secret', '#synthetic-secret', '#main-content?token=secret']) {
    await page.goto(origin + '/contact/' + suffix);
    await page.locator('footer [data-cookie-settings]').click();
    await page.locator('[data-analytics-choice="accepted"]').click();
    await page.waitForLoadState('networkidle'); assert.equal(google.length, 1);
  }
  // Ordinary allowlisted UTM visits retain useful attribution without raw text.
  await page.goto(origin + '/web-design/?utm_medium=organic&utm_source=google', { referer: 'https://www.google.co.uk/search?q=synthetic-secret#private' });
  await page.waitForLoadState('networkidle'); assert.equal(google.length, 2);
  const marketing = await page.evaluate(() => window.dataLayer.map(x => Array.from(x)));
  const marketingEvent = marketing.find(x => x[0] === 'event')[2];
  assert.equal(marketingEvent.page_location, origin + '/web-design/?utm_source=google&utm_medium=organic');
  assert.equal(marketingEvent.page_referrer, 'https://www.google.co.uk');
  assert.equal(marketing.find(x => x[0] === 'config')[2].ignore_referrer, undefined);
  assert.equal(JSON.stringify(marketing).includes('synthetic-secret'), false);
  // Real public anchor link and back/forward preserve the document and one view.
  await page.evaluate(() => { window.anchorDocument = 'same-document'; });
  await page.locator('a[href="#custom-software"]').click();
  await page.waitForURL(url => url.hash === '#custom-software');
  await page.goBack(); await page.goForward();
  await page.waitForURL(url => url.hash === '#custom-software');
  await page.waitForLoadState('networkidle');
  assert.equal(await page.evaluate(() => window.anchorDocument), 'same-document');
  assert.equal(await page.evaluate(() => window['ga-disable-G-BL5KVVGNMX']), false);
  assert.equal(await page.evaluate(() => window.dataLayer.filter(x => x[0] === 'event').length), 1);
  assert.equal(google.length, 2);
  // Deep links to known IDs count without including the fragment.
  await page.goto(origin + '/web-design/#custom-software');
  await page.waitForLoadState('networkidle');
  assert.equal(google.length, 3);
  assert.equal(await page.evaluate(() => window.dataLayer.find(x => x[0] === 'event')[2].page_location), origin + '/web-design/');
  // An unknown fragment after loading still disables/unloads, without a new request.
  await Promise.all([page.waitForEvent('load'), page.evaluate(() => { location.hash = 'synthetic-secret'; })]);
  await page.waitForLoadState('networkidle');
  assert.equal(google.length, 3);
  assert.equal(await page.evaluate(() => window['ga-disable-G-BL5KVVGNMX']), true);
  assert.equal(await page.evaluate(() => window.dataLayer), undefined);
  // A plain organic landing is attributed too, without requiring UTMs.
  await page.goto(origin + '/contact/', { referer: 'https://www.bing.com/search?q=synthetic-secret' });
  await page.waitForLoadState('networkidle');
  assert.equal(await page.evaluate(() => window.dataLayer.find(x => x[0] === 'event')[2].page_referrer), 'https://www.bing.com');
  await page.goto(origin + '/privacy/');
  await page.getByRole('heading', { name: 'Privacy & cookies', exact: true }).waitFor();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('footer [data-cookie-settings]').click();
  const desktop = await notice.boundingBox(); assert.ok(desktop.y + desktop.height <= 901);
  assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
  console.log(JSON.stringify({ result: 'PASS', transport: 'Google library mocked; all other external requests blocked', googleScriptRequests: google.length, mobileNotice: geometry, desktopNotice: desktop, checks: ['first visit zero Google', 'equal buttons', 'mobile no overflow', 'persistent reject', 'accept/manual minimized event', 'withdraw/reload/cookie cleanup', 'sensitive query/hash block', 'allowlisted UTM reconstruction', 'sanitized Google/Bing organic referrers', 'public anchor/back/forward without reload or extra view', 'known anchor deep link', 'unknown fragment unload', 'privacy route', 'desktop notice'], errors, blocked }, null, 2));
  await context.close();
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
