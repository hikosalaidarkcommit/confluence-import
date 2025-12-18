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

        // 3. Convert Obsidian callouts
        const withCallouts = this.convertCallouts(withImages);

        // 4. Convert wiki links
        const withLinks = this.convertWikiLinks(withCallouts);

        // 5. Convert markdown to HTML/Storage format
        const storageFormat = await this.markdownToStorage(withLinks);

        return storageFormat;
    }

    private removeFrontmatter(markdown: string): string {
        // Remove YAML frontmatter
        return markdown.replace(/^---\n[\s\S]*?\n---\n/, '');
    }

    private convertCallouts(markdown: string): string {
        const calloutRegex = /> \[!(\w+)\]([^\n]*)\n((?:> [^\n]*\n?)*)/g;

        return markdown.replace(calloutRegex, (match, type, title, content) => {
            const macroType = this.mapCalloutType(type.toLowerCase());
            const cleanContent = content.replace(/^> /gm, '').trim();
            const cleanTitle = title.trim();

            return `<ac:structured-macro ac:name="${macroType}">
  ${cleanTitle ? `<ac:parameter ac:name="title">${cleanTitle}</ac:parameter>` : ''}
  <ac:rich-text-body>
    <p>${cleanContent}</p>
  </ac:rich-text-body>
</ac:structured-macro>`;
        });
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

    private convertWikiLinks(markdown: string): string {
        // Convert [[Page Name]] to Confluence link
        return markdown.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match, page, display) => {
            const linkText = display || page;
            return `<ac:link><ri:page ri:content-title="${page}" /><ac:plain-text-link-body><![CDATA[${linkText}]]></ac:plain-text-link-body></ac:link>`;
        });
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

        marked.setOptions({ renderer });

        return marked.parse(markdown);
    }
}
