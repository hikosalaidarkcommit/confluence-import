/**
 * @jest-environment jsdom
 */

// Mock Obsidian global helper BEFORE loading DiffEngine
(global as unknown as { createEl: Function }).createEl = function (tag: string, opts?: { text?: string, cls?: string }) {
    const el = document.createElement(tag);
    if (opts?.text) el.textContent = opts.text;
    if (opts?.cls) el.className = opts.cls;
    return el;
};
(global as unknown as { createFragment: Function }).createFragment = function () {
    return document.createDocumentFragment();
};

const { DiffEngine } = require('../../src/diff/diff-engine');

describe('Hybrid Table Converter Fidelity', () => {
    let engine: typeof DiffEngine.prototype;

    beforeEach(() => {
        engine = new DiffEngine();
    });

    /**
     * Helper to run conversion on storage format HTML and return the resulting markdown.
     */
    async function convert(storageHtml: string): Promise<string> {
        // DiffEngine.compare returns remoteContent which is the converted markdown
        const result = await engine.compare('', storageHtml, 'page-123');
        return result.remoteContent.trim();
    }

    // ---------------------------------------------------------------------------
    // Simple Path: Rectangular GFM
    // ---------------------------------------------------------------------------
    describe('Simple Path (GFM)', () => {
        test('converts basic rectangular table to GFM', async () => {
            const html = `
                <table>
                    <thead>
                        <tr><th>Header 1</th><th>Header 2</th></tr>
                    </thead>
                    <tbody>
                        <tr><td>Cell 1.1</td><td>Cell 1.2</td></tr>
                        <tr><td>Cell 2.1</td><td>Cell 2.2</td></tr>
                    </tbody>
                </table>
            `;
            const md = await convert(html);
            // GFM tables should have headers and rows
            expect(md).toContain('Header 1');
            expect(md).toContain('| --- |');
            expect(md).toContain('Cell 1.1');
        });

        test('escapes pipes in simple cells', async () => {
            const html = `<table><tr><td>Value | Separated</td></tr></table>`;
            const md = await convert(html);
            // GFM requires pipe escaping in cells: \|
            // (Note: Markdown normalization might adjust spacing)
            expect(md).toMatch(/Value\s+\\\|\s+Separated/);
        });

        test('preserves inline formatting in simple cells', async () => {
            const html = `<table><tr><td><strong>Bold</strong> and <em>Italic</em> and <a href="https://google.com">Link</a></td></tr></table>`;
            const md = await convert(html);
            expect(md).toContain('**Bold**');
            expect(md).toContain('*Italic*');
            expect(md).toContain('[Link](https://google.com)');
        });
    });

    // ---------------------------------------------------------------------------
    // Complex Path: Sanitized HTML Fallback
    // ---------------------------------------------------------------------------
    describe('Complex Path (Sanitized HTML Fallback)', () => {
        test('falls back to HTML for tables with colspans', async () => {
            const html = `
                <table>
                    <tr><th colspan="2">Wide Header</th></tr>
                    <tr><td>Cell 1</td><td>Cell 2</td></tr>
                </table>
            `;
            const md = await convert(html);
            expect(md).toContain('<table');
            expect(md).toContain('colspan="2">Wide Header</th>');
            // Should NOT be GFM
            expect(md).not.toContain('| --- |');
        });

        test('falls back to HTML for tables with rowspans', async () => {
            const html = `
                <table>
                    <tr><td rowspan="2">Tall Cell</td><td>Cell 1</td></tr>
                    <tr><td>Cell 2</td></tr>
                </table>
            `;
            const md = await convert(html);
            expect(md).toContain('rowspan="2">Tall Cell</td>');
        });

        test('falls back to HTML for nested tables', async () => {
            const html = `
                <table>
                    <tr>
                        <td>
                            Outer Cell
                            <table><tr><td>Inner Cell</td></tr></table>
                        </td>
                    </tr>
                </table>
            `;
            const md = await convert(html);
            expect(md).toContain('<table');
            expect(md.match(/<table/g)?.length).toBe(2); // One outer, one inner
            expect(md).toContain('Inner Cell');
        });

        test('falls back to HTML for block-rich cells (lists)', async () => {
            const html = `
                <table>
                    <tr>
                        <td>
                            <ul><li>Item 1</li><li>Item 2</li></ul>
                        </td>
                    </tr>
                </table>
            `;
            const md = await convert(html);
            expect(md).toContain('<table');
            expect(md).toContain('<ul><li>Item 1</li><li>Item 2</li></ul>');
        });

        test('strips forbidden tags and attributes from fallback HTML', async () => {
            const html = `
                <table>
                    <tr style="background: red" onclick="alert(1)">
                        <td>
                            <script>evil()</script>
                            <span class="foo" id="bar" data-secret="123">Safe Text</span>
                        </td>
                    </tr>
                </table>
            `;
            const md = await convert(html);
            expect(md).toContain('<table>');
            expect(md).toContain('<tr>'); // style and onclick removed
            expect(md).not.toContain('style=');
            expect(md).not.toContain('onclick=');
            expect(md).not.toContain('<script>');
            expect(md).toContain('<span>Safe Text</span>'); // class, id, data- removed
            expect(md).not.toContain('class=');
            expect(md).not.toContain('id=');
        });

        test('sanitizes URL schemes in links within complex tables', async () => {
            const html = `
                <table>
                    <tr>
                        <td>
                            <a href="https://safe.com">Safe</a>
                            <a href="javascript:alert(1)">Unsafe</a>
                        </td>
                    </tr>
                </table>
            `;
            const md = await convert(html);
            expect(md).toContain('<a href="https://safe.com">Safe</a>');
            expect(md).toContain('Unsafe');
            expect(md).not.toContain('javascript:');
        });

        test('converts ac: macros to text within complex tables', async () => {
            const html = `
                <table>
                    <tr>
                        <td>
                            <ac:structured-macro ac:name="status">
                                <ac:parameter ac:name="title">Done</ac:parameter>
                            </ac:structured-macro>
                        </td>
                    </tr>
                </table>
            `;
            const md = await convert(html);
            // Macro tag stripped, but content/parameter text is preserved
            expect(md).toContain('Done');
            expect(md).not.toContain('<ac:');
        });
    });

    // ---------------------------------------------------------------------------
    // Synthetic Fixture Preservation
    // ---------------------------------------------------------------------------
    describe('Synthetic Fixture Integration', () => {
        test('processes full de-identified complex fixture without data loss or corruption', async () => {
            const fs = require('fs');
            const path = require('path');
            const fixturePath = path.join(__dirname, '../fixtures/confluence-complex-table.html');
            const fixtureHtml = fs.readFileSync(fixturePath, 'utf8');

            const md = await convert(fixtureHtml);

            // Verify structural key markers from the fixture are preserved
            // (Underscores may be escaped in markdown)
            expect(md).toContain('CONFL');
            expect(md).toContain('<table');
            
            // The fixture has 21 tables; at least some should be complex enough for HTML fallback
            expect(md.includes('<table')).toBe(true);

            // Ensure no dangerous patterns leaked into output
            expect(md).not.toContain('javascript:');
            expect(md).not.toContain('<script');
            expect(md).not.toContain('onclick=');
        });
    });
});
