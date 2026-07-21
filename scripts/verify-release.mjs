#!/usr/bin/env node
/**
 * Release artifact verifier. Usage: node scripts/verify-release.mjs <zip-path>
 *
 * Checks (all must pass, exit 1 on first failure):
 *  1. Zip contains EXACTLY main.js, manifest.json, styles.css at the root
 *     (flat paths - required for manual install into
 *      <vault>/.obsidian/plugins/<plugin-id>/).
 *  2. Zip name matches <manifest.id>-<manifest.version>.zip.
 *  3. Bundled manifest is byte-identical to root manifest.json;
 *     main.js / styles.css SHA-256 match the root copies.
 *  4. Manifest field contract: id/version/minAppVersion present,
 *     isDesktopOnly === true, versions.json + package.json agree,
 *     description contains no push/upload wording.
 *  5. Bundled main.js contains no remote-mutation symbols
 *     (updatePage, uploadAttachment, PUT/POST/DELETE methods)
 *     and no stale "Sync Obsidian notes to Confluence" description.
 */
import { execFileSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const zipPath = process.argv[2];
if (!zipPath || !fs.existsSync(zipPath)) {
    console.error("usage: node scripts/verify-release.mjs <zip-path>");
    process.exit(2);
}

let failures = 0;
function check(ok, label, detail = "") {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
}
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const unzipEntry = (entry) =>
    execFileSync("unzip", ["-p", zipPath, entry], { maxBuffer: 64 * 1024 * 1024 });

const WHITELIST = ["main.js", "manifest.json", "styles.css"];

// 1. entry whitelist + flat structure
const entries = execFileSync("zipinfo", ["-1", zipPath])
    .toString().trim().split("\n").filter(Boolean).sort();
check(
    entries.join(",") === [...WHITELIST].sort().join(","),
    "zip contains exactly main.js/manifest.json/styles.css at root",
    entries.join(", ")
);
check(entries.every((e) => !e.includes("/")), "flat path structure (manual-install ready)");

// 2. zip name matches id + version
const rootManifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const expectedName = `${rootManifest.id}-${rootManifest.version}.zip`;
check(path.basename(zipPath) === expectedName, "zip name matches <id>-<version>.zip", path.basename(zipPath));

// 3. byte equality with root files
const zipManifestBuf = unzipEntry("manifest.json");
const rootManifestBuf = fs.readFileSync("manifest.json");
check(zipManifestBuf.equals(rootManifestBuf), "manifest.json byte-identical to root");

for (const f of ["main.js", "styles.css"]) {
    const zHash = sha256(unzipEntry(f));
    const rHash = sha256(fs.readFileSync(f));
    check(zHash === rHash, `${f} sha256 matches root`, zHash.slice(0, 16));
}

// 4. manifest field contract
const m = JSON.parse(zipManifestBuf.toString("utf8"));
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));
check(typeof m.id === "string" && m.id.length > 0, "manifest.id present", m.id);
check(/^\d+\.\d+\.\d+$/.test(m.version || ""), "manifest.version is semver", m.version);
check(/^\d+\.\d+\.\d+$/.test(m.minAppVersion || ""), "manifest.minAppVersion is semver", m.minAppVersion);
check(m.isDesktopOnly === true, "manifest.isDesktopOnly === true");
check(m.version === pkg.version, "manifest.version === package.json version");
check(versions[m.version] === m.minAppVersion, `versions.json["${m.version}"] === minAppVersion`);
const staleDescRe = /(sync|push|upload|post)\s+obsidian\s+notes?\s+to\s+confluence/i;
check(!staleDescRe.test(m.description || ""), "description has no push-to-Confluence wording");
check(/pull|one-way/i.test(m.description || ""), "description declares pull/one-way sync");

// 5. bundle content guards
const bundle = unzipEntry("main.js").toString("utf8");
for (const sym of ["updatePage", "uploadAttachment"]) {
    check(!bundle.includes(sym), `main.js has no remote-mutation symbol '${sym}'`);
}
const mutatingMethod = bundle.match(/method:\s*["'](PUT|POST|DELETE|PATCH)["']/i);
check(!mutatingMethod, "main.js requests use no mutating HTTP methods", mutatingMethod?.[1] ?? "GET only");
check(!staleDescRe.test(bundle), "main.js has no stale push description");

const st = fs.statSync(zipPath);
console.log(`\nartifact: ${path.relative(root, zipPath)} (${st.size} bytes)`);
console.log(failures === 0 ? "VERIFY OK" : `VERIFY FAILED: ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
