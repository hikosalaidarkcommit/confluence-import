/**
 * @jest-environment jsdom
 *
 * Image extraction during storage→Markdown conversion (real DiffEngine):
 * three source forms, token placement, sanitization, and no-network preview.
 */
import { DiffEngine } from '../../src/diff/diff-engine';

beforeAll(() => {
    (global as Record<string, unknown>).createEl =
        (tag: string) => document.createElement(tag);
    (global as Record<string, unknown>).createDiv =
        () => document.createElement('div');
    (global as Record<string, unknown>).createSpan =
        () => document.createElement('span');
    (global as Record<string, unknown>).DocumentFragment = DocumentFragment;
    (global as Record<string, unknown>).XMLSerializer = XMLSerializer;
});

describe('DiffEngine image extraction', () => {
    test('ri:attachment form produces attachment ref with token in markdown', async () => {
        const engine = new DiffEngine();
        const storage =
            '<p>before</p>' +
            '<ac:image ac:alt="my diagram" ac:width="480">' +
            '<ri:attachment ri:filename="diagram v2.png"/></ac:image>' +
            '<p>after</p>';
        const result = await engine.compare('x', storage, "123");

        expect(result.imageRefs).toHaveLength(1);
        const ref = result.imageRefs[0];
        expect(ref.kind).toBe('attachment');
        expect(ref.filename).toBe('diagram v2.png');
        expect(ref.alt).toBe('my diagram');
        expect(ref.width).toBe(480);
        expect(ref.token).toMatch(/^%%CFIMG-[0-9a-f]{12}-0%%$/);
        expect(result.remoteContent).toContain(ref.token);
        expect(result.remoteContent).toContain('before');
        expect(result.remoteContent).toContain('after');
    });

    test('ri:url form produces url ref', async () => {
        const engine = new DiffEngine();
        const storage =
            '<ac:image><ri:url ri:value="https://cdn.example.org/pic.jpg"/></ac:image>';
        const result = await engine.compare('x', storage, "123");

        expect(result.imageRefs).toHaveLength(1);
        expect(result.imageRefs[0].kind).toBe('url');
        expect(result.imageRefs[0].url).toBe('https://cdn.example.org/pic.jpg');
        expect(result.remoteContent).toContain(result.imageRefs[0].token);
    });

    test('standard img src form produces url ref with alt/width', async () => {
        const engine = new DiffEngine();
        const storage = '<p><img src="/download/attachments/1/x.png" alt="inline pic" width="200"></p>';
        const result = await engine.compare('x', storage, "123");

        expect(result.imageRefs).toHaveLength(1);
        expect(result.imageRefs[0].kind).toBe('url');
        expect(result.imageRefs[0].url).toBe('/download/attachments/1/x.png');
        expect(result.imageRefs[0].alt).toBe('inline pic');
        expect(result.imageRefs[0].width).toBe(200);
    });

    test('dangerous img src scheme is dropped (no ref, alt kept as text)', async () => {
        const engine = new DiffEngine();
        const storage = '<p><img src="javascript:alert(1)" alt="evil pic"></p>';
        const result = await engine.compare('x', storage, "123");

        expect(result.imageRefs).toHaveLength(0);
        expect(result.remoteContent).toContain('evil pic');
        expect(result.remoteContent).not.toContain('javascript:');
    });

    test('alt text with Markdown injection characters is sanitized', async () => {
        const engine = new DiffEngine();
        const storage = '<ac:image ac:alt="a](x) ![b"><ri:attachment ri:filename="f.png"/></ac:image>';
        const result = await engine.compare('x', storage, "123");

        expect(result.imageRefs[0].alt).toContain('\\]');
        expect(result.imageRefs[0].alt).toContain('\\[');
        expect(result.imageRefs[0].alt).toContain('\\!');
    });

    test('multiple images get unique tokens', async () => {
        const engine = new DiffEngine();
        const storage =
            '<ac:image><ri:attachment ri:filename="a.png"/></ac:image>' +
            '<ac:image><ri:attachment ri:filename="a.png"/></ac:image>' +
            '<img src="https://e.example.com/c.png">';
        const result = await engine.compare('x', storage, "123");

        expect(result.imageRefs).toHaveLength(3);
        const tokens = new Set(result.imageRefs.map(r => r.token));
        expect(tokens.size).toBe(3);
    });

    test('page without images yields empty imageRefs (identical semantics intact)', async () => {
        const engine = new DiffEngine();
        const result = await engine.compare('Hello world', '<p>Hello world</p>', "123");
        expect(result.imageRefs).toEqual([]);
        expect(result.isIdentical).toBe(true);
    });

    test('attachment without filename is dropped without a ref', async () => {
        const engine = new DiffEngine();
        const storage = '<ac:image ac:alt="broken"><ri:attachment/></ac:image>';
        const result = await engine.compare('x', storage, "123");
        expect(result.imageRefs).toHaveLength(0);
        expect(result.remoteContent).toContain('broken');
    });
});
