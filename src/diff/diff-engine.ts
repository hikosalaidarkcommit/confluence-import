import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

import { DiffResult, RemoteImageRef } from '../models';
import { normalizeMarkdown } from '../utils/markdown-normalizer';
import { PluginLogger } from '../utils/logger';

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
        const cleanHtml = this.preprocessStorageToCleanHtml(
            remoteStorageFormat,
            imageRefs,
            pageId,
            attachmentLinks,
            baseUrl
        );
        const remoteMarkdown = this.turndownCleanHtml(cleanHtml);

        const normalizedLocal = normalizeMarkdown(localMarkdown);
        const normalizedRemote = normalizeMarkdown(remoteMarkdown);

        // A local note must never contain a literal placeholder token —
        // tokens exist only inside the freshly-converted remote text and are
        // replaced by link+marker pairs on apply. If a user pastes the raw
        // token text it must count as a difference, so raw equality is
        // short-circuited in that case.
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
                    identity = `url:${ref.url}`;
                }

                if (identity) {
                    const marker = buildImageMarker(identity);
                    const escapedMarker = marker.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
                    // Adjacency is strict: the marker must follow the image
                    // link on the SAME line (spaces/tabs only). `\s*` would
                    // let a marker several blank lines away pair with an
                    // unrelated earlier image.
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

    /**
     * Lightweight pre-scan: parse the storage XHTML and collect image refs
     * WITHOUT running the full preprocess/Turndown pipeline. Used by the
     * sync service to learn which attachment filenames the page references
     * so attachment metadata pagination can stop as soon as all of them are
     * resolved. Identity here intentionally omits download/version (metadata
     * is not fetched yet); only `kind`/`filename` are consumed by callers.
     */
    extractImageRefs(storageFormat: string): RemoteImageRef[] {
        const refs: RemoteImageRef[] = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(storageFormat, 'text/html');
        this.extractImages(doc, refs);
        return refs;
    }

    /**
     * Parse raw Confluence storage into a detached document, apply all DOM
     * pre-processing, and serialize back to a string via XMLSerializer
     * (no innerHTML access). Returning a STRING (not the live node) matters
     * for memory: Turndown clones any node input wholesale (cloneNode(true)),
     * which would keep two full DOM trees alive at once on large pages. With
     * a string, the pre-processing document is garbage-collectable before
     * Turndown builds its own tree.
     */
    private preprocessStorageToCleanHtml(
        storageFormat: string,
        imageRefs: RemoteImageRef[],
        pageId?: string,
        attachmentLinks?: Map<string, { download: string; version: number }>,
        baseUrl?: string
    ): string {
        const parser = new DOMParser();
        const doc = parser.parseFromString(storageFormat, 'text/html');

        this.extractImages(doc, imageRefs, pageId, attachmentLinks);

        /**
         * Helper to create nodes using Obsidian's createEl and safely
         * adopting them into our processing document (no direct document
         * element construction).
         */
        const create = <K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] => {
            const el = createEl(tag);
            return doc.adoptNode(el);
        };

        // SECURITY: neutralize anchors with dangerous URL schemes
        doc.querySelectorAll('a[href]').forEach(anchor => {
            const href = anchor.getAttribute('href') || '';
            if (!isSafeHref(href)) {
                const text = doc.createTextNode(anchor.textContent || '');
                anchor.parentNode?.replaceChild(text, anchor);
            }
        });

        // 1. Pre-process Tables
        doc.querySelectorAll('table').forEach(table => {
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
                cell.querySelectorAll('p, div').forEach(block => {
                    const fragment = new DocumentFragment();
                    while (block.firstChild) fragment.appendChild(block.firstChild);
                    block.parentNode?.replaceChild(fragment, block);
                });
                cell.querySelectorAll('br').forEach(br => {
                    br.parentNode?.replaceChild(doc.createTextNode(' '), br);
                });
            });
        });

        // 2. Pre-process strikethrough in headings
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

        // 3. Pre-process Headings with <br>
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
                    const fragment = new DocumentFragment();
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

        // 4. Pre-process List Items
        doc.querySelectorAll('li h1, li h2, li h3, li h4, li h5, li h6').forEach(h => {
            const span = create('span');
            while (h.firstChild) span.appendChild(h.firstChild);
            h.parentNode?.replaceChild(span, h);
        });

        doc.querySelectorAll('li').forEach(li => {
            li.querySelectorAll('p').forEach((p, idx) => {
                const fragment = new DocumentFragment();
                while (p.firstChild) fragment.appendChild(p.firstChild);
                if (idx < li.querySelectorAll('p').length - 1) fragment.appendChild(create('br'));
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

        // 5. Simplify namespaces
        doc.querySelectorAll('*').forEach(el => {
            Array.from(el.attributes).forEach(attr => {
                if (attr.name.includes(':')) {
                    const cleanName = attr.name.split(':').pop()!;
                    if (!el.hasAttribute(cleanName)) el.setAttribute(cleanName, attr.value);
                    el.removeAttribute(attr.name);
                }
            });
        });

        // Serialize WITHOUT innerHTML: XMLSerializer is a standard DOM API.
        // Turndown re-parses this string in its own scope, so the
        // pre-processing document above can be garbage-collected first.
        return new XMLSerializer()
            .serializeToString(doc.body)
            // Unwrap the <body> element and its serializer-added xmlns.
            .replace(/^<body[^>]*>/i, '')
            .replace(/<\/body>$/i, '')
            // Final cleanup for tag names that may keep colon prefixes in
            // some environments.
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

    private turndownCleanHtml(cleanHtml: string): string {
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

        return markdown;
    }
}
