// Quick test of frontmatter extraction

const content = `---
confluence-url: https://example.com
confluence-version: 14
---

# My Note

Some content here.`;

function extractFrontmatter(content: string): { frontmatter: string; content: string } {
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

const result = extractFrontmatter(content);
console.log('Frontmatter:', result.frontmatter);
console.log('Content:', result.content);
