/**
 * Normalizes markdown syntax to ensure consistent comparison between
 * Obsidian markdown and Confluence-converted markdown.
 * 
 * This handles differences like:
 * - List markers: `*` vs `-`
 * - Escaped brackets: `\[` vs `[`
 * - Indentation styles
 * - Line endings
 * - Trailing newlines
 */

/**
 * Normalizes a line of markdown for comparison purposes.
 */
function normalizeLine(line: string): string {
    let normalized = line;

    // 1. Normalize line endings (already split by \n, but trim trailing \r)
    normalized = normalized.replace(/\r$/, '');

    // 2. Normalize list markers: convert `* ` to `- ` at any indentation level
    // Match: optional whitespace + asterisk + space
    normalized = normalized.replace(/^(\s*)\*\s/, '$1- ');

    // 3. Normalize escaped brackets: `\[` -> `[` and `\]` -> `]`
    // These are often escaped in Confluence but not in Obsidian
    normalized = normalized.replace(/\\\[/g, '[');
    normalized = normalized.replace(/\\\]/g, ']');

    // 4. Normalize indentation: convert tabs to 4 spaces
    normalized = normalized.replace(/\t/g, '    ');

    // 5. Normalize multiple spaces in indentation to consistent 2-space increments
    // This handles cases where Confluence uses 4 spaces and Obsidian uses 2
    const match = normalized.match(/^(\s*)/);
    if (match) {
        const indent = match[1];
        const indentLevel = Math.floor(indent.length / 2); // Normalize to 2-space units
        const normalizedIndent = '  '.repeat(indentLevel);
        normalized = normalizedIndent + normalized.trimStart();
    }

    // 6. Normalize trailing whitespace
    normalized = normalized.trimEnd();

    return normalized;
}

/**
 * Normalizes an entire markdown document for comparison.
 */
export function normalizeMarkdown(content: string): string {
    // Normalize line endings first
    let normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Split into lines
    let lines = normalized.split('\n');

    // Remove trailing empty lines (normalize end of file)
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
        lines.pop();
    }

    // Normalize each line
    const normalizedLines = lines.map(normalizeLine);

    return normalizedLines.join('\n');
}

/**
 * Checks if two lines are semantically equivalent after normalization.
 */
export function linesAreEquivalent(line1: string, line2: string): boolean {
    return normalizeLine(line1) === normalizeLine(line2);
}

/**
 * Given original content and normalized diff results, maps back to original line content.
 * This allows us to show the original formatting while only highlighting real differences.
 */
export interface NormalizedDiff {
    originalLocal: string[];
    originalRemote: string[];
    normalizedLocal: string[];
    normalizedRemote: string[];
}

export function prepareNormalizedComparison(localContent: string, remoteContent: string): NormalizedDiff {
    const originalLocal = localContent.split('\n');
    const originalRemote = remoteContent.split('\n');

    return {
        originalLocal,
        originalRemote,
        normalizedLocal: originalLocal.map(normalizeLine),
        normalizedRemote: originalRemote.map(normalizeLine),
    };
}
