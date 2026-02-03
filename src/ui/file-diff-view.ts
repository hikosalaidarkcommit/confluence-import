import { structuredPatch, diffWords } from 'diff';
import { normalizeMarkdown } from '../utils/markdown-normalizer';

export interface DifferenceBlock {
    localStart: number;
    remoteStart: number;
    localLines: string[];
    remoteLines: string[];
}

export interface FileDiff {
    differences: DifferenceBlock[];
    localLines: string[];
    remoteLines: string[];
}

/**
 * Computes structured differences between local and remote content.
 * Uses markdown normalization to ignore syntax differences (like * vs - for lists).
 */
export function computeFileDiff(localContent: string, remoteContent: string): FileDiff {
    // Helper to clean up lines
    const cleanLines = (content: string): string[] => {
        let lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        // Trim each line's trailing whitespace
        lines = lines.map(l => l.trimEnd());
        // Remove trailing empty lines
        while (lines.length > 0 && lines[lines.length - 1] === '') {
            lines.pop();
        }
        return lines;
    };

    // Keep original lines for display (but cleaned up)
    const localLines = cleanLines(localContent);
    const remoteLines = cleanLines(remoteContent);

    // Normalize for comparison - this makes `* item` equivalent to `- item`
    const normalizedLocal = normalizeMarkdown(localContent);
    const normalizedRemote = normalizeMarkdown(remoteContent);

    // Compare normalized versions
    const patch = structuredPatch(
        'local',
        'remote',
        normalizedLocal,
        normalizedRemote
    );

    const differences: DifferenceBlock[] = [];

    // Track mapping between normalized line numbers and original line numbers
    const normalizedLocalLines = normalizedLocal.split('\n');
    const normalizedRemoteLines = normalizedRemote.split('\n');

    patch.hunks.forEach(hunk => {
        let localCount = 0;
        let remoteCount = 0;

        for (let i = 0; i < hunk.lines.length; i++) {
            const line = hunk.lines[i];

            if (line.startsWith('+') || line.startsWith('-')) {
                const start = i;

                // Find end of contiguous changed lines
                let end = start;
                while (
                    end < hunk.lines.length - 1 &&
                    (hunk.lines[end + 1].startsWith('+') || hunk.lines[end + 1].startsWith('-'))
                ) {
                    end++;
                }

                // Calculate positions in original content
                const localStartIdx = hunk.oldStart + start - remoteCount - 1;
                const remoteStartIdx = hunk.newStart + start - localCount - 1;

                // Count lines being changed
                const localChangeCount = hunk.lines
                    .slice(start, end + 1)
                    .filter(l => l.startsWith('-'))
                    .length;
                const remoteChangeCount = hunk.lines
                    .slice(start, end + 1)
                    .filter(l => l.startsWith('+'))
                    .length;

                // Get ORIGINAL (non-normalized) lines for display
                const localDiffLines = localLines.slice(localStartIdx, localStartIdx + localChangeCount);
                const remoteDiffLines = remoteLines.slice(remoteStartIdx, remoteStartIdx + remoteChangeCount);

                differences.push({
                    localStart: localStartIdx,
                    remoteStart: remoteStartIdx,
                    localLines: localDiffLines,
                    remoteLines: remoteDiffLines,
                });

                localCount += localChangeCount;
                remoteCount += remoteChangeCount;
                i += end - start;
            }
        }
    });

    return { differences, localLines, remoteLines };
}

/**
 * Builds an inline word-diff span for a line.
 */
function buildDiffLine(line1: string | undefined, line2: string | undefined, charClass: string): HTMLElement {
    const fragment = document.createElement('div');

    if (line1 === undefined || line1.length === 0) {
        fragment.textContent = line1 || '\u00A0'; // non-breaking space for empty lines
    } else if (line1 !== undefined && line2 !== undefined) {
        const diffs = diffWords(line2, line1);
        for (const part of diffs) {
            if (part.removed) continue;
            const span = document.createElement('span');
            span.textContent = part.value || '\u00A0';
            if (part.added) {
                span.classList.add(charClass);
            }
            fragment.appendChild(span);
        }
    } else if (line1 !== undefined) {
        const span = document.createElement('span');
        span.textContent = line1 || '\u00A0';
        span.classList.add(charClass);
        fragment.appendChild(span);
    }

    return fragment;
}

export interface FileDiffViewOptions {
    container: HTMLElement;
    localContent: string;
    remoteContent: string;
    onResolve: (resolvedContent: string) => Promise<void>;
    onCancel?: () => void;
}

/**
 * Renders a file diff view with action buttons for each difference block.
 */
export class FileDiffView {
    private fileDiff: FileDiff;
    private localLines: string[];
    private remoteLines: string[];
    private container: HTMLElement;
    private onResolve: (resolvedContent: string) => Promise<void>;
    private onCancel?: () => void;

    // Track resolved state: maps difference index to chosen resolution
    private resolutions: Map<number, 'local' | 'remote' | 'both'> = new Map();

    constructor(options: FileDiffViewOptions) {
        this.container = options.container;
        this.localLines = options.localContent.split('\n');
        this.remoteLines = options.remoteContent.split('\n');
        this.fileDiff = computeFileDiff(options.localContent, options.remoteContent);
        this.onResolve = options.onResolve;
        this.onCancel = options.onCancel;
    }

    render(): void {
        this.container.empty();
        this.container.addClass('file-diff__container');

        // Header
        const header = this.container.createDiv({ cls: 'file-diff__header' });
        header.createEl('h3', { text: `${this.fileDiff.differences.length} difference(s) found` });

        // Content area
        const content = this.container.createDiv({ cls: 'file-diff__content' });
        this.buildLines(content);

        // Footer with action buttons
        const footer = this.container.createDiv({ cls: 'file-diff__footer modal-button-container' });

        const cancelBtn = footer.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => {
            if (this.onCancel) {
                this.onCancel();
            }
        };

        const mergeBtn = footer.createEl('button', { text: 'Merge & Push', cls: 'mod-cta' });
        mergeBtn.onclick = async () => {
            try {
                mergeBtn.disabled = true;
                mergeBtn.textContent = 'Uploading...';
                const resolved = this.buildResolvedContent();
                await this.onResolve(resolved);
            } catch (error) {
                console.error('Error during merge/push:', error);
                mergeBtn.disabled = false;
                mergeBtn.textContent = 'Merge & Push';
                // The error should already be handled by the sync-service's handleError
            }
        };
    }

    private buildLines(container: HTMLElement): void {
        let localIdx = 0;
        let remoteIdx = 0;
        const maxIterations = this.localLines.length + this.remoteLines.length + 100; // Safety guard
        let iterations = 0;

        // Sort differences by position to process them in order
        const sortedDiffs = [...this.fileDiff.differences].sort((a, b) =>
            a.localStart - b.localStart || a.remoteStart - b.remoteStart
        );
        let nextDiffIdx = 0;

        while (localIdx < this.localLines.length || remoteIdx < this.remoteLines.length) {
            // Safety guard against infinite loops
            if (++iterations > maxIterations) {
                console.error('buildLines: Max iterations reached, breaking loop');
                break;
            }

            // Check if we're at a difference position
            const currentDiff = sortedDiffs[nextDiffIdx];
            const atDiff = currentDiff &&
                currentDiff.localStart === localIdx &&
                currentDiff.remoteStart === remoteIdx;

            if (atDiff && currentDiff) {
                this.buildDifferenceBlock(container, currentDiff, nextDiffIdx);

                // Advance by the number of lines in the diff (at least 1 to prevent stuck)
                const localAdvance = Math.max(currentDiff.localLines.length, 0);
                const remoteAdvance = Math.max(currentDiff.remoteLines.length, 0);

                // If both are 0, we still need to advance to avoid infinite loop
                if (localAdvance === 0 && remoteAdvance === 0) {
                    localIdx++;
                    remoteIdx++;
                } else {
                    localIdx += localAdvance;
                    remoteIdx += remoteAdvance;
                }

                nextDiffIdx++;
            } else {
                // Unchanged line - take from local if available
                if (localIdx < this.localLines.length) {
                    container.createDiv({
                        text: this.localLines[localIdx] || '\u00A0',
                        cls: 'file-diff__line',
                    });
                }
                localIdx++;
                remoteIdx++;
            }
        }
    }

    private buildDifferenceBlock(container: HTMLElement, diff: DifferenceBlock, diffIndex: number): void {
        const block = container.createDiv({ cls: 'file-diff__difference' });

        // Action buttons
        const actions = block.createDiv({ cls: 'file-diff__actions conflict-actions-inline' });

        const label = actions.createSpan({ text: 'Resolve: ', cls: 'conflict-indicator' });

        const btnLocal = actions.createEl('button', { text: 'Accept Local', cls: 'conflict-action-btn' });
        btnLocal.style.color = 'var(--color-green)';
        btnLocal.onclick = () => {
            this.resolutions.set(diffIndex, 'local');
            this.highlightResolution(block, 'local');
        };

        actions.createSpan({ text: ' | ' });

        const btnRemote = actions.createEl('button', { text: 'Accept Remote', cls: 'conflict-action-btn' });
        btnRemote.style.color = 'var(--color-blue)';
        btnRemote.onclick = () => {
            this.resolutions.set(diffIndex, 'remote');
            this.highlightResolution(block, 'remote');
        };

        actions.createSpan({ text: ' | ' });

        const btnBoth = actions.createEl('button', { text: 'Accept Both', cls: 'conflict-action-btn' });
        btnBoth.onclick = () => {
            this.resolutions.set(diffIndex, 'both');
            this.highlightResolution(block, 'both');
        };

        // Local (top) lines - green background
        for (let i = 0; i < diff.localLines.length; i++) {
            const lineDiv = block.createDiv({ cls: 'file-diff__line conflict-region-current' });
            const diffSpan = buildDiffLine(diff.localLines[i], diff.remoteLines[i], 'file-diff__char-highlight-local');
            lineDiv.appendChild(diffSpan);
        }

        // Remote (bottom) lines - blue background
        for (let i = 0; i < diff.remoteLines.length; i++) {
            const lineDiv = block.createDiv({ cls: 'file-diff__line conflict-region-incoming' });
            const diffSpan = buildDiffLine(diff.remoteLines[i], diff.localLines[i], 'file-diff__char-highlight-remote');
            lineDiv.appendChild(diffSpan);
        }
    }

    private highlightResolution(block: HTMLElement, resolution: 'local' | 'remote' | 'both'): void {
        // Add visual feedback
        block.querySelectorAll('.file-diff__line').forEach(el => {
            el.removeClass('file-diff__resolved');
        });

        if (resolution === 'local') {
            block.querySelectorAll('.conflict-region-current').forEach(el => el.addClass('file-diff__resolved'));
        } else if (resolution === 'remote') {
            block.querySelectorAll('.conflict-region-incoming').forEach(el => el.addClass('file-diff__resolved'));
        } else {
            block.querySelectorAll('.file-diff__line').forEach(el => el.addClass('file-diff__resolved'));
        }
    }

    private buildResolvedContent(): string {
        const resultLines: string[] = [];
        let localIdx = 0;
        let remoteIdx = 0;
        const maxIterations = this.localLines.length + this.remoteLines.length + 100;
        let iterations = 0;

        // Sort differences by position
        const sortedDiffs = [...this.fileDiff.differences].sort((a, b) =>
            a.localStart - b.localStart || a.remoteStart - b.remoteStart
        );
        let nextDiffIdx = 0;

        while (localIdx < this.localLines.length || remoteIdx < this.remoteLines.length) {
            if (++iterations > maxIterations) {
                console.error('buildResolvedContent: Max iterations reached');
                break;
            }

            const currentDiff = sortedDiffs[nextDiffIdx];
            const atDiff = currentDiff &&
                currentDiff.localStart === localIdx &&
                currentDiff.remoteStart === remoteIdx;

            if (atDiff && currentDiff) {
                const resolution = this.resolutions.get(nextDiffIdx) || 'local';

                if (resolution === 'local') {
                    resultLines.push(...currentDiff.localLines);
                } else if (resolution === 'remote') {
                    resultLines.push(...currentDiff.remoteLines);
                } else { // both
                    resultLines.push(...currentDiff.localLines);
                    resultLines.push(...currentDiff.remoteLines);
                }

                const localAdvance = Math.max(currentDiff.localLines.length, 0);
                const remoteAdvance = Math.max(currentDiff.remoteLines.length, 0);

                if (localAdvance === 0 && remoteAdvance === 0) {
                    localIdx++;
                    remoteIdx++;
                } else {
                    localIdx += localAdvance;
                    remoteIdx += remoteAdvance;
                }

                nextDiffIdx++;
            } else {
                // Unchanged line - take from local
                if (localIdx < this.localLines.length) {
                    resultLines.push(this.localLines[localIdx]);
                }
                localIdx++;
                remoteIdx++;
            }
        }

        return resultLines.join('\n');
    }
}
