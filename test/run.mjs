/**
 * Smoke test for veryanti.user.js.
 *
 * test/fixture.html runs seven common anti-adblock detections plus a polite
 * nag bar. It is served as https://xadultflix.com/ so the per-host rules in
 * SITE_RULES are the ones under test.
 *
 * Three scenarios:
 *   1. no script          — the wall must appear (proves the fixture works)
 *   2. script             — every detection must come back clean
 *   3. script + ?wall=1   — the wall is raised regardless of detection, so
 *                           the DOM-cleanup layer has to remove it on its own
 *
 *   node test/run.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

// Playwright may be installed locally or globally; take whichever is there.
const require = createRequire(import.meta.url);
let chromium;
try {
    ({ chromium } = require('playwright'));
} catch {
    ({ chromium } = require(join(
        process.env.NODE_PATH || '/opt/node22/lib/node_modules', 'playwright')));
}

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(here, '..', 'veryanti.user.js');
const fixtureHtml = await readFile(join(here, 'fixture.html'), 'utf8');
const SITE = 'https://xadultflix.com/';

async function run({ withScript, query = '' }) {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    if (withScript) await page.addInitScript({ path: scriptPath });

    // Serve the fixture from the real hostname so SITE_RULES applies.
    await page.route(SITE + '**', (route) => route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: fixtureHtml,
    }));
    // The fixture probes a real ad host; block it so the request fails the
    // same way an adblocker would make it fail.
    await page.route('**://*.googlesyndication.com/**', (route) => route.abort());
    await page.route('**://*.exoclick.com/**', (route) => route.abort());

    await page.goto(SITE + query);
    await page.waitForTimeout(1500);

    const state = await page.evaluate(() => ({
        checks: window.__results.checks,
        overlay: !!document.getElementById('adblock-overlay'),
        nagBar: !!document.getElementById('topbar'),
        contentIntact: !!document.getElementById('content'),
        scrollLocked: getComputedStyle(document.body).overflow === 'hidden',
        playbackStarted: window.__results.playbackStarted === true,
        queueRan: window.__results.queueRan === true,
        adRendered: window.__results.adRendered === true,
        detectorCallable: window.__results.detectorCallable === true,
        afterSdkCall: window.__results.afterSdkCall === true,
        playerPresent: !!document.getElementById('player'),
        playerHidden: (() => {
            const player = document.getElementById('player');
            return player ? getComputedStyle(player).display === 'none' : true;
        })(),
        wallIsOverlay: (() => {
            const wall = document.querySelector('.blocker-modal');
            return wall ? getComputedStyle(wall).position === 'fixed' : false;
        })(),
        layers: window.__veryanti
            ? { installed: window.__veryanti.installed, failed: window.__veryanti.failed }
            : null,
    }));

    await browser.close();
    return state;
}

function report(label, state) {
    console.log(`\n--- ${label} ---`);
    for (const check of state.checks) {
        console.log(`  ${check.detected ? 'DETECTED ' : 'clean    '} ${check.name}`);
    }
    console.log(`  overlay present : ${state.overlay}`);
    console.log(`  nag bar present : ${state.nagBar}`);
    console.log(`  content intact  : ${state.contentIntact}`);
    console.log(`  scroll locked   : ${state.scrollLocked}`);
    console.log(`  player hidden   : ${state.playerHidden}`);
    console.log(`  playback started: ${state.playbackStarted}`);
    console.log(`  ad queue ran    : ${state.queueRan}`);
    console.log(`  ad reported     : ${state.adRendered}`);
    console.log(`  detector callable: ${state.detectorCallable}`);
    console.log(`  survived sdk call: ${state.afterSdkCall}`);
    if (state.layers) {
        console.log(`  layers active   : ${state.layers.installed.join(', ')}`);
        for (const failure of state.layers.failed) {
            console.log(`  LAYER FAILED    : ${failure.layer} — ${failure.error}`);
        }
    }
}

const failures = [];

const baseline = await run({ withScript: false });
report('without Veryanti (expect a wall)', baseline);
if (!baseline.overlay) failures.push('fixture did not raise a wall without the script');
if (!baseline.nagBar) failures.push('fixture lost its nag bar without the script');
if (baseline.playbackStarted) {
    failures.push('fixture started playback without the script, so the preroll test proves nothing');
}

const patched = await run({ withScript: true });
report('with Veryanti (expect no wall)', patched);
for (const check of patched.checks) {
    if (check.detected) failures.push(`detection still fires: ${check.name}`);
}
if (patched.overlay) failures.push('overlay was not removed');
if (patched.nagBar) failures.push('nag bar was not removed');
if (!patched.contentIntact) failures.push('page content was removed along with the nagging');
if (patched.scrollLocked) failures.push('scrolling is still locked');
if (!patched.playbackStarted) {
    failures.push('the blocked preroll was not answered, so playback never started');
}
if (!patched.detectorCallable) {
    failures.push('calling the detector global threw, so the site script died at that line');
}
if (!patched.adRendered) {
    failures.push('the ad library never reported a rendered ad, so the site still sees a blocker');
}
if (!patched.queueRan) {
    failures.push('the ad library queue was never drained, so its callback never ran');
}
if (!patched.afterSdkCall) {
    failures.push('a call into the missing ad SDK threw and killed the rest of the function');
}
// Every layer must actually install: a layer that throws at boot used to go
// unnoticed because the other layers hid the symptom.
for (const failure of patched.layers?.failed ?? []) {
    failures.push(`layer failed to install: ${failure.layer} — ${failure.error}`);
}
for (const layer of ['fakeBaitVisibility', 'stubDetectors', 'spoofAdProbes',
                     'filterTimers', 'cleanDom', 'blockPopups']) {
    if (!patched.layers?.installed.includes(layer)) {
        failures.push(`layer never installed: ${layer}`);
    }
}

const forced = await run({ withScript: true, query: '?wall=1' });
report('with Veryanti, wall forced open (DOM cleanup only)', forced);
if (forced.overlay) failures.push('forced wall was not removed');
if (forced.scrollLocked) failures.push('forced wall left scrolling locked');
if (forced.playerHidden) failures.push('forced wall left the player hidden');
if (!forced.contentIntact) failures.push('forced-wall cleanup removed page content');

// A wall built around the player must lose its overlay styling, not take
// the player down with it.
const wrapped = await run({ withScript: true, query: '?wrap=1' });
report('with Veryanti, wall wrapped around the player', wrapped);
if (!wrapped.playerPresent) failures.push('the player was removed with the wall');
if (wrapped.playerHidden) failures.push('the player stayed hidden inside the wall');
if (wrapped.wallIsOverlay) failures.push('the wall around the player still covers the page');

// The URL switch has to be able to turn everything off, or there is no way
// to tell "the site blocks this" from "the script breaks this" on a phone.
const switchedOff = await run({ withScript: true, query: '#veryanti=off' });
report('with Veryanti switched off from the URL', switchedOff);
if (switchedOff.layers?.installed.length) {
    failures.push('#veryanti=off still installed layers');
}
if (!switchedOff.overlay) failures.push('#veryanti=off should leave the wall standing');

console.log('');
if (failures.length) {
    for (const failure of failures) console.error(`FAIL  ${failure}`);
    process.exit(1);
}
console.log('PASS  every detection neutralised, walls removed, page usable');
