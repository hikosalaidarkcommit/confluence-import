import { ConflictBlock, DiffLine } from '../models';

/**
 * Represents a conflict region in the file with markers
 */
export interface ConflictRegion {
    startLine: number;
    endLine: number;
    currentContent: string;  // Local version
    incomingContent: string; // Remote version
    markerStart: number;     // Line number of <<<<<<< marker
    markerMiddle: number;    // Line number of ======= marker
    markerEnd: number;       // Line number of >>>>>>> marker
}

/**
 * Handles insertion and removal of Git-style conflict markers
 */
export class ConflictMarker {
    private readonly MARKER_START = '<<<<<<< Local (Your Version)';
    private readonly MARKER_MIDDLE = '=======';
    private readonly MARKER_END = '>>>>>>> Remote (Confluence)';

    /**
     * Extract frontmatter from content
     * Returns { frontmatter: string, content: string }
     */
    public extractFrontmatter(content: string): { frontmatter: string; content: string } {
        const lines = content.split('\n');

        // Check if content starts with frontmatter (---)
        if (lines[0]?.trim() === '---') {
            // Find the closing ---
            let endIndex = -1;
            for (let i = 1; i < lines.length; i++) {
                if (lines[i].trim() === '---') {
                    endIndex = i;
                    break;
                }
            }

            if (endIndex !== -1) {
                // Extract frontmatter (including delimiters)
                const frontmatter = lines.slice(0, endIndex + 1).join('\n');
                // Extract content after frontmatter
                const contentWithoutFrontmatter = lines.slice(endIndex + 1).join('\n');
                return { frontmatter, content: contentWithoutFrontmatter };
            }
        }

        // No frontmatter found
        return { frontmatter: '', content };
    }

    /**
     * Combine frontmatter and content
     */
    private combineFrontmatterAndContent(frontmatter: string, content: string): string {
        if (frontmatter) {
            return frontmatter + '\n' + content;
        }
        return content;
    }

    /**
     * Insert conflict markers into content (preserving frontmatter)
     */
    insertMarkers(content: string, conflicts: ConflictBlock[]): string {
        // Extract frontmatter first
        const { frontmatter, content: contentWithoutFrontmatter } = this.extractFrontmatter(content);

        const lines = contentWithoutFrontmatter.split('\n');
        const result: string[] = [];
        let currentLine = 0;

        for (const conflict of conflicts) {
            // Add unchanged lines before this conflict
            while (currentLine < conflict.startLine) {
                result.push(lines[currentLine]);
                currentLine++;
            }

            // Add conflict markers
            result.push(this.MARKER_START);

            // Add local (current) content
            const localContent = conflict.localLines
                .map(l => l.content)
                .join('\n');
            result.push(localContent);

            result.push(this.MARKER_MIDDLE);

            // Add remote (incoming) content
            const remoteContent = conflict.remoteLines
                .map(l => l.content)
                .join('\n');
            result.push(remoteContent);

            result.push(this.MARKER_END);

            // Skip the conflicted lines
            currentLine = conflict.endLine + 1;
        }

        // Add remaining unchanged lines
        while (currentLine < lines.length) {
            result.push(lines[currentLine]);
            currentLine++;
        }

        // Combine frontmatter with marked content
        return this.combineFrontmatterAndContent(frontmatter, result.join('\n'));
    }

    /**
     * Detect conflict markers in content
     */
    detectMarkers(content: string): ConflictRegion[] {
        const lines = content.split('\n');
        const regions: ConflictRegion[] = [];
        let i = 0;

        while (i < lines.length) {
            if (lines[i].trim() === this.MARKER_START) {
                const markerStart = i;
                i++;

                // Find middle marker
                const currentLines: string[] = [];
                while (i < lines.length && lines[i].trim() !== this.MARKER_MIDDLE) {
                    currentLines.push(lines[i]);
                    i++;
                }

                if (i >= lines.length) {
                    // Malformed conflict marker
                    break;
                }

                const markerMiddle = i;
                i++;

                // Find end marker
                const incomingLines: string[] = [];
                while (i < lines.length && lines[i].trim() !== this.MARKER_END) {
                    incomingLines.push(lines[i]);
                    i++;
                }

                if (i >= lines.length) {
                    // Malformed conflict marker
                    break;
                }

                const markerEnd = i;

                regions.push({
                    startLine: markerStart,
                    endLine: markerEnd,
                    currentContent: currentLines.join('\n'),
                    incomingContent: incomingLines.join('\n'),
                    markerStart,
                    markerMiddle,
                    markerEnd
                });

                i++;
            } else {
                i++;
            }
        }

        return regions;
    }

    /**
     * Remove conflict markers and apply resolution
     */
    resolveConflict(
        content: string,
        region: ConflictRegion,
        resolution: 'current' | 'incoming' | 'both'
    ): string {
        const lines = content.split('\n');
        const before = lines.slice(0, region.startLine);
        const after = lines.slice(region.endLine + 1);

        let resolvedContent: string;
        switch (resolution) {
            case 'current':
                resolvedContent = region.currentContent;
                break;
            case 'incoming':
                resolvedContent = region.incomingContent;
                break;
            case 'both':
                resolvedContent = region.currentContent + '\n' + region.incomingContent;
                break;
        }

        return [
            ...before,
            resolvedContent,
            ...after
        ].join('\n');
    }

    /**
     * Check if content has any conflict markers (excluding frontmatter)
     */
    hasConflicts(content: string): boolean {
        // Skip frontmatter when checking for conflicts
        const { content: contentWithoutFrontmatter } = this.extractFrontmatter(content);

        return contentWithoutFrontmatter.includes(this.MARKER_START) &&
            contentWithoutFrontmatter.includes(this.MARKER_MIDDLE) &&
            contentWithoutFrontmatter.includes(this.MARKER_END);
    }

    /**
     * Count number of conflicts in content (excluding frontmatter)
     */
    countConflicts(content: string): number {
        // Skip frontmatter when counting conflicts
        const { content: contentWithoutFrontmatter } = this.extractFrontmatter(content);
        return this.detectMarkers(contentWithoutFrontmatter).length;
    }
}
