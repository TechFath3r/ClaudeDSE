import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initConsent, readChoice, saveChoice, safeLocation, safeReferrer, STORAGE_KEY, MAX_AGE, MEASUREMENT_ID } from '../src/scripts/analytics-consent.js';

function harness({ initial, brokenRead = false, brokenWrite = false, search = '', hash = '', referrer = '' } = {}) {
  const values = new Map(initial ? [[STORAGE_KEY, initial]] : []);
  const listeners = {}, appended = [], timers = [], writes = [];
  const element = (dataset = {}) => ({ dataset, hidden: true, textContent: '', handlers: {},
    addEventListener(type, callback) { this.handlers[type] = callback; },
    focus() { this.focused = true; }, click() { this.handlers.click(); } });
  const accept = element({ analyticsChoice: 'accepted' }), reject = element({ analyticsChoice: 'rejected' });
  const settings = element(), status = element(), notice = element({ pagePath: '/repairs/' });
  notice.querySelector = () => accept;
  let reloads = 0;
  const storage = { getItem(key) { if (brokenRead) throw Error('blocked'); return values.get(key) ?? null; },
    setItem(key, value) { if (brokenWrite) throw Error('blocked'); values.set(key, value); } };
  const win = { localStorage: storage,
    location: { origin: 'https://example.test', hostname: 'example.test', pathname: '/repairs/', search, hash, reload() { reloads++; } },
    addEventListener(type, callback) { listeners[type] = callback; },
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; }, clearTimeout() {} };
  const doc = { referrer, getElementById: id => id === 'analytics-notice' ? notice : status,
    querySelectorAll: selector => selector === '[id]' ? [{ id: 'main-content' }] : selector === '[data-analytics-choice]' ? [accept, reject] : [settings],
    head: { appendChild: value => appended.push(value) }, createElement: () => ({}),
    get cookie() { return '_ga=existing; _ga_BL5KVVGNMX=session; theme=dark; _ga_OTHER=keep'; },
    set cookie(value) { writes.push(value); } };
  initConsent(win, doc);
  return { win, doc, storage, notice, status, accept, reject, settings, appended, timers, listeners, writes, values, reloads: () => reloads };
}
const record = (choice, expires = Date.now() + MAX_AGE - 1000) => JSON.stringify({ version: 1, choice, expires });
const disabled = h => assert.equal(h.win[`ga-disable-${MEASUREMENT_ID}`], true);

test('first visit: nonmodal notice, no Google script or queued events', () => {
  const h = harness(); assert.equal(h.notice.hidden, false); assert.equal(h.appended.length, 0);
  assert.equal(h.win.dataLayer, undefined); disabled(h);
});
test('accept persists choice then loads exactly the literal GA4 ID once', () => {
  const h = harness(); h.accept.click(); h.accept.click();
  assert.equal(readChoice(h.storage), 'accepted'); assert.equal(h.notice.hidden, true);
  assert.equal(h.appended.length, 1); assert.equal(h.appended[0].src, `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`);
  assert.equal(h.appended[0].referrerPolicy, 'no-referrer');
});
test('rejection persists across navigation without Google or denied pings', () => {
  const h = harness(); h.reject.click(); disabled(h); assert.equal(h.appended.length, 0);
  const next = harness({ initial: h.values.get(STORAGE_KEY) });
  assert.equal(next.notice.hidden, true); assert.equal(next.appended.length, 0); assert.equal(next.win.dataLayer, undefined);
});
test('saved acceptance starts only on safe page', () => {
  assert.equal(harness({ initial: record('accepted') }).appended.length, 1);
  for (const options of [{ search: '?email=private@example.test' }, { hash: '#token=secret' }]) {
    const h = harness({ initial: record('accepted'), ...options }); disabled(h); assert.equal(h.appended.length, 0);
    h.accept.click(); assert.equal(h.appended.length, 0);
  }
});
test('public marketing values and search referrers are reconstructed, never copied raw', () => {
  const h = harness({ search: '?utm_source=google&utm_medium=organic', referrer: 'https://www.google.co.uk/search?q=private-email%40example.test#secret' });
  assert.equal(h.appended.length, 0); assert.equal(h.win.dataLayer, undefined); disabled(h);
  h.accept.click();
  assert.equal(h.appended.length, 1);
  const commands = h.win.dataLayer.map(x => Array.from(x));
  const config = commands.find(x => x[0] === 'config')[2];
  assert.notEqual(config.ignore_referrer, true);
  const event = commands.find(x => x[0] === 'event')[2];
  assert.equal(event.page_location, 'https://example.test/repairs/?utm_source=google&utm_medium=organic');
  assert.equal(event.page_referrer, 'https://www.google.co.uk');
  assert.equal(JSON.stringify(h.win.dataLayer).includes('private-email'), false);
});
test('only exact search engine HTTPS origins survive referrer sanitization', () => {
  for (const host of ['www.google.com', 'www.google.co.uk', 'www.bing.com', 'duckduckgo.com', 'search.yahoo.com', 'search.brave.com', 'www.ecosia.org']) {
    assert.equal(safeReferrer(`https://${host}/private/path?email=secret#token`), `https://${host}`);
  }
  for (const url of ['', 'bad', 'https://customer.example/private', 'https://www.google.com.evil.test/search', 'https://evil.google.com/', 'http://www.google.com/', 'https://user:secret@www.google.com/', 'https://www.google.com:444/']) {
    assert.equal(safeReferrer(url), '');
  }
});
test('known DOM anchors remain enabled without reload or extra page views', () => {
  const h = harness({ initial: record('accepted') });
  for (const hash of ['#main-content', '']) {
    h.win.location.hash = hash;
    h.listeners.hashchange(); h.listeners.popstate(); h.listeners.pageshow();
    assert.equal(h.win[`ga-disable-${MEASUREMENT_ID}`], false);
    assert.equal(h.reloads(), 0);
  }
  assert.equal(h.win.dataLayer.filter(x => x[0] === 'event').length, 1);
});
test('corrupt, unknown, expired and overlong consent fail closed', () => {
  for (const initial of ['bad', '{}', record('yes'), record('accepted', Date.now() - 1), record('accepted', Date.now() + MAX_AGE * 2)]) {
    const h = harness({ initial }); disabled(h); assert.equal(h.appended.length, 0); assert.equal(h.notice.hidden, false);
  }
});
test('blocked reads, writes, or localStorage getter fail closed on acceptance', () => {
  for (const options of [{ brokenRead: true }, { brokenWrite: true }]) {
    const h = harness(options); h.accept.click(); disabled(h); assert.equal(h.appended.length, 0); assert.match(h.status.textContent, /remains off/);
  }
  const h = harness(); Object.defineProperty(h.win, 'localStorage', { get() { throw Error('blocked'); } });
  h.accept.click(); disabled(h); assert.equal(h.appended.length, 0);
});
test('withdrawal disables before reload and clears only this integration’s cookies', () => {
  const h = harness(); h.accept.click(); const events = h.win.dataLayer.length;
  h.settings.click(); assert.equal(h.notice.hidden, false); assert.equal(h.accept.focused, true);
  h.reject.click(); disabled(h); assert.equal(h.reloads(), 1); assert.equal(h.win.dataLayer.length, events);
  assert.equal(readChoice(h.storage), 'rejected'); assert.ok(h.writes.some(x => x.startsWith('_ga=')));
  assert.ok(h.writes.some(x => x.startsWith('_ga_BL5KVVGNMX=')));
  assert.ok(h.writes.every(x => !x.startsWith('theme=') && !x.startsWith('_ga_OTHER=')));
});
test('expiry/revocation while open and other-tab rejection stop loaded library', () => {
  const h = harness({ initial: record('accepted') }); h.values.set(STORAGE_KEY, record('accepted', Date.now() - 1));
  h.timers[0].callback(); disabled(h); assert.equal(h.reloads(), 1);
  assert.ok(h.timers[0].delay > 0 && h.timers[0].delay <= 60_000);
  const other = harness({ initial: record('accepted') }); other.values.set(STORAGE_KEY, record('rejected'));
  other.listeners.storage({ key: STORAGE_KEY }); disabled(other); assert.equal(other.reloads(), 1);
});
test('hash and history sensitivity disable and unload already loaded library', () => {
  for (const type of ['hashchange', 'popstate', 'pageshow']) {
    const h = harness({ initial: record('accepted') }); h.win.location.hash = '#private';
    h.listeners[type](); disabled(h); assert.equal(h.reloads(), 1);
  }
});
test('event payload minimized; no document title, arbitrary referrer, customer or form data', () => {
  const h = harness(); h.accept.click();
  const commands = h.win.dataLayer.map(args => Array.from(args));
  const config = commands.find(x => x[0] === 'config')[2];
  assert.equal(config.send_page_view, false); assert.equal(config.allow_google_signals, false);
  assert.equal(config.allow_ad_personalization_signals, false); assert.equal(config.cookie_update, false);
  const events = commands.filter(x => x[0] === 'event'); assert.equal(events.length, 1);
  assert.equal(events[0][1], 'page_view');
  assert.deepEqual(events[0][2], { page_location: 'https://example.test/repairs/', page_referrer: '', page_title: 'DannStarr Electronics', send_to: MEASUREMENT_ID });
});
test('blocked cookie access cannot prevent withdrawal/reload', () => {
  const h = harness({ initial: record('accepted') });
  Object.defineProperty(h.doc, 'cookie', { get() { throw Error('blocked cookies'); } });
  h.reject.click(); disabled(h); assert.equal(h.reloads(), 1);
});
test('URL policy blocks unknown paths, arbitrary query values and unknown fragments', () => {
  const base = { origin: 'https://example.test', pathname: '/repairs/', search: '', hash: '' };
  assert.equal(safeLocation(base, '/repairs/'), 'https://example.test/repairs/');
  for (const search of ['?utm_source=x', '?utm_source=private%40example.test', '?utm_medium=private', '?utm_campaign=customer-secret', '?utm_source=google&email=secret', '?utm_source=google&utm_campaign=secret', '?utm_source=google&utm_source=bing', '?gclid=secret', '?q=secret', '?utm_source=Google', '?UTM_SOURCE=google']) {
    const h = harness({ initial: record('accepted'), search });
    assert.equal(safeLocation({ ...base, search }, '/repairs/'), null);
    disabled(h); assert.equal(h.appended.length, 0); assert.equal(h.win.dataLayer, undefined);
  }
  for (const value of [{ ...base, hash: '#x' }, { ...base, pathname: '/customer-secret/' }]) assert.equal(safeLocation(value, '/repairs/'), null);
  assert.equal(safeLocation({ ...base, search: '?utm_medium=organic&utm_source=%67oogle', hash: '#main-content' }, '/repairs/', new Set(['main-content'])), 'https://example.test/repairs/?utm_source=google&utm_medium=organic');
  assert.equal(harness({ initial: record('accepted'), hash: '#main-content' }).appended.length, 1);
  for (const hash of ['#main-content?email=secret', '#main-content:~:text=private', '#main-content%00', '#main-content/secret']) {
    assert.equal(safeLocation({ ...base, hash }, '/repairs/', new Set(['main-content'])), null);
  }
  assert.equal(safeLocation({ ...base, pathname: '/404/' }, '/404/'), null);
  assert.equal(safeLocation({ ...base, pathname: '/404.html' }, '/404.html'), null);
});
test('bounded persistence is not renewed by reading; storage corruption rejected', () => {
  const values = new Map(); const storage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) };
  assert.equal(saveChoice(storage, 'accepted', 1000), true);
  const value = values.get(STORAGE_KEY); assert.equal(readChoice(storage, 1001), 'accepted');
  assert.equal(values.get(STORAGE_KEY), value); assert.equal(readChoice(storage, 1000 + MAX_AGE), null);
});
test('markup has equal buttons, no modal/overlay, settings, privacy, and JS-free off state', () => {
  const component = readFileSync(new URL('../src/components/layout/AnalyticsConsent.astro', import.meta.url), 'utf8');
  assert.match(component, /<aside[^>]+hidden>/); assert.doesNotMatch(component, /aria-modal|role="dialog"|position: fixed/);
  assert.match(component, /data-analytics-choice="accepted"/); assert.match(component, /data-analytics-choice="rejected"/);
  assert.match(component, /<noscript>/); assert.match(component, /position: sticky/);
  const footer = readFileSync(new URL('../src/components/layout/Footer.astro', import.meta.url), 'utf8');
  assert.match(footer, /data-cookie-settings hidden/); assert.match(footer, /href="\/privacy\/"/);
});
