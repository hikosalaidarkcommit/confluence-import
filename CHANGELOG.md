# Changelog

All notable changes to this project will be documented in this file.

## [1.0.4] - 2026-01-13
### Fixed
- Table structure loss when merging changes from Confluence to Obsidian.

## [1.0.3] - 2026-01-13
### Added
- "Cancel" button in the diff view to abort sync.
### Changed
- Simplified conflict resolution flow to open "Edit Whole File" directly.
- Removed unused step-by-step conflict resolution UI and legacy code.

## [1.0.2] - 2026-01-13
### Added
- Dedicated `FileDiffView` for clearer conflict inspection.
- `ConflictConfirmModal` for safer resolution confirmation.
- `MarkdownNormalizer` utility for improved content comparison.
### Changed
- Refactored `SyncService` for better error handling and state management.
- Improved styling for conflict resolution UI.

## [1.0.1] - 2026-01-13
### Changed
- Moved documentation files to `docs/` folder for better organization.
- Updated internal documentation links.
- Initialized official CHANGELOG.md.
- Added `/version-bump` workflow for automated releases.

## [1.0.0] - 2026-01-12
### Added
- Initial release with Push to Confluence support.
- Conflict detection and visual resolution tool.
- Support for Confluence Cloud and Server/Data Center.
- Image upload support.
- Conversion for Obsidian Callouts to Confluence macros.
