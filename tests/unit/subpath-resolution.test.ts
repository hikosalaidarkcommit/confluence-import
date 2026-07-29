/**
 * @jest-environment jsdom
 * 
 * Test for context-path (subpath) resolution in ImageImporter.
 */
import { resolveDownloadUrl } from '../../src/utils/url-utils';

describe('Context Path Resolution', () => {
    test('resolveDownloadUrl handles base URLs with subpaths correctly', () => {
        const BASE_WITH_PATH = 'https://confluence.acme.com/wiki';
        
        // If Confluence returns a path starting with /, it's usually absolute from root.
        // E.g., /wiki/download/attachments/...
        expect(resolveDownloadUrl(BASE_WITH_PATH, '/wiki/download/img.png'))
            .toBe('https://confluence.acme.com/wiki/download/img.png');

        // If Confluence returns a relative path (unlikely for _links.download), 
        // URL resolution depends on trailing slash in base.
        // ConfluenceSyncPluginInterface removes trailing slash in settings.
        
        // POTENTIAL FAIL: if Confluence returns a path WITHOUT the context path but starting with /
        // This would be a Confluence configuration issue or a bug in our assumption.
        // But let's see if we can resolve a truly relative one.
        expect(resolveDownloadUrl(BASE_WITH_PATH + '/', 'download/img.png'))
            .toBe('https://confluence.acme.com/wiki/download/img.png');
    });
});
