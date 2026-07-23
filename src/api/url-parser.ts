import { ParsedConfluenceUrl } from '../models';

export class ConfluenceUrlParser {
    /**
     * Parse a Confluence URL and extract relevant components
     * @param url - Confluence page URL
     * @returns Parsed URL components
     * @throws Error if URL format is invalid
     */
    parse(url: string): ParsedConfluenceUrl {
        try {
            const urlObj = new URL(url);
            const baseUrl = `${urlObj.protocol}//${urlObj.host}`;

            // Type 1: Modern URL with page ID
            // Pattern: /wiki/spaces/{spaceKey}/pages/{pageId}/{pageTitle}
            const modernMatch = url.match(new RegExp('/wiki/spaces/([^/]+)/pages/(\\d+)'));
            if (modernMatch) {
                return {
                    baseUrl,
                    spaceKey: modernMatch[1],
                    pageId: modernMatch[2],
                    urlType: 'modern'
                };
            }

            // Type 2: Legacy URL with pageId parameter
            // Pattern: /pages/viewpage.action?pageId={pageId}
            const legacyMatch = url.match(new RegExp('pageId=(\\d+)'));
            if (legacyMatch) {
                return {
                    baseUrl,
                    pageId: legacyMatch[1],
                    urlType: 'legacy'
                };
            }

            // Type 3: Display URL (needs resolution)
            // Pattern: /display/{spaceKey}/{pageTitle}
            const displayMatch = url.match(new RegExp('/display/([^/]+)/(.+?)(?:\\?|$)'));
            if (displayMatch) {
                const rawTitle = displayMatch[2];
                // Decode URL-encoded title and replace + with spaces
                const decodedTitle = decodeURIComponent(rawTitle.replace(/\+/g, ' '));

                return {
                    baseUrl,
                    spaceKey: displayMatch[1],
                    pageTitle: decodedTitle,
                    urlType: 'display'
                };
            }

            throw new Error('URL does not match any known Confluence URL pattern');

        } catch (error) {
            if (error instanceof TypeError) {
                throw new Error('Invalid URL format');
            }
            throw error;
        }
    }

    /**
     * Validate if a string is a valid Confluence URL
     */
    isValidConfluenceUrl(url: string): boolean {
        try {
            this.parse(url);
            return true;
        } catch {
            return false;
        }
    }
}
