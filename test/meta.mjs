/**
 * Metadata check for veryanti.user.js.
 *
 * A script manager reads the ==UserScript== block with a strict line parser:
 * every line has to be `// @key value`. Prose, decoration or a stray blank
 * line in there can make the whole script fail to install or fail to match,
 * which looks exactly like "the script doesn't load". This test parses the
 * block the same way and validates what comes out.
 *
 *   node test/meta.mjs
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const source = await readFile(join(root, 'veryanti.user.js'), 'utf8');
const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8');

const failures = [];
const lines = source.split(/\r?\n/);
const start = lines.findIndex((line) => /^\/\/\s*==UserScript==\s*$/.test(line));
const end = lines.findIndex((line) => /^\/\/\s*==\/UserScript==\s*$/.test(line));

if (start === -1) failures.push('no // ==UserScript== opening marker');
if (end === -1) failures.push('no // ==/UserScript== closing marker');
if (start !== 0) failures.push(`metadata block must start on line 1, found it on ${start + 1}`);

const directives = new Map();
if (start !== -1 && end > start) {
    for (let i = start + 1; i < end; i++) {
        const line = lines[i];
        // The parser managers use: "// @key rest-of-line".
        const match = /^\/\/\s*@([^\s]+)(?:\s+(.*))?$/.exec(line);
        if (!match) {
            failures.push(`line ${i + 1} is not a "// @key value" pair: ${JSON.stringify(line)}`);
            continue;
        }
        const [, key, rawValue] = match;
        const value = (rawValue || '').trim();
        if (!value && key !== 'noframes') {
            failures.push(`line ${i + 1}: @${key} has no value`);
        }
        if (!directives.has(key)) directives.set(key, []);
        directives.get(key).push(value);
    }
}

for (const key of ['name', 'version', 'run-at', 'grant']) {
    if (!directives.has(key)) failures.push(`missing @${key}`);
}
if (!directives.has('match') && !directives.has('include')) {
    failures.push('missing @match (the script would never run anywhere)');
}

// Chrome-style match patterns: <scheme>://<host><path>
const MATCH_PATTERN = /^(\*|https?|file|ftp):\/\/(\*|(\*\.)?[^/*]+)(\/.*)$/;
for (const pattern of directives.get('match') || []) {
    if (!MATCH_PATTERN.test(pattern)) {
        failures.push(`invalid @match pattern: ${pattern}`);
    }
}

// A regex @include has to be delimited; a bare regex is read as a URL glob.
for (const pattern of directives.get('include') || []) {
    if (/[\\^$]/.test(pattern) && !/^\/.*\/$/.test(pattern)) {
        failures.push(`@include looks like a regex but is not wrapped in slashes: ${pattern}`);
    }
}

const version = (directives.get('version') || [])[0];
if (version && !/^\d+\.\d+\.\d+$/.test(version)) {
    failures.push(`@version is not x.y.z: ${version}`);
}

// The version in the header and the one the script reports must agree.
const reported = /const VERSION = '([^']+)'/.exec(source);
if (!reported) failures.push('no VERSION constant found in the script body');
else if (reported[1] !== version) {
    failures.push(`@version ${version} does not match VERSION ${reported[1]} in the body`);
}

// The changelog leads with the version being shipped; the release workflow
// takes its notes from that section.
const newestEntry = /^## (\S+)/m.exec(changelog);
if (!newestEntry) failures.push('CHANGELOG.md has no "## <version>" entry');
else if (newestEntry[1] !== version) {
    failures.push(`@version ${version} is not the newest CHANGELOG entry (${newestEntry[1]})`);
}

// Auto-update needs both URLs: managers fetch @updateURL to compare versions
// and @downloadURL for the file itself.
for (const key of ['updateURL', 'downloadURL']) {
    const value = (directives.get(key) || [])[0];
    if (!value) {
        failures.push(`missing @${key}, so script managers cannot auto-update`);
    } else if (!/^https:\/\//.test(value)) {
        failures.push(`@${key} must be https: ${value}`);
    } else if (!value.endsWith('.user.js')) {
        failures.push(`@${key} must end in .user.js: ${value}`);
    }
}

console.log('metadata directives:');
for (const [key, values] of directives) {
    for (const value of values) console.log(`  @${key} ${value}`);
}

console.log('');
if (failures.length) {
    for (const failure of failures) console.error(`FAIL  ${failure}`);
    process.exit(1);
}
console.log('PASS  metadata block parses cleanly');
