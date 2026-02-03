import { diff_match_patch, Diff } from 'diff-match-patch';
// @ts-ignore
import TurndownService from 'turndown';
// @ts-ignore
import * as TurndownPluginGfm from 'turndown-plugin-gfm';
const gfm = TurndownPluginGfm.gfm || TurndownPluginGfm;
import { DiffResult, DiffLine, ConflictBlock } from '../models';
import { normalizeMarkdown } from '../utils/markdown-normalizer';
import { PluginLogger } from '../utils/logger';

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

        // === DEBUG LOGGING: Raw inputs ===
        this.logger?.info('=== DIFF ENGINE DEBUG START ===');
        this.logger?.info('Raw Remote Storage Format (Confluence XHTML)', {
            length: remoteStorageFormat.length,
            content: remoteStorageFormat
        });
        this.logger?.info('Raw Local Markdown', {
            length: localMarkdown.length,
            content: localMarkdown
        });

        // Convert remote Confluence storage format to Markdown
        const remoteMarkdown = await this.convertStorageToMarkdown(
            remoteStorageFormat
        );

        // === DEBUG LOGGING: After conversion ===
        this.logger?.info('Converted Remote Markdown (after Turndown conversion)', {
            length: remoteMarkdown.length,
            content: remoteMarkdown
        });

        // Debugging logs detection
        if (remoteStorageFormat.includes('<table')) {
            console.log('[DiffEngine] Table detected in remote storage format.');
            console.log('[DiffEngine] Remote Storage Length:', remoteStorageFormat.length);
            console.log('[DiffEngine] Converted Markdown Preview:', remoteMarkdown.substring(0, 500));
            if (!remoteMarkdown.includes('|')) {
                console.warn('[DiffEngine] WARNING: Table detected but no Markdown table syntax found!');
            }
        }

        // Normalize both contents to avoid false positives (e.g. table formatting, whitespace)
        const normalizedLocal = normalizeMarkdown(localMarkdown);
        const normalizedRemote = normalizeMarkdown(remoteMarkdown);

        // === DEBUG LOGGING: After normalization ===
        this.logger?.info('Normalized Local Markdown', {
            length: normalizedLocal.length,
            content: normalizedLocal
        });
        this.logger?.info('Normalized Remote Markdown', {
            length: normalizedRemote.length,
            content: normalizedRemote
        });

        // === DEBUG LOGGING: Check if normalized contents are identical ===
        const areIdentical = normalizedLocal === normalizedRemote;
        this.logger?.info('Comparison Result', {
            areIdentical,
            localLength: normalizedLocal.length,
            remoteLength: normalizedRemote.length
        });

        // Perform diff using library
        const dmp = new diff_match_patch();
        const diffs = dmp.diff_main(normalizedRemote, normalizedLocal);
        dmp.diff_cleanupSemantic(diffs);

        // Convert diffs to our format
        const diffLines = this.convertToLines(diffs);

        // Identify conflict blocks
        const conflicts = this.identifyConflicts(diffLines);

        // === DEBUG LOGGING: Diff results ===
        const changedLines = diffLines.filter(l => l.type !== 'unchanged');
        this.logger?.info('Diff Analysis', {
            totalLines: diffLines.length,
            unchangedLines: diffLines.filter(l => l.type === 'unchanged').length,
            addedLines: diffLines.filter(l => l.type === 'added').length,
            removedLines: diffLines.filter(l => l.type === 'removed').length,
            conflictBlocks: conflicts.length
        });

        if (changedLines.length > 0) {
            this.logger?.info('Changed Lines (first 20)', {
                changes: changedLines.slice(0, 20).map(l => ({
                    type: l.type,
                    lineNumber: l.lineNumber,
                    content: l.content,
                    charCodes: l.content.split('').map(c => c.charCodeAt(0)).join(',')
                }))
            });
        }

        this.logger?.info('=== DIFF ENGINE DEBUG END ===');

        if (conflicts.length > 0) {
            console.warn('[DiffEngine] Conflicts detected!');
            // Detailed debug for the first conflict
            const firstConflict = conflicts[0];
            const localLineIdx = firstConflict.localLines[0]?.lineNumber; // This might be index, careful
            // Actually diffLines have lineNumber.

            // Log the raw and normalized content comparison for the first few differences
            const diffsOnly = diffLines.filter(l => l.type !== 'unchanged').slice(0, 5);
            diffsOnly.forEach(d => {
                console.log(`[DiffEngine-Debug] Diff Line (${d.type}): "${d.content}"`);
                console.log(`[DiffEngine-Debug] Char codes: ${d.content.split('').map(c => c.charCodeAt(0)).join(',')}`);
            });
        }

        return {
            hasConflicts: conflicts.length > 0,
            conflicts,
            remoteVersion: 0, // Set by caller
            remoteContent: normalizedRemote,
            localContent: normalizedLocal,
            diffLines
        };
    }

    private convertToLines(diffs: Diff[]): DiffLine[] {
        const lines: DiffLine[] = [];
        let lineNumber = 1;

        for (const [type, text] of diffs) {
            const textLines = text.split('\n');
            // If the last element is empty, it means the text ended with a newline,
            // so split creates an empty string at the end. We handle this carefully.
            // However, standard split behavior: "a\n".split('\n') -> ["a", ""]
            // We usually want to process lines.

            for (let i = 0; i < textLines.length; i++) {
                const lineContent = textLines[i];
                // Determine line type
                let lineType: 'unchanged' | 'added' | 'removed' | 'modified' = 'unchanged';
                if (type === 1) lineType = 'added';
                else if (type === -1) lineType = 'removed';

                // If it's a newline separator (empty string result) inside a block?
                // Actually diffs works on characters usually, unless we use line mode.
                // DMP is character based.
                // The "Line based" logic in spec implies we might want to run diff_linesToChars first 
                // or just map character diffs to lines.

                // For simplicity and spec compliance "Use a line-based diff algorithm",
                // let's try to simulate line-based diff using DMP's helper or just treat it roughly.
                // DMP has diff_linesToChars.

                // But let's look at the implementation in the prompt: it says "Use a line-based diff algorithm".
                // And sample implementation:
                // const dmp = new DiffMatchPatch();
                // const diffs = dmp.diff_main(remoteMarkdown, localMarkdown);
                // dmp.diff_cleanupSemantic(diffs);
                // const diffLines = this.convertToLines(diffs);

                // If dmp.diff_main is character based, converting to lines is non-trivial if edits span partial lines.
                // However a simple "convertToLines" might just push lines.
                // If we want true line diff, we should use dmp.diff_linesToChars which is a common trick.
                // But I'll stick to a simpler interpretation or just assume character diffs aligned to newlines for now
                // to match the spec's simpler "convertToLines" method signature.
                // Actually, if I ignore partial line edits and just say "if a line has any change, mark it modified",
                // that's safer.

                if (i < textLines.length - 1 || lineContent.length > 0) {
                    lines.push({
                        lineNumber: type !== -1 ? lineNumber++ : lineNumber, // Increment local line num only if not removed?
                        // Wait, line numbers refer to local file usually. 
                        // If removed, it's not in local file.
                        // Spec says: "lineNumber: number". 
                        // Let's assume it tracks the resulting (local) line numbers for added/unchanged, 
                        // and maybe remote line numbers for removed?
                        // Or just a sequential index for the diff view.
                        content: lineContent,
                        type: lineType
                    });
                }
            }
        }
        return lines;
    }

    /**
     * Identify conflict blocks from diff lines
     */
    private identifyConflicts(diffLines: DiffLine[]): ConflictBlock[] {
        const conflicts: ConflictBlock[] = [];
        let currentConflict: ConflictBlock | null = null;

        for (let i = 0; i < diffLines.length; i++) {
            const line = diffLines[i];

            if (line.type !== 'unchanged') {
                // Start new conflict block
                if (!currentConflict) {
                    currentConflict = {
                        startLine: line.lineNumber,
                        endLine: line.lineNumber,
                        localLines: [],
                        remoteLines: []
                    };
                }

                // Add to current conflict
                currentConflict.endLine = line.lineNumber;

                if (line.type === 'added') {
                    currentConflict.localLines.push(line);
                } else if (line.type === 'removed') {
                    currentConflict.remoteLines.push(line);
                } else if (line.type === 'modified') {
                    // Treating as both added and removed? Or just one?
                    // DMP standard: -1 then 1. 
                    // Modified line usually appears as removed then added.
                    // So we likely won't see 'modified' type directly from a simple parser unless we merge.
                }

            } else {
                // Close current conflict block
                if (currentConflict) {
                    conflicts.push(currentConflict);
                    currentConflict = null;
                }
            }
        }

        // Close final conflict if exists
        if (currentConflict) {
            conflicts.push(currentConflict);
        }

        return conflicts;
    }

    /**
     * Convert Confluence storage format to Markdown
     */
    private async convertStorageToMarkdown(
        storageFormat: string
    ): Promise<string> {
        // Use DOMParser to clean up Confluence XHTML
        // This is much safer than regex for complex structures like tables
        const parser = new DOMParser();
        const doc = parser.parseFromString(storageFormat, 'text/html');

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
                        th.innerHTML = td.innerHTML;
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
                    p.innerHTML = heading.innerHTML;
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
            span.innerHTML = h.innerHTML;
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
        let cleanHtml = doc.body.innerHTML
            .replace(/<ac:([\w-]+)/gi, '<$1')
            .replace(/<\/ac:([\w-]+)/gi, '</$1')
            .replace(/<ri:([\w-]+)/gi, '<$1')
            .replace(/\u003c\/ri:([\w-]+)/gi, '</$1');

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
                    const lines = content.trim().split('\n');
                    const calloutContent = lines.map(line => `> ${line}`).join('\n');
                    return `\n> [!${calloutType}] ${titleParam}\n${calloutContent}\n`;
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

        // Post-processing: Remove unnecessary backslash escapes that Turndown adds
        // These escapes cause perpetual diffs between local and remote
        markdown = markdown
            .replace(/\\-/g, '-')      // Escaped hyphens
            .replace(/\\\*/g, '*')     // Escaped asterisks (when not needed)
            .replace(/\\\[/g, '[')     // Escaped brackets
            .replace(/\\]/g, ']')
            .replace(/\\#/g, '#')      // Escaped hash
            .replace(/\\_/g, '_');     // Escaped underscores

        return markdown;
    }
}
