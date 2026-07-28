/**
 * @jest-environment jsdom
 * 
 * Test if identity comparison works correctly for pages with images.
 * If remote has tokens and local has final links, they should be treated as identical
 * if the text and image order match.
 */
import { DiffEngine } from '../../src/diff/diff-engine';

describe('Image Token Identity', () => {
    test('local note with final links and remote with tokens are detected as identical', async () => {
        const engine = new DiffEngine();
        const pageId = '123';
        
        // Attachment metadata with version
        const attachmentLinks = new Map([
            ['a.png', { download: '/dl/a.png', version: 5 }]
        ]);
        
        // Remote storage with one image
        const storage = '<p>Hello</p><ac:image><ri:attachment ri:filename="a.png"/></ac:image><p>World</p>';
        
        // Local note from a PREVIOUS sync (tokens replaced with deterministic local links)
        // Identity includes pageId:123, download:/dl/a.png, version:5
        // Hash for "attachment:123:/dl/a.png:5" is deterministic.
        const identity = 'attachment:123:/dl/a.png:5';
        const expectedName = (engine as any).buildExpectedFilename(pageId, identity, 'a.png');
        const local = `Hello\n\n![[${expectedName}]]\n\nWorld`;
        
        const result = await engine.compare(local, storage, pageId, attachmentLinks);
        
        // This must be TRUE to avoid false diffs on every pull
        expect(result.isIdentical).toBe(true);
    });

    test('same filename but different version is detected as different', async () => {
        const engine = new DiffEngine();
        const pageId = '123';
        
        // Current remote version is 6
        const attachmentLinks = new Map([
            ['a.png', { download: '/dl/a.png', version: 6 }]
        ]);
        const storage = '<ac:image><ri:attachment ri:filename="a.png"/></ac:image>';
        
        // Local note has version 5
        const oldIdentity = 'attachment:123:/dl/a.png:5';
        const oldName = (engine as any).buildExpectedFilename(pageId, oldIdentity, 'a.png');
        const local = `![[${oldName}]]`;
        
        const result = await engine.compare(local, storage, pageId, attachmentLinks);
        
        // Must be FALSE: different version means different content, must pull.
        expect(result.isIdentical).toBe(false);
    });

    test('external URL unchanged is detected as identical', async () => {
        const engine = new DiffEngine();
        const url = 'https://other.site/img.png';
        const storage = `<ac:image><ri:url ri:value="${url}"/></ac:image>`;
        const local = `![image](${url})`;
        
        const result = await engine.compare(local, storage, '123');
        expect(result.isIdentical).toBe(true);
    });

    test('different image order is detected as different', async () => {
        const engine = new DiffEngine();
        const pageId = '123';
        const attachmentLinks = new Map([
            ['1.png', { download: '/dl/1.png', version: 1 }],
            ['2.png', { download: '/dl/2.png', version: 1 }]
        ]);
        const storage = '<p>A</p><ac:image><ri:attachment ri:filename="1.png"/></ac:image><p>B</p><ac:image><ri:attachment ri:filename="2.png"/></ac:image>';
        
        const name1 = (engine as any).buildExpectedFilename(pageId, 'attachment:123:/dl/1.png:1', '1.png');
        const name2 = (engine as any).buildExpectedFilename(pageId, 'attachment:123:/dl/2.png:1', '2.png');
        const local = `A\n\n![[${name2}]]\n\nB\n\n![[${name1}]]`;
        
        const result = await engine.compare(local, storage, pageId, attachmentLinks);
        expect(result.isIdentical).toBe(false);
    });

    test('missing version falls back to canonical URL identity', async () => {
        const engine = new DiffEngine();
        const pageId = '123';
        
        // Metadata missing version (legacy or DC)
        const attachmentLinks = new Map([
            ['a.png', { download: '/dl/a.png' } as any]
        ]);
        
        const storage = '<ac:image><ri:attachment ri:filename="a.png"/></ac:image>';
        
        // Identity uses pageId + download as fallback if version is missing
        const fallbackIdentity = 'attachment:123:/dl/a.png';
        const expectedName = (engine as any).buildExpectedFilename(pageId, fallbackIdentity, 'a.png');
        const local = `![[${expectedName}]]`;
        
        const result = await engine.compare(local, storage, pageId, attachmentLinks);
        expect(result.isIdentical).toBe(true);
    });

    test('placeholder-like user text is unaffected', async () => {
        const engine = new DiffEngine();
        const local = 'This text contains %%CFIMG-abc-0%% but it is just text.';
        const storage = '<p>This text contains %%CFIMG-abc-0%% but it is just text.</p>';
        const result = await engine.compare(local, storage, '123');
        expect(result.isIdentical).toBe(true);
    });
});
