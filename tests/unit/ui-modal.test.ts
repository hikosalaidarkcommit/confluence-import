/**
 * @jest-environment jsdom
 */
import { ConflictResolutionModal } from '../../src/ui/conflict-modal';
import { DiffResult } from '../../src/models';

// Patch HTMLElement for Obsidian helpers
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
        if (opts?.cls) el.className = opts.cls;
        if (opts?.text) el.textContent = opts.text;
        this.appendChild(el);
        return el;
    };
    proto.createEl = function (tag: string, opts?: any) {
        const el = document.createElement(tag);
        if (opts?.text) el.textContent = opts.text;
        if (opts?.cls) el.className = opts.cls;
        this.appendChild(el);
        return el;
    };
    proto.createSpan = function (opts?: any) {
        const el = document.createElement('span');
        if (opts?.text) el.textContent = opts.text;
        if (opts?.cls) el.className = opts.cls;
        this.appendChild(el);
        return el;
    };
    // Mock global createEl
    (global as any).createEl = function (tag: string, opts?: any) {
        const el = document.createElement(tag);
        if (opts?.text) el.textContent = opts.text;
        if (opts?.cls) el.className = opts.cls;
        return el;
    };
    (global as any).createDiv = function () { return document.createElement('div'); };
    (global as any).createSpan = function () { return document.createElement('span'); };
});

describe('ConflictResolutionModal UI', () => {
    const mockApp = {} as any;
    const mockDiff: DiffResult = {
        hasConflicts: true,
        isIdentical: false,
        remoteVersion: 1,
        remoteContent: 'remote',
        localContent: 'local'
    };

    test('uses semantic CSS class for the preview container instead of inline styles', () => {
        const modal = new ConflictResolutionModal(mockApp, mockDiff, async () => {});
        
        // Mock contentEl
        const contentEl = document.createElement('div');
        (modal as any).contentEl = contentEl;

        // Trigger render
        (modal as any).render();

        const container = contentEl.querySelector('.file-diff__preview-container');
        expect(container).not.toBeNull();
        
        // Verify no inline styles that were previously there
        const style = (container as HTMLElement).style;
        expect(style.maxHeight).toBe('');
        expect(style.overflow).toBe('');
        expect(style.border).toBe('');
    });
});
