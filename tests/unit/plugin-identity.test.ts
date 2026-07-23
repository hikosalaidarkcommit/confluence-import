/**
 * Plugin identity contract tests (Confluence Page Import rebrand).
 *
 * Locks the public identity used for Obsidian Community Plugin submission:
 *  - manifest id/name/description rules (no "obsidian" in id, unique name)
 *  - command id is the semantic `import-from-confluence` (legacy
 *    `push-to-confluence` fully removed)
 *  - no stale "Confluence Sync" identity in active source
 */
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

describe('manifest identity', () => {
    const manifest = JSON.parse(read('manifest.json'));

    test('id is confluence-import and contains no forbidden words', () => {
        expect(manifest.id).toBe('confluence-import');
        expect(manifest.id).not.toMatch(/obsidian/i);
        expect(manifest.id).toMatch(/^[a-z0-9-]+$/);
    });

    test('name is Confluence Page Import', () => {
        expect(manifest.name).toBe('Confluence Page Import');
    });

    test('description is action-oriented, ≤250 chars, pull-only wording', () => {
        expect(manifest.description.length).toBeLessThanOrEqual(250);
        expect(manifest.description).toMatch(/^Import /);
        expect(manifest.description.endsWith('.')).toBe(true);
        expect(manifest.description.toLowerCase()).not.toContain('obsidian');
        expect(manifest.description.toLowerCase()).not.toContain('push');
    });

    test('version/minAppVersion/desktop contract intact', () => {
        expect(manifest.version).toBe('1.0.15');
        // 1.13.0 is required by the declarative settings API
        // (PluginSettingTab.getSettingDefinitions, @since 1.13.0).
        expect(manifest.minAppVersion).toBe('1.13.0');
        expect(manifest.isDesktopOnly).toBe(true);
    });

    test('versions.json preserves historical minApp mappings', () => {
        const versions = JSON.parse(read('versions.json'));
        // 1.0.13 shipped with the imperative settings tab only — its
        // historical requirement stays 1.4.4 and must never be rewritten.
        expect(versions['1.0.13']).toBe('1.4.4');
        expect(versions['1.0.14']).toBe('1.13.0');
        expect(versions['1.0.15']).toBe('1.13.0');
    });

    test('package.json name matches identity and versions.json covers current version', () => {
        const pkg = JSON.parse(read('package.json'));
        const versions = JSON.parse(read('versions.json'));
        expect(pkg.name).toBe('confluence-import');
        expect(pkg.version).toBe(manifest.version);
        expect(versions[manifest.version]).toBe(manifest.minAppVersion);
    });
});

describe('command identity', () => {
    const mainSrc = read('src/main.ts');

    test('command id is import-from-confluence', () => {
        expect(mainSrc).toContain("id: 'import-from-confluence'");
        expect(mainSrc).toContain("name: 'Import current note from Confluence'");
    });

    test('legacy push-to-confluence command id fully removed', () => {
        expect(mainSrc).not.toContain('push-to-confluence');
    });
});

describe('no stale identity in active source', () => {
    const srcFiles: string[] = [];
    (function walk(dir: string) {
        for (const entry of fs.readdirSync(path.join(root, dir))) {
            const rel = path.join(dir, entry);
            const stat = fs.statSync(path.join(root, rel));
            if (stat.isDirectory()) walk(rel);
            else if (rel.endsWith('.ts') || rel.endsWith('.css')) srcFiles.push(rel);
        }
    })('src');
    srcFiles.push('styles/styles.css');

    test.each(srcFiles)('%s has no "Confluence Sync" / old id strings', (file) => {
        const content = read(file);
        expect(content).not.toContain('Confluence Sync');
        expect(content).not.toContain('obsidian-confluence-sync');
        expect(content).not.toContain('push-to-confluence');
    });
});

describe('settings heading compliance', () => {
    test('declarative group headings are functional and neutral', () => {
        const content = read('src/settings.ts');

        // Declarative API: group headings are `heading: '...'` fields.
        const headingMatches = [...content.matchAll(/heading:\s*['"](.*?)['"]/g)];

        expect(headingMatches.length).toBeGreaterThan(0);

        for (const match of headingMatches) {
            const label = match[1];
            // No heading should include the plugin name
            expect(label).not.toContain('Confluence Page Import');
            // No heading should include the word "Settings" (case-insensitive)
            expect(label.toLowerCase()).not.toContain('settings');

            // Expected functional labels
            expect(['Connection', 'Diagnostics']).toContain(label);
        }
    });
});
