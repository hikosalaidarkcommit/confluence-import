export interface ConfluenceSettings {
    baseUrl: string;
    apiToken: string;
    userEmail: string;
    defaultSpace?: string;
    enableDebugLogging: boolean;
    enablePageIdCache: boolean;
}

export const DEFAULT_SETTINGS: ConfluenceSettings = {
    baseUrl: '',
    apiToken: '',
    userEmail: '',
    defaultSpace: '',
    enableDebugLogging: false,
    enablePageIdCache: true
};

export interface NoteConfluenceMetadata {
    confluenceUrl?: string;
    // confluencePageId?: string; // Optional direct mapping
    // confluenceBaseUrl?: string; // If using direct ID
}

export interface DiffLine {
    lineNumber: number;
    content: string;
    type: 'unchanged' | 'added' | 'removed' | 'modified';
}

export interface ConflictBlock {
    startLine: number;
    endLine: number;
    localLines: DiffLine[];
    remoteLines: DiffLine[];
    resolution?: 'local' | 'remote' | 'both' | 'manual';
    manualContent?: string;
}

export interface DiffResult {
    hasConflicts: boolean;
    conflicts: ConflictBlock[];
    remoteVersion: number;
    remoteContent: string;
    localContent: string;
    diffLines: DiffLine[];
}

export interface ParsedConfluenceUrl {
    baseUrl: string;
    pageId?: string;
    spaceKey?: string;
    pageTitle?: string;
    urlType: 'display' | 'legacy' | 'modern' | 'direct-id';
}

export interface PageResolutionResult {
    pageId: string;
    version: number;
    title: string;
    spaceKey: string;
    warning?: string;
}

export interface PageContent {
    id: string;
    type: string;
    status: string;
    title: string;
    body: {
        storage: {
            value: string;
            representation: string;
        };
    };
    version: {
        number: number;
        when: string;
    };
    space: {
        key: string;
        name: string;
    };
}
