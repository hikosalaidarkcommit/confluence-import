
import { normalizeMarkdown, linesAreEquivalent } from '../../src/utils/markdown-normalizer';

describe('Markdown Normalizer', () => {
    describe('normalizeMarkdown', () => {
        test('should normalize line endings', () => {
            const input = 'line1\r\nline2\rline3';
            const expected = 'line1\nline2\nline3';
            expect(normalizeMarkdown(input)).toBe(expected);
        });

        test('should normalize non-breaking spaces', () => {
            const input = 'hello\u00A0world';
            const expected = 'hello world';
            expect(normalizeMarkdown(input)).toBe(expected);
        });

        test('should normalize list markers', () => {
            const input = '* item 1\n  * item 2';
            const expected = '- item 1\n  - item 2';
            expect(normalizeMarkdown(input)).toBe(expected);
        });

        test('should normalize escaped characters', () => {
            const input = '\\[link\\] \\*bold\\* \\:colon\\: \\_underscore\\_';
            const expected = '[link] *bold* :colon: _underscore_';
            expect(normalizeMarkdown(input)).toBe(expected);
        });

        test('should normalize indentation (tabs to spaces)', () => {
            const input = '\titem 1';
            const expected = '    - item 1'; // normalizeLine also fixes list markers if present, but here it's just text? 
            // Wait, normalizeLine replaces \t with 4 spaces.
            // If input is '\titem 1', it becomes '    item 1'.
            expect(normalizeMarkdown('\titem 1')).toBe('    item 1');
        });

        test('should normalize indentation (2-space increments)', () => {
            // normalizeLine logic: indentLevel = Math.floor(indent.length / 2) -> '  '.repeat(indentLevel)
            // 4 spaces -> 2 units -> 4 spaces (no change)
            // 3 spaces -> 1 unit -> 2 spaces
            expect(normalizeMarkdown('   item')).toBe('  item');
        });

        test('should collapse table separators', () => {
            const input = '| --- | :---: |';
            // The regex in normalizeLine: /^\s*\|?[\s\-:|]+\|?\s*$/
            // It collapses -{2,} to ---
            // returns '\| --- \| :---: \|' with spaces normalized?
            // normalizeLine: normalized.replace(/\s*\|\s*/g, ' | ')
            // So '| --- | :---: |' -> '| --- | :---: |'

            const messy = '|-|-|';  // -> ' | - | - | ' -> then dashes?
            // normalizeLine collapses multiple dashes.
            // Let's test specific collapse
            const longDashes = '|-------|';
            expect(normalizeMarkdown(longDashes)).toBe('| --- |');
        });

        test('should normalize multiple spaces', () => {
            const input = 'word1    word2';
            const expected = 'word1 word2';
            expect(normalizeMarkdown(input)).toBe(expected);
        });

        test('should remove trailing whitespace', () => {
            const input = 'line1   ';
            expect(normalizeMarkdown(input)).toBe('line1');
        });
    });

    describe('linesAreEquivalent', () => {
        test('should return true for equivalent lines', () => {
            expect(linesAreEquivalent('* item', '- item')).toBe(true);
            expect(linesAreEquivalent('text\u00A0', 'text ')).toBe(true);
        });

        test('should return false for different lines', () => {
            expect(linesAreEquivalent('item 1', 'item 2')).toBe(false);
        });
    });
});
