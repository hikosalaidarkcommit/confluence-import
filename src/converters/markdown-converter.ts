// @ts-ignore
import { marked } from 'marked';
import { ConfluenceApiClient } from '../api/confluence-client';
import { ImageHandler } from './image-handler';

export class MarkdownToConfluenceConverter {
    private imageHandler: ImageHandler;

    constructor(
        private vaultPath: string,
        private apiClient: ConfluenceApiClient,
        private readBinaryFile: (path: string) => Promise<ArrayBuffer>
    ) {
        this.imageHandler = new ImageHandler();
    }

    async convert(markdown: string, pageId: string): Promise<string> {
        // 1. Process frontmatter (remove it)
        const withoutFrontmatter = this.removeFrontmatter(markdown);

        // 2. Process images (upload and convert)
        const withImages = await this.imageHandler.processImages(
            withoutFrontmatter,
            this.vaultPath,
            pageId,
            this.apiClient,
            this.readBinaryFile
        );

        // 3. Convert Obsidian callouts to placeholders (will be restored after marked)
        const { content: withCalloutPlaceholders, callouts } = this.extractCallouts(withImages);

        // 4. Convert wiki links to placeholders (will be restored after marked)
        const { content: withLinkPlaceholders, links } = this.extractWikiLinks(withCalloutPlaceholders);

        // 5. Extract task lists before marked processing (they will be converted to Confluence format after)
        const { content: withTaskPlaceholders, taskLists } = this.extractTaskLists(withLinkPlaceholders);

        // 6. Convert remaining markdown to HTML/Storage format using marked
        let storageFormat = await this.markdownToStorage(withTaskPlaceholders);

        // 7. Restore callouts as Confluence macros
        storageFormat = this.restoreCallouts(storageFormat, callouts);

        // 8. Restore wiki links as Confluence links
        storageFormat = this.restoreWikiLinks(storageFormat, links);

        // 9. Restore task lists as Confluence task list format
        storageFormat = this.restoreTaskLists(storageFormat, taskLists);

        return storageFormat;
    }

    // ========== Extraction methods (before marked) ==========

    private extractTaskLists(markdown: string): { content: string; taskLists: string[] } {
        const lines = markdown.split('\n');
        const result: string[] = [];
        const taskLists: string[] = [];
        let currentTaskBlock: string[] = [];
        let inTaskList = false;
        let placeholderIndex = 0;
        let taskId = 1;

        for (const line of lines) {
            const checkedMatch = line.match(/^(\s*)-\s*\[x\]\s*(.*)$/i);
            const uncheckedMatch = line.match(/^(\s*)-\s*\[\s*\]\s*(.*)$/);

            if (checkedMatch || uncheckedMatch) {
                if (!inTaskList) {
                    inTaskList = true;
                    currentTaskBlock = ['<ac:task-list>'];
                }
                const isChecked = !!checkedMatch;
                const text = this.escapeXml(checkedMatch ? checkedMatch[2] : uncheckedMatch![2]);
                const status = isChecked ? 'complete' : 'incomplete';

                currentTaskBlock.push(`<ac:task>
<ac:task-id>${taskId++}</ac:task-id>
<ac:task-status>${status}</ac:task-status>
<ac:task-body>${text}</ac:task-body>
</ac:task>`);
            } else {
                if (inTaskList) {
                    currentTaskBlock.push('</ac:task-list>');
                    taskLists.push(currentTaskBlock.join('\n'));
                    result.push(`%%TASK_LIST_${placeholderIndex++}%%`);
                    currentTaskBlock = [];
                    inTaskList = false;
                }
                result.push(line);
            }
        }

        if (inTaskList) {
            currentTaskBlock.push('</ac:task-list>');
            taskLists.push(currentTaskBlock.join('\n'));
            result.push(`%%TASK_LIST_${placeholderIndex}%%`);
        }

        return { content: result.join('\n'), taskLists };
    }

    private extractCallouts(markdown: string): { content: string; callouts: string[] } {
        const callouts: string[] = [];
        let placeholderIndex = 0;

        const calloutRegex = /> \[!(\w+)\]([^\n]*)\n((?:> [^\n]*\n?)*)/g;

        const content = markdown.replace(calloutRegex, (match, type, title, contentText) => {
            const macroType = this.mapCalloutType(type.toLowerCase());
            const cleanContent = contentText.replace(/^> /gm, '').trim();
            const cleanTitle = title.trim();

            const confluenceMacro = `<ac:structured-macro ac:name="${macroType}">
  ${cleanTitle ? `<ac:parameter ac:name="title">${this.escapeXml(cleanTitle)}</ac:parameter>` : ''}
  <ac:rich-text-body>
    <p>${this.escapeXml(cleanContent)}</p>
  </ac:rich-text-body>
</ac:structured-macro>`;

            callouts.push(confluenceMacro);
            return `%%CALLOUT_${placeholderIndex++}%%`;
        });

        return { content, callouts };
    }

    private extractWikiLinks(markdown: string): { content: string; links: string[] } {
        const links: string[] = [];
        let placeholderIndex = 0;

        const content = markdown.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match, page, display) => {
            const linkText = display || page;
            const confluenceLink = `<ac:link><ri:page ri:content-title="${this.escapeXml(page)}" /><ac:plain-text-link-body><![CDATA[${linkText}]]></ac:plain-text-link-body></ac:link>`;
            links.push(confluenceLink);
            return `%%WIKI_LINK_${placeholderIndex++}%%`;
        });

        return { content, links };
    }

    // ========== Restoration methods (after marked) ==========

    private restoreTaskLists(html: string, taskLists: string[]): string {
        let result = html;
        for (let i = 0; i < taskLists.length; i++) {
            // The placeholder might be wrapped in <p> tags by marked
            result = result.replace(new RegExp(`<p>%%TASK_LIST_${i}%%</p>`, 'g'), taskLists[i]);
            result = result.replace(new RegExp(`%%TASK_LIST_${i}%%`, 'g'), taskLists[i]);
        }
        return result;
    }

    private restoreCallouts(html: string, callouts: string[]): string {
        let result = html;
        for (let i = 0; i < callouts.length; i++) {
            result = result.replace(new RegExp(`<p>%%CALLOUT_${i}%%</p>`, 'g'), callouts[i]);
            result = result.replace(new RegExp(`%%CALLOUT_${i}%%`, 'g'), callouts[i]);
        }
        return result;
    }

    private restoreWikiLinks(html: string, links: string[]): string {
        let result = html;
        for (let i = 0; i < links.length; i++) {
            result = result.replace(new RegExp(`%%WIKI_LINK_${i}%%`, 'g'), links[i]);
        }
        return result;
    }

    // ========== Helper methods ==========

    private escapeXml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    private mapCalloutType(type: string): string {
        const mapping: Record<string, string> = {
            'note': 'note',
            'info': 'info',
            'tip': 'tip',
            'warning': 'warning',
            'danger': 'warning',
            'error': 'warning',
            'quote': 'info',
            'todo': 'info'
        };
        return mapping[type] || 'info';
    }

    private removeFrontmatter(markdown: string): string {
        // Remove YAML frontmatter
        return markdown.replace(/^---\n[\s\S]*?\n---\n/, '');
    }

    private async markdownToStorage(markdown: string): Promise<string> {
        const renderer = new marked.Renderer();

        // Custom code block renderer
        renderer.code = (code: string, language: string | undefined) => {
            return `<ac:structured-macro ac:name="code">
  <ac:parameter ac:name="language">${language || 'text'}</ac:parameter>
  <ac:plain-text-body><![CDATA[${code}]]></ac:plain-text-body>
</ac:structured-macro>`;
        };

        // Custom table renderer
        renderer.table = (header: string, body: string) => {
            return `<table><tbody>${header}${body}</tbody></table>`;
        };

        marked.setOptions({
            renderer,
            breaks: true, // Convert single newlines to <br>
            gfm: true,     // Ensure GFM is enabled
            xhtml: true    // Ensure self-closing tags for XML/Confluence compliance
        });

        return marked.parse(markdown);
    }
}
