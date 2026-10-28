// Basic consent: never load Google's library or send denied-consent pings.
export const MEASUREMENT_ID = 'G-BL5KVVGNMX';
export const STORAGE_KEY = 'dse.analytics-consent.v1';
export const MAX_AGE = 180 * 24 * 60 * 60 * 1000;

export function readChoice(storage, now = Date.now()) {
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY));
    if (value?.version !== 1 || !['accepted', 'rejected'].includes(value.choice) ||
        !Number.isFinite(value.expires) || value.expires <= now || value.expires > now + MAX_AGE) return null;
    return value.choice;
  } catch { return null; }
}

export function saveChoice(storage, choice, now = Date.now()) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, choice, expires: now + MAX_AGE }));
    return readChoice(storage, now) === choice;
  } catch { return false; }
}

// Closed vocabularies only: never pass arbitrary campaign names or tracking IDs.
const MARKETING_VALUES = new Map([
  ['utm_source', new Set(['google', 'bing', 'duckduckgo', 'yahoo', 'brave', 'ecosia', 'newsletter', 'facebook', 'instagram'])],
  ['utm_medium', new Set(['organic', 'referral', 'email', 'social', 'cpc'])],
]);
const SEARCH_HOSTS = new Set([
  'google.com', 'www.google.com', 'google.co.uk', 'www.google.co.uk',
  'bing.com', 'www.bing.com', 'duckduckgo.com', 'www.duckduckgo.com',
  'search.yahoo.com', 'search.brave.com', 'ecosia.org', 'www.ecosia.org',
]);

export function safeReferrer(referrer) {
  try {
    const url = new URL(referrer);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && SEARCH_HOSTS.has(url.hostname)
      ? url.origin : '';
  } catch { return ''; }
}

// The path must match the static rendered page; only initial DOM IDs are anchors.
// Neither raw query text nor fragments are ever copied into the analytics URL.
export function safeLocation(location, renderedPath, publicAnchors = new Set()) {
  if (location.pathname !== renderedPath || /^\/404(?:\.html)?\/?$/.test(renderedPath)) return null;
  if (location.hash && (!/^#[A-Za-z][A-Za-z0-9_-]*$/.test(location.hash) || !publicAnchors.has(location.hash.slice(1)))) return null;
  if (location.search.length > 256) return null;
  const incoming = new URLSearchParams(location.search);
  for (const [key, value] of incoming) {
    if (!MARKETING_VALUES.get(key)?.has(value) || incoming.getAll(key).length !== 1) return null;
  }
  const sanitized = new URLSearchParams();
  for (const key of MARKETING_VALUES.keys()) {
    if (incoming.has(key)) sanitized.set(key, incoming.get(key));
  }
  return location.origin + renderedPath + (sanitized.size ? '?' + sanitized.toString() : '');
}

export function clearAnalyticsCookies(doc, hostname, pathname) {
  const domains = ['', hostname, ...hostname.split('.').map((_, i, parts) => '.' + parts.slice(i).join('.'))];
  const parts = pathname.split('/');
  const paths = ['/', ...parts.map((_, i) => parts.slice(0, i + 1).join('/') || '/')];
  for (const cookie of doc.cookie.split(';')) {
    const name = cookie.trim().split('=')[0];
    if (name !== '_ga' && name !== '_ga_BL5KVVGNMX') continue;
    for (const domain of new Set(domains)) for (const path of new Set(paths)) {
      doc.cookie = `${name}=; Max-Age=0; path=${path}${domain ? `; domain=${domain}` : ''}; SameSite=Lax`;
    }
  }
}

export function initConsent(win, doc) {
  const notice = doc.getElementById('analytics-notice');
  if (!notice) return;
  const status = doc.getElementById('analytics-status');
  const disableKey = `ga-disable-${MEASUREMENT_ID}`;
  let loaded = false;
  let expiryTimer;
  let returnFocus;
  const storage = () => win.localStorage; // Access itself can throw.
  const choice = () => { try { return readChoice(storage()); } catch { return null; } };
  const publicAnchors = new Set(Array.from(doc.querySelectorAll('[id]'), element => element.id));
  const page = () => safeLocation(win.location, notice.dataset.pagePath, publicAnchors);
  const show = () => { notice.hidden = false; };
  const hide = () => { notice.hidden = true; returnFocus?.focus(); returnFocus = null; };
  win[disableKey] = true;

  function stop(reload = false) {
    win[disableKey] = true;
    win.clearTimeout(expiryTimer);
    try { clearAnalyticsCookies(doc, win.location.hostname, win.location.pathname); }
    catch { /* Cookie access may also be blocked: the disable flag and reload still apply. */ }
    // Reload discards an already-loaded library and any pending automatic listeners.
    // Do not send a consent-update ping on withdrawal.
    if (loaded && reload) win.location.reload();
  }

  function start() {
    if (choice() !== 'accepted' || !page()) { stop(); return; }
    if (loaded) return;
    let expires;
    try { expires = JSON.parse(storage().getItem(STORAGE_KEY)).expires; }
    catch { stop(); return; }
    loaded = true;
    win[disableKey] = false;
    win.dataLayer = win.dataLayer || [];
    const gtag = function () { win.dataLayer.push(arguments); };
    gtag('consent', 'default', {
      analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
    });
    gtag('set', 'ads_data_redaction', true);
    gtag('js', new Date());
    const minimized = { page_location: page(), page_referrer: safeReferrer(doc.referrer), page_title: 'DannStarr Electronics' };
    gtag('config', MEASUREMENT_ID, {
      ...minimized, send_page_view: false, allow_google_signals: false,
      allow_ad_personalization_signals: false,
      cookie_expires: MAX_AGE / 1000, cookie_update: false, cookie_flags: 'SameSite=Lax;Secure',
    });
    gtag('event', 'page_view', { ...minimized, send_to: MEASUREMENT_ID });
    const script = doc.createElement('script');
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
    doc.head.appendChild(script);
    // Browser timeout limits require bounded rechecks rather than a 180-day timeout.
    const check = () => {
      if (choice() !== 'accepted' || !page()) { stop(true); show(); }
      else expiryTimer = win.setTimeout(check, Math.min(60_000, Math.max(1, expires - Date.now())));
    };
    expiryTimer = win.setTimeout(check, Math.min(60_000, Math.max(1, expires - Date.now())));
  }

  for (const button of doc.querySelectorAll('[data-analytics-choice]')) {
    button.addEventListener('click', () => {
      const next = button.dataset.analyticsChoice;
      let saved = false;
      try { saved = saveChoice(storage(), next); } catch { /* Fail closed. */ }
      if (next === 'rejected' || !saved) stop(true);
      if (saved) { hide(); if (next === 'accepted') start(); }
      else { show(); status.textContent = 'Your preference could not be saved. Analytics remains off.'; }
    });
  }
  for (const button of doc.querySelectorAll('[data-cookie-settings]')) {
    button.hidden = false;
    button.addEventListener('click', () => {
      returnFocus = button;
      show();
      status.textContent = `Analytics is ${choice() === 'accepted' && page() ? 'on' : 'off'}. You can change your choice below.`;
      notice.querySelector('button')?.focus();
    });
  }
  win.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      if (choice() !== 'accepted') { stop(true); if (!choice()) show(); }
      // Consent in another tab never starts collection in this tab until navigation.
    }
  });
  win.addEventListener('hashchange', () => { if (!page()) stop(true); });
  win.addEventListener('popstate', () => { if (!page()) stop(true); });
  win.addEventListener('pageshow', () => { if (choice() !== 'accepted' || !page()) stop(loaded); });
  if (!choice()) { stop(); show(); }
  else if (choice() === 'accepted') start();
  else stop();
}
