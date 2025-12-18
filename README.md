# Obsidian Confluence Sync Plugin

A plugin that enables users to publish Obsidian notes to Confluence pages with conflict detection and resolution capabilities.

## Features

- **Push notes to Confluence**: Right-click any markdown note to sync it to a Confluence page.
- **Conflict Detection**: Automatically detects if the Confluence page has been modified since your last edit.
- **Visual Conflict Resolution**: detailed diff view to review changes and resolve conflicts (Keep Local, Keep Remote, or Manual Edit).
- **Smart URL Parsing**: Automatically detects Page ID, Space, and Title from various Confluence URL formats.
- **Image Support**: Uploads local images as attachments to Confluence.
- **Markdown Conversion**: Converts your Obsidian markdown (including Callouts!) to Confluence Storage Format.

## Installation

### From Community Plugins
1. Open Obsidian Settings > Community Plugins
2. Turn off "Restricted mode"
3. Click "Browse" and search for "Confluence Sync"
4. Click Install and then Enable

### Manual Installation
1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Create a folder `obsidian-confluence-sync` in your vault's `.obsidian/plugins/` directory.
3. Put the downloaded files in that folder.
4. Reload Obsidian and enable the plugin.

## Setup Guide

1. **Get your API Token**:
   - Go to Confluence.
   - Click your Profile picture -> Settings -> Personal Access Tokens.
   - Create a token and copy it.

2. **Configure Plugin**:
   - Open Obsidian Settings -> Confluence Sync.
   - Enter your **Confluence User Email**.
   - Paste your **API Token**.
   - (Optional) Enter a default Space Key.

3. **Test Connection**:
   - Click "Test Connection" and enter your Confluence Base URL (e.g., `https://mycompany.atlassian.net`) when prompted.

## Usage

1. **Prepare your Note**:
   Add a `confluence-url` property to your note's frontmatter:

   ```yaml
   ---
   confluence-url: https://confluence.example.com/display/SPACEKEY/My+Page+Title
   ---
   ```

2. **Push to Confluence**:
   - Right-click the note in the File Explorer or Editor.
   - Select **Push to Confluence**.
   - Or use the Command Palette: `Confluence Sync: Push current note to Confluence`.

3. **Resolve Conflicts** (if any):
   - If the remote page is different, a conflict window will appear.
   - Review changes and select your resolution (Keep Local is default).
   - Click "Merge & Push".

## Supported Markdown

- Headers, Bold, Italic, Strikethrough
- Lists (Ordered, Unordered, Tasks)
- Tables
- Code Blocks
- Images (Local and Remote)
- Links (External and Wiki-links)
- **Obsidian Callouts** (converted to Confluence Macros like Info, Warning, Note)

## Troubleshooting

- **Authentication Failed**: Check your email and API token.
- **Page Not Found**: Ensure the URL is correct and you have view permissions.
- **Network Error**: Check your internet connection.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for build instructions.
