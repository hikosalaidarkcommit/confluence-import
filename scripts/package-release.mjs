#!/usr/bin/env node
/**
 * Local release packaging script (no publish / no push / no remote mutation).
 *
 * Pipeline (fail-fast, each step must exit 0):
 *   1. npm test           - full Jest suite
 *   2. npm run build      - typecheck (tsc -noEmit) + esbuild production bundle
 *   3. clean staging dir  - release/staging is removed and recreated
 *   4. copy whitelist     - main.js, manifest.json, styles.css ONLY
 *   5. zip                - release/<plugin-id>-<version>.zip (flat structure,
 *                           suitable for manual install: unzip into
 *                           <vault>/.obsidian/plugins/<plugin-id>/)
 *   6. verify             - scripts/verify-release.mjs against the fresh zip
 *
 * NOTE on the memory gate: `npm run test:memory` is intentionally NOT a
 * hard packaging gate. It spawns a cold-start child process with a peak-RSS
 * bound (~1.9GB ceiling) whose absolute measurements vary with machine load,
 * making it flaky as a blocking gate on a busy workstation. Run it as an
 * independent verification step (`npm run test:memory`) before cutting a
 * release, or pass --with-memory to include it in this pipeline.
 */
import { execSync, execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const WHITELIST = ["main.js", "manifest.json", "styles.css"];

function run(cmd, label) {
    console.log(`\n=== ${label}: ${cmd} ===`);
    execSync(cmd, { stdio: "inherit" }); // throws (non-zero exit) on failure
}

function fail(msg) {
    console.error(`\nPACKAGE FAILED: ${msg}`);
    process.exit(1);
}

const withMemory = process.argv.includes("--with-memory");

// --- 0. version contract sanity ---------------------------------------
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));

if (!manifest.id || !manifest.version) fail("manifest.json missing id/version");
if (manifest.version !== pkg.version)
    fail(`version mismatch: manifest ${manifest.version} != package.json ${pkg.version}`);
if (versions[manifest.version] !== manifest.minAppVersion)
    fail(`versions.json["${manifest.version}"] (${versions[manifest.version]}) != manifest.minAppVersion (${manifest.minAppVersion})`);
if (manifest.isDesktopOnly !== true) fail("manifest.isDesktopOnly must be true");

// --- 1-2. quality gates -------------------------------------------------
run("npm test", "test");
if (withMemory) run("npm run test:memory", "test:memory (opt-in gate)");
run("npm run build", "build");

// --- 3. clean staging ---------------------------------------------------
const releaseDir = path.join(root, "release");
const staging = path.join(releaseDir, "staging");
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

// --- 4. copy whitelist only ----------------------------------------------
for (const f of WHITELIST) {
    if (!fs.existsSync(f)) fail(`required release file missing: ${f}`);
    fs.copyFileSync(f, path.join(staging, f));
}
const staged = fs.readdirSync(staging).sort();
if (staged.join(",") !== [...WHITELIST].sort().join(","))
    fail(`staging contains unexpected files: ${staged.join(", ")}`);

// Reproducibility: normalize mtimes of staged files to a fixed epoch so the
// zip local headers do not embed the build time. Same source => same SHA-256.
// (2020-01-01T00:00:00Z; any fixed post-1980 date works for the zip format.)
const FIXED_MTIME = new Date("2020-01-01T00:00:00Z");
for (const f of WHITELIST) {
    fs.utimesSync(path.join(staging, f), FIXED_MTIME, FIXED_MTIME);
}

// --- 5. zip (flat, deterministic, name = <id>-<version>.zip) --------------
const zipName = `${manifest.id}-${manifest.version}.zip`;
const zipPath = path.join(releaseDir, zipName);
fs.rmSync(zipPath, { force: true });
// execFileSync arg array (no shell interpolation); -X strips extended attrs,
// fixed sorted file order keeps the central directory deterministic.
execFileSync(
    "zip",
    ["-X", "-j", zipPath, ...[...WHITELIST].sort().map((f) => path.join(staging, f))],
    { stdio: "inherit" }
);
fs.rmSync(staging, { recursive: true, force: true });

// --- 6. verify ------------------------------------------------------------
console.log(`\n=== verify: scripts/verify-release.mjs ${zipPath} ===`);
execFileSync("node", [path.join("scripts", "verify-release.mjs"), zipPath], {
    stdio: "inherit",
});

console.log(`\nPACKAGE OK: ${path.relative(root, zipPath)}`);
