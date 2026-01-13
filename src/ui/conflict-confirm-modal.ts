import { App, Modal, Setting } from 'obsidian';

/**
 * Modal to confirm conflict resolution workflow
 */
export class ConflictConfirmModal extends Modal {
    private onConfirm: () => void;
    private onCancel: () => void;
    private conflictCount: number;
    private remoteVersion: number;

    constructor(
        app: App,
        conflictCount: number,
        remoteVersion: number,
        onConfirm: () => void,
        onCancel: () => void
    ) {
        super(app);
        this.conflictCount = conflictCount;
        this.remoteVersion = remoteVersion;
        this.onConfirm = onConfirm;
        this.onCancel = onCancel;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: '🔀 Conflicts Detected' });

        // Explanation
        const explanation = contentEl.createDiv({ cls: 'conflict-explanation' });
        explanation.createEl('p', {
            text: 'The plugin has detected conflicts between your local changes and the remote Confluence page:'
        });

        // Status list
        const statusList = explanation.createEl('ul');
        statusList.createEl('li', {
            text: `✓ Pulled latest content from Confluence (version ${this.remoteVersion})`,
            cls: 'status-success'
        });
        statusList.createEl('li', {
            text: '✓ Compared with your local changes',
            cls: 'status-success'
        });
        statusList.createEl('li', {
            text: `✗ Found ${this.conflictCount} conflict${this.conflictCount > 1 ? 's' : ''} that need manual resolution`,
            cls: 'status-error'
        });

        // What will happen
        const nextSteps = contentEl.createDiv({ cls: 'conflict-next-steps' });
        nextSteps.createEl('h3', { text: 'What happens next?' });

        const stepsList = nextSteps.createEl('ol');
        stepsList.createEl('li', {
            text: 'Conflict markers will be inserted into your file (GitHub-style)'
        });
        stepsList.createEl('li', {
            text: 'You resolve conflicts directly in the file'
        });
        stepsList.createEl('li', {
            text: 'You push again after resolving all conflicts'
        });

        // Example
        const example = contentEl.createDiv({ cls: 'conflict-example' });
        example.createEl('h4', { text: 'Example conflict marker:' });
        const codeBlock = example.createEl('pre');
        codeBlock.createEl('code', {
            text:
                '<<<<<<< Local (Your Version)\n' +
                'Your content here\n' +
                '=======\n' +
                'Remote content here\n' +
                '>>>>>>> Remote (Confluence)'
        });

        // Warning
        const warning = contentEl.createDiv({ cls: 'conflict-warning' });
        warning.createEl('p', {
            text: '⚠️ Your file will be modified with conflict markers. You can undo this change if needed.',
            cls: 'mod-warning'
        });

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => {
            this.close();
            this.onCancel();
        };

        const confirmBtn = buttonContainer.createEl('button', {
            text: 'Insert Conflict Markers',
            cls: 'mod-cta'
        });
        confirmBtn.onclick = () => {
            this.close();
            this.onConfirm();
        };
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
