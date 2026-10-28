# Optional analytics (local implementation; not deployed)

- Measurement ID: `G-BL5KVVGNMX` (not a GTM container).
- Basic opt-in gating: no Google script, preconnect, or denied-consent ping before acceptance.
- A small nonmodal bottom notice has equally styled accept/reject controls. No focus trap or automatic initial focus. Footer settings reopen the notice; focus returns to the opener on dismissal.
- Both choices expire after 180 days without renewal on visits. Missing/corrupt/expired/inaccessible storage means off. An open accepted page checks storage/expiry at most every minute (subject to browser timer throttling), and checks on page restoration. Changes in another tab disable collection here but do not automatically enable it.
- Withdrawal sets Google's disable flag synchronously, deletes this integration's accessible `_ga`/`_ga_BL5KVVGNMX` cookies across host/domain/path variants, and reloads to unload the library. It does not send a withdrawal ping or undo prior data collection. A withdrawal may interrupt an unsaved page interaction; the static site has no local form submission added here.
- Only an explicit page view is emitted by this integration. No booking, phone, form, search, download or outbound click listeners were added. The location must match the static rendered page; unknown/404 paths are blocked and the title is fixed rather than copied from the document.
- Public marketing URLs may contain only `utm_source` (`google`, `bing`, `duckduckgo`, `yahoo`, `brave`, `ecosia`, `newsletter`, `facebook`, `instagram`) and/or `utm_medium` (`organic`, `referral`, `email`, `social`, `cpc`). Values are case-sensitive, unique and reconstructed in a fixed order; no raw query string is copied. All other keys, duplicate keys or arbitrary values block collection for the entire visit. In particular `utm_campaign`, `utm_term`, `utm_content`, `gclid`, customer identifiers and search terms remain unsupported. Use e.g. `?utm_source=google&utm_medium=organic` for a public business-profile link. Adding campaign reporting requires a separately reviewed closed vocabulary, not free-text pass-through.
- Search referrers are reduced to HTTPS origins on an exact host allowlist: Google `.com`/`.co.uk`, Bing, DuckDuckGo and Ecosia (bare/`www`), `search.yahoo.com` and `search.brave.com`. No referrer path, query, fragment, credentials or nonstandard port is sent. Other referrers become blank. `ignore_referrer` is no longer forced on: this preserves the inputs for organic attribution without transmitting search terms. Engines/regional domains outside this list and browsers suppressing referrers will not provide organic attribution; actual GA4 channel classification is not verified by the mocked tests.
- Known in-page fragments must match an ID present in the initial rendered DOM and use letters, digits, underscores or hyphens (starting with a letter). They never enter event payloads. Ordinary anchors (including skip-to-content and custom-software links) and same-document back/forward do not reload, disable analytics or add page views. Unknown/potentially sensitive fragments still fail closed; if the library is already loaded they trigger disable/cleanup/reload. URLs are never rewritten. History API mutations are not monkey-patched; no client router is present and Enhanced Measurement must remain off.
- The contact-page Google Maps embed is restored exactly as before at Dan's explicit request. It loads automatically (native lazy loading), independently of analytics consent; the privacy notice discloses this. No map-cookie/compliance certification is implied.

## Before any production release (not performed here)

GA4's **web-stream Enhanced Measurement must be switched OFF**, including automatic page/history changes, scrolls, outbound clicks, site search, video, file downloads and form interactions. Client `send_page_view: false` only suppresses automatic configuration page views; it is **not** a reliable property-wide Enhanced Measurement off switch. Do not enable extra tags or Google signals/user-provided-data collection in the property. This code disables Google signals and ad personalization in its config but cannot audit/override every remote property setting. Verify the actual property setup before release; no GA4 account was accessed here.

Review GA4 retention/access/processing settings and the privacy notice for the business's actual setup and obligations. This is a minimal integration notice, not a claim of complete legal compliance. Google still receives technical connection data after consent. Cross-device consent synchronization and erasure of data already sent are not implemented.

## Repeatable local checks

```sh
npm test
npm run build
git diff --check
```

Optional real Chromium UI test using an **already installed** Playwright module/browser (no new dependency/download):

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
CHROMIUM_EXECUTABLE=/absolute/path/to/chrome \
node tests/analytics-browser.mjs
```

The browser runner serves `dist/` on a temporary loopback port, blocks every external request, and substitutes an empty Google tag script. It exercises real compiled UI, local storage and cookie cleanup, **not real Google library behavior, GA delivery or property configuration**. No real analytics events are sent. It shuts down its browser/server in `finally`.
