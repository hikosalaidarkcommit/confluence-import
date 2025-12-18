import { ConfluenceApiClient } from '../api/confluence-client';
import * as path from 'path';
// import { TFile } from 'obsidian'; // Cannot import TFile in non-module context easily without 'obsidian' package which is peer dep.
// But we are in a plugin project.

export class ImageHandler {
    async processImages(
        markdown: string,
        vaultPath: string, // Base path of the vault
        pageId: string,
        apiClient: ConfluenceApiClient,
        readBinaryFile: (path: string) => Promise<ArrayBuffer>
    ): Promise<string> {

        // Find all image references
        // Standard markdown ![alt](src)
        const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
        let processed = markdown;
        // matchAll returns an iterator
        const matches = Array.from(markdown.matchAll(imageRegex));

        // Process in reverse order to avoid index shift issues if we were replacing by index, 
        // but here we use string replacement which is fine if unique or we handle it carefully.
        // Spec uses replace(match[0]) which is risky if same image appears twice.
        // A better approach is async replace or processing tokens.
        // For now, I'll stick to the spec's logic but maybe improve safety?
        // Actually, simple string replace is fine if we assume global replace or careful loop.

        for (const match of matches) {
            const altText = match[1];
            const imagePath = match[2];

            // Skip external URLs
            if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
                const confluenceMacro = this.externalImageMacro(imagePath, altText);
                // Replace ONLY this instance? match[0] is the whole string.
                // String.replace replaces the first occurrence.
                // If we have multiple same images, we might replace the wrong one (already replaced?).
                // If we iterate through matches from matchAll, we should be careful.
                // But if they are identical, the result is identical, so it's fine.
                processed = processed.replace(match[0], confluenceMacro);
                continue;
            }

            // Handle local image
            // In Obsidian, imagePath might be relative or just filename.
            // We should resolve it properly.
            // For now assume it's relative to vault root or absolute?
            // Obsidian internal links `![[image.png]]` are different from `![alt](image.png)`.
            // Spec regex handles `![...](...)`.

            try {
                // Read file
                // We accept a callback to read file because we don't want to couple to 'fs' or Obsidian 'vault' directly here if possible, 
                // or just pass the read function.
                // The spec passed 'vaultPath' but didn't actually use fs in the snippet except 'path.join'.
                // I added 'readBinaryFile' to the signature to be cleaner/testable.

                // resolve path
                // simple join for now
                // const fullPath = path.join(vaultPath, imagePath); 
                // We don't need full path for Obsidian vault.read usually, just the TFile.
                // But 'readBinaryFile' will handle the path string.

                const fileData = await readBinaryFile(imagePath);

                // Upload to Confluence
                const attachment = await apiClient.uploadAttachment(
                    pageId,
                    fileData,
                    path.basename(imagePath)
                );

                // Replace with attachment macro
                const confluenceMacro = this.attachmentImageMacro(
                    attachment.filename,
                    altText
                );
                processed = processed.replace(match[0], confluenceMacro);

            } catch (error) {
                console.error(`Failed to upload image ${imagePath}:`, error);
                // Keep original markdown or show placeholder
            }
        }

        return processed;
    }

    private attachmentImageMacro(filename: string, alt: string): string {
        return `<ac:image${alt ? ` ac:alt="${alt}"` : ''}>
  <ri:attachment ri:filename="${filename}" />
</ac:image>`;
    }

    private externalImageMacro(url: string, alt: string): string {
        return `<ac:image${alt ? ` ac:alt="${alt}"` : ''}>
  <ri:url ri:value="${url}" />
</ac:image>`;
    }
}
