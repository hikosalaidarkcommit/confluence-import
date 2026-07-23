/**
 * Static regression tests asserting the v1.0.14 Community-review warning
 * pattern roots stay eliminated. One test per residual warning category.
 * No eslint-disable/suppression exists anywhere in src.
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseStoredSettings, DEFAULT_SETTINGS } from '../../src/models';

const root = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

function srcFiles(): string[] {
    const out: string[] = [];
    (function walk(dir: string) {
        for (const entry of fs.readdirSync(path.join(root, dir))) {
            const rel = path.join(dir, entry);
            if (fs.statSync(path.join(root, rel)).isDirectory()) walk(rel);
            else if (rel.endsWith('.ts')) out.push(rel);
        }
    })('src');
    return out;
}

describe('review warning pattern roots eliminated', () => {
    const files = srcFiles();

    test('1. no @ts-ignore / @ts-expect-error anywhere in src (turndown typed via .d.ts)', () => {
        for (const f of files) {
            expect({ f, hit: /@ts-(ignore|expect-error|nocheck)/.test(read(f)) }).toEqual({ f, hit: false });
        }
    });

    test('2. no eslint-disable suppression comments in src', () => {
        for (const f of files) {
            expect({ f, hit: /eslint-disable/.test(read(f)) }).toEqual({ f, hit: false });
        }
    });

    test('3. confluence-client has no cast on custom headers (typed option shape)', () => {
        const client = read('src/api/confluence-client.ts');
        expect(client).not.toContain('as Record<string, string>');
        expect(client).not.toContain('RequestInit');
    });

    test('4. no `as any` / `as unknown as` in src', () => {
        for (const f of files) {
            const content = read(f);
            expect({ f, hit: content.includes('as any') }).toEqual({ f, hit: false });
            expect({ f, hit: content.includes('as unknown as') }).toEqual({ f, hit: false });
        }
    });

    test('5. unnecessary assertions removed (sync-service frontmatter, logger String)', () => {
        expect(read('src/services/sync-service.ts')).not.toContain('frontmatter as Record');
        expect(read('src/utils/logger.ts')).not.toContain('as never');
    });

    test('6. UI uses createDiv/createSpan, not createEl("div"/"span") or document.createElement', () => {
        const ui = read('src/ui/file-diff-view.ts');
        expect(ui).not.toMatch(/createEl\(\s*['"](div|span)['"]/);
        for (const f of files) {
            expect({ f, hit: /document\.createElement\(/.test(read(f)) }).toEqual({ f, hit: false });
        }
    });

    test('7. settings tab has no deprecated display() override', () => {
        const settings = read('src/settings.ts');
        expect(settings).not.toMatch(/^\s*display\(\)/m);
        expect(settings).toContain('getSettingDefinitions()');
    });

    test('8. tsconfig lib/target is ES2020 so trimStart/trimEnd are typed', () => {
        const tsconfig = JSON.parse(read('tsconfig.json')) as {
            compilerOptions: { target: string; lib: string[] };
        };
        expect(tsconfig.compilerOptions.target).toBe('ES2020');
        expect(tsconfig.compilerOptions.lib).toContain('ES2020');
        expect(tsconfig.compilerOptions.lib).not.toContain('ES6');
    });
});

describe('parseStoredSettings (loadData runtime validation)', () => {
    test('null/undefined/non-object → defaults', () => {
        expect(parseStoredSettings(null)).toEqual(DEFAULT_SETTINGS);
        expect(parseStoredSettings(undefined)).toEqual(DEFAULT_SETTINGS);
        expect(parseStoredSettings('junk')).toEqual(DEFAULT_SETTINGS);
        expect(parseStoredSettings(42)).toEqual(DEFAULT_SETTINGS);
    });

    test('valid fields merge; wrong-typed fields fall back to defaults', () => {
        const out = parseStoredSettings({
            baseUrl: 'https://ok.example.com',
            apiToken: 12345,            // wrong type → default
            userEmail: 'a@b.co',
            enableDebugLogging: 'yes',  // wrong type → default
            enablePageIdCache: false,
        });
        expect(out.baseUrl).toBe('https://ok.example.com');
        expect(out.apiToken).toBe(DEFAULT_SETTINGS.apiToken);
        expect(out.userEmail).toBe('a@b.co');
        expect(out.enableDebugLogging).toBe(DEFAULT_SETTINGS.enableDebugLogging);
        expect(out.enablePageIdCache).toBe(false);
    });

    test('unknown keys are dropped (not carried into settings)', () => {
        const out = parseStoredSettings({ rogueField: 'x', baseUrl: 'https://h.example.com' });
        expect(Object.keys(out)).toEqual(Object.keys(DEFAULT_SETTINGS));
    });
});
