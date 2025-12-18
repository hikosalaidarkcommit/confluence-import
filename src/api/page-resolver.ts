import { ConfluenceApiClient } from './confluence-client';
import { PageResolutionResult, ParsedConfluenceUrl } from '../models';

export class ConfluencePageResolver {
    constructor(private apiClient: ConfluenceApiClient) { }

    /**
     * Resolve page ID from parsed URL
     */
    async resolvePageId(
        parsedUrl: ParsedConfluenceUrl
    ): Promise<PageResolutionResult> {

        // Case 1: Already have page ID (modern or legacy URL)
        if (parsedUrl.pageId) {
            // Verify page exists and get current version
            const pageInfo = await this.apiClient.getPage(parsedUrl.pageId);

            return {
                pageId: parsedUrl.pageId,
                version: pageInfo.version.number,
                title: pageInfo.title,
                spaceKey: pageInfo.space.key
            };
        }

        // Case 2: Need to resolve from display URL
        if (parsedUrl.urlType === 'display') {
            const response = await this.apiClient.searchContent({
                spaceKey: parsedUrl.spaceKey!,
                title: parsedUrl.pageTitle!,
                expand: 'version,space'
            });

            // No results found
            if (response.results.length === 0) {
                throw new Error(
                    `Page not found: "${parsedUrl.pageTitle}" in space ${parsedUrl.spaceKey}.\n` +
                    `Please verify the page exists and you have access to it.`
                );
            }

            // Multiple results found
            let warning: string | undefined;
            if (response.results.length > 1) {
                warning = `Multiple pages found with title "${parsedUrl.pageTitle}". ` +
                    `Using the first match. Consider using a direct page ID URL for accuracy.`;
            }

            const page = response.results[0];
            return {
                pageId: page.id,
                version: page.version.number,
                title: page.title,
                spaceKey: page.space.key,
                warning
            };
        }

        throw new Error('Cannot resolve page ID from URL');
    }
}

interface CachedPageInfo {
    pageId: string;
    version: number;
    timestamp: number;
    spaceKey: string;
    title: string;
}

export class CachedPageResolver extends ConfluencePageResolver {
    private cache: Map<string, CachedPageInfo> = new Map();
    private readonly CACHE_TTL = 3600000; // 1 hour

    /**
     * Generate cache key from URL components
     */
    private getCacheKey(parsed: ParsedConfluenceUrl): string {
        if (parsed.pageId) {
            return `id:${parsed.pageId}`;
        }
        return `title:${parsed.baseUrl}:${parsed.spaceKey}:${parsed.pageTitle}`;
    }

    async resolvePageId(
        parsedUrl: ParsedConfluenceUrl
    ): Promise<PageResolutionResult> {

        const cacheKey = this.getCacheKey(parsedUrl);
        const cached = this.cache.get(cacheKey);

        // Return cached if valid and not expired
        if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
            console.log('Using cached page ID:', cached.pageId);
            return {
                pageId: cached.pageId,
                version: cached.version,
                title: cached.title,
                spaceKey: cached.spaceKey
            };
        }

        // Resolve from API
        const result = await super.resolvePageId(parsedUrl);

        // Cache the result
        this.cache.set(cacheKey, {
            pageId: result.pageId,
            version: result.version,
            timestamp: Date.now(),
            spaceKey: result.spaceKey,
            title: result.title
        });

        return result;
    }

    /**
     * Clear cache for specific page or all pages
     */
    clearCache(pageId?: string): void {
        if (pageId) {
            this.cache.delete(`id:${pageId}`);
        } else {
            this.cache.clear();
        }
    }
}
