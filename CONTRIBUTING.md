# Contributing to Confluence Sync

## Development Setup

1. **Prerequisites**:
   - Node.js (v16+)
   - npm
   - Obsidian (for testing)

2. **Clone and Install**:
   ```bash
   git clone https://github.com/yourusername/obsidian-confluence-sync.git
   cd obsidian-confluence-sync
   npm install
   ```

3. **Build**:
   - Development build (watch mode):
     ```bash
     npm run dev
     ```
   - Production build:
     ```bash
     npm run build
     ```

## Project Structure

- `src/main.ts`: Entry point.
- `src/services/`: Core logic for syncing.
- `src/api/`: Confluence API interaction.
- `src/diff/`: Diffing logic.
- `src/converters/`: Markdown <-> Storage Format conversion.
- `src/ui/`: Obsidian Modal implementations.

## Testing

Currently, manual testing in Obsidian is recommended.
1. Enable the plugin in a test Vault.
2. Point the local plugin to your dist folder (or symlink).
3. Use the "Reload plugins" command in Obsidian to refresh changes.

## Release Workflow

1. Update version in `package.json`.
2. Run `npm run version` to update manifest and versions files.
3. Commit and Tag.
4. Build `main.js`.
