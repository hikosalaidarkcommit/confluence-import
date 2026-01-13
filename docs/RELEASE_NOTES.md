# Release Notes - v1.0.7

## Critical Crash Fix for Macro Conversion

This hotfix addresses a crash that occurred when processing certain Confluence macros in the diff view.

### Bug Fixes
- **Fixed `querySelector` Error**: Resolved a "Failed to execute 'querySelector' on 'Element': ... is not a valid selector" error. This was caused by an invalid CSS selector string used when extracting titles from Confluence macros (specifically handling namespaced attributes like `ac:name`). The logic has been simplified to use the normalized attribute names.

---



## Robust Table Support & Conflict Improvements

This release addresses critical issues with table conversion and conflict detection, ensuring a smoother sync experience.

### Key Changes
- **Fixed "Headless" Tables**: Tables from Confluence that lack a distinct header row (thead) are now correctly converted to Markdown tables instead of being stripped to plain text.
- **Smarter Table Diffing**: The diff engine now normalizes table separator rows (e.g., `|---|` vs `|-------|`), preventing false-positive conflicts where the content is identical but the formatting differs slightly.
- **Robust Plugin Loading**: Improved the loading mechanism for the GitHub Flavored Markdown (GFM) plugin to prevent sporadic failures.

---

# Release Notes - v1.0.5

## Enhanced Diff Accuracy & Macro Support

This release improves the conflict resolution experience by making the remote content look more like your local Obsidian notes and refining the diffing logic to ignore minor formatting variations.

### Key Changes
- **Confluence Macro Conversion**: Confluence structured macros (Info, Note, Tip, Warning) are now converted back to Obsidian callouts in the diff view. This makes it much easier to compare your local callouts with remote content.
- **Improved Diff Normalization**: The diffing engine now handles escaped underscores and extra spaces more intelligently, significantly reducing false-positive conflicts.
- **List Normalization**: Improved list conversion to maintain consistent formatting between remote and local versions.

---

# Release Notes - v1.0.4

## Fixed Table Format Loss

This release fixes a critical bug where table formatting was lost when merging content from Confluence.

### Bug Fixes
- **Table Preservation**: Added `turndown-plugin-gfm` to the conversion engine to ensure Confluence tables are correctly converted back to Markdown when merging changes into Obsidian. Previously, table structures were stripped, leaving only plain text.

---

# Release Notes - v1.0.3

## Simplified Conflict Resolution Flow

This release streamlines the conflict resolution process by taking you directly to the full file editor.

### Key Changes
- **Direct Edit Mode**: The "Conflict Detected" landing page has been removed. Clicking "Push to Confluence" now shows the "Edit Whole File" window directly when a conflict is found.
- **Added Cancel Button**: Introduced a "Cancel" button in the diff view to allow users to easily abort the sync process.
- **Cleaned Up UI**: Removed unused navigation and step-by-step resolution components for a cleaner experience.

---

# Release Notes - v1.0.2

## Enhanced Conflict Resolution & Logic Improvements

This release brings significant improvements to the conflict resolution workflow and internal consistency.

### Key Changes
- **New Diff View**: Introduced a more robust file diff view for better comparison of local and remote changes.
- **Improved Conflict Logic**: Added a dedicated confirmation modal for conflict resolutions.
- **Markdown Normalization**: Enhanced internal markdown normalization to reduce false-positive conflicts.
- **Core Improvements**: Refined sync service logic for better reliability.

---

# Release Notes - v1.0.1

## Project Reorganization & Documentation Improvements

This maintenance release focuses on improving the project structure and documentation accessibility.

### Changes
- **Project Structure**: Created `docs/` folder to organize documentation files.
- **Documentation Updates**: Updated internal links across `README.md`, `MIGRATION_GUIDE.md`, and other guides to reflect the new structure.
- **Workflows**: Added `/version-bump` workflow to automate release preparation.
- **Git Config**: Added `/docs` to `.gitignore` to keep the vault root clean (if used as a plugin).

---

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
