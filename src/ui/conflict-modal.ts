import { App, Modal, Notice } from 'obsidian';
import { DiffResult } from '../models';
import { FileDiffView } from './file-diff-view';

export class ConflictResolutionModal extends Modal {
    private diffResult: DiffResult;
    private onSettled?: () => void;

    constructor(
        app: App,
        diffResult: DiffResult,
        /** Called when the user confirms the pull (no content param — remote is always used). */
        private onAccept: () => Promise<void>,
        onSettled?: () => void
    ) {
        super(app);
        this.diffResult = diffResult;
        this.onSettled = onSettled;
    }

    onOpen() {
        this.render();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        // Notify the service that the modal lifecycle is over
        // (applied successfully OR cancelled/dismissed).
        if (this.onSettled) {
            const cb = this.onSettled;
            this.onSettled = undefined;
            cb();
        }
    }

    private render() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: 'Confluence has differences from your local note' });

        // Explain exactly what will happen so the user can make an informed choice.
        contentEl.createEl('p', {
            text: 'The preview below shows what changed. ' +
                '"Pull & Replace" will overwrite your local note body with the Confluence version shown in blue. ' +
                'Your local edits shown in green will be lost. Confluence is never modified by this plugin.',
        });

        // Container for the diff view — scrollable, keyboard-accessible
        const container = contentEl.createDiv({ cls: 'file-diff__preview-container' });

        const diffView = new FileDiffView({
            container,
            localContent: this.diffResult.localContent,
            remoteContent: this.diffResult.remoteContent,
            onAccept: async () => {
                try {
                    await this.onAccept();
                    this.close(); // Only close if successful
                } catch (error) {
                    // Error is handled by sync-service; modal stays open for retry or cancel.
                }
            },
            onCancel: () => {
                this.close();
            },
        });
        diffView.render();
    }
}
