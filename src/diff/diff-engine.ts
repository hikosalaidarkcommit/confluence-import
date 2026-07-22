// @ts-ignore
import TurndownService from 'turndown';
// @ts-ignore
import * as TurndownPluginGfm from 'turndown-plugin-gfm';
const gfm = TurndownPluginGfm.gfm || TurndownPluginGfm;
import { DiffResult } from '../models';
import { normalizeMarkdown } from '../utils/markdown-normalizer';
import { PluginLogger } from '../utils/logger';

const CALLOUT_TITLE_MAX_LENGTH = 200;

/**
 * Sanitize a Confluence macro title before embedding it in an Obsidian
 * callout header line (`> [!type] title`).
 *
 * Remote page authors control this string, so it must not be able to break
 * out of the single header line or introduce new Markdown structure:
 * - collapse ALL whitespace (CR/LF/tabs/unicode separators) to single spaces
 * - escape characters that could start new structure or alter the callout
 *   (backslash first, then [ ] ( ) ` # > * _ ~ | ! -)
 * - cap the length to keep pathological titles from flooding the note
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
 *
 * Allowed: http(s), mailto, and scheme-less (relative/anchor/protocol-relative)
 * links. Blocked: javascript/data/vbscript/file/obsidian and any other exotic
 * scheme. Obfuscation via case, leading/embedded whitespace, control chars,
 * or percent-encoding of the scheme separator is normalized before checking.
 */
export function isSafeHref(rawHref: string): boolean {
    if (!rawHref) return true; // empty href → harmless, Turndown drops it

    // Strip control chars and whitespace that browsers ignore inside scheme
    // (e.g. "java\tscript:", " javascript:", "java\nscript:").
    let candidate = rawHref.replace(/[\u0000-\u0020\u007f]/g, '');

    // Percent-decode ONCE to catch "%6Aavascript:" style scheme hiding.
    try {
        candidate = decodeURIComponent(candidate);
        candidate = candidate.replace(/[\u0000-\u0020\u007f]/g, '');
    } catch {
        // Malformed percent-encoding — keep the stripped original.
    }

    const schemeMatch = candidate.match(/^([a-z][a-z0-9+.-]*):/i);
    if (!schemeMatch) return true; // relative URL, #anchor, or //host

    const scheme = schemeMatch[1].toLowerCase();
    if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') return true;
    if (BLOCKED_URL_SCHEMES.has(scheme)) return false;
    // Default-deny every other exotic scheme as well.
    return false;
}

export class DiffEngine {
    private logger?: PluginLogger;

    constructor(logger?: PluginLogger) {
        this.logger = logger;
    }

    /**
     * Compare local and remote content
     */
    async compare(
        localMarkdown: string,
        remoteStorageFormat: string
    ): Promise<DiffResult> {

        // === DEBUG LOGGING ===
        // PRIVACY: only metadata (lengths, counts, timings) is ever logged.
        // Note bodies, remote XHTML/Markdown, and normalized text must never
        // be passed to the logger — not even behind the debug flag.
        this.logger?.info('=== DIFF ENGINE DEBUG START ===');
        this.logger?.info('Diff inputs', {
            remoteStorageLength: remoteStorageFormat.length,
            localMarkdownLength: localMarkdown.length
        });

        // Convert remote Confluence storage format to Markdown
        const convertStart = Date.now();
        const remoteMarkdown = await this.convertStorageToMarkdown(
            remoteStorageFormat
        );

        this.logger?.info('Conversion complete', {
            convertedLength: remoteMarkdown.length,
            durationMs: Date.now() - convertStart
        });

        // Table conversion diagnostics — metadata only.
        if (remoteStorageFormat.includes('<table')) {
            const tableSyntaxFound = remoteMarkdown.includes('|');
            this.logger?.info('[DiffEngine] Table detected in remote storage format', {
                remoteStorageLength: remoteStorageFormat.length,
                tableSyntaxFound
            });
            if (!tableSyntaxFound) {
                this.logger?.warn('[DiffEngine] Table detected but no Markdown table syntax found after conversion');
            }
        }

        // Normalize both contents to avoid false positives (e.g. table formatting, whitespace)
        const normalizedLocal = normalizeMarkdown(localMarkdown);
        const normalizedRemote = normalizeMarkdown(remoteMarkdown);

        this.logger?.info('Normalization complete', {
            normalizedLocalLength: normalizedLocal.length,
            normalizedRemoteLength: normalizedRemote.length
        });

        // Equality after normalization is the single source of truth.
        // NOTE: No per-line diff is computed here. The conflict modal
        // (FileDiffView/computeFileDiff) computes detailed difference blocks
        // lazily only when it opens — running a diff pass here would allocate
        // tens of thousands of per-line objects on large pages with no
        // production consumer (its only historical use was debug logging).
        const areIdentical = normalizedLocal === normalizedRemote;
        this.logger?.info('Comparison Result', {
            areIdentical,
            localLength: normalizedLocal.length,
            remoteLength: normalizedRemote.length
        });

        this.logger?.info('=== DIFF ENGINE DEBUG END ===');

        return {
            hasConflicts: !areIdentical,
            isIdentical: areIdentical,
            remoteVersion: 0, // Set by caller
            // Return ORIGINAL content (not normalized) so that anything the
            // user applies to the local file preserves original formatting.
            // Normalization is only used internally for comparison.
            remoteContent: remoteMarkdown,
            localContent: localMarkdown
        };
    }

    /**
     * Convert Confluence storage format to Markdown.
     *
     * MEMORY: the DOM pre-processing lives in its own method so that the
     * parsed `doc` (a full DOM copy of the page) goes out of scope and is
     * collectable BEFORE Turndown re-parses the cleaned HTML string into its
     * own internal DOM. This avoids holding three full-page representations
     * (pre-processing DOM + cleaned string + Turndown DOM) alive at once on
     * large pages. This is a structural scope fix — not a GC hint.
     */
    private async convertStorageToMarkdown(
        storageFormat: string
    ): Promise<string> {
        const cleanHtml = this.preprocessStorageToCleanHtml(storageFormat);
        return this.turndownCleanHtml(cleanHtml);
    }

    /**
     * Parse Confluence XHTML, apply all DOM pre-processing, and serialize
     * back to a cleaned HTML string. The DOM created here does not escape
     * this method.
     */
    private preprocessStorageToCleanHtml(storageFormat: string): string {
        // Use DOMParser to clean up Confluence XHTML
        // This is much safer than regex for complex structures like tables
        const parser = new DOMParser();
        const doc = parser.parseFromString(storageFormat, 'text/html');

        // 0. SECURITY: neutralize anchors with dangerous URL schemes BEFORE
        // Turndown turns them into clickable Markdown links. Done at the DOM
        // level so obfuscation (case, whitespace, control chars, percent
        // encoding of the scheme) is handled by one decoder, and legitimate
        // parentheses/brackets in URLs are untouched.
        doc.querySelectorAll('a[href]').forEach(anchor => {
            const href = anchor.getAttribute('href') || '';
            if (!isSafeHref(href)) {
                // Keep the visible text, drop the link entirely.
                const text = doc.createTextNode(anchor.textContent || '');
                anchor.parentNode?.replaceChild(text, anchor);
            }
        });

        // 1. Pre-process Tables for Turndown GFM compatibility
        const tables = doc.querySelectorAll('table');
        tables.forEach(table => {
            // Remove colgroup/col which often break Turndown GFM detection
            table.querySelectorAll('colgroup, col').forEach(el => el.remove());

            // GFM tables MUST have a header. If no thead, promote first row.
            let thead = table.querySelector('thead');
            if (!thead) {
                const firstRow = table.querySelector('tr');
                if (firstRow) {
                    thead = doc.createElement('thead');
                    // Promote first row to header
                    thead.appendChild(firstRow);

                    // Convert all 'td' in this new header row to 'th'
                    firstRow.querySelectorAll('td').forEach(td => {
                        const th = doc.createElement('th');
                        // Safely transfer all child nodes from td to th
                        while (td.firstChild) {
                            th.appendChild(td.firstChild);
                        }
                        // Copy attributes if needed, but usually stripped is better
                        Array.from(td.attributes).forEach(attr => th.setAttribute(attr.name, attr.value));
                        td.parentNode?.replaceChild(th, td);
                    });

                    table.insertBefore(thead, table.firstChild);
                }
            }

            // Clean up cells: Markdown tables cannot have multiple blocks inside cells
            table.querySelectorAll('td, th').forEach(cell => {
                // Replace paragraphs and divs with their content (inline it)
                const blocks = cell.querySelectorAll('p, div');
                blocks.forEach(block => {
                    const fragment = doc.createDocumentFragment();
                    while (block.firstChild) fragment.appendChild(block.firstChild);
                    block.parentNode?.replaceChild(fragment, block);
                });
                // Replace breaks with spaces to avoid breaking table row structure
                cell.querySelectorAll('br').forEach(br => {
                    br.parentNode?.replaceChild(doc.createTextNode(' '), br);
                });
            });
        });

        // 2. Pre-process strikethrough in headings
        // Markdown headings cannot contain ~~strikethrough~~, so we need to unwrap them
        const headingsToReplace: Array<{ heading: Element, paragraph: Element }> = [];

        doc.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => {
            const strikethroughElements = heading.querySelectorAll('del, s, strike');
            if (strikethroughElements.length > 0) {
                // Calculate total strikethrough text length
                const headingText = heading.textContent?.trim() || '';
                let strikeTextLength = 0;

                strikethroughElements.forEach(strike => {
                    strikeTextLength += (strike.textContent?.trim() || '').length;
                });

                // If strikethrough is >50% of the heading, convert to paragraph
                if (strikeTextLength > headingText.length * 0.5) {
                    const p = doc.createElement('p');
                    // Safely transfer child nodes
                    while (heading.firstChild) {
                        p.appendChild(heading.firstChild);
                    }
                    headingsToReplace.push({ heading, paragraph: p });
                }
            }
        });

        // Replace headings with paragraphs in a separate step
        headingsToReplace.forEach(({ heading, paragraph }) => {
            heading.parentNode?.replaceChild(paragraph, heading);
        });

        // 3. Pre-process Headings: Confluence often puts multiple paragraphs inside one heading with <br>
        // This is invalid for Markdown. We need to extract text segments separated by <br> properly.
        doc.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => {
            const brs = heading.querySelectorAll('br');
            if (brs.length > 0) {
                const level = heading.tagName.toLowerCase();

                // First, unwrap all nested spans to flatten the structure
                heading.querySelectorAll('span').forEach(span => {
                    while (span.firstChild) {
                        span.parentNode?.insertBefore(span.firstChild, span);
                    }
                    span.remove();
                });

                // Now collect text segments by iterating through child nodes
                const segments: string[] = [];
                let currentSegment = '';

                const processNode = (node: Node) => {
                    if (node.nodeType === Node.TEXT_NODE) {
                        currentSegment += node.textContent || '';
                    } else if (node.nodeType === Node.ELEMENT_NODE) {
                        const el = node as Element;
                        if (el.tagName.toLowerCase() === 'br') {
                            // End current segment, start new one
                            if (currentSegment.trim()) {
                                segments.push(currentSegment.trim());
                            }
                            currentSegment = '';
                        } else {
                            // For other elements (strong, em, etc.), include their text
                            currentSegment += el.textContent || '';
                        }
                    }
                };

                heading.childNodes.forEach(node => processNode(node));
                // Don't forget the last segment
                if (currentSegment.trim()) {
                    segments.push(currentSegment.trim());
                }

                if (segments.length > 1) {
                    const fragment = doc.createDocumentFragment();

                    // First segment stays as heading
                    const newHeading = doc.createElement(level);
                    newHeading.textContent = segments[0];
                    fragment.appendChild(newHeading);

                    // Remaining segments become ONE paragraph with <br> for line breaks
                    // This preserves the Confluence visual layout
                    if (segments.length > 1) {
                        const p = doc.createElement('p');
                        for (let i = 1; i < segments.length; i++) {
                            if (i > 1) {
                                p.appendChild(doc.createElement('br'));
                            }
                            p.appendChild(doc.createTextNode(segments[i]));
                        }
                        fragment.appendChild(p);
                    }

                    heading.parentNode?.replaceChild(fragment, heading);
                }
            }
        });

        // 4. Pre-process List Items: Confluence has unusual HTML structures
        // 4a. FIRST: Convert headings inside list items to spans with bold
        // (Markdown doesn't support h# inside lists - this MUST happen before paragraph unwrap)
        doc.querySelectorAll('li h1, li h2, li h3, li h4, li h5, li h6').forEach(h => {
            // Replace heading with just its content (already has strong inside usually)
            const span = doc.createElement('span');
            // Safely transfer child nodes
            while (h.firstChild) {
                span.appendChild(h.firstChild);
            }
            h.parentNode?.replaceChild(span, h);
        });

        // 4b. Unwrap paragraphs inside list items
        doc.querySelectorAll('li').forEach(li => {
            const paragraphs = li.querySelectorAll('p');
            if (paragraphs.length > 0) {
                paragraphs.forEach((p, idx) => {
                    const fragment = doc.createDocumentFragment();
                    while (p.firstChild) {
                        fragment.appendChild(p.firstChild);
                    }
                    if (idx < paragraphs.length - 1) {
                        fragment.appendChild(doc.createElement('br'));
                    }
                    p.parentNode?.replaceChild(fragment, p);
                });
            }
        });

        // 4c. Handle inline-task-list items (Confluence checklists)
        doc.querySelectorAll('ul.inline-task-list li, li.checked, li.unchecked').forEach(li => {
            const isChecked = li.classList.contains('checked');
            const checkbox = isChecked ? '[x] ' : '[ ] ';

            // Prepend checkbox to the content
            const firstText = li.firstChild;
            if (firstText) {
                const textNode = doc.createTextNode(checkbox);
                li.insertBefore(textNode, firstText);
            }
        });

        // 5. Simplify Confluence namespaces and attributes
        const allElements = doc.querySelectorAll('*');
        allElements.forEach(el => {
            const attrs = Array.from(el.attributes);
            attrs.forEach(attr => {
                if (attr.name.includes(':')) {
                    const cleanName = attr.name.split(':').pop()!;
                    // Update attribute to namespace-less version if not already present
                    if (!el.hasAttribute(cleanName)) {
                        el.setAttribute(cleanName, attr.value);
                    }
                    el.removeAttribute(attr.name);
                }
            });
        });

        // Get cleaned HTML for Turndown
        // We also do a final regex cleanup for tag names that might still have colons in some environments
        return doc.body.innerHTML
            .replace(/<ac:([\w-]+)/gi, '<$1')
            .replace(/<\/ac:([\w-]+)/gi, '</$1')
            .replace(/<ri:([\w-]+)/gi, '<$1')
            .replace(/\u003c\/ri:([\w-]+)/gi, '</$1');
    }

    /**
     * Run Turndown (plus post-processing) on the cleaned HTML string.
     * By the time this runs, the pre-processing DOM is out of scope.
     */
    private turndownCleanHtml(cleanHtml: string): string {
        const turndownService = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced',
            emDelimiter: '*',
            blankReplacement: function (content: string, node: Node) {
                // Ensure blank lines are preserved
                return '\n\n';
            }
        });

        // Custom rule for paragraphs to ensure proper spacing
        turndownService.addRule('paragraph', {
            filter: 'p',
            replacement: function (content: string) {
                return '\n\n' + content + '\n\n';
            }
        });

        // Use GFM plugin for table support
        turndownService.use(gfm);

        // Custom rule for strikethrough (Confluence uses <del>, <s>, <strike> or style="text-decoration: line-through")
        // NOTE: This must come AFTER turndownService.use(gfm) to override its default behavior
        turndownService.addRule('strikethrough', {
            filter: function (node: HTMLElement, options: any) {
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

        // Custom rule to handle Confluence structured macros (panels, info, etc.)
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
                    'info': 'info',
                    'note': 'note',
                    'tip': 'tip',
                    'warning': 'warning',
                    'code': 'code'
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

        // Custom rule for Confluence task lists (checklists)
        turndownService.addRule('confluenceTaskList', {
            filter: (node: HTMLElement) => {
                const name = node.nodeName.toUpperCase();
                return name === 'TASK-LIST' || name === 'AC:TASK-LIST';
            },
            replacement: (content: string) => {
                // The content should already be processed by the task rule below
                return '\n' + content + '\n';
            }
        });

        turndownService.addRule('confluenceTask', {
            filter: (node: HTMLElement) => {
                const name = node.nodeName.toUpperCase();
                return name === 'TASK' || name === 'AC:TASK';
            },
            replacement: (content: string, node: HTMLElement) => {
                // Find task status
                const statusEl = node.querySelector('task-status, ac\\:task-status');
                const status = statusEl?.textContent?.toLowerCase().trim() || '';
                const isComplete = status === 'complete';

                // Find task body
                const bodyEl = node.querySelector('task-body, ac\\:task-body');
                const taskText = bodyEl?.textContent?.trim() || content.trim();

                const checkbox = isComplete ? '[x]' : '[ ]';
                return `- ${checkbox} ${taskText}\n`;
            }
        });

        // The previous tableCellCleanup and tableBreaksCleanup rules are now handled by DOM manipulation
        // in the pre-processing step, so they are no longer needed here.

        let markdown = turndownService.turndown(cleanHtml);

        // Post-processing: Remove a conservative set of backslash escapes that
        // Turndown adds and that cause perpetual diffs. Each removal is limited
        // to contexts where the escape cannot change Markdown semantics:
        //
        //   \- at line-start → only list-marker position; safe to remove
        //      because Obsidian does not treat a bare "-" at the start of a
        //      non-list paragraph as a list item when the line has content.
        //   \[ and \] → always safe: Turndown escapes these even inside code
        //      spans where they are literal characters in both forms.
        //
        // NOT removed globally:
        //   \* — could protect a literal "*" that would otherwise start bold
        //   \# — "# Foo" at line-start would become a heading
        //   \_ — could start italic/bold
        //   Numeric \. — "1\." protects ordered-list markers
        markdown = markdown
            .replace(/^\\-/gm, '-')    // Line-leading escaped hyphen (list-marker artifact)
            .replace(/\\\[/g, '[')     // Escaped opening bracket (safe everywhere)
            .replace(/\\]/g, ']');     // Escaped closing bracket (safe everywhere)

        return markdown;
    }
}
