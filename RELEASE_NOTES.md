# Release Notes - v1.0.0

## Initial Release

We are excited to announce the first release of the **Obsidian Confluence Sync** plugin! This plugin bridges the gap between your personal knowledge base in Obsidian and your team's documentation in Confluence.

### Key Features

*   **Push to Confluence**: Seamlessly publish your Obsidian markdown notes to Confluence pages essentially with a single click.
*   **Conflict Detection**: Intelligent diffing engine detects if the remote Confluence page has been modified since your last sync, preventing accidental overwrites.
*   **Visual Conflict Resolution**: A built-in merge tool allows you to inspect changes side-by-side and choose to keep your local changes, the remote changes, or manually merge them.
*   **On-Premise & Cloud Support**: Fully compatible with both Confluence Cloud (Atlassian) and Confluence Server/Data Center (On-Premise) using API Tokens or Personal Access Tokens.
*   **Image Uploads**: Automatically uploads local images referenced in your notes as attachments to the Confluence page.
*   **Smart Content Conversion**:
    *   Converts **Obsidian Callouts** to native Confluence Info/Note/Warning macros.
    *   Handles Markdown tables, code blocks, and formatting faithfully.
*   **Debug Mode**: deep introspection into the sync process for troubleshooting.

### Configuration

Set up your connection in `Settings > Confluence Sync`:
*   **API Token**: Secure authentication.
*   **Base URL**: Support for custom domains (e.g., `confluence.mycompany.com`).

### Requirements
*   Obsidian v1.0.0+
*   Confluence API Access
