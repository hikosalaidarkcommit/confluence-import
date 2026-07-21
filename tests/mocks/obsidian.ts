export const requestUrl = jest.fn();
export interface RequestUrlParam { }

export class Notice {
    /** All messages created since the last reset — lets tests assert user-visible notices. */
    static messages: string[] = [];
    static reset() { Notice.messages = []; }

    constructor(public message?: string, public timeout?: number) {
        if (typeof message === 'string') Notice.messages.push(message);
    }
}

export class TFile {
    path = '';
    basename = '';
    extension = 'md';
}

export class Modal {
    app: any;
    /** Mirrors the real Obsidian Modal lifecycle: open() → onOpen(), close() → onClose(). */
    isOpen = false;
    contentEl: any = {
        empty: jest.fn(),
        createEl: jest.fn().mockReturnThis(),
        createDiv: jest.fn().mockReturnThis(),
    };
    constructor(app: any) {
        this.app = app;
    }
    open() {
        if (this.isOpen) return;
        this.isOpen = true;
        this.onOpen();
    }
    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.onClose();
    }
    /** Subclasses override these, exactly like the real Obsidian Modal. */
    onOpen() { }
    onClose() { }
}

export class Plugin { }
export class PluginSettingTab { }
export class Setting { }
export class FileSystemAdapter {
    private _basePath: string;
    // basePath is optional to match the Obsidian type signature
    // (the real class is constructed internally by Obsidian, not by plugin code).
    constructor(basePath?: string) { this._basePath = basePath ?? '/vault'; }
    getBasePath() { return this._basePath; }
    getName() { return 'file'; }
}
export type App = any;
export type Vault = any;
export type WorkspaceLeaf = any;
