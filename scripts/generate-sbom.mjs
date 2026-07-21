#!/usr/bin/env node
/**
 * Generate a CycloneDX SBOM for the distributed (production) dependency set.
 *
 * Output: release/sbom.cdx.json (gitignored — release/ is not tracked).
 * Tracking strategy: the SBOM is a generated artifact regenerated on every
 * `npm run sbom` / CI run from package-lock.json; it is NOT committed, the
 * lockfile is the source of truth.
 *
 * Safety: fails if the SBOM would contain local absolute paths (e.g. $HOME)
 * so no machine-specific information can leak into a published artifact.
 */
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

fs.mkdirSync("release", { recursive: true });

const sbomRaw = execFileSync(
    "npm",
    ["sbom", "--sbom-format", "cyclonedx", "--omit", "dev"],
    { maxBuffer: 16 * 1024 * 1024 }
).toString("utf8");

const home = os.homedir();
if (home && sbomRaw.includes(home)) {
    console.error("SBOM FAILED: output contains local home directory path");
    process.exit(1);
}

const sbom = JSON.parse(sbomRaw);
const outPath = path.join("release", "sbom.cdx.json");
fs.writeFileSync(outPath, JSON.stringify(sbom, null, 2) + "\n");
console.log(
    `SBOM OK: ${sbom.bomFormat} ${sbom.specVersion}, ${sbom.components?.length ?? 0} components -> ${outPath}`
);
