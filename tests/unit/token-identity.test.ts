/**
 * @jest-environment jsdom
 * 
 * Test if identity comparison works correctly for pages with images using
 * the explicit identity marker.
 */
import { DiffEngine, buildImageMarker } from '../../src/diff/diff-engine';

describe('Image Token Identity (Marker-based)', () => {
    const pageId = '123';
    const baseUrl = 'https://example.atlassian.net';
    
    function getIdentity(filename: string, version: number) {
        return `attachment:${pageId}:/dl/${filename}:${version}`;
    }

    test('local note with final links and marker are detected as identical (wiki link)', async () => {
        const engine = new DiffEngine();
        const attachmentLinks = new Map([['a.png', { download: '/dl/a.png', version: 5 }]]);
        const storage = '<p>Hello</p><ac:image><ri:attachment ri:filename="a.png"/></ac:image><p>World</p>';
        
        const identity = getIdentity('a.png', 5);
        const marker = buildImageMarker(identity);
        // Path independence: works even with a folder path in the link
        const local = `Hello\n\n![[attachments/a.png]] ${marker}\n\nWorld`;
        
        const result = await engine.compare(local, storage, pageId, attachmentLinks, baseUrl);
        expect(result.isIdentical).toBe(true);
    });

    test('local note with markdown link and marker are detected as identical', async () => {
        const engine = new DiffEngine();
        const attachmentLinks = new Map([['a.png', { download: '/dl/a.png', version: 5 }]]);
        const storage = '<ac:image><ri:attachment ri:filename="a.png"/></ac:image>';
        
        const identity = getIdentity('a.png', 5);
        const marker = buildImageMarker(identity);
        // Markdown link style
        const local = `![a.png](attachments/a.png) ${marker}`;
        
        const result = await engine.compare(local, storage, pageId, attachmentLinks, baseUrl);
        expect(result.isIdentical).toBe(true);
    });

    test('supports aliases and width in wiki links', async () => {
        const engine = new DiffEngine();
        const attachmentLinks = new Map([['a.png', { download: '/dl/a.png', version: 5 }]]);
        const storage = '<ac:image><ri:attachment ri:filename="a.png"/></ac:image>';
        
        const identity = getIdentity('a.png', 5);
        const marker = buildImageMarker(identity);
        // Wiki link with width
        const local = `![[a.png|300]] ${marker}`;
        
        const result = await engine.compare(local, storage, pageId, attachmentLinks, baseUrl);
        expect(result.isIdentical).toBe(true);
    });

    test('link without marker is NOT identical', async () => {
        const engine = new DiffEngine();
        const attachmentLinks = new Map([['a.png', { download: '/dl/a.png', version: 5 }]]);
        const storage = '<ac:image><ri:attachment ri:filename="a.png"/></ac:image>';
        
        // Link exists but marker is missing
        const local = `![[a.png]]`;
        
        const result = await engine.compare(local, storage, pageId, attachmentLinks, baseUrl);
        expect(result.isIdentical).toBe(false);
    });

    test('marker without link is NOT identical', async () => {
        const engine = new DiffEngine();
        const attachmentLinks = new Map([['a.png', { download: '/dl/a.png', version: 5 }]]);
        const storage = '<ac:image><ri:attachment ri:filename="a.png"/></ac:image>';
        
        const identity = getIdentity('a.png', 5);
        const marker = buildImageMarker(identity);
        const local = `Just the marker ${marker}`;
        
        const result = await engine.compare(local, storage, pageId, attachmentLinks, baseUrl);
        expect(result.isIdentical).toBe(false);
    });

    test('mismatched marker hash is NOT identical', async () => {
        const engine = new DiffEngine();
        const attachmentLinks = new Map([['a.png', { download: '/dl/a.png', version: 5 }]]);
        const storage = '<ac:image><ri:attachment ri:filename="a.png"/></ac:image>';
        
        const wrongIdentity = getIdentity('a.png', 4); // old version
        const marker = buildImageMarker(wrongIdentity);
        const local = `![[a.png]] ${marker}`;
        
        const result = await engine.compare(local, storage, pageId, attachmentLinks, baseUrl);
        expect(result.isIdentical).toBe(false);
    });

    test('external URL identical with marker', async () => {
        const engine = new DiffEngine();
        const url = 'https://other.site/img.png';
        const storage = `<ac:image><ri:url ri:value="${url}"/></ac:image>`;
        
        const identity = `url:${url}`;
        const marker = buildImageMarker(identity);
        const local = `![image](${url}) ${marker}`;
        
        const result = await engine.compare(local, storage, pageId, undefined, baseUrl);
        expect(result.isIdentical).toBe(true);
    });

    test('external URL different link title remains identical if marker matches', async () => {
        const engine = new DiffEngine();
        const url = 'https://other.site/img.png';
        const storage = `<ac:image><ri:url ri:value="${url}"/></ac:image>`;
        
        const identity = `url:${url}`;
        const marker = buildImageMarker(identity);
        // User changed link title from "image" to "my pic"
        const local = `![my pic](${url}) ${marker}`;
        
        const result = await engine.compare(local, storage, pageId, undefined, baseUrl);
        expect(result.isIdentical).toBe(true);
    });

    test('unrelated image remains different', async () => {
        const engine = new DiffEngine();
        const local = '![[manual.png]]\n\nSome text';
        const storage = '<p>Some text</p>';
        const result = await engine.compare(local, storage, pageId);
        expect(result.isIdentical).toBe(false);
    });

    test('unrelated comment remains different', async () => {
        const engine = new DiffEngine();
        const local = '<!-- some other comment -->\n\nSome text';
        const storage = '<p>Some text</p>';
        const result = await engine.compare(local, storage, pageId);
        expect(result.isIdentical).toBe(false);
    });

    test('marker abuse: user typing a literal placeholder token stays a difference', async () => {
        const engine = new DiffEngine();
        const attachmentLinks = new Map([['a.png', { download: '/dl/a.png', version: 5 }]]);
        const storage = '<ac:image><ri:attachment ri:filename="a.png"/></ac:image>';

        // A user pasting the raw %%CFIMG-…%% token text (matching the remote
        // placeholder) without link+marker must NOT count as identical.
        const identity = getIdentity('a.png', 5);
        const engineForToken = await engine.compare('', storage, pageId, attachmentLinks, baseUrl);
        const token = engineForToken.imageRefs[0].token;
        const local = `${token}`;

        const result = await engine.compare(local, storage, pageId, attachmentLinks, baseUrl);
        // Local literal token vs remote token: raw text equality would call
        // them identical, but link+marker pairing is required.
        expect(result.isIdentical).toBe(false);
        void identity;
    });

    test('marker separated from link by a blank line is NOT adjacent → difference', async () => {
        const engine = new DiffEngine();
        const attachmentLinks = new Map([['a.png', { download: '/dl/a.png', version: 5 }]]);
        const storage = '<ac:image><ri:attachment ri:filename="a.png"/></ac:image>';

        const marker = buildImageMarker(getIdentity('a.png', 5));
        const local = `![[a.png]]\n\n${marker}`;

        const result = await engine.compare(local, storage, pageId, attachmentLinks, baseUrl);
        expect(result.isIdentical).toBe(false);
    });

    test('edited link text with matching marker still identical; edited marker not', async () => {
        const engine = new DiffEngine();
        const attachmentLinks = new Map([['a.png', { download: '/dl/a.png', version: 5 }]]);
        const storage = '<ac:image><ri:attachment ri:filename="a.png"/></ac:image>';
        const marker = buildImageMarker(getIdentity('a.png', 5));

        // Renamed/moved file in the link — marker is the identity anchor.
        const moved = await engine.compare(`![[assets/renamed.png]] ${marker}`, storage, pageId, attachmentLinks, baseUrl);
        expect(moved.isIdentical).toBe(true);

        // Corrupted marker hash → difference.
        const corrupted = marker.replace(/[0-9a-f]{16}/, '0'.repeat(16));
        const bad = await engine.compare(`![[a.png]] ${corrupted}`, storage, pageId, attachmentLinks, baseUrl);
        expect(bad.isIdentical).toBe(false);
    });

    test('repeated unchanged pulls stay identical (idempotent)', async () => {
        const engine = new DiffEngine();
        const attachmentLinks = new Map([['a.png', { download: '/dl/a.png', version: 5 }]]);
        const storage = '<p>Text</p><ac:image><ri:attachment ri:filename="a.png"/></ac:image>';
        const marker = buildImageMarker(getIdentity('a.png', 5));
        const local = `Text\n\n![[attachments/a.png]] ${marker}`;

        const r1 = await engine.compare(local, storage, pageId, attachmentLinks, baseUrl);
        const r2 = await engine.compare(local, storage, pageId, attachmentLinks, baseUrl);
        expect(r1.isIdentical).toBe(true);
        expect(r2.isIdentical).toBe(true);
    });
});
