export const requestUrl = jest.fn();
export interface RequestUrlParam { }

// Polyfill btoa and atob for the test environment if missing
if (typeof btoa === 'undefined') {
    (global as any).btoa = (str: string) => Buffer.from(str, 'binary').toString('base64');
}
if (typeof atob === 'undefined') {
    (global as any).atob = (str: string) => Buffer.from(str, 'base64').toString('binary');
}

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
export class PluginSettingTab {
    app: unknown;
    plugin: unknown;
    constructor(app: unknown, plugin: unknown) {
        this.app = app;
        this.plugin = plugin;
    }
}
export class Setting { }
/** Type-only mirror of Obsidian 1.13's declarative settings item. */
export type SettingDefinitionItem = {
    name: string;
    desc?: string;
    aliases?: string[];
    control?: { type: string; key: string; defaultValue?: unknown; placeholder?: string };
};
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

/** Mirrors Obsidian's normalizePath: forward slashes, collapse, trim edges. */
export function normalizePath(path: string): string {
    let p = path.replace(/\\/g, '/').replace(/\/+/g, '/');
    p = p.replace(/^\/+/, '').replace(/\/+$/, '');
    return p === '' ? '/' : p;
}

export interface Stat {
    type: 'file' | 'folder';
    ctime: number;
    mtime: number;
    size: number;
}

export type DataAdapter = any;

/**
 * In-memory DataAdapter test double implementing the subset the logger
 * uses: exists / stat / mkdir / append / write / rename / remove.
 */
export class MemoryDataAdapter {
    files = new Map<string, string>();
    dirs = new Set<string>();
    failWrites = false;

    async exists(path: string): Promise<boolean> {
        return this.files.has(path) || this.dirs.has(path);
    }
    async stat(path: string): Promise<Stat | null> {
        if (this.files.has(path)) {
            return { type: 'file', ctime: 0, mtime: 0, size: this.files.get(path)!.length };
        }
        if (this.dirs.has(path)) return { type: 'folder', ctime: 0, mtime: 0, size: 0 };
        return null;
    }
    async mkdir(path: string): Promise<void> {
        if (this.failWrites) throw new Error('mkdir failed');
        this.dirs.add(path);
    }
    async append(path: string, data: string): Promise<void> {
        if (this.failWrites) throw new Error('append failed');
        this.files.set(path, (this.files.get(path) ?? '') + data);
    }
    async write(path: string, data: string): Promise<void> {
        if (this.failWrites) throw new Error('write failed');
        this.files.set(path, data);
    }
    async rename(oldPath: string, newPath: string): Promise<void> {
        if (this.failWrites) throw new Error('rename failed');
        if (!this.files.has(oldPath)) throw new Error('no such file');
        this.files.set(newPath, this.files.get(oldPath)!);
        this.files.delete(oldPath);
    }
    async remove(path: string): Promise<void> {
        if (this.failWrites) throw new Error('remove failed');
        this.files.delete(path);
    }
}
