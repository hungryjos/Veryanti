// ==UserScript==
// @name         Veryanti
// @namespace    https://github.com/hungryjos/Veryanti
// @version      1.6.0
// @description  Neutralises anti-adblock walls: fakes ad-bait visibility, stubs detector libraries, spoofs blocked ad probes, removes nag overlays and restores page scrolling.
// @author       hungryjos
// @license      MIT
// @homepageURL  https://github.com/hungryjos/Veryanti
// @supportURL   https://github.com/hungryjos/Veryanti/issues
// @updateURL    https://github.com/hungryjos/Veryanti/raw/HEAD/veryanti.user.js
// @downloadURL  https://github.com/hungryjos/Veryanti/raw/HEAD/veryanti.user.js
// @match        *://xadultflix.com/*
// @match        *://www.xadultflix.com/*
// @match        *://*.xadultflix.com/*
// @match        https://xadultflix.com/*
// @match        https://www.xadultflix.com/*
// @match        https://*.xadultflix.com/*
// @include      https://xadultflix.com/*
// @include      https://*.xadultflix.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * Adding sites: put one more "// @match *://example.com/*" line in the block
 * above, inside the ==UserScript== markers. Keep every line in that block a
 * plain "// @key value" pair — prose or decoration between the markers is
 * what makes a script manager skip the script entirely.
 * To run on every site, use a single match line for all hosts instead.
 *
 * Veryanti runs in the page context (@grant none) so it can replace page
 * globals before the site's own scripts touch them. Everything is layered:
 * each defence is independent, so one failing technique does not disable
 * the rest.
 *
 *   1. bait visibility  — hidden elements that "look like ads" report a real
 *                         size and a visible computed style
 *   2. detector stubs   — FuckAdBlock/BlockAdBlock & friends are replaced by
 *                         no-ops that always report "no adblocker"
 *   3. probe spoofing   — requests to ad hosts that the blocker kills are
 *                         rewritten/faked so they look successful
 *   4. timer filtering  — timers whose source code mentions adblock detection
 *                         never fire
 *   5. DOM cleanup      — nag overlays are removed and scrolling is restored
 *   6. popup guard      — popunders / forced window.open are dropped
 */

(function () {
    'use strict';

    // =====================================================================
    // Configuration
    // =====================================================================

    const CONFIG = {
        /** Log everything Veryanti does to the console. Turn on when tuning. */
        debug: false,

        /** Also show that log on the page itself — for phones. */
        panel: false,

        /** Make hidden ad-bait elements report a non-zero size. */
        fakeBaitVisibility: true,

        /** Replace known adblock-detector libraries with harmless stubs. */
        stubDetectors: true,

        /** Make blocked requests to ad hosts look like they succeeded. */
        spoofAdProbes: true,

        /** Drop setTimeout/setInterval callbacks that smell like detection. */
        filterTimers: true,

        /** Remove nag overlays and keep the page scrollable. */
        cleanDom: true,

        /**
         * Search the page text for adblock nagging and remove whatever holds
         * it — catches banners and bars whose class names give nothing away.
         */
        textScan: true,

        /** Block window.open() popunders. */
        blockPopups: true,

        /**
         * Also remove *any* full-screen high-z-index layer, even without
         * adblock wording. Effective against silent paywalls, but it can eat
         * legitimate lightboxes / video overlays. Off by default.
         */
        aggressiveOverlayRemoval: false,

        /** How often (ms) to re-sweep the DOM. */
        sweepInterval: 800,
    };

    /**
     * Per-host tuning. The key is matched against location.hostname
     * (suffix match, so "example.com" also covers "www.example.com").
     *
     * remove   : selectors that are deleted on sight
     * unhide   : selectors that get their content forced back into view
     *            (useful when the site hides the player instead of showing
     *            a modal)
     * options  : any CONFIG key, overridden for this host only
     */
    const SITE_RULES = {
        'xadultflix.com': {
            remove: [
                // Generic names used by the usual anti-adblock snippets. Open
                // devtools with CONFIG.debug = true and add the real ones you
                // see reported in the console.
                '#adblock', '#adblocker', '#adblock-modal', '#adblock-overlay',
                '#ab-overlay', '#ab-modal', '#blocker', '#blocker-overlay',
                '.adblock-modal', '.adblock-overlay', '.adblock-notice',
                '.adb-overlay', '.adb-modal', '.anti-adblock',
                '.modal-adblock', '.no-adblock', '.please-disable-adblock',
            ],
            unhide: [
                '#player', '#video', '.player-holder', '.video-holder',
            ],
            options: {
                // Tube sites are popunder-heavy.
                blockPopups: true,
            },
        },

        // Fallback applied to every host that has no entry above.
        '*': {
            remove: [
                '#adblock-detected', '.adblock-detected',
                '[class*="adblock-modal"]', '[id*="adblock-modal"]',
            ],
            unhide: [],
            options: {},
        },
    };

    // =====================================================================
    // Small helpers
    // =====================================================================

    const VERSION = '1.6.0';
    const win = window;
    const doc = document;
    const TAG = '%c[Veryanti]';
    const TAG_STYLE = 'color:#8ab4f8;font-weight:bold';

    // With #veryanti=panel the log lands on the page as well. A phone has no
    // console, so this is the only way to see what the script is doing.
    const panelLines = [];
    let panelNode = null;

    function renderPanel() {
        if (!settings.panel || !doc.body) return;
        if (!panelNode) {
            panelNode = doc.createElement('div');
            panelNode.id = 'veryanti-panel';
            panelNode.style.cssText = [
                'position:fixed', 'left:4px', 'right:4px', 'bottom:4px',
                'max-height:38vh', 'overflow:auto', 'z-index:2147483647',
                'background:rgba(0,0,0,.88)', 'color:#8ab4f8',
                'font:11px/1.4 ui-monospace,Menlo,monospace', 'padding:6px 8px',
                'border-radius:8px', 'white-space:pre-wrap', 'word-break:break-all',
            ].join(';');
            panelNode.addEventListener('dblclick', () => panelNode.remove());
            doc.body.appendChild(panelNode);
        }
        panelNode.textContent = 'Veryanti v' + VERSION +
            ' (dubbeltik om te sluiten)\n' + panelLines.join('\n');
    }

    function toPanel(args) {
        if (!settings.panel) return;
        panelLines.push(args.map((a) => {
            if (typeof a === 'string') return a;
            try { return JSON.stringify(a); } catch (e) { return String(a); }
        }).join(' '));
        if (panelLines.length > 60) panelLines.shift();
        renderPanel();
    }

    const log = (...args) => {
        if (!settings.debug) return;
        console.log(TAG, TAG_STYLE, ...args);
        toPanel(args);
    };
    const warn = (...args) => {
        console.warn(TAG, TAG_STYLE, ...args);
        toPanel(['WARN'].concat(args));
    };

    /** Resolve the rules for the current host. */
    function resolveRules() {
        const host = location.hostname.replace(/^www\./, '');
        for (const key of Object.keys(SITE_RULES)) {
            if (key === '*') continue;
            if (host === key || host.endsWith('.' + key)) return SITE_RULES[key];
        }
        return SITE_RULES['*'];
    }

    /**
     * Switches you can set from the address bar, which is the only practical
     * way to try things on a phone:
     *
     *   ...xadultflix.com/#veryanti=off             everything off
     *   ...xadultflix.com/#veryanti=-filterTimers   that one layer off
     *   ...xadultflix.com/#veryanti=debug           log what it does
     *
     * Combine with commas. Layer names are the keys of CONFIG.
     */
    function readUrlSwitches() {
        const match = /veryanti=([^&\s#]+)/i.exec(location.search + location.hash);
        if (!match) return [];
        try {
            return decodeURIComponent(match[1]).split(',').map((s) => s.trim());
        } catch (e) {
            return match[1].split(',').map((s) => s.trim());
        }
    }

    const rules = resolveRules();
    const fallback = SITE_RULES['*'];
    const settings = Object.assign({}, CONFIG, rules.options || {});

    const switches = readUrlSwitches();
    for (const item of switches) {
        if (!item) continue;
        if (item === 'debug') settings.debug = true;
        else if (item === 'panel') { settings.debug = true; settings.panel = true; }
        else if (item.charAt(0) === '-') settings[item.slice(1)] = false;
        else if (item.charAt(0) === '+') settings[item.slice(1)] = true;
    }
    const disabledFromUrl = switches.includes('off');
    const removeSelectors = []
        .concat(fallback.remove || [], rules === fallback ? [] : rules.remove || []);
    const unhideSelectors = []
        .concat(fallback.unhide || [], rules === fallback ? [] : rules.unhide || []);

    // Native references, captured before the page can tamper with them.
    const nativeGetComputedStyle = win.getComputedStyle.bind(win);
    const nativeSetTimeout = win.setTimeout.bind(win);
    const nativeSetInterval = win.setInterval.bind(win);
    const nativeOpen = win.open ? win.open.bind(win) : null;
    const nativeFetch = win.fetch ? win.fetch.bind(win) : null;

    /**
     * Things that look like an ad container to a detector script.
     *
     * The ad words have to stand on their own: "-" and "_" count as edges,
     * letters and digits do not. Without that, "ad" matches the tail of
     * "load", "upload" and "lazyload", and half the player markup gets
     * treated as bait.
     */
    const EDGE_BEFORE = '(?:^|[^a-z0-9])';
    const EDGE_AFTER = '(?:$|[^a-z0-9])';
    const BAIT_RE = new RegExp(EDGE_BEFORE + '(?:' + [
        'ads?', 'adv', 'advert(?:is(?:e|ing|ement)s?)?',
        'ad(?:box|unit|slot|frame|wrap|holder|zone|space|banner|block|label|container)',
        'banner', 'sponsor', 'doubleclick', 'googlead', 'adsbygoogle',
        'pub[_-]?\\d+', 'popunder', 'pop[_-]?ads', 'adsterra', 'exoclick',
        'juicyads', 'trafficjunky', 'adnxs', 'taboola', 'outbrain',
    ].join('|') + ')' + EDGE_AFTER, 'i');

    /**
     * Third-party ad hosts. Nothing the site itself needs comes from these,
     * so a request to one can safely be faked or diverted.
     */
    const AD_HOST_RE = new RegExp([
        'doubleclick\\.net', 'googlesyndication\\.com', 'googleadservices\\.com',
        'adservice\\.google', 'amazon-adsystem\\.com', 'adnxs\\.com',
        'criteo\\.', 'taboola\\.com', 'outbrain\\.com', 'exoclick\\.com',
        'juicyads\\.com', 'popads\\.net', 'popcash\\.net', 'adsterra\\.com',
        'trafficjunky\\.net', 'exdynsrv\\.com', 'realsrv\\.com',
    ].join('|'), 'i');

    /**
     * Hosts plus the paths a detector pings to see whether requests get
     * blocked. Only used for <script>/<img>, where a swapped source costs
     * nothing; paths like "/banner" are too common to divert a data request.
     */
    const AD_PROBE_RE = new RegExp([
        AD_HOST_RE.source,
        '/ads?\\.js', '/ads?\\.php', '/adframe', '/adsbygoogle',
        '/prebid', '/pagead/', 'gpt\\.js',
    ].join('|'), 'i');

    /** Wording used by nag screens, in a few languages. */
    const NAG_TEXT_RE = new RegExp([
        'ad\\s?-?block(er|ers|ing)?', 'anti[-\\s]?adblock', 'ublock', 'adguard',
        'advertentie[-\\s]?blok', 'werbeblocker', 'bloqueur\\s+de\\s+pub',
        'bloqueador\\s+de\\s+anuncios', 'blocco\\s+(degli\\s+)?annunci',
        '(disable|turn\\s+off|deactivate|pause)\\s+(your\\s+)?(ad|advert)',
        '(schakel|zet)\\s+(je|uw)?\\s*adblock', 'deactiveer',
        'whitelist\\s+(us|this\\s+site|our\\s+site)',
        'add\\s+us\\s+to\\s+your\\s+whitelist',
    ].join('|'), 'i');

    /**
     * Code fragments that mean "this callback checks for an adblocker".
     * Deliberately narrow: a player often mentions ads while doing the very
     * work that starts the video, and dropping that timer stops playback.
     */
    const DETECTION_CODE_RE = new RegExp([
        'ad[_-]?block', 'adblock', 'blockadblock', 'fuckadblock',
        'canRunAds', 'canShowAds', 'isAdBlock', 'adBlockDetected',
        'adsAreBlocked', 'detectAdBlock', 'checkAdblock',
    ].join('|'), 'i');

    /** Safe string signature of an element, for bait matching. */
    function signature(el) {
        if (!el || el.nodeType !== 1) return '';
        let cls = el.className;
        if (typeof cls !== 'string') cls = (cls && cls.baseVal) || '';
        let sig = (el.id || '') + ' ' + cls + ' ' + (el.tagName || '');
        const dataset = el.dataset;
        if (dataset) {
            for (const key in dataset) sig += ' ' + key + ' ' + dataset[key];
        }
        return sig;
    }

    const baitCache = new WeakMap();

    function looksLikeBait(el) {
        if (!el || el.nodeType !== 1) return false;
        if (baitCache.has(el)) return baitCache.get(el);
        let result = BAIT_RE.test(signature(el));
        if (!result && el.tagName === 'INS') result = true; // adsbygoogle uses <ins>
        baitCache.set(el, result);
        return result;
    }

    // =====================================================================
    // 1. Bait visibility — hidden "ads" report a real size
    // =====================================================================

    const FAKE_SIZE = { width: 300, height: 250 };

    function fakeDimension(proto, prop, value) {
        const desc = Object.getOwnPropertyDescriptor(proto, prop);
        if (!desc || typeof desc.get !== 'function') return;
        Object.defineProperty(proto, prop, {
            configurable: true,
            enumerable: desc.enumerable,
            get() {
                const real = desc.get.call(this);
                if (real === 0 && looksLikeBait(this)) return value;
                return real;
            },
            set: desc.set,
        });
    }

    function installBaitVisibility() {
        const el = win.HTMLElement && win.HTMLElement.prototype;
        if (!el) return;

        fakeDimension(el, 'offsetHeight', FAKE_SIZE.height);
        fakeDimension(el, 'offsetWidth', FAKE_SIZE.width);
        fakeDimension(el, 'offsetTop', 10);
        fakeDimension(el, 'offsetLeft', 10);
        fakeDimension(win.Element.prototype, 'clientHeight', FAKE_SIZE.height);
        fakeDimension(win.Element.prototype, 'clientWidth', FAKE_SIZE.width);

        // getBoundingClientRect(): hand back a plausible rect for hidden bait.
        const nativeRect = win.Element.prototype.getBoundingClientRect;
        win.Element.prototype.getBoundingClientRect = function () {
            const rect = nativeRect.call(this);
            if ((rect.width === 0 || rect.height === 0) && looksLikeBait(this)) {
                return new DOMRect(10, 10, FAKE_SIZE.width, FAKE_SIZE.height);
            }
            return rect;
        };

        // getComputedStyle(): report bait as visible.
        const VISIBLE = {
            display: 'block',
            visibility: 'visible',
            opacity: '1',
            height: FAKE_SIZE.height + 'px',
            width: FAKE_SIZE.width + 'px',
        };
        win.getComputedStyle = function (element, pseudo) {
            const style = nativeGetComputedStyle(element, pseudo);
            if (pseudo || !style || !looksLikeBait(element)) return style;
            if (style.display !== 'none' && style.visibility !== 'hidden' &&
                style.opacity !== '0') {
                return style;
            }
            return new Proxy(style, {
                get(target, prop) {
                    if (prop in VISIBLE) return VISIBLE[prop];
                    if (prop === 'getPropertyValue') {
                        return (name) => (name in VISIBLE
                            ? VISIBLE[name]
                            : target.getPropertyValue(name));
                    }
                    const value = target[prop];
                    return typeof value === 'function' ? value.bind(target) : value;
                },
            });
        };

        log('bait visibility installed');
    }

    // =====================================================================
    // 2. Detector stubs
    // =====================================================================

    /** A drop-in replacement for the FuckAdBlock / BlockAdBlock API. */
    function makeFuckAdBlockStub() {
        function Stub(options) {
            this._options = Object.assign({
                checkOnLoad: false,
                resetOnEnd: false,
                loopCheckTime: 50,
                loopMaxNumber: 5,
                baitClass: '',
                baitStyle: '',
                debug: false,
            }, options || {});
            this._var = {};
            this._callbacks = { detected: [], notDetected: [] };
        }
        Stub.prototype.setOption = function (name, value) {
            if (typeof name === 'object') Object.assign(this._options, name);
            else this._options[name] = value;
            return this;
        };
        Stub.prototype.on = function (detected, fn) {
            this._callbacks[detected ? 'detected' : 'notDetected'].push(fn);
            if (!detected) nativeSetTimeout(() => fn(), 0);
            return this;
        };
        Stub.prototype.onDetected = function () { return this; };
        Stub.prototype.onNotDetected = function (fn) { return this.on(false, fn); };
        Stub.prototype.emitEvent = function () {
            this._callbacks.notDetected.forEach((fn) => { try { fn(); } catch (e) {} });
            return this;
        };
        Stub.prototype.clearEvent = function () {
            this._callbacks = { detected: [], notDetected: [] };
            return this;
        };
        Stub.prototype.check = function () { this.emitEvent(); return true; };
        return Stub;
    }

    /** Define a property the page cannot overwrite. */
    function lockGlobal(name, value) {
        try {
            Object.defineProperty(win, name, {
                configurable: false,
                enumerable: true,
                get() { return value; },
                set() { /* the page's own version is discarded */ },
            });
        } catch (err) {
            try { win[name] = value; } catch (e) { /* ignore */ }
        }
    }

    function installDetectorStubs() {
        const Stub = makeFuckAdBlockStub();
        const instance = new Stub();

        ['FuckAdBlock', 'BlockAdBlock', 'DetectAdBlock', 'AdBlockDetector',
         'AdBlocker', 'SniffAdBlock'].forEach((name) => lockGlobal(name, Stub));

        ['fuckAdBlock', 'blockAdBlock', 'sniffAdBlock', 'adBlockDetector',
         'detectAdBlock', 'adblockDetector'].forEach((name) => lockGlobal(name, instance));

        // "Do ads work?" flags a lot of sites read directly.
        [['canRunAds', true], ['canShowAds', true], ['isAdsDisplayed', true],
         ['adsAreBlocked', false], ['adblockDetected', false],
         ['isAdBlockActive', false], ['adBlockEnabled', false],
         ['google_ad_status', 1], ['_sp_', undefined]].forEach(([name, value]) => {
            if (value === undefined) return;
            lockGlobal(name, value);
        });

        // adsbygoogle: accept pushes silently so no error path is triggered.
        if (!Array.isArray(win.adsbygoogle)) {
            try {
                win.adsbygoogle = [];
                win.adsbygoogle.loaded = true;
                win.adsbygoogle.push = function () { return 1; };
            } catch (e) { /* ignore */ }
        }

        log('detector stubs installed');
    }

    // =====================================================================
    // 3. Ad-probe spoofing
    // =====================================================================

    const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const EMPTY_JS = 'data:text/javascript,';

    function isAdProbe(url) {
        return typeof url === 'string' && url.length > 0 && AD_PROBE_RE.test(url);
    }

    /**
     * What a blocked ad request should have answered. A video player asking
     * for a preroll needs a well-formed "no ad here" reply; an empty body
     * leaves it waiting, and a waiting player never starts the video.
     */
    const EMPTY_VAST = '<?xml version="1.0" encoding="UTF-8"?><VAST version="3.0"></VAST>';

    function emptyAdResponse(url) {
        if (/vast|vpaid|vmap|\.xml|ad_?tag|zoneid/i.test(url)) {
            return { text: EMPTY_VAST, type: 'text/xml' };
        }
        if (/\.json|json=|callback=/i.test(url)) {
            return { text: '{}', type: 'application/json' };
        }
        return { text: '', type: 'text/plain' };
    }

    /** Rewrite src on script/img elements before the request is even made. */
    function patchSrcSetter(proto, replacement, label) {
        if (!proto) return;
        const desc = Object.getOwnPropertyDescriptor(proto, 'src');
        if (!desc || typeof desc.set !== 'function') return;
        Object.defineProperty(proto, 'src', {
            configurable: true,
            enumerable: desc.enumerable,
            get: desc.get,
            set(value) {
                if (isAdProbe(String(value))) {
                    log('probe rewritten (' + label + '):', value);
                    desc.set.call(this, replacement);
                    return;
                }
                desc.set.call(this, value);
            },
        });
    }

    function installProbeSpoofing() {
        patchSrcSetter(win.HTMLScriptElement && win.HTMLScriptElement.prototype,
                       EMPTY_JS, 'script');
        patchSrcSetter(win.HTMLImageElement && win.HTMLImageElement.prototype,
                       PIXEL, 'img');

        // setAttribute('src', …) takes a different code path.
        const nativeSetAttribute = win.Element.prototype.setAttribute;
        win.Element.prototype.setAttribute = function (name, value) {
            if (String(name).toLowerCase() === 'src' && isAdProbe(String(value))) {
                const tag = this.tagName;
                if (tag === 'SCRIPT') return nativeSetAttribute.call(this, name, EMPTY_JS);
                if (tag === 'IMG') return nativeSetAttribute.call(this, name, PIXEL);
            }
            return nativeSetAttribute.call(this, name, value);
        };

        // fetch(): rescue a request the blocker killed. Only after it has
        // actually failed — pre-empting a request that would have succeeded
        // is how you break the site instead of the wall.
        if (nativeFetch) {
            win.fetch = function (input, init) {
                const url = typeof input === 'string' ? input
                          : (input && input.url) || '';
                const promise = nativeFetch(input, init);
                if (!isAdProbe(url)) return promise;
                return promise.catch(() => {
                    const body = emptyAdResponse(url);
                    log('probe rescued (fetch):', url);
                    return new Response(body.text, {
                        status: 200,
                        statusText: 'OK',
                        headers: { 'Content-Type': body.type },
                    });
                });
            };
        }

        // XMLHttpRequest: same idea. A player that asks for a preroll and
        // gets a network error waits forever, which is what leaves the play
        // button dead. An empty VAST answer means "no ad" and it moves on.
        if (win.XMLHttpRequest) {
            const nativeXhrOpen = win.XMLHttpRequest.prototype.open;
            const nativeXhrSend = win.XMLHttpRequest.prototype.send;

            win.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
                this.__veryantiUrl = String(url);
                return nativeXhrOpen.call(this, method, url, ...rest);
            };

            win.XMLHttpRequest.prototype.send = function (...args) {
                const xhr = this;
                const url = xhr.__veryantiUrl || '';
                if (isAdProbe(url)) {
                    let rescued = false;
                    const rescue = () => {
                        if (rescued) return;
                        rescued = true;
                        const body = emptyAdResponse(url);
                        const shadow = {
                            readyState: 4,
                            status: 200,
                            statusText: 'OK',
                            responseText: body.text,
                            response: body.text,
                            responseURL: url,
                        };
                        for (const key of Object.keys(shadow)) {
                            try {
                                Object.defineProperty(xhr, key, {
                                    configurable: true,
                                    get: () => shadow[key],
                                });
                            } catch (e) { /* keep going */ }
                        }
                        log('probe rescued (xhr):', url);
                        for (const type of ['readystatechange', 'load', 'loadend']) {
                            try { xhr.dispatchEvent(new Event(type)); } catch (e) { /* ignore */ }
                        }
                    };
                    xhr.addEventListener('error', rescue);
                    xhr.addEventListener('timeout', rescue);
                    xhr.addEventListener('abort', rescue);
                    // A blocker often answers with an instant status 0 "load".
                    xhr.addEventListener('load', () => {
                        if (xhr.status === 0) rescue();
                    });
                }
                return nativeXhrSend.apply(xhr, args);
            };
        }

        log('probe spoofing installed');
    }

    // =====================================================================
    // 4. Timer filtering
    // =====================================================================

    function installTimerFilter() {
        const wrap = (native) => function (handler, delay, ...args) {
            if (typeof handler === 'function' || typeof handler === 'string') {
                const source = String(handler);
                // Only inspect small callbacks: big bundles match by accident.
                if (source.length < 3000 && DETECTION_CODE_RE.test(source)) {
                    log('timer dropped:', source.slice(0, 120));
                    return 0;
                }
            }
            return native(handler, delay, ...args);
        };
        win.setTimeout = wrap(nativeSetTimeout);
        win.setInterval = wrap(nativeSetInterval);
        log('timer filter installed');
    }

    // =====================================================================
    // 5. DOM cleanup — kill overlays, keep the page usable
    // =====================================================================

    const UNLOCK_CSS = `
        html, body {
            overflow: visible !important;
            overflow-y: auto !important;
            position: static !important;
            filter: none !important;
            -webkit-filter: none !important;
        }
        body {
            pointer-events: auto !important;
            user-select: auto !important;
            -webkit-user-select: auto !important;
        }
    `;

    /**
     * At document-start <html> may not exist yet, so anything touching the
     * DOM has to wait for it. Observing `document` itself works even while
     * the tree is empty.
     */
    function whenDocumentElement(fn) {
        if (doc.documentElement) { fn(); return; }
        const observer = new MutationObserver(() => {
            if (!doc.documentElement) return;
            observer.disconnect();
            fn();
        });
        observer.observe(doc, { childList: true, subtree: true });
    }

    function injectStyle(css) {
        const root = doc.head || doc.documentElement;
        if (!root) return null;
        const style = doc.createElement('style');
        style.textContent = css;
        root.appendChild(style);
        return style;
    }

    /** Elements worth checking for "is this a nag screen?". */
    const CANDIDATE_SELECTOR = [
        '[class*="modal"]', '[class*="overlay"]', '[class*="popup"]',
        '[class*="block"]', '[class*="notice"]', '[class*="warn"]',
        '[class*="curtain"]', '[class*="backdrop"]', '[class*="mask"]',
        '[id*="modal"]', '[id*="overlay"]', '[id*="popup"]',
        '[id*="block"]', '[id*="notice"]',
    ].join(',');

    function isFullScreenLayer(el, style, rect) {
        if (style.position !== 'fixed' && style.position !== 'absolute') return false;
        return rect.width >= win.innerWidth * 0.75 &&
               rect.height >= win.innerHeight * 0.6;
    }

    function isNagScreen(el) {
        if (!el || el.nodeType !== 1 || !el.isConnected) return false;
        if (el === doc.body || el === doc.documentElement) return false;
        // A wall wrapped around the player is still a wall, but removing the
        // player with it leaves a page where nothing plays. Leave anything
        // holding the video alone; the nag inside it is caught separately.
        if (holdsProtectedContent(el)) return false;

        let style;
        try { style = nativeGetComputedStyle(el); } catch (e) { return false; }
        if (!style || style.display === 'none' || style.visibility === 'hidden') {
            return false;
        }

        const rect = el.getBoundingClientRect();
        const zIndex = parseInt(style.zIndex, 10) || 0;
        const fullScreen = isFullScreenLayer(el, style, rect);
        const text = (el.innerText || el.textContent || '').slice(0, 3000);

        if (NAG_TEXT_RE.test(text) && (fullScreen || zIndex >= 100)) return true;
        if (NAG_TEXT_RE.test(signature(el)) && fullScreen) return true;
        if (settings.aggressiveOverlayRemoval && fullScreen && zIndex >= 1000 &&
            text.trim().length < 500) {
            return true;
        }
        return false;
    }

    /** Remove the dim layer that usually sits behind a modal. */
    function removeBackdrops() {
        const body = doc.body;
        if (!body) return;
        for (const el of Array.from(body.children)) {
            if (el.nodeType !== 1 || el.tagName === 'SCRIPT') continue;
            if (holdsProtectedContent(el)) continue;
            let style;
            try { style = nativeGetComputedStyle(el); } catch (e) { continue; }
            if (style.position !== 'fixed') continue;
            const rect = el.getBoundingClientRect();
            if (!isFullScreenLayer(el, style, rect)) continue;
            const text = (el.innerText || '').trim();
            const zIndex = parseInt(style.zIndex, 10) || 0;
            if (text.length === 0 && zIndex >= 100) {
                log('backdrop removed:', signature(el).trim());
                el.remove();
            }
        }
    }

    /**
     * Content that must survive: the player, and anything holding it. The
     * text scan walks up the tree and stops before these.
     */
    const PROTECTED_SELECTOR = 'video, audio, [id*="player" i], [class*="player" i]';

    function holdsProtectedContent(el) {
        try {
            if (el.matches && el.matches(PROTECTED_SELECTOR)) return true;
            return !!(el.querySelector && el.querySelector(PROTECTED_SELECTOR));
        } catch (e) {
            return false;
        }
    }

    const SKIP_TAGS = /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|TITLE|TEMPLATE)$/;

    /**
     * From the element holding nagging text, walk up to the box that holds
     * the whole notice — the bar, banner or dialog — without swallowing the
     * page. Returns null when nothing can be removed safely.
     */
    function nagContainer(start) {
        const MAX_TEXT = 900;
        let node = start;
        let candidate = null;

        while (node && node !== doc.body && node !== doc.documentElement) {
            if (holdsProtectedContent(node)) break;
            const text = (node.innerText || node.textContent || '');
            if (text.length > MAX_TEXT) break;

            candidate = node;

            let style;
            try { style = nativeGetComputedStyle(node); } catch (e) { style = null; }
            // A positioned layer, or a box sitting straight in <body>, is
            // where a notice normally ends.
            if (style && (style.position === 'fixed' || style.position === 'sticky')) {
                return node;
            }
            if (node.parentElement === doc.body) return node;

            node = node.parentElement;
        }
        return candidate;
    }

    /**
     * A wall built *around* the player cannot be deleted without taking the
     * video with it. Strip what makes it a wall instead: it stops covering
     * the page, and the player inside keeps working.
     */
    function defuseWallsAroundPlayer() {
        let candidates;
        try { candidates = doc.querySelectorAll(CANDIDATE_SELECTOR); }
        catch (e) { return; }

        candidates.forEach((el) => {
            if (!holdsProtectedContent(el)) return;
            let style;
            try { style = nativeGetComputedStyle(el); } catch (e) { return; }
            if (style.position !== 'fixed' && style.position !== 'absolute') return;
            if (!isFullScreenLayer(el, style, el.getBoundingClientRect())) return;

            const text = (el.innerText || el.textContent || '').slice(0, 3000);
            if (!NAG_TEXT_RE.test(text) && !NAG_TEXT_RE.test(signature(el))) return;

            el.style.setProperty('position', 'static', 'important');
            el.style.setProperty('background', 'none', 'important');
            el.style.setProperty('z-index', 'auto', 'important');
            log('defused a wall around the player:', signature(el).trim());
        });
    }

    /** Find adblock nagging by its wording, whatever the element is called. */
    function scanForNagText() {
        if (!doc.body) return;

        let walker;
        try {
            walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
                acceptNode(node) {
                    const data = node.data;
                    if (!data || data.length < 8 || data.length > 400) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    const parent = node.parentElement;
                    if (!parent || SKIP_TAGS.test(parent.tagName)) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NAG_TEXT_RE.test(data)
                        ? NodeFilter.FILTER_ACCEPT
                        : NodeFilter.FILTER_REJECT;
                },
            });
        } catch (e) {
            return;
        }

        const hits = [];
        while (walker.nextNode()) hits.push(walker.currentNode);
        if (!hits.length) return;

        let removedAny = false;
        for (const textNode of hits) {
            const parent = textNode.parentElement;
            if (!parent || !parent.isConnected) continue;

            let style;
            try { style = nativeGetComputedStyle(parent); } catch (e) { continue; }
            if (!style || style.display === 'none' || style.visibility === 'hidden') {
                continue; // already invisible, leave it alone
            }

            const container = nagContainer(parent);
            if (!container || container === doc.body) continue;
            kill(container, 'nag text: ' + textNode.data.trim().slice(0, 60));
            removedAny = true;
        }
        if (removedAny) removeBackdrops();
    }

    let removedCount = 0;

    function kill(el, reason) {
        if (!el || !el.isConnected) return;
        removedCount++;
        log('removed (' + reason + '):', signature(el).trim() || el.tagName,
            '#' + removedCount);
        el.remove();
    }

    function unlockScrolling() {
        const html = doc.documentElement;
        const body = doc.body;
        [html, body].forEach((el) => {
            if (!el) return;
            if (el.style.overflow === 'hidden') el.style.overflow = '';
            if (el.style.position === 'fixed') el.style.position = '';
            if (el.style.filter) el.style.filter = '';
        });
        // Classes sites toggle to freeze the page.
        const LOCK_CLASSES = /(^|\s)(modal-open|no-scroll|noscroll|overflow-hidden|scroll-lock|is-locked|blurred|blur)(\s|$)/gi;
        [html, body].forEach((el) => {
            if (!el || typeof el.className !== 'string') return;
            const cleaned = el.className.replace(LOCK_CLASSES, ' ').trim();
            if (cleaned !== el.className) {
                el.className = cleaned;
                log('unlocked scroll on <' + el.tagName.toLowerCase() + '>');
            }
        });
    }

    function sweep() {
        if (!doc.body) return;

        for (const selector of removeSelectors) {
            let nodes;
            try { nodes = doc.querySelectorAll(selector); } catch (e) { continue; }
            nodes.forEach((el) => kill(el, 'rule'));
        }

        let candidates;
        try { candidates = doc.querySelectorAll(CANDIDATE_SELECTOR); }
        catch (e) { candidates = []; }
        let hit = false;
        candidates.forEach((el) => {
            if (isNagScreen(el)) { kill(el, 'nag screen'); hit = true; }
        });
        if (hit) removeBackdrops();

        defuseWallsAroundPlayer();

        if (settings.textScan) scanForNagText();

        for (const selector of unhideSelectors) {
            let nodes;
            try { nodes = doc.querySelectorAll(selector); } catch (e) { continue; }
            nodes.forEach((el) => {
                const style = nativeGetComputedStyle(el);
                if (style.display === 'none') el.style.setProperty('display', 'block', 'important');
                if (style.visibility === 'hidden') el.style.setProperty('visibility', 'visible', 'important');
                if (style.opacity === '0') el.style.setProperty('opacity', '1', 'important');
            });
        }

        unlockScrolling();
    }

    function installDomCleanup() {
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (isNagScreen(node)) { kill(node, 'nag screen'); removeBackdrops(); }
                }
            }
            unlockScrolling();
        });

        whenDocumentElement(() => {
            injectStyle(UNLOCK_CSS);
            observer.observe(doc.documentElement, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'style'],
            });
            sweep();
        });

        doc.addEventListener('DOMContentLoaded', sweep);
        win.addEventListener('load', sweep);
        nativeSetInterval(sweep, settings.sweepInterval);

        log('DOM cleanup installed');
    }

    // =====================================================================
    // 6. Popup / popunder guard
    // =====================================================================

    function installPopupGuard() {
        if (!nativeOpen) return;

        // Only block window.open() that was not started by a real click.
        let lastUserClick = 0;
        doc.addEventListener('click', () => { lastUserClick = Date.now(); }, true);

        win.open = function (url, ...rest) {
            const trusted = Date.now() - lastUserClick < 500;
            if (!trusted) {
                log('popup blocked:', url);
                return null;
            }
            return nativeOpen(url, ...rest);
        };

        // Sites use onbeforeunload to bounce you back into a nag screen.
        Object.defineProperty(win, 'onbeforeunload', {
            configurable: true,
            get() { return null; },
            set() { /* dropped */ },
        });

        log('popup guard installed');
    }

    // =====================================================================
    // Boot
    // =====================================================================

    const steps = [
        ['fakeBaitVisibility', installBaitVisibility],
        ['stubDetectors', installDetectorStubs],
        ['spoofAdProbes', installProbeSpoofing],
        ['filterTimers', installTimerFilter],
        ['cleanDom', installDomCleanup],
        ['blockPopups', installPopupGuard],
    ];

    const installed = [];
    const failed = [];

    for (const [flag, install] of steps) {
        if (disabledFromUrl) break;
        if (!settings[flag]) continue;
        try {
            install();
            installed.push(flag);
        } catch (err) {
            failed.push({ layer: flag, error: String(err) });
            warn(flag + ' failed:', err);
        }
    }

    // Handy while tuning: window.__veryanti.sweep() / .rules
    try {
        Object.defineProperty(win, '__veryanti', {
            configurable: true,
            value: {
                version: VERSION,
                settings,
                installed,
                failed,
                rules: { remove: removeSelectors, unhide: unhideSelectors },
                sweep,
                get removed() { return removedCount; },
            },
        });
    } catch (e) { /* ignore */ }

    // Proof of life, on purpose not behind the debug flag: one line in the
    // console, plus a marker on <html>. The marker survives even when a
    // script manager has to sandbox the script — in that case the console
    // sees data-veryanti but window.__veryanti stays undefined, which tells
    // you exactly what went wrong.
    whenDocumentElement(() => {
        try {
            doc.documentElement.setAttribute('data-veryanti', VERSION);
        } catch (e) { /* ignore */ }
    });

    // Lines logged before <body> existed still have to reach the panel.
    doc.addEventListener('DOMContentLoaded', renderPanel);
    win.addEventListener('load', renderPanel);

    console.info(TAG, TAG_STYLE, 'v' + VERSION + ' on ' + location.hostname +
        (disabledFromUrl ? ' - switched off from the URL' : '') +
        ' - active: ' + (installed.join(', ') || 'nothing') +
        (failed.length ? ' - failed: ' + failed.map((f) => f.layer).join(', ') : ''));

    log('settings', settings);
})();
