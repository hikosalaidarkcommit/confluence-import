---
description: Build and deploy plugin to Obsidian vault
---

# Release Workflow

This workflow builds the plugin and deploys it to your Obsidian vault.

## Steps

// turbo-all

1. **Build the plugin**
   ```bash
   npm run build
   ```

2. **Ensure target directory exists**
   ```bash
   mkdir -p /Users/andy/Documents/pl-documentation/.obsidian/plugins/obsidian-auto-post-confluence
   ```

3. **Copy plugin files to vault**
   ```bash
   cp main.js manifest.json styles.css /Users/andy/Documents/pl-documentation/.obsidian/plugins/obsidian-auto-post-confluence/
   ```

4. **Create a zip archive for distribution**
   ```bash
   zip obsidian-auto-post-confluence.zip main.js manifest.json styles.css
   ```

## Notes

- **Target location**: `/Users/andy/Documents/pl-documentation/.obsidian/plugins/obsidian-auto-post-confluence/`
- **Files deployed**: `main.js`, `manifest.json`, `styles.css`
- **Distribution archive**: `obsidian-auto-post-confluence.zip` (for sharing with colleagues)
- **Development mode**: Use `npm run dev` for continuous building during development
- After deployment, manually reload Obsidian or toggle the plugin to see changes
