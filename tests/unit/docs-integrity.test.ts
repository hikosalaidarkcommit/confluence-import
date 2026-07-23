/**
 * Documentation integrity checks (SEO/GEO content rules):
 *  1. All relative Markdown links in current docs resolve to real files.
 *  2. No forbidden capability claims in current-facing docs.
 *  3. llms.txt is plain factual text (no hidden JSON-LD/HTML/crawler tricks)
 *     and its repo links use the canonical URL.
 *  4. manifest.json remains untouched by doc work (identity/version lock).
 */
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

/** Current-facing docs subject to strict claim rules. */
const CURRENT_DOCS = [
    'README.md',
    'SECURITY.md',
    'llms.txt',
    'docs/INDEX.md',
    'docs/FAQ.md',
    'docs/TROUBLESHOOTING.md',
    'docs/COMPARISON.md',
    'docs/GEO_EVALUATION.md',
    'docs/CONFLICT_RESOLUTION_GUIDE.md',
    'docs/CONTRIBUTING.md',
];

/**
 * Claims the plugin must never make about itself. Kept as simple substrings
 * (lowercased comparison). Negated usages are excluded by checking context.
 */
const FORBIDDEN_POSITIVE_CLAIMS = [
    'encrypts your token',
    'encrypted credential',
    'tokens are encrypted',
    'sso integration',
    'soc 2 certified',
    'gdpr certified',
    'hipaa compliant',
    'syncs automatically',
    'automatic background sync',
    'bulk space import support',
    'imports entire spaces',
    'zero dependencies',
    'works on mobile',
];

function extractRelativeLinks(markdown: string): string[] {
    const links: string[] = [];
    // [text](target) — skip http(s)/mailto/# anchors
    for (const m of markdown.matchAll(/\]\(([^)]+)\)/g)) {
        const target = m[1].split('#')[0].trim();
        if (!target) continue;
        if (/^(https?:|mailto:)/i.test(target)) continue;
        links.push(target);
    }
    return links;
}

describe('relative Markdown links resolve', () => {
    const docsWithLinks = CURRENT_DOCS.filter(d => d.endsWith('.md'));

    test.each(docsWithLinks)('%s', (doc) => {
        const dir = path.dirname(doc);
        const broken: string[] = [];
        for (const link of extractRelativeLinks(read(doc))) {
            const resolved = path.join(root, dir, link);
            if (!fs.existsSync(resolved)) broken.push(link);
        }
        expect(broken).toEqual([]);
    });
});

describe('no forbidden capability claims in current docs', () => {
    test.each(CURRENT_DOCS)('%s', (doc) => {
        const content = read(doc).toLowerCase();
        const hits: string[] = [];
        for (const claim of FORBIDDEN_POSITIVE_CLAIMS) {
            let idx = content.indexOf(claim);
            while (idx !== -1) {
                // Allow negated/contextualized mentions ("no", "not", "never",
                // "does not", "none of these") within the preceding 80 chars.
                const context = content.slice(Math.max(0, idx - 80), idx);
                if (!/\b(no|not|never|none|without|don'?t|does not|has no)\b/.test(context)) {
                    hits.push(claim);
                }
                idx = content.indexOf(claim, idx + 1);
            }
        }
        expect(hits).toEqual([]);
    });
});

describe('llms.txt discipline', () => {
    const llms = read('llms.txt');

    test('plain text only — no HTML comments, JSON-LD, or crawler directives', () => {
        expect(llms).not.toContain('<!--');
        expect(llms).not.toContain('<script');
        expect(llms).not.toContain('application/ld+json');
        expect(llms.toLowerCase()).not.toContain('user-agent:');
        expect(llms.toLowerCase()).not.toContain('disallow:');
    });

    test('links use the canonical repository URL', () => {
        const urls = llms.match(/https:\/\/[^\s)]+/g) ?? [];
        expect(urls.length).toBeGreaterThan(0);
        for (const url of urls) {
            expect(url.startsWith('https://github.com/hikosalaidarkcommit/confluence-import')).toBe(true);
        }
    });

    test('states one-way and never-writes facts', () => {
        const lower = llms.toLowerCase();
        expect(lower).toContain('one-way');
        expect(lower).toContain('never modifies confluence');
    });
});

describe('manifest untouched by docs work', () => {
    test('identity, version, and platform fields are locked', () => {
        const manifest = JSON.parse(read('manifest.json')) as Record<string, unknown>;
        expect(manifest.id).toBe('confluence-import');
        expect(manifest.name).toBe('Confluence Page Import');
        expect(manifest.version).toBe('1.0.16');
        expect(manifest.minAppVersion).toBe('1.13.0');
        expect(manifest.isDesktopOnly).toBe(true);
    });
});
