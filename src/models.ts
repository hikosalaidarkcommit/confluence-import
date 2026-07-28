export interface ConfluenceSettings {
    baseUrl: string;
    apiToken: string;
    userEmail: string;
    defaultSpace?: string;
    enableDebugLogging: boolean;
    enablePageIdCache: boolean;
    /** Download Confluence attachment images into the vault on import. */
    importImages: boolean;
}

export const DEFAULT_SETTINGS: ConfluenceSettings = {
    baseUrl: '',
    apiToken: '',
    userEmail: '',
    defaultSpace: '',
    enableDebugLogging: false,
    enablePageIdCache: true,
    importImages: true
};

/**
 * Runtime validator for persisted plugin data (`loadData()` returns
 * unknown/any — the stored JSON may come from an older plugin version or
 * be hand-edited). Only fields with the CORRECT type are merged onto
 * DEFAULT_SETTINGS; anything invalid falls back to the default. Never
 * throws and never logs values (the payload includes the API token).
 */
export function parseStoredSettings(raw: unknown): ConfluenceSettings {
    const settings: ConfluenceSettings = { ...DEFAULT_SETTINGS };
    if (typeof raw !== 'object' || raw === null) {
        return settings;
    }
    const source = raw as Record<string, unknown>;

    if (typeof source.baseUrl === 'string') settings.baseUrl = source.baseUrl;
    if (typeof source.apiToken === 'string') settings.apiToken = source.apiToken;
    if (typeof source.userEmail === 'string') settings.userEmail = source.userEmail;
    if (typeof source.defaultSpace === 'string') settings.defaultSpace = source.defaultSpace;
    if (typeof source.enableDebugLogging === 'boolean') settings.enableDebugLogging = source.enableDebugLogging;
    if (typeof source.enablePageIdCache === 'boolean') settings.enablePageIdCache = source.enablePageIdCache;
    if (typeof source.importImages === 'boolean') settings.importImages = source.importImages;

    return settings;
}

/**
 * One image reference discovered during storage→Markdown conversion.
 * `token` is a deterministic unique placeholder embedded in the converted
 * Markdown; the apply step replaces the EXACT token string — no fragile
 * Markdown re-parsing.
 */
export interface RemoteImageRef {
    /** Unique placeholder token present in DiffResult.remoteContent. */
    token: string;
    /** 'attachment' = ri:attachment (needs API metadata resolution); 'url' = explicit URL (ri:url or img src). */
    kind: 'attachment' | 'url';
    /** Attachment filename (kind='attachment'). */
    filename?: string;
    /** Attachment version (kind='attachment'). */
    version?: number;
    /** Explicit source URL (kind='url'); may be relative. */
    url?: string;
    /** Sanitized alt text (may be empty). */
    alt: string;
    /** Sanitized title (may be empty). */
    title?: string;
    /** Positive integer width if declared and valid. */
    width?: number;
}

/** Result status for one image ref after an import attempt. */
export type ImageOutcomeStatus = 'imported' | 'reused' | 'failed' | 'kept-remote';

export interface ImageOutcome {
    ref: RemoteImageRef;
    status: ImageOutcomeStatus;
    /** Markdown snippet that replaces the token. */
    replacement: string;
    /** Vault path of a newly created attachment (rollback target). */
    createdPath?: string;
    /** Fixed machine-readable failure reason (never raw response bodies). */
    reason?: string;
}

export interface NoteConfluenceMetadata {
    confluenceUrl?: string;
    // confluencePageId?: string; // Optional direct mapping
    // confluenceBaseUrl?: string; // If using direct ID
}

export interface DiffResult {
    /**
     * True when local and remote differ after normalization.
     * Always equal to `!isIdentical`; kept for readability at call sites.
     * Detailed difference blocks are computed lazily by the conflict modal
     * (FileDiffView/computeFileDiff) — NOT here — so comparing large pages
     * does not allocate per-line diff objects up front.
     */
    hasConflicts: boolean;
    /** True when local and remote are equivalent after normalization. */
    isIdentical: boolean;
    remoteVersion: number;
    /** ORIGINAL (un-normalized) remote markdown — safe to write to disk. */
    remoteContent: string;
    /** ORIGINAL (un-normalized) local markdown — safe to write to disk. */
    localContent: string;
    /**
     * Image references found during conversion, keyed by placeholder tokens
     * embedded in remoteContent. Empty array when the page has no images.
     * Identity comparison (isIdentical) is computed on token-normalized
     * text so image tokens do not affect identical semantics.
     */
    imageRefs: RemoteImageRef[];
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
