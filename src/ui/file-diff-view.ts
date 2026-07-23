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

interface Patch {
    hunks: Array<{
        oldStart: number;
        newStart: number;
        lines: string[];
    }>;
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
    ) as unknown as Patch;

    const differences: DifferenceBlock[] = [];

    patch.hunks.forEach(hunk => {
        let localCount = 0;
        let remoteCount = 0;

        // structuredPatch emits "\ No newline at end of file" marker lines;
        // they are metadata, not content, and break contiguous-block
        // detection and line-index math if left in.
        const hunkLines = hunk.lines.filter((l: string) => !l.startsWith('\\'));

        for (let i = 0; i < hunkLines.length; i++) {
            const line = hunkLines[i];

            if (line.startsWith('+') || line.startsWith('-')) {
                const start = i;

                // Find end of contiguous changed lines
                let end = start;
                while (
                    end < hunkLines.length - 1 &&
                    (hunkLines[end + 1].startsWith('+') || hunkLines[end + 1].startsWith('-'))
                ) {
                    end++;
                }

                // Calculate positions in original content
                const localStartIdx = hunk.oldStart + start - remoteCount - 1;
                const remoteStartIdx = hunk.newStart + start - localCount - 1;

                // Count lines being changed
                const localChangeCount = hunkLines
                    .slice(start, end + 1)
                    .filter((l: string) => l.startsWith('-'))
                    .length;
                const remoteChangeCount = hunkLines
                    .slice(start, end + 1)
                    .filter((l: string) => l.startsWith('+'))
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
    const fragment = createEl('div');

    if (line1 === undefined || line1.length === 0) {
        fragment.textContent = line1 || '\u00A0'; // non-breaking space for empty lines
    } else if (line1 !== undefined && line2 !== undefined) {
        const diffs = diffWords(line2, line1);
        for (const part of diffs) {
            if (part.removed) continue;
            const span = fragment.createEl('span');
            span.textContent = part.value || '\u00A0';
            if (part.added) {
                span.classList.add(charClass);
            }
        }
    } else if (line1 !== undefined) {
        const span = fragment.createEl('span');
        span.textContent = line1 || '\u00A0';
        span.classList.add(charClass);
    }

    return fragment;
}

export interface FileDiffViewOptions {
    container: HTMLElement;
    localContent: string;
    remoteContent: string;
    /** Called when the user confirms the pull. No content parameter — the
     *  caller always uses the raw remoteContent passed at construction. */
    onAccept: () => Promise<void>;
    onCancel?: () => void;
}

/**
 * Read-only diff preview. Shows what Confluence has vs what is local.
 * The user can only Accept (pull the entire remote version) or Cancel.
 * There is no per-block resolution — this is a strict pull-only UI.
 */
export class FileDiffView {
    private fileDiff: FileDiff;
    private localLines: string[];
    private container: HTMLElement;
    private onAccept: () => Promise<void>;
    private onCancel?: () => void;

    constructor(options: FileDiffViewOptions) {
        this.container = options.container;
        this.localLines = options.localContent.split('\n');
        this.fileDiff = computeFileDiff(options.localContent, options.remoteContent);
        this.onAccept = options.onAccept;
        this.onCancel = options.onCancel;
    }

    render(): void {
        this.container.empty();
        this.container.addClass('file-diff__container');

        // Header
        const header = this.container.createDiv({ cls: 'file-diff__header' });
        header.createEl('h3', {
            text: `${this.fileDiff.differences.length} difference(s) between Confluence and your note`,
        });

        // Read-only diff preview region — keyboard-scrollable for accessibility
        const content = this.container.createDiv({ cls: 'file-diff__content' });
        content.setAttribute('role', 'region');
        content.setAttribute('aria-label', 'Changes from Confluence');
        content.setAttribute('tabindex', '0');
        this.buildLines(content);

        // Footer: two CTAs — primary pull, secondary cancel
        const footer = this.container.createDiv({ cls: 'file-diff__footer modal-button-container' });

        const cancelBtn = footer.createEl('button', { text: 'Cancel (Keep Local)' });
        cancelBtn.setAttribute('title', 'Do not apply. Your local note is unchanged and the version marker is not updated.');
        cancelBtn.onclick = () => {
            if (this.onCancel) {
                this.onCancel();
            }
        };

        const applyBtn = footer.createEl('button', { text: 'Pull & Replace', cls: 'mod-cta' });
        applyBtn.setAttribute('title', 'Replace your local note body with the Confluence version shown above. Confluence is not modified.');
        applyBtn.onclick = async () => {
            try {
                applyBtn.disabled = true;
                applyBtn.textContent = 'Pulling...';
                await this.onAccept();
            } catch (error) {
                console.error('Error during pull & replace:', error);
                applyBtn.disabled = false;
                applyBtn.textContent = 'Pull & Replace';
                // Error is handled by sync-service; modal stays open for retry or cancel.
            }
        };
    }

    private buildLines(container: HTMLElement): void {
        let localIdx = 0;
        let remoteIdx = 0;
        const maxIterations = this.localLines.length + this.fileDiff.remoteLines.length + 100;
        let iterations = 0;

        // Sort differences by position to process them in order
        const sortedDiffs = [...this.fileDiff.differences].sort((a, b) =>
            a.localStart - b.localStart || a.remoteStart - b.remoteStart
        );
        let nextDiffIdx = 0;

        while (localIdx < this.localLines.length || remoteIdx < this.fileDiff.remoteLines.length) {
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
                this.buildDifferenceBlock(container, currentDiff);

                // Advance by the number of lines in the diff (at least 1 to prevent stuck)
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
                // Unchanged line — show from local
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

    private buildDifferenceBlock(container: HTMLElement, diff: DifferenceBlock): void {
        const block = container.createDiv({ cls: 'file-diff__difference' });

        // Local (being replaced) lines — red-tinted to show what will be removed
        for (let i = 0; i < diff.localLines.length; i++) {
            const lineDiv = block.createDiv({ cls: 'file-diff__line conflict-region-current' });
            const diffSpan = buildDiffLine(diff.localLines[i], diff.remoteLines[i], 'file-diff__char-highlight-local');
            lineDiv.appendChild(diffSpan);
        }

        // Remote (incoming) lines — blue-tinted to show what Confluence has
        for (let i = 0; i < diff.remoteLines.length; i++) {
            const lineDiv = block.createDiv({ cls: 'file-diff__line conflict-region-incoming' });
            const diffSpan = buildDiffLine(diff.remoteLines[i], diff.localLines[i], 'file-diff__char-highlight-remote');
            lineDiv.appendChild(diffSpan);
        }
    }
}
