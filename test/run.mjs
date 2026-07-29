/**
 * Smoke test for veryanti.user.js.
 *
 * Loads test/fixture.html — a page that runs seven common anti-adblock
 * detections — first without and then with the userscript injected at
 * document-start, and asserts that the wall appears in the first run and is
 * gone in the second.
 *
 *   node test/run.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
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
const fixture = pathToFileURL(join(here, 'fixture.html')).href;
const script = join(here, '..', 'veryanti.user.js');

async function run({ withScript }) {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    if (withScript) await page.addInitScript({ path: script });

    // The fixture probes a real ad host; block it so the request fails the
    // same way an adblocker would make it fail.
    await page.route('**://*.googlesyndication.com/**', (route) => route.abort());

    await page.goto(fixture);
    await page.waitForTimeout(1200);

    const state = await page.evaluate(() => ({
        checks: window.__results.checks,
        overlay: !!document.getElementById('adblock-overlay'),
        scrollLocked: getComputedStyle(document.body).overflow === 'hidden',
        playerHidden: getComputedStyle(document.getElementById('player')).display === 'none',
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
    console.log(`  scroll locked   : ${state.scrollLocked}`);
    console.log(`  player hidden   : ${state.playerHidden}`);
}

const baseline = await run({ withScript: false });
report('without Veryanti (expect a wall)', baseline);

const patched = await run({ withScript: true });
report('with Veryanti (expect no wall)', patched);

const failures = [];
if (!baseline.overlay) failures.push('fixture did not raise a wall without the script');
for (const check of patched.checks) {
    if (check.detected) failures.push(`detection still fires: ${check.name}`);
}
if (patched.overlay) failures.push('overlay was not removed');
if (patched.scrollLocked) failures.push('scrolling is still locked');
if (patched.playerHidden) failures.push('player is still hidden');

console.log('');
if (failures.length) {
    for (const failure of failures) console.error(`FAIL  ${failure}`);
    process.exit(1);
}
console.log('PASS  every detection neutralised, page usable');
