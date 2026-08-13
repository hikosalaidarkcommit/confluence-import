import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

import { DiffResult, RemoteImageRef } from '../models';
import { normalizeMarkdown } from '../utils/markdown-normalizer';
import { PluginLogger } from '../utils/logger';
import { resolveDownloadUrl } from '../utils/url-utils';

const CALLOUT_TITLE_MAX_LENGTH = 200;
const IMAGE_ALT_MAX_LENGTH = 120;

/** Marker used to identify images pull-imported by this plugin. */
const IMPORT_MARKER_PREFIX = 'confluence-import-image:';

/**
 * Deterministic, non-secret content hash (double FNV-1a, 16 hex chars).
 * Used for placeholder tokens and attachment filenames. Pure JS — no Node
 * crypto import, so it cannot trigger builtin-module bundle warnings.
 */
export function deterministicHash(input: string): string {
    let h1 = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        h1 ^= input.charCodeAt(i);
        h1 = Math.imul(h1, 0x01000193) >>> 0;
    }
    let h2 = (0x811c9dc5 ^ 0x5bd1e995) >>> 0;
    for (let i = input.length - 1; i >= 0; i--) {
        h2 ^= input.charCodeAt(i);
        h2 = Math.imul(h2, 0x01000193) >>> 0;
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/** Build the HTML comment marker for a given identity. */
export function buildImageMarker(identity: string): string {
    const hash = deterministicHash(identity).slice(0, 16);
    return `<!-- ${IMPORT_MARKER_PREFIX}${hash} -->`;
}

/**
 * Sanitize image alt/title text for safe embedding inside Markdown image
 * syntax: single line, bounded length, Markdown-structural characters
 * escaped (backslash first).
 */
export function sanitizeImageText(raw: string): string {
    if (!raw) return '';
    let text = raw.replace(/\s+/g, ' ').trim();
    if (text.length > IMAGE_ALT_MAX_LENGTH) {
        text = text.substring(0, IMAGE_ALT_MAX_LENGTH) + '…';
    }
    text = text.replace(/\\/g, '\\\\');
    text = text.replace(/([[\]()`#>*_~|!])/g, '\\$1');
    return text;
}

/** Build the deterministic placeholder token for one image occurrence. */
export function buildImageToken(identity: string, index: number): string {
    return `%%CFIMG-${deterministicHash(identity).slice(0, 12)}-${index}%%`;
}

/**
 * Sanitize a Confluence macro title before embedding it in an Obsidian
 * callout header line (`> [!type] title`).
 */
export function sanitizeCalloutTitle(raw: string): string {
    if (!raw) return '';
    let title = raw.replace(/\s+/g, ' ').trim();
    if (title.length > CALLOUT_TITLE_MAX_LENGTH) {
        title = title.substring(0, CALLOUT_TITLE_MAX_LENGTH) + '…';
    }
    // Backslash MUST be escaped first, then Markdown-significant characters.
    title = title.replace(/\\/g, '\\\\');
    title = title.replace(/([[\]()`#>*_~|!-])/g, '\\$1');
    return title;
}

const BLOCKED_URL_SCHEMES = new Set([
    'javascript', 'data', 'vbscript', 'file', 'obsidian',
]);

/**
 * Decide whether an anchor href is safe to keep as a clickable Markdown link.
 */
export function isSafeHref(rawHref: string): boolean {
    if (!rawHref) return true;

    const isControlOrSpace = (char: string) => {
        const code = char.charCodeAt(0);
        return code <= 32 || code === 127;
    };
    let candidate = Array.from(rawHref).filter(c => !isControlOrSpace(c)).join('');

    try {
        candidate = decodeURIComponent(candidate);
        candidate = Array.from(candidate).filter(c => !isControlOrSpace(c)).join('');
    } catch {
        // Malformed percent-encoding
    }

    const schemeMatch = candidate.match(/^([a-z][a-z0-9+.-]*):/i);
    if (!schemeMatch) return true;

    const scheme = schemeMatch[1].toLowerCase();
    if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') return true;
    if (BLOCKED_URL_SCHEMES.has(scheme)) return false;
    return false;
}

/**
 * Safe style-attribute parsing to detect line-through decoration
 * without using the restricted .style property on detached nodes.
 */
function hasLineThrough(node: HTMLElement): boolean {
    const styleAttr = node.getAttribute('style');
    if (!styleAttr) return false;
    return /\btext-decoration\s*:\s*line-through\b/i.test(styleAttr);
}

/**
 * Determines if a table is "simple" (convertible to rectangular GFM) or
 * "complex" (requiring sanitized HTML fallback).
 */
function isSimpleTable(table: HTMLTableElement): boolean {
    // Check the table element itself for attributes that require sanitization
    const tableAttrs = Array.from(table.attributes);
    for (const attr of tableAttrs) {
        const attrName = attr.name.toLowerCase();
        if (attrName.startsWith('on') || attrName === 'style' || attrName === 'class' || attrName === 'id') {
            return false;
        }
    }

    // 1. Spans make it complex
    const cells = Array.from(table.querySelectorAll('td, th')) as HTMLTableCellElement[];
    for (const cell of cells) {
        const rowspan = parseInt(cell.getAttribute('rowspan') || '1', 10);
        const colspan = parseInt(cell.getAttribute('colspan') || '1', 10);
        if (rowspan > 1 || colspan > 1) return false;
    }

    // 2. GFM tables don't support nested tables, captions, footers, or
    // multiple body sections.
    if (table.querySelector('table, caption, tfoot')) return false;
    if (table.querySelectorAll('tbody').length > 1) return false;

    // 3. Check for block-rich content or potentially unsafe elements in cells
    const blockSelectors = [
        'ul', 'ol', 'pre', 'blockquote',
        'ac\\:structured-macro', 'structured-macro',
        'div[data-macro-name]',
        'script', 'object', 'embed', 'iframe', 'form'
    ];
    for (const selector of blockSelectors) {
        if (table.querySelector(`td ${selector}, th ${selector}`)) return false;
    }

    // 4. Rectangular requirement: every row must have the same cell count.
    const rows = Array.from(table.querySelectorAll('tr'));
    if (rows.length === 0) return true;
    const colCount = rows[0].querySelectorAll('td, th').length;
    for (let i = 1; i < rows.length; i++) {
        if (rows[i].querySelectorAll('td, th').length !== colCount) return false;
    }

    // 5. Check all descendants for unsafe links or attributes that would be lost in GFM
    const allInTable = Array.from(table.querySelectorAll('*'));
    for (const el of allInTable) {
        if (el.tagName.toLowerCase() === 'a') {
            const href = el.getAttribute('href');
            if (href && !isSafeHref(href)) return false;
        }
        const attrs = Array.from(el.attributes);
        for (const attr of attrs) {
            const attrName = attr.name.toLowerCase();
            if (attrName.startsWith('on') || attrName === 'style' || attrName === 'class' || attrName === 'id') {
                return false;
            }
        }
    }

    return true;
}

/**
 * Strict sanitized HTML emitter for complex tables.
 * Recursively produces safe HTML from a detached DOM subtree.
 */
class SafeHtmlEmitter {
    private static readonly ALLOWED_TAGS = new Set([
        'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
        'colgroup', 'col', 'p', 'br', 'ul', 'ol', 'li', 'strong', 'em',
        'code', 'pre', 'a', 'img', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'
    ]);

    private static readonly ALLOWED_ATTRS: Record<string, Set<string>> = {
        'td': new Set(['colspan', 'rowspan', 'align', 'valign']),
        'th': new Set(['colspan', 'rowspan', 'align', 'valign', 'scope']),
        'a': new Set(['href', 'title']),
        'img': new Set(['src', 'alt', 'title', 'width', 'height']),
        'col': new Set(['width']),
        'table': new Set(['width', 'border']),
    };

    static emit(node: Node): string {
        if (node.nodeType === Node.TEXT_NODE) {
            return this.escapeHtml(node.textContent || '');
        }

        if (node.nodeType !== Node.ELEMENT_NODE) return '';

        const el = node as HTMLElement;
        const tagName = el.tagName.toLowerCase();

        // Recursively strip macros but keep their children (if any)
        if (tagName.startsWith('ac:') || tagName.startsWith('ri:') ||
            tagName === 'structured-macro' || el.hasAttribute('data-macro-name')) {
            return Array.from(el.childNodes).map(child => this.emit(child)).join('');
        }

        if (!this.ALLOWED_TAGS.has(tagName)) {
            return Array.from(el.childNodes).map(child => this.emit(child)).join('');
        }

        let html = `<${tagName}`;

        const allowedAttrs = this.ALLOWED_ATTRS[tagName];
        if (allowedAttrs) {
            const attrs = Array.from(el.attributes)
                .filter(attr => allowedAttrs.has(attr.name.toLowerCase()))
                .sort((a, b) => a.name.localeCompare(b.name));

            for (const attr of attrs) {
                let value = attr.value;
                if (attr.name.toLowerCase() === 'href' || attr.name.toLowerCase() === 'src') {
                    if (!isSafeHref(value)) continue;
                }
                if (attr.name.toLowerCase() === 'colspan' || attr.name.toLowerCase() === 'rowspan') {
                    const n = parseInt(value, 10);
                    if (isNaN(n) || n < 1) continue;
                    value = Math.min(n, 100).toString();
                }
                html += ` ${attr.name.toLowerCase()}="${this.escapeHtml(value)}"`;
            }
        }

        if (this.isVoidElement(tagName)) {
            html += ' />';
            return html;
        }

        html += '>';
        html += Array.from(el.childNodes).map(child => this.emit(child)).join('');
        html += `</${tagName}>`;
        return html;
    }

    private static isVoidElement(tag: string): boolean {
        return ['br', 'img', 'col', 'hr'].includes(tag);
    }

    private static escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}

export class DiffEngine {
    private logger?: PluginLogger;

    constructor(logger?: PluginLogger) {
        this.logger = logger;
    }

    async compare(
        localMarkdown: string,
        remoteStorageFormat: string,
        pageId: string,
        attachmentLinks?: Map<string, { download: string; version: number }>,
        baseUrl?: string
    ): Promise<DiffResult> {
        this.logger?.info('=== DIFF ENGINE DEBUG START ===');
        const imageRefs: RemoteImageRef[] = [];
        const complexTablePlaceholders = new Map<string, string>();
        const cleanHtml = this.preprocessStorageToCleanHtml(
            remoteStorageFormat,
            imageRefs,
            complexTablePlaceholders,
            pageId,
            attachmentLinks,
            baseUrl
        );
        const remoteMarkdown = this.turndownCleanHtml(cleanHtml, complexTablePlaceholders);

        const normalizedLocal = normalizeMarkdown(localMarkdown);
        const normalizedRemote = normalizeMarkdown(remoteMarkdown);

        const localHasLiteralToken = imageRefs.some(ref => normalizedLocal.includes(ref.token));
        let areIdentical = !localHasLiteralToken && normalizedLocal === normalizedRemote;

        if (!areIdentical && !localHasLiteralToken && imageRefs.length > 0) {
            let localReplaced = normalizedLocal;
            let remoteReplaced = normalizedRemote;

            for (let i = 0; i < imageRefs.length; i++) {
                const ref = imageRefs[i];
                const token = ref.token;
                const uniquePlaceholder = `IMG_PLACEHOLDER_${i}`;

                let identity = '';
                if (ref.kind === 'attachment' && ref.filename) {
                    const meta = attachmentLinks?.get(ref.filename);
                    if (meta) {
                        const download = meta.download;
                        const version = meta.version;
                        identity = (pageId && download)
                            ? (version ? `attachment:${pageId}:${download}:${version}` : `attachment:${pageId}:${download}`)
                            : `attachment:${ref.filename.trim()}`;
                    }
                } else if (ref.kind === 'url' && ref.url) {
                    const resolved = resolveDownloadUrl(baseUrl || '', ref.url);
                    identity = `url:${resolved || ref.url}`;
                }

                if (identity) {
                    const marker = buildImageMarker(identity);
                    const escapedMarker = marker.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
                    const localPattern = new RegExp(
                        `(!\\[[^\\]\\n]*\\]\\([^)\\n]*\\)|!\\[\\[[^\\]\\n]*\\]\\])[ \\t]*${escapedMarker}`,
                        'g'
                    );

                    if (localPattern.test(localReplaced)) {
                        localReplaced = localReplaced.replace(localPattern, uniquePlaceholder);
                        remoteReplaced = remoteReplaced.replace(token, uniquePlaceholder);
                    }
                }
            }
            areIdentical = localReplaced === remoteReplaced;
        }

        return {
            hasConflicts: !areIdentical,
            isIdentical: areIdentical,
            remoteVersion: 0,
            remoteContent: remoteMarkdown,
            localContent: localMarkdown,
            imageRefs
        };
    }

    extractImageRefs(storageFormat: string): RemoteImageRef[] {
        const refs: RemoteImageRef[] = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(storageFormat, 'text/html');
        this.extractImages(doc, refs);
        return refs;
    }

    private preprocessStorageToCleanHtml(
        storageFormat: string,
        imageRefs: RemoteImageRef[],
        complexTablePlaceholders: Map<string, string>,
        pageId?: string,
        attachmentLinks?: Map<string, { download: string; version: number }>,
        baseUrl?: string
    ): string {
        const parser = new DOMParser();
        const doc = parser.parseFromString(storageFormat, 'text/html');

        this.extractImages(doc, imageRefs, pageId, attachmentLinks);

        const create = <K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] => {
            const el = createEl(tag);
            return doc.adoptNode(el);
        };

        // 1. Pre-process Tables
        doc.querySelectorAll('table').forEach(table => {
            if (isSimpleTable(table as HTMLTableElement)) {
                table.querySelectorAll('colgroup, col').forEach(el => el.remove());

                let thead = table.querySelector('thead');
                if (!thead) {
                    const firstRow = table.querySelector('tr');
                    if (firstRow) {
                        thead = create('thead');
                        thead.appendChild(firstRow);
                        firstRow.querySelectorAll('td').forEach(td => {
                            const th = create('th');
                            while (td.firstChild) th.appendChild(td.firstChild);
                            Array.from(td.attributes).forEach(attr => th.setAttribute(attr.name, attr.value));
                            td.parentNode?.replaceChild(th, td);
                        });
                        table.insertBefore(thead, table.firstChild);
                    }
                }

                table.querySelectorAll('td, th').forEach(cell => {
                    // Normalize p/div to content + <br> to keep GFM compatibility
                    const blocks = Array.from(cell.querySelectorAll('p, div'));
                    blocks.forEach((block, idx) => {
                        const fragment = doc.createDocumentFragment();
                        while (block.firstChild) fragment.appendChild(block.firstChild);
                        if (idx < blocks.length - 1) {
                            fragment.appendChild(create('br'));
                        }
                        block.parentNode?.replaceChild(fragment, block);
                    });

                    // Protect pipes in simple cells to keep GFM structure
                    this.escapePipesInNode(cell);
                });
            } else {
                const sanitizedHtml = SafeHtmlEmitter.emit(table);
                // Protect sanitized HTML from Turndown escaping by using a placeholder.
                const placeholder = `%%CFCOMPLEXTABLE-${deterministicHash(sanitizedHtml).slice(0, 12)}%%`;
                complexTablePlaceholders.set(placeholder, sanitizedHtml);
                const fallback = doc.createTextNode(`\n\n${placeholder}\n\n`);
                table.parentNode?.replaceChild(fallback, table);
            }
        });

        // 2. SECURITY: neutralize anchors with dangerous URL schemes (outside tables or in simple ones)
        doc.querySelectorAll('a[href]').forEach(anchor => {
            const href = anchor.getAttribute('href') || '';
            if (!isSafeHref(href)) {
                const text = doc.createTextNode(anchor.textContent || '');
                anchor.parentNode?.replaceChild(text, anchor);
            }
        });

        const headingsToReplace: Array<{ heading: Element, paragraph: Element }> = [];
        doc.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => {
            const strikethroughElements = heading.querySelectorAll('del, s, strike');
            if (strikethroughElements.length > 0) {
                const headingText = heading.textContent?.trim() || '';
                let strikeTextLength = 0;
                strikethroughElements.forEach(strike => {
                    strikeTextLength += (strike.textContent?.trim() || '').length;
                });

                if (strikeTextLength > headingText.length * 0.5) {
                    const p = create('p');
                    while (heading.firstChild) p.appendChild(heading.firstChild);
                    headingsToReplace.push({ heading, paragraph: p });
                }
            }
        });
        headingsToReplace.forEach(({ heading, paragraph }) => {
            heading.parentNode?.replaceChild(paragraph, heading);
        });

        doc.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => {
            const brs = heading.querySelectorAll('br');
            if (brs.length > 0) {
                const level = heading.tagName.toLowerCase() as keyof HTMLElementTagNameMap;
                heading.querySelectorAll('span').forEach(span => {
                    while (span.firstChild) span.parentNode?.insertBefore(span.firstChild, span);
                    span.remove();
                });

                const segments: string[] = [];
                let currentSegment = '';
                heading.childNodes.forEach(node => {
                    if (node.nodeType === Node.TEXT_NODE) {
                        currentSegment += node.textContent || '';
                    } else if (node.nodeType === Node.ELEMENT_NODE) {
                        const el = node as Element;
                        if (el.tagName.toLowerCase() === 'br') {
                            if (currentSegment.trim()) segments.push(currentSegment.trim());
                            currentSegment = '';
                        } else {
                            currentSegment += el.textContent || '';
                        }
                    }
                });
                if (currentSegment.trim()) segments.push(currentSegment.trim());

                if (segments.length > 1) {
                    const fragment = doc.createDocumentFragment();
                    const newHeading = create(level);
                    newHeading.textContent = segments[0];
                    fragment.appendChild(newHeading);

                    const p = create('p');
                    for (let i = 1; i < segments.length; i++) {
                        if (i > 1) p.appendChild(create('br'));
                        p.appendChild(doc.createTextNode(segments[i]));
                    }
                    fragment.appendChild(p);
                    heading.parentNode?.replaceChild(fragment, heading);
                }
            }
        });

        doc.querySelectorAll('li h1, li h2, li h3, li h4, li h5, li h6').forEach(h => {
            const span = create('span');
            while (h.firstChild) span.appendChild(h.firstChild);
            h.parentNode?.replaceChild(span, h);
        });

        doc.querySelectorAll('li').forEach(li => {
            const paragraphs = Array.from(li.querySelectorAll('p'));
            paragraphs.forEach((p, idx) => {
                const fragment = doc.createDocumentFragment();
                while (p.firstChild) fragment.appendChild(p.firstChild);
                if (idx < paragraphs.length - 1) fragment.appendChild(create('br'));
                p.parentNode?.replaceChild(fragment, p);
            });
        });

        doc.querySelectorAll('ul.inline-task-list li, li.checked, li.unchecked').forEach(li => {
            const checkbox = li.classList.contains('checked') ? '[x] ' : '[ ] ';
            const firstText = li.firstChild;
            if (firstText) {
                li.insertBefore(doc.createTextNode(checkbox), firstText);
            }
        });

        doc.querySelectorAll('*').forEach(el => {
            Array.from(el.attributes).forEach(attr => {
                if (attr.name.includes(':')) {
                    const cleanName = attr.name.split(':').pop()!;
                    if (!el.hasAttribute(cleanName)) el.setAttribute(cleanName, attr.value);
                    el.removeAttribute(attr.name);
                }
            });
        });

        return new XMLSerializer()
            .serializeToString(doc.body)
            .replace(/^<body[^>]*>/i, '')
            .replace(/<\/body>$/i, '')
            .replace(/<ac:([\w-]+)/gi, '<$1')
            .replace(/<\/ac:([\w-]+)/gi, '</$1')
            .replace(/<ri:([\w-]+)/gi, '<$1')
            .replace(/<\/ri:([\w-]+)/gi, '</$1');
    }

    private extractImages(
        doc: Document,
        imageRefs: RemoteImageRef[],
        pageId?: string,
        attachmentLinks?: Map<string, { download: string; version: number }>
    ): void {
        const parseWidth = (el: Element): number | undefined => {
            const raw = el.getAttribute('width') ?? el.getAttribute('ac:width');
            if (!raw) return undefined;
            const n = Number.parseInt(raw, 10);
            return Number.isFinite(n) && n > 0 && n <= 10000 ? n : undefined;
        };

        const takeRef = (
            node: Element,
            ref: Omit<RemoteImageRef, 'token'>,
            identity: string
        ): void => {
            const token = buildImageToken(identity, imageRefs.length);
            imageRefs.push({ ...ref, token });
            const placeholder = doc.createTextNode(`\n\n${token}\n\n`);
            node.parentNode?.replaceChild(placeholder, node);
        };

        doc.querySelectorAll('ac\\:image, image').forEach(imageEl => {
            const alt = sanitizeImageText(
                imageEl.getAttribute('ac:alt') ?? imageEl.getAttribute('alt') ?? ''
            );
            const title = sanitizeImageText(
                imageEl.getAttribute('ac:title') ?? imageEl.getAttribute('title') ?? ''
            );
            const width = parseWidth(imageEl);

            const attachment = imageEl.querySelector('ri\\:attachment, attachment');
            const urlEl = imageEl.querySelector('ri\\:url, url');

            if (attachment) {
                const filename = attachment.getAttribute('ri:filename')
                    ?? attachment.getAttribute('filename') ?? '';
                if (filename.trim()) {
                    const meta = attachmentLinks?.get(filename.trim());
                    const version = meta?.version;
                    const download = meta?.download;
                    const identity = (pageId && download)
                        ? (version ? `attachment:${pageId}:${download}:${version}` : `attachment:${pageId}:${download}`)
                        : `attachment:${filename.trim()}`;

                    takeRef(imageEl, {
                        kind: 'attachment',
                        filename: filename.trim(),
                        version,
                        alt, title: title || undefined, width,
                    }, identity);
                    return;
                }
            }
            if (urlEl) {
                const value = urlEl.getAttribute('ri:value')
                    ?? urlEl.getAttribute('value') ?? '';
                if (value.trim() && isSafeHref(value.trim())) {
                    takeRef(imageEl, {
                        kind: 'url',
                        url: value.trim(),
                        alt, title: title || undefined, width,
                    }, `url:${value.trim()}`);
                    return;
                }
            }
            const fallback = doc.createTextNode(alt ? `${alt}` : '');
            imageEl.parentNode?.replaceChild(fallback, imageEl);
        });

        doc.querySelectorAll('img[src]').forEach(img => {
            const src = (img.getAttribute('src') ?? '').trim();
            const alt = sanitizeImageText(img.getAttribute('alt') ?? '');
            const title = sanitizeImageText(img.getAttribute('title') ?? '');
            const width = parseWidth(img);
            if (src && isSafeHref(src)) {
                takeRef(img, {
                    kind: 'url', url: src, alt, title: title || undefined, width,
                }, `img:${src}`);
            } else {
                const fallback = doc.createTextNode(alt ? `${alt}` : '');
                img.parentNode?.replaceChild(fallback, img);
            }
        });
    }

    private buildExpectedFilename(pageId: string, identity: string, originalName: string): string {
        const ext = originalName.split('.').pop()?.toLowerCase() || 'bin';
        const safePageId = pageId.replace(/[^0-9a-zA-Z]/g, '').slice(0, 20) || 'page';
        return `confluence-${safePageId}-${deterministicHash(identity).slice(0, 12)}.${ext}`;
    }

    /**
     * Recursively find all text nodes in a subtree and escape pipes.
     */
    private escapePipesInNode(node: Node): void {
        if (node.nodeType === Node.TEXT_NODE) {
            node.textContent = (node.textContent || '').replace(/\|/g, '%%CFPIPE%%');
        } else {
            Array.from(node.childNodes).forEach(child => this.escapePipesInNode(child));
        }
    }

    private turndownCleanHtml(cleanHtml: string, complexTablePlaceholders?: Map<string, string>): string {
        const turndownService = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced',
            emDelimiter: '*',
            blankReplacement: function (_content: string, _node: Node) {
                return '\n\n';
            }
        });

        turndownService.addRule('paragraph', {
            filter: 'p',
            replacement: function (content: string) {
                return '\n\n' + content + '\n\n';
            }
        });

        turndownService.use(gfm);

        turndownService.addRule('strikethrough', {
            filter: function (node: HTMLElement) {
                return (
                    node.nodeName === 'DEL' ||
                    node.nodeName === 'S' ||
                    node.nodeName === 'STRIKE' ||
                    (node.nodeName === 'SPAN' && hasLineThrough(node))
                );
            },
            replacement: function (content: string) {
                return '~~' + content + '~~';
            }
        });

        turndownService.addRule('confluenceMacros', {
            filter: (node: HTMLElement) => {
                const name = node.nodeName.toUpperCase();
                return name === 'STRUCTURED-MACRO' ||
                    name === 'AC:STRUCTURED-MACRO' ||
                    (node.nodeName === 'DIV' && node.getAttribute('data-macro-name') !== null);
            },
            replacement: (content: string, node: HTMLElement) => {
                const macroName = node.getAttribute('name') || node.getAttribute('ac:name') || node.getAttribute('data-macro-name') || '';
                const titleParam = node.querySelector('parameter[name="title"]')?.textContent || '';

                const macroToCallout: Record<string, string> = {
                    'info': 'info', 'note': 'note', 'tip': 'tip', 'warning': 'warning', 'code': 'code'
                };

                const calloutType = macroToCallout[macroName.toLowerCase()];
                if (calloutType) {
                    const safeTitle = sanitizeCalloutTitle(titleParam);
                    const lines = content.trim().split('\n');
                    const calloutContent = lines.map(line => `> ${line}`).join('\n');
                    return `\n> [!${calloutType}]${safeTitle ? ' ' + safeTitle : ''}\n${calloutContent}\n`;
                }
                return content;
            }
        });

        turndownService.addRule('confluenceTaskList', {
            filter: (node: HTMLElement) => {
                const name = node.nodeName.toUpperCase();
                return name === 'TASK-LIST' || name === 'AC:TASK-LIST';
            },
            replacement: (content: string) => {
                return '\n' + content + '\n';
            }
        });

        turndownService.addRule('confluenceTask', {
            filter: (node: HTMLElement) => {
                const name = node.nodeName.toUpperCase();
                return name === 'TASK' || name === 'AC:TASK';
            },
            replacement: (content: string, node: HTMLElement) => {
                const statusEl = node.querySelector('task-status, ac\\:task-status');
                const status = statusEl?.textContent?.toLowerCase().trim() || '';
                const isComplete = status === 'complete';

                const bodyEl = node.querySelector('task-body, ac\\:task-body');
                const taskText = bodyEl?.textContent?.trim() || content.trim();

                const checkbox = isComplete ? '[x]' : '[ ]';
                return `- ${checkbox} ${taskText}\n`;
            }
        });

        let markdown = turndownService.turndown(cleanHtml);

        markdown = markdown
            .replace(/^\\-/gm, '-')
            .replace(/\\\[/g, '[')
            .replace(/\\]/g, ']');

        // Restore escaped pipes in simple tables
        markdown = markdown.split('%%CFPIPE%%').join('\\|');

        // Restore complex table HTML from placeholders.
        if (complexTablePlaceholders) {
            for (const [placeholder, sanitizedHtml] of complexTablePlaceholders.entries()) {
                markdown = markdown.split(placeholder).join(sanitizedHtml);
            }
        }

        return markdown;
    }
}
