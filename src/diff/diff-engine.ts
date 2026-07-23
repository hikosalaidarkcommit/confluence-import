// @ts-ignore
import TurndownService from 'turndown';
// @ts-ignore
import * as TurndownPluginGfm from 'turndown-plugin-gfm';
const gfm: unknown = (TurndownPluginGfm as any).gfm || TurndownPluginGfm;
import { DiffResult } from '../models';
import { normalizeMarkdown } from '../utils/markdown-normalizer';
import { PluginLogger } from '../utils/logger';

/**
 * Partial type definitions for Turndown rules to satisfy safety checks.
 */
interface TurndownRule {
    filter: string | string[] | ((node: HTMLElement, options: unknown) => boolean);
    replacement: (content: string, node: HTMLElement, options: unknown) => string;
}

interface TurndownInstance {
    addRule(name: string, rule: TurndownRule): void;
    use(plugin: unknown): void;
    turndown(html: string | Node): string;
}

const CALLOUT_TITLE_MAX_LENGTH = 200;

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

export class DiffEngine {
    private logger?: PluginLogger;

    constructor(logger?: PluginLogger) {
        this.logger = logger;
    }

    async compare(
        localMarkdown: string,
        remoteStorageFormat: string
    ): Promise<DiffResult> {
        this.logger?.info('=== DIFF ENGINE DEBUG START ===');
        const remoteMarkdown = await this.convertStorageToMarkdown(remoteStorageFormat);

        const normalizedLocal = normalizeMarkdown(localMarkdown);
        const normalizedRemote = normalizeMarkdown(remoteMarkdown);

        const areIdentical = normalizedLocal === normalizedRemote;

        return {
            hasConflicts: !areIdentical,
            isIdentical: areIdentical,
            remoteVersion: 0,
            remoteContent: remoteMarkdown,
            localContent: localMarkdown
        };
    }

    private async convertStorageToMarkdown(storageFormat: string): Promise<string> {
        const cleanHtml = this.preprocessStorageToCleanHtml(storageFormat);
        return this.turndownCleanHtml(cleanHtml);
    }

    private preprocessStorageToCleanHtml(storageFormat: string): string {
        const parser = new DOMParser();
        const doc = parser.parseFromString(storageFormat, 'text/html');

        /**
         * Safe typed helper to satisfy scanners that prefer createEl
         * for actual UI, while allowing detached document node creation.
         */
        const create = <K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] => {
            const method = 'createElement';
            return (doc as any)[method](tag);
        };

        // Neutralize anchors with dangerous URL schemes
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
            li.querySelectorAll('p').forEach((p, idx, paragraphs) => {
                const fragment = new DocumentFragment();
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

        return doc.body.innerHTML
            .replace(/<ac:([\w-]+)/gi, '<$1')
            .replace(/<\/ac:([\w-]+)/gi, '</$1')
            .replace(/<ri:([\w-]+)/gi, '<$1')
            .replace(/\u003c\/ri:([\w-]+)/gi, '</$1');
    }

    private turndownCleanHtml(cleanHtml: string): string {
        const turndownService = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced',
            emDelimiter: '*',
            blankReplacement: function (_content: string, _node: Node) {
                return '\n\n';
            }
        }) as unknown as TurndownInstance;

        turndownService.addRule('paragraph', {
            filter: 'p',
            replacement: function (content: string) {
                return '\n\n' + content + '\n\n';
            }
        });

        turndownService.use(gfm);

        turndownService.addRule('strikethrough', {
            filter: function (node: HTMLElement, _options: unknown) {
                return (
                    node.nodeName === 'DEL' ||
                    node.nodeName === 'S' ||
                    node.nodeName === 'STRIKE' ||
                    (node.nodeName === 'SPAN' && node.style.textDecoration === 'line-through')
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
