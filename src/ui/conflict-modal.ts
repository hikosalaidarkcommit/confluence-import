import { App, Modal } from 'obsidian';
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

        // For the PREVIEW ONLY, replace image placeholder tokens with a
        // readable text representation (no network, no rendering). The
        // actual token replacement with local links happens at apply time.
        let previewRemote = this.diffResult.remoteContent;
        for (const ref of this.diffResult.imageRefs) {
            const label = ref.kind === 'attachment'
                ? `[image attachment: ${ref.filename ?? 'unknown'}]`
                : `[remote image: ${ref.url ?? 'unknown'}]`;
            previewRemote = previewRemote.split(ref.token).join(label);
        }

        const diffView = new FileDiffView({
            container,
            localContent: this.diffResult.localContent,
            remoteContent: previewRemote,
            onAccept: async () => {
                try {
                    await this.onAccept();
                    this.close(); // Only close if successful
                } catch {
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
