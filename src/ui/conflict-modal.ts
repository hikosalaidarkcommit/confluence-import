import { App, Modal, Notice } from 'obsidian';
import { DiffResult } from '../models';
import { FileDiffView } from './file-diff-view';

export class ConflictResolutionModal extends Modal {
    private diffResult: DiffResult;

    constructor(
        app: App,
        diffResult: DiffResult,
        private onResolve: (merged: string) => Promise<void>
    ) {
        super(app);
        this.diffResult = diffResult;
    }

    onOpen() {
        this.render();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }

    private render() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: 'Confluence Sync - Conflicts Detected' });

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
                try {
                    await this.onResolve(resolvedContent);
                    this.close();  // Only close if successful
                } catch (error) {
                    // Error is handled by sync-service, but don't close the modal
                    // so user can retry or cancel
                }
            },
            onCancel: () => {
                this.close();
            }
        });
        diffView.render();
    }
}
