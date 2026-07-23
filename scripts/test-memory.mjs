#!/usr/bin/env node
/**
 * Standalone large-page memory verification (NOT part of `npm test`).
 *
 * Why not Jest: in-process heapUsed thresholds under Jest+jsdom are dominated
 * by test-runner overhead and GC timing, which made the old memory.test.ts
 * permanently red. This script runs the real DiffEngine in a dedicated child
 * process (cold start, fixed fixture, --expose-gc) and enforces:
 *   1. completion without crash within TIMEOUT_MS
 *   2. post-GC retained heap below RETAINED_HEAP_LIMIT_MB
 *   3. peak RSS below PEAK_RSS_LIMIT_MB
 *
 * Threshold rationale: Phase-2 profiling of the current engine on a 3.8MB
 * synthetic page measured ~1157MB median peak RSS and ~575MB in-process heap
 * after compare (pre-optimization baseline was ~2334MB RSS). Limits are set
 * ~40-70% above current medians to catch regressions toward the old baseline
 * while tolerating environment noise.
 *
 * Usage: npm run test:memory
 * Exit code: 0 = pass, 1 = fail (threshold or crash), 2 = harness error.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { build } from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const TIMEOUT_MS = 120_000;
const RETAINED_HEAP_LIMIT_MB = 900;   // post-GC heap in child (current ~575MB)
const PEAK_RSS_LIMIT_MB = 1900;       // child max RSS (current median ~1157MB)

async function main() {
    // 1. Bundle the real DiffEngine (never shipped; temp output only).
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'confsync-mem-'));
    const enginePath = path.join(tmpDir, 'diff-engine.cjs');
    await build({
        entryPoints: [path.join(root, 'src/diff/diff-engine.ts')],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        external: ['obsidian'],
        outfile: enginePath,
        logLevel: 'silent',
    });

    // 2. Child runner: cold-start process with jsdom DOM + fixed fixture.
    const runnerPath = path.join(tmpDir, 'runner.cjs');
    fs.writeFileSync(runnerPath, `
const { JSDOM } = require(${JSON.stringify(path.join(root, 'node_modules/jsdom'))});
const dom = new JSDOM('<!doctype html><html><body></body></html>');
global.DOMParser = dom.window.DOMParser;
global.Node = dom.window.Node;
global.document = dom.window.document;
// Obsidian exposes createEl (and DOM classes) as globals; the diff engine
// uses them for detached node creation. Provide minimal equivalents.
global.createEl = function (tag) { return dom.window.document.createElement(tag); };
global.DocumentFragment = dom.window.DocumentFragment;
global.XMLSerializer = dom.window.XMLSerializer;

const { DiffEngine } = require(${JSON.stringify(enginePath)});

// Fixed fixture: paragraphs + tables (deterministic, matches profiling shape)
function makeStorage(paragraphs, tables) {
    const parts = [];
    for (let i = 0; i < paragraphs; i++) {
        parts.push('<h2>Section ' + i + '</h2><p>Paragraph ' + i + ' with some <strong>bold</strong> and <em>italic</em> text that is reasonably long to simulate real Confluence content lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor.</p>');
        if (i % Math.ceil(paragraphs / tables) === 0) {
            let rows = '';
            for (let r = 0; r < 20; r++) rows += '<tr><td><p>cell a</p></td><td><p>cell b</p></td><td><p>cell c</p></td></tr>';
            parts.push('<table><colgroup><col/><col/><col/></colgroup><tbody>' + rows + '</tbody></table>');
        }
    }
    return parts.join('');
}

(async () => {
    const storage = makeStorage(15000, 100); // ≈3.8MB, same as profiling baseline
    const engine = new DiffEngine();
    const t0 = Date.now();
    const result = await engine.compare('local placeholder body', storage);
    const durationMs = Date.now() - t0;
    if (global.gc) global.gc();
    const retainedHeapMB = process.memoryUsage().heapUsed / 1024 / 1024;
    process.stdout.write(JSON.stringify({
        ok: true,
        durationMs,
        retainedHeapMB: +retainedHeapMB.toFixed(1),
        isIdentical: result.isIdentical,
        remoteContentLength: result.remoteContent.length,
    }) + '\\n');
    process.exit(0);
})().catch((e) => {
    process.stdout.write(JSON.stringify({ ok: false, error: String(e && e.message || e) }) + '\\n');
    process.exit(1);
});
`);

    // 3. Spawn with timeout; sample child RSS for peak measurement.
    const child = spawn(process.execPath, ['--expose-gc', runnerPath], {
        stdio: ['ignore', 'pipe', 'inherit'],
    });

    let peakRssMB = 0;
    const rssTimer = setInterval(() => {
        try {
            // ps works on macOS and Linux; rss is in KB.
            const out = spawn('ps', ['-o', 'rss=', '-p', String(child.pid)]);
            let buf = '';
            out.stdout.on('data', (d) => (buf += d));
            out.on('close', () => {
                const kb = parseInt(buf.trim(), 10);
                if (!Number.isNaN(kb)) peakRssMB = Math.max(peakRssMB, kb / 1024);
            });
        } catch { /* sampling is best-effort */ }
    }, 250);

    const killTimer = setTimeout(() => {
        clearInterval(rssTimer);
        child.kill('SIGKILL');
        console.error(`FAIL: memory check timed out after ${TIMEOUT_MS}ms`);
        process.exitCode = 1;
    }, TIMEOUT_MS);

    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d));

    const exitCode = await new Promise((resolve) => child.on('close', resolve));
    clearTimeout(killTimer);
    clearInterval(rssTimer);
    fs.rmSync(tmpDir, { recursive: true, force: true });

    if (process.exitCode === 1) return; // timed out

    let report;
    try {
        report = JSON.parse(stdout.trim().split('\n').pop());
    } catch {
        console.error('FAIL: child produced no parsable report. Raw output:\n' + stdout);
        process.exitCode = 1;
        return;
    }

    console.log('--- Large-page memory verification (3.8MB fixture, cold child process) ---');
    console.log(JSON.stringify({ ...report, peakRssMB: +peakRssMB.toFixed(1), exitCode }, null, 2));

    const failures = [];
    if (exitCode !== 0 || !report.ok) failures.push(`child failed (exit ${exitCode}): ${report.error || 'unknown'}`);
    if (report.ok && report.isIdentical !== false) failures.push('unexpected isIdentical result');
    if (report.ok && report.retainedHeapMB >= RETAINED_HEAP_LIMIT_MB)
        failures.push(`retained heap ${report.retainedHeapMB}MB >= limit ${RETAINED_HEAP_LIMIT_MB}MB`);
    if (peakRssMB > 0 && peakRssMB >= PEAK_RSS_LIMIT_MB)
        failures.push(`peak RSS ${peakRssMB.toFixed(0)}MB >= limit ${PEAK_RSS_LIMIT_MB}MB`);

    if (failures.length) {
        console.error('FAIL:\n  - ' + failures.join('\n  - '));
        process.exitCode = 1;
    } else {
        console.log('PASS: completed without crash within memory bounds.');
    }
}

main().catch((e) => {
    console.error('Harness error:', e);
    process.exitCode = 2;
});
