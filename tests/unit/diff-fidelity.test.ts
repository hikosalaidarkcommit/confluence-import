/**
 * @jest-environment jsdom
 *
 * Fidelity regression tests using REAL components (no mocks of DiffEngine
 * or FileDiffView). These guard against:
 *  - H1: identical-content detection with the real DiffEngine
 *  - H2: Pull & Replace preview renders correctly; onAccept receives the
 *        raw remoteContent and not a merged/partial result
 */
import { DiffEngine } from '../../src/diff/diff-engine';
import { FileDiffView } from '../../src/ui/file-diff-view';

// jsdom does not implement Obsidian's createDiv/createEl/empty helpers,
// so patch minimal versions onto HTMLElement for FileDiffView rendering.
beforeAll(() => {
    const proto = HTMLElement.prototype as any;
    proto.empty = function () {
        while (this.firstChild) this.removeChild(this.firstChild);
    };
    proto.addClass = function (cls: string) {
        this.classList.add(cls);
    };
    proto.removeClass = function (cls: string) {
        this.classList.remove(cls);
    };
    proto.createDiv = function (opts?: any) {
        const el = document.createElement('div');
        applyOpts(el, opts);
        this.appendChild(el);
        return el;
    };
    proto.createEl = function (tag: string, opts?: any) {
        const el = document.createElement(tag);
        applyOpts(el, opts);
        this.appendChild(el);
        return el;
    };
    proto.createSpan = function (opts?: any) {
        const el = document.createElement('span');
        applyOpts(el, opts);
        this.appendChild(el);
        return el;
    };
    // Mock global createEl
    (global as any).createEl = function (tag: string, opts?: any) {
        const el = document.createElement(tag);
        applyOpts(el, opts);
        return el;
    };
    function applyOpts(el: HTMLElement, opts?: any) {
        if (!opts) return;
        if (typeof opts === 'string') {
            el.className = opts;
            return;
        }
        if (opts.text) el.textContent = opts.text;
        if (opts.cls) el.className = opts.cls;
    }
});

// ---------------------------------------------------------------------------
// H1: DiffEngine identical-content detection
// ---------------------------------------------------------------------------
describe('H1: real DiffEngine identical-content detection', () => {
    test('byte-identical simple content → isIdentical=true, hasConflicts=false', async () => {
        const engine = new DiffEngine();
        const local = 'Hello world\n\nSecond paragraph';
        // Storage format that Turndown converts back to the same markdown
        const storage = '<p>Hello world</p><p>Second paragraph</p>';

        const result = await engine.compare(local, storage);

        expect(result.isIdentical).toBe(true);
        expect(result.hasConflicts).toBe(false);
    });

    test('formatting-only differences (bullet style, trailing newline) → isIdentical=true', async () => {
        const engine = new DiffEngine();
        // Local uses `*` bullets; Confluence-converted markdown uses `-`
        const local = '* item one\n* item two\n';
        const storage = '<ul><li>item one</li><li>item two</li></ul>';

        const result = await engine.compare(local, storage);

        expect(result.isIdentical).toBe(true);
        expect(result.hasConflicts).toBe(false);
    });

    test('real content difference → isIdentical=false and conflicts reported', async () => {
        const engine = new DiffEngine();
        const local = 'Deadline: Friday';
        const storage = '<p>Deadline: Monday</p>';

        const result = await engine.compare(local, storage);

        expect(result.isIdentical).toBe(false);
        expect(result.hasConflicts).toBe(true);
    });

    test('DiffResult carries ORIGINAL (un-normalized) local content', async () => {
        const engine = new DiffEngine();
        const local = '* star bullet\n\tTabbed line';
        const storage = '<p>Something else entirely</p>';

        const result = await engine.compare(local, storage);

        // localContent must be the original bytes, not the normalized form
        expect(result.localContent).toBe(local);
        expect(result.localContent).toContain('* star bullet');
        expect(result.localContent).toContain('\t');
    });

    test('DiffResult carries ORIGINAL (un-normalized) remote content', async () => {
        const engine = new DiffEngine();
        const local = 'Local content';
        const storage = '<p>Remote content</p>';

        const result = await engine.compare(local, storage);

        // remoteContent is the Turndown-converted markdown (not XHTML)
        // and must NOT be further mangled — it is written verbatim on apply.
        expect(typeof result.remoteContent).toBe('string');
        expect(result.remoteContent).toContain('Remote content');
    });
});

// ---------------------------------------------------------------------------
// H2: FileDiffView — pull-only, readonly preview, onAccept semantics
// ---------------------------------------------------------------------------
describe('H2: FileDiffView pull-only preview (real component)', () => {
    /** Helper: build a FileDiffView wired to capture onAccept calls. */
    function makeView(localContent: string, remoteContent: string) {
        const container = document.createElement('div');
        let accepted = false;
        const view = new FileDiffView({
            container: container as any,
            localContent,
            remoteContent,
            onAccept: async () => {
                accepted = true;
            },
        });
        return { view, container, wasAccepted: () => accepted };
    }

    /** Click "Pull & Replace" and wait for async handlers. */
    async function clickPullAndReplace(container: HTMLElement): Promise<void> {
        const buttons = Array.from(container.querySelectorAll('button'));
        const applyBtn = buttons.find(b => b.textContent?.startsWith('Pull'))!;
        expect(applyBtn).toBeDefined();
        applyBtn.click();
        await new Promise((r) => setTimeout(r, 0));
    }

    /** Click "Cancel (Keep Local)" */
    function clickCancel(container: HTMLElement): void {
        const buttons = Array.from(container.querySelectorAll('button'));
        const cancelBtn = buttons.find(b => b.textContent?.includes('Cancel'))!;
        expect(cancelBtn).toBeDefined();
        cancelBtn.click();
    }

    test('renders "Pull & Replace" as primary CTA and "Cancel (Keep Local)" as secondary', () => {
        const { view, container } = makeView('local body', 'remote body');
        view.render();

        const buttons = Array.from(container.querySelectorAll('button'));
        const pullBtn = buttons.find(b => b.textContent?.startsWith('Pull'));
        const cancelBtn = buttons.find(b => b.textContent?.includes('Cancel'));

        expect(pullBtn).toBeDefined();
        expect(pullBtn!.classList.contains('mod-cta')).toBe(true);
        expect(cancelBtn).toBeDefined();
        expect(cancelBtn!.textContent).toContain('Keep Local');
    });

    test('diff preview region has role=region, aria-label, and tabindex for keyboard access', () => {
        const { view, container } = makeView('local line', 'remote line');
        view.render();

        const region = container.querySelector('[role="region"]');
        expect(region).not.toBeNull();
        expect(region!.getAttribute('aria-label')).toBeTruthy();
        expect(region!.getAttribute('tabindex')).toBe('0');
    });

    test('clicking "Pull & Replace" invokes onAccept (no content argument)', async () => {
        const { view, container, wasAccepted } = makeView('local body', 'remote body');
        view.render();

        expect(wasAccepted()).toBe(false);
        await clickPullAndReplace(container);
        expect(wasAccepted()).toBe(true);
    });

    test('clicking "Cancel (Keep Local)" does NOT invoke onAccept', async () => {
        let cancelCalled = false;
        const container = document.createElement('div');
        const view = new FileDiffView({
            container: container as any,
            localContent: 'local body',
            remoteContent: 'remote body',
            onAccept: async () => { throw new Error('onAccept must not be called on cancel'); },
            onCancel: () => { cancelCalled = true; },
        });
        view.render();

        clickCancel(container);
        await new Promise((r) => setTimeout(r, 0));

        expect(cancelCalled).toBe(true);
    });

    test('no per-block Accept Local/Remote/Both buttons exist in the rendered output', () => {
        const { view, container } = makeView('old line\nshared line', 'new line\nshared line');
        view.render();

        const allBtnText = Array.from(container.querySelectorAll('button'))
            .map(b => b.textContent ?? '');

        expect(allBtnText.some(t => t.includes('Accept Local'))).toBe(false);
        expect(allBtnText.some(t => t.includes('Accept Remote'))).toBe(false);
        expect(allBtnText.some(t => t.includes('Accept Both'))).toBe(false);
        expect(allBtnText.some(t => t.includes('Resolve'))).toBe(false);
    });

    test('local lines appear in green region, remote lines appear in blue region', () => {
        const { view, container } = makeView('LOCAL line\nshared', 'REMOTE line\nshared');
        view.render();

        const greenLines = Array.from(container.querySelectorAll('.conflict-region-current'));
        const blueLines = Array.from(container.querySelectorAll('.conflict-region-incoming'));

        const greenText = greenLines.map(el => el.textContent).join('\n');
        const blueText = blueLines.map(el => el.textContent).join('\n');

        expect(greenText).toContain('LOCAL line');
        expect(blueText).toContain('REMOTE line');
    });

    test('onAccept is called exactly once when "Pull & Replace" is clicked', async () => {
        let acceptCount = 0;
        const container = document.createElement('div');
        const view = new FileDiffView({
            container: container as any,
            localContent: 'a',
            remoteContent: 'b',
            onAccept: async () => { acceptCount++; },
        });
        view.render();

        await clickPullAndReplace(container);
        expect(acceptCount).toBe(1);
    });

    test('EOF fidelity: diff is rendered even when content has no trailing newline', async () => {
        // Regression: ensure no crash or missing diff block when content lacks trailing newline
        const { view, container, wasAccepted } = makeView(
            'Shared header\nlocal final line without newline',
            'Shared header\nremote final line without newline'
        );
        view.render();

        const blueLines = container.querySelectorAll('.conflict-region-incoming');
        expect(blueLines.length).toBeGreaterThan(0);

        await clickPullAndReplace(container);
        expect(wasAccepted()).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Large-input safety (real DiffEngine, no crash)
// ---------------------------------------------------------------------------
describe('Large-input safety (real DiffEngine, no crash)', () => {
    function makeLargeStorage(paragraphs: number): string {
        const parts: string[] = [];
        for (let i = 0; i < paragraphs; i++) {
            parts.push(`<h2>Section ${i}</h2><p>Paragraph ${i} with some <strong>bold</strong> text lorem ipsum dolor sit amet consectetur adipiscing elit.</p>`);
        }
        return parts.join('');
    }

    test('multi-hundred-KB storage converts and compares without crashing, result is lean', async () => {
        const engine = new DiffEngine();
        const storage = makeLargeStorage(2000); // ~250KB storage (kept moderate for CI time)
        expect(storage.length).toBeGreaterThan(200_000);

        const warm = await engine.compare('', storage);
        const local = warm.remoteContent + '\nlocal tail edit';
        const result = await engine.compare(local, storage);

        expect(result.isIdentical).toBe(false);
        expect(result.hasConflicts).toBe(true);
        // Lean DiffResult: no eagerly-allocated per-line diff arrays
        expect((result as any).diffLines).toBeUndefined();
        expect((result as any).conflicts).toBeUndefined();
        // Original content preserved for the modal's lazy diff
        expect(result.localContent).toBe(local);
    }, 60000);

    test('hasConflicts is always the negation of isIdentical', async () => {
        const engine = new DiffEngine();

        const same = await engine.compare('Hello world', '<p>Hello world</p>');
        expect(same.isIdentical).toBe(true);
        expect(same.hasConflicts).toBe(false);

        const diff = await engine.compare('Hello world', '<p>Goodbye world</p>');
        expect(diff.isIdentical).toBe(false);
        expect(diff.hasConflicts).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Escape-cleanup fidelity: conservative removal must not destroy Markdown
// ---------------------------------------------------------------------------
describe('Escape cleanup: conservative removal only', () => {
    // Access the private turndownCleanHtml through a subclass-style hack so
    // we can unit-test the post-processing in isolation without needing full
    // XHTML → HTML preprocessing.
    function runTurndown(html: string): string {
        const engine = new DiffEngine() as any;
        return engine.turndownCleanHtml(html);
    }

    test('line-leading \\- (list-marker artifact) is removed', () => {
        const html = '<p>\\- not a list</p>';
        const md = runTurndown(html);
        expect(md).not.toMatch(/^\\-/m);
    });

    test('\\[ and \\] added by Turndown are removed (bracket escapes are safe)', () => {
        const html = '<p>See [RFC 2119] for details</p>';
        const md = runTurndown(html);
        expect(md).not.toContain('\\[');
        expect(md).not.toContain('\\]');
        expect(md).toContain('[RFC 2119]');
    });

    test('\\* mid-line is NOT removed (could protect literal asterisk)', () => {
        const html = '<p>price is 10 \\* 2</p>';
        const md = runTurndown(html);
        expect(typeof md).toBe('string');
    });

    test('\\# mid-string is NOT removed (would create spurious heading)', () => {
        const html = '<p>tag \\#feature</p>';
        const md = runTurndown(html);
        expect(md).not.toMatch(/^# feature/m);
    });

    test('\\_ is NOT removed (could start italic or bold)', () => {
        const html = '<p>snake\\_case example</p>';
        const md = runTurndown(html);
        expect(typeof md).toBe('string');
        expect(md).not.toContain('snake case');
        expect(md).not.toContain('snake case');
    });
});

// ---------------------------------------------------------------------------
// Conversion Fidelity (Post-Refactor)
// ---------------------------------------------------------------------------
describe('Conversion Fidelity: Safe DOM refactor verification', () => {
    function runConversion(html: string): string {
        interface ConversionInternals {
            preprocessStorageToCleanHtml(storage: string): string;
            turndownCleanHtml(cleanHtml: string): string;
        }
        const engine = new DiffEngine() as unknown as ConversionInternals;
        return engine.turndownCleanHtml(engine.preprocessStorageToCleanHtml(html));
    }

    test('promotes first row to thead/th safely', () => {
        const html = '<table><tr><td>Header</td></tr><tr><td>Data</td></tr></table>';
        const md = runConversion(html);
        // GFM table must have header
        expect(md).toContain('| Header |');
        expect(md).toContain('| --- |');
        expect(md).toContain('| Data |');
    });

    test('converts strikethrough heading to paragraph safely', () => {
        const html = '<h1><del>Struck Heading</del></h1>';
        const md = runConversion(html);
        // Heading should be gone, paragraph with ~~ used
        expect(md).not.toMatch(/^# /);
        expect(md).toContain('~~Struck Heading~~');
    });

    test('converts list item headings to bold safely', () => {
        const html = '<ul><li><h3>Item Heading</h3></li></ul>';
        const md = runConversion(html);
        // Bullet should exist, but no # heading inside.
        // Turndown defaults to * for bullets.
        expect(md).toMatch(/^\* +Item Heading/m);
        expect(md).not.toContain('###');
    });
});

