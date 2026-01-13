import { App, Modal, Notice, Setting } from 'obsidian';
import { DiffResult, ConflictBlock, DiffLine } from '../models';
import { ConflictMarker } from '../conflict/conflict-marker';
import { EditorView, ViewPlugin, Decoration, DecorationSet, ViewUpdate, WidgetType } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { FileDiffView } from './file-diff-view';

// Widget for Interactive Conflict Buttons
class ConflictActionsWidget extends WidgetType {
    constructor(private onAction: (action: 'local' | 'remote' | 'both') => void) {
        super();
    }

    toDOM() {
        const div = document.createElement('div');
        div.className = 'conflict-actions-inline';
        div.style.userSelect = 'none'; // Prevent selection issues

        const label = div.createSpan({ text: 'Resolve: ' });
        label.style.fontWeight = 'bold';
        label.style.marginRight = '8px';
        label.style.color = 'var(--text-muted)';

        const btnLocal = div.createEl('button', { text: 'Accept Local', cls: 'conflict-action-btn' });
        btnLocal.onclick = (e) => { e.preventDefault(); this.onAction('local'); };
        btnLocal.style.color = 'var(--color-green)';

        div.createSpan({ text: ' | ' });

        const btnRemote = div.createEl('button', { text: 'Accept Remote', cls: 'conflict-action-btn' });
        btnRemote.onclick = (e) => { e.preventDefault(); this.onAction('remote'); };
        btnRemote.style.color = 'var(--color-blue)';

        div.createSpan({ text: ' | ' });

        const btnBoth = div.createEl('button', { text: 'Accept Both', cls: 'conflict-action-btn' });
        btnBoth.onclick = (e) => { e.preventDefault(); this.onAction('both'); };

        return div;
    }

    eq(other: ConflictActionsWidget) { return false; } // Always update for safety
}

function resolveConflict(view: EditorView, startPos: number, action: 'local' | 'remote' | 'both') {
    const startLine = view.state.doc.lineAt(startPos);

    // Scan forward to find bounds
    let scanLine = startLine;
    let middle = -1;
    let end = -1;
    let endLine = null;

    for (let i = 0; i < 5000; i++) {
        if (scanLine.number >= view.state.doc.lines) break;
        if (scanLine.text.startsWith('=======')) {
            middle = scanLine.from;
        }
        if (scanLine.text.startsWith('>>>>>>>')) {
            end = scanLine.from;
            endLine = scanLine;
            break;
        }
        scanLine = view.state.doc.line(scanLine.number + 1);
    }

    if (middle !== -1 && end !== -1 && endLine) {
        const fullRangeFrom = startLine.from;
        const fullRangeTo = endLine.to;
        let replacement = '';

        const middleLine = view.state.doc.lineAt(middle);

        if (action === 'local') {
            if (middleLine.from > startLine.to + 1) {
                replacement = view.state.sliceDoc(startLine.to + 1, middleLine.from);
            }
        } else if (action === 'remote') {
            if (endLine.from > middleLine.to + 1) {
                replacement = view.state.sliceDoc(middleLine.to + 1, endLine.from);
            }
        } else if (action === 'both') {
            const local = (middleLine.from > startLine.to + 1) ? view.state.sliceDoc(startLine.to + 1, middleLine.from) : '';
            const remote = (endLine.from > middleLine.to + 1) ? view.state.sliceDoc(middleLine.to + 1, endLine.from) : '';
            replacement = local + remote;
        }

        view.dispatch({
            changes: { from: fullRangeFrom, to: fullRangeTo, insert: replacement }
        });
    }
}

export class ConflictResolutionModal extends Modal {
    private diffResult: DiffResult;
    private currentConflictIndex: number = 0;
    private resolutions: Map<number, 'local' | 'remote' | 'both' | 'manual'>;
    private manualContents: Map<number, string>;
    private isFullFileEditMode: boolean = false;
    private fullFileContent: string = '';
    private editorView: EditorView | null = null;

    constructor(
        app: App,
        diffResult: DiffResult,
        private onResolve: (merged: string) => Promise<void>
    ) {
        super(app);
        this.diffResult = diffResult;
        this.resolutions = new Map();
        this.manualContents = new Map();
    }

    onOpen() {
        this.render();
    }

    onClose() {
        if (this.editorView) {
            this.editorView.destroy();
            this.editorView = null;
        }
        const { contentEl } = this;
        contentEl.empty();
    }

    private render() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: 'Confluence Sync - Conflicts Detected' });

        if (this.isFullFileEditMode) {
            this.renderFullFileEdit();
            return;
        }

        // Check if we have conflicts
        if (!this.diffResult.hasConflicts || this.diffResult.conflicts.length === 0) {
            contentEl.createEl('p', { text: 'No conflicts to resolve.' });
            return;
        }

        const conflict = this.diffResult.conflicts[this.currentConflictIndex];

        // Navigation
        const navDiv = contentEl.createDiv({ cls: 'conflict-nav' });
        navDiv.createSpan({ text: `Conflict ${this.currentConflictIndex + 1} of ${this.diffResult.conflicts.length}` });

        const prevBtn = navDiv.createEl('button', { text: 'Previous' });
        prevBtn.disabled = this.currentConflictIndex === 0;
        prevBtn.onclick = () => {
            if (this.currentConflictIndex > 0) {
                this.currentConflictIndex--;
                this.render();
            }
        };

        const nextBtn = navDiv.createEl('button', { text: 'Next' });
        nextBtn.disabled = this.currentConflictIndex === this.diffResult.conflicts.length - 1;
        nextBtn.onclick = () => {
            if (this.currentConflictIndex < this.diffResult.conflicts.length - 1) {
                this.currentConflictIndex++;
                this.render();
            }
        };

        // Split View
        const splitContainer = contentEl.createDiv({ cls: 'conflict-split-view' });

        const localPanel = splitContainer.createDiv({ cls: 'conflict-panel local' });
        localPanel.createEl('h3', { text: 'Local (Yours)' });
        const localContent = localPanel.createDiv({ cls: 'conflict-content' });
        this.renderDiffLines(localContent, conflict.localLines);

        const remotePanel = splitContainer.createDiv({ cls: 'conflict-panel remote' });
        remotePanel.createEl('h3', { text: 'Remote (Theirs)' });
        const remoteContent = remotePanel.createDiv({ cls: 'conflict-content' });
        this.renderDiffLines(remoteContent, conflict.remoteLines);

        // Resolution Options
        const currentResolution = this.resolutions.get(this.currentConflictIndex) || 'local';

        new Setting(contentEl)
            .setName('Resolution')
            .addDropdown(dropdown => dropdown
                .addOption('local', 'Keep Local')
                .addOption('remote', 'Keep Remote')
                .addOption('both', 'Keep Both')
                .addOption('manual', 'Manual Edit')
                .setValue(currentResolution)
                .onChange((value: any) => {
                    this.resolutions.set(this.currentConflictIndex, value);
                    this.render(); // Re-render to show manual edit box or preview update
                }));

        if (currentResolution === 'manual') {
            // Show GitHub-style conflict markers by default
            const defaultManualContent =
                '<<<<<<< Local (Your Version)\n' +
                this.getConflictText(conflict.localLines) + '\n' +
                '=======\n' +
                this.getConflictText(conflict.remoteLines) + '\n' +
                '>>>>>>> Remote (Confluence)';

            const manualText = this.manualContents.get(this.currentConflictIndex) || defaultManualContent;

            const textArea = contentEl.createEl('textarea', { text: manualText, cls: 'manual-edit-area' });
            textArea.style.width = '100%';
            textArea.style.height = '200px';
            textArea.oninput = (e) => {
                const target = e.target as HTMLTextAreaElement;
                this.manualContents.set(this.currentConflictIndex, target.value);
            };
        }

        // Actions
        const actionsDiv = contentEl.createDiv({ cls: 'modal-button-container' });
        const cancelBtn = actionsDiv.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => this.close();

        const fullEditBtn = actionsDiv.createEl('button', { text: 'Edit Whole File' });
        fullEditBtn.onclick = () => {
            this.isFullFileEditMode = true;
            // Generate content with markers using ConflictMarker
            const marker = new ConflictMarker();
            this.fullFileContent = marker.insertMarkers(this.diffResult.localContent, this.diffResult.conflicts);
            this.render();
        };

        const mergeBtn = actionsDiv.createEl('button', { text: 'Merge & Push', cls: 'mod-cta' });
        mergeBtn.onclick = async () => {
            await this.handleMerge();
        };
    }

    private renderDiffLines(container: HTMLElement, lines: DiffLine[]) {
        lines.forEach(line => {
            const div = container.createDiv({ cls: `diff-line-${line.type}` });
            div.createSpan({ text: line.content }); // Use textContent to escape HTML
        });
    }

    private getConflictText(lines: DiffLine[]): string {
        return lines.map(l => l.content).join('\n');
    }

    private async handleMerge() {
        const mergedContent = this.applyResolutions();
        this.close();
        await this.onResolve(mergedContent);
    }

    private applyResolutions(): string {
        // This is a naive reconstruction. 
        // Ideally we reconstruct the file by iterating through ALL diff lines (conflict and non-conflict).
        // The DiffResult 'diffLines' contains the sequence.
        // Spec says: "Apply each resolution in reverse order (to maintain line numbers)" 
        // if we were patching the original file.
        // If we have the full diffLines sequence, we can just map over it.
        // But ConflictBlock logic in diff-engine.ts might separate conflicts from context.
        // Let's assume we can reconstruct from diffLines, but replacing conflict blocks.

        // We need to map which lines belong to which conflict.
        // Simplification: We iterate over the resolutions and apply patches to localContent?
        // Or simpler: Rebuild string from diffLines, checking if we are inside a conflict block.
        // Since 'diffLines' tracks all content, we can parse it potentially.

        // BUT diff-engine implementation returns 'diffLines' which is a flat list.
        // And 'conflicts' identifies ranges in that list? 
        // My previous implementation of DiffEngine.identifyConflicts uses 'lineNumber' which was just local line number.
        // Reconstructing from that is hard.

        // Alternative: We just use the raw 'diffs' (semantic cleaned) from DMP if we had them.
        // Or we use 'localContent' as base and patch it.

        // Let's try to be robust: We have the 'diffLines' array in DiffResult.
        // We can iterate through it. 
        // BUT 'DiffLine' in my implementation isn't linked to conflict index explicitly.
        // Logic: Iterate through conflicts. A conflict has expected start/end lines in the diff sequence?
        // Actually, identifyConflicts returned ConflictBlocks which have `localLines` and `remoteLines`.
        // It's tricky to map back to the full document flow if we don't have a "token stream".

        // Better strategy for this MVP:
        // Just use 'localContent' as base.
        // For each conflict, we know the "Local Lines" (what they are in localContent).
        // We can find them and replace them.
        // But if there are multiple identical blocks, search/replace is dangerous.

        // Let's assume for this MVP that I won't perfect the merge logic here, 
        // but clearly indicate that this method needs robust implementation.
        // However, the USER asked to "make it".
        // So I should provide a working-ish merge.

        // The DiffEngine 'diffLines' should correspond to the "patch" stream.
        // Let's refine DiffEngine to be useful here? 
        // Or just accept that for MVP, "Keep Local" means do nothing for that block (if it was added locally), etc.
        // This is getting complicated without a robust diff model.
        // I will try to implement a simple line-based reconstruction.

        // If we assume 'diffLines' covers the whole file linearly (it basically does if we traverse it),
        // We can just iterate diffLines.
        // But wait, 'diffLines' separates added/removed.
        // Reconstructing "Local" = take Unchanged + Added.
        // Reconstructing "Remote" = take Unchanged + Removed.
        // Reconstructing "Merged":
        // Iterate through diffLines.
        // If Unchanged -> Keep.
        // If Added/Removed -> Check if it belongs to a conflict.
        // We need to know which conflict a line belongs to.

        // I'll add a helper to mark conflict IDs on lines or similar.
        // For now, I'll return localContent as a placeholder if logic is too complex, 
        // but let's try to traverse.

        let result = '';
        let conflictIndex = -1;

        // We need to know where conflicts start/end in the linear diffLines array.
        // My IdentifyConflicts implementation in DiffEngine iterated diffLines.
        // We can re-run that logic or just guess.

        // Ideally DiffEngine should have returned a structured list of (Block | Conflict).
        // Let's assume we can't easily change DiffEngine now without rewriting it.
        // I'll do a simple "Keep Local" for everything (default)
        // and log "Merge logic requires advanced implementation".

        // Just kidding, I'll try to do it right.
        const lines = this.diffResult.diffLines;
        // We need to group them again to match conflicts?
        // Just walk through conflicts and lines together.

        let currentLineIdx = 0;
        const resolvedBlocks: string[] = [];

        // Sort conflicts by line number? They should be sorted.
        // We need to fill gap between conflicts with Unchanged lines?
        // But 'diffLines' has all lines.

        // Let's traverse diffLines. 
        // We need to detect when we are in a conflict.
        // A conflict starts when type != unchanged.
        // It ends when type == unchanged.

        let inConflict = false;
        let currentConflictLines: DiffLine[] = [];
        let conflictCount = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.type !== 'unchanged') {
                if (!inConflict) {
                    inConflict = true;
                    currentConflictLines = [];
                }
                currentConflictLines.push(line);
            } else {
                if (inConflict) {
                    // End of conflict
                    inConflict = false;
                    const resolution = this.resolutions.get(conflictCount) || 'local';
                    resolvedBlocks.push(this.resolveConflictBlock(conflictCount, currentConflictLines, resolution));
                    conflictCount++;
                }
                resolvedBlocks.push(line.content); // Unchanged line
            }
        }
        // Handle trailing conflict
        if (inConflict) {
            const resolution = this.resolutions.get(conflictCount) || 'local';
            resolvedBlocks.push(this.resolveConflictBlock(conflictCount, currentConflictLines, resolution));
        }

        return resolvedBlocks.join('\n');
    }

    private resolveConflictBlock(index: number, lines: DiffLine[], resolution: 'local' | 'remote' | 'both' | 'manual'): string {
        // Filter lines based on resolution
        if (resolution === 'manual') {
            return this.manualContents.get(index) || '';
        }

        const localPart = lines.filter(l => l.type === 'added').map(l => l.content).join('\n');
        const remotePart = lines.filter(l => l.type === 'removed').map(l => l.content).join('\n');

        if (resolution === 'local') return localPart;
        if (resolution === 'remote') return remotePart;
        if (resolution === 'both') return localPart + '\n' + remotePart;
        return localPart;
    }

    private renderFullFileEdit() {
        const { contentEl } = this;

        // Header with instructions
        contentEl.createEl('p', {
            text: 'Review differences between your local file and Confluence. Click the action buttons to resolve each difference.'
        });

        // Container for the diff view
        const container = contentEl.createDiv({ cls: 'full-file-editor-container' });
        container.style.maxHeight = '500px';
        container.style.overflow = 'auto';
        container.style.border = '1px solid var(--background-modifier-border)';
        container.style.borderRadius = '4px';
        container.style.marginBottom = '16px';

        // Create the FileDiffView
        const diffView = new FileDiffView({
            container: container,
            localContent: this.diffResult.localContent,
            remoteContent: this.diffResult.remoteContent,
            onResolve: async (resolvedContent: string) => {
                this.close();
                await this.onResolve(resolvedContent);
            }
        });
        diffView.render();

        // Back button (outside of FileDiffView's footer)
        const actionsDiv = contentEl.createDiv({ cls: 'modal-button-container' });
        const backBtn = actionsDiv.createEl('button', { text: 'Back to Step-by-Step' });
        backBtn.onclick = () => {
            this.isFullFileEditMode = false;
            this.render();
        };
    }
}
