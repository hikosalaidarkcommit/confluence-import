# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]
### Added (documentation & discovery — no runtime change)
- Documentation index (`docs/INDEX.md`) separating current docs from the historical design archive, plus contributor content rules (factual claims only; forbidden-claim list; verified external links only).
- Current-facing `docs/FAQ.md`, `docs/TROUBLESHOOTING.md`, and an objective `docs/COMPARISON.md` comparing workflow categories (manual import with diff preview vs copy/paste vs export/conversion pipelines vs publishing tools) without naming competitors.
- Root `llms.txt`: plain factual capability/non-capability summary with canonical repository links (no structured-data tricks, crawler directives, or invented statistics).
- `docs/GEO_EVALUATION.md`: 15 natural-language evaluation prompts and a monthly citation-accuracy scorecard against a canonical fact list (no baseline claimed).
- `package.json` keywords (obsidian-plugin, confluence, markdown, knowledge-management, one-way-import, diff-preview, atlassian, documentation, import, notes) and homepage; version/description/dependencies unchanged.
- Docs integrity test suite: relative-link checker, forbidden-claim checker, llms.txt discipline (plain text, canonical URLs), and a manifest-untouched lock.
### Changed (documentation)
- README opens with a first-200-words summary answering what the plugin is, who it serves, direction (Confluence → local note), manual/one-way/no-write guarantees, the diff preview, and the no-external-Pandoc/CLI fact; adds a factual "Who is this for?" section and a Documentation section linking FAQ/Troubleshooting/Comparison/Index.
- The pre-1.0.8 push-removal notice moved from the top of the README into a "Version History Notes" section (historical context, unchanged facts).
- Setup guide links the official Atlassian API-token documentation and Obsidian's community-plugins help page (both verified).

## [1.0.16] - 2026-07-23
### Fixed
- **Narrow frontmatter values safely**: Fixed a community-review warning (`@typescript-eslint/no-unsafe-assignment`) by explicitly typing indexed reads from Obsidian's `FrontMatterCache` as `unknown` before runtime validation. This ensures honest type safety when retrieving the `confluence-url` property from notes.

## [1.0.15] - 2026-07-23
### Changed
- Settings tab fully migrated to the declarative settings API: the deprecated `display()` override is removed. All six settings render from `getSettingDefinitions()` (grouped under Connection and Diagnostics), with the API token as a masked password input and Test Connection as an action row. Text values persist via the existing 400 ms debounce; toggles save immediately. A new command **"Test Confluence connection"** mirrors the settings action.
- Community-review type-safety cleanup: proper module declarations for `turndown`/`turndown-plugin-gfm` (no `@ts-ignore`, no casts), typed request options in the Confluence client (no `RequestInit` casts), `structuredPatch` typed via `@types/diff` directly, and removal of unnecessary type assertions in the sync service and logger. TypeScript target/lib raised to ES2020 (matching Obsidian 1.13's Electron), making `trimStart`/`trimEnd` fully typed; esbuild output target aligned to ES2020.
- Stored settings are now validated at runtime when loaded (`loadData()` is untyped): only correctly-typed fields merge over defaults; invalid or unknown fields fall back safely and are never logged.
- Diff preview uses `createDiv`/`createSpan` helpers instead of `createEl('div'/'span')`.

## [1.0.14] - 2026-07-23
### Added
- Declarative settings via `PluginSettingTab.getSettingDefinitions()` (Obsidian 1.13+): all six settings (Base URL, user email, API token, default space key, debug logging, page ID cache) are now discoverable through Obsidian's settings search. The rendered settings UI (including debounced saves and Test Connection) is unchanged.
### Changed
- **Minimum Obsidian version raised to 1.13.0** (required by the declarative settings API). Historical `versions.json` mappings are preserved — 1.0.13 and earlier still map to their original minimum versions.
- Debug logger rewritten to use Obsidian's public `DataAdapter` API (`exists`/`stat`/`mkdir`/`append`/`rename`/`remove`) with vault-relative paths via `normalizePath` — no more Node `fs`/`path` access, eliminating the "Direct Filesystem Access" review warning. All I/O stays inside the vault (the plugin's own config folder). Queue ordering, 1 MB rotation to `debug.log.1`, single-failure reporting, and unload flush/close are preserved; `sanitizeLogData` is now fully typed over `unknown` with cycle/getter-exception guards.
- Removed the `builtin-modules` dev dependency (flagged by plugin review); the esbuild config no longer marks Node builtins as externals since the bundle contains none.
- Storage pre-processing hardened for review compliance: detached-DOM node creation goes through Obsidian's `createEl` (adopted into the processing document), strikethrough detection reads the `style` attribute instead of the live `.style` object, and serialization uses `XMLSerializer` instead of `innerHTML` — while keeping the memory-friendly string hand-off to the Markdown converter.
- Turndown and its GFM plugin are now typed through honest local declarations (no `any` casts) across the conversion pipeline.

## [1.0.13] - 2026-07-23
### Fixed
- **Obsidian Community Plugin review fixes**:
  - Renamed the "Advanced options" settings section heading to "Diagnostics" to eliminate the redundant word "options" in the settings context.
- Version bumped to 1.0.13.

## [1.0.12] - 2026-07-23
### Fixed
- **Obsidian Community Plugin review fixes**:
  - Replaced redundant/prohibited settings section headings ("Confluence Page Import Settings", "Advanced Options") with neutral functional labels ("Connection", "Advanced options") using `Setting.setHeading()`.
- Version bumped to 1.0.12.

## [1.0.11] - 2026-07-23
### Fixed
- **Obsidian Community Plugin review fixes**:
  - Eliminated all unsafe `.innerHTML =` assignments in `DiffEngine` by using safe DOM APIs (manual node transfers).
  - Replaced direct HTML heading creation (`createEl('h2/h3', ...)`) in settings with the recommended Obsidian Setting `.setHeading()` pattern.
  - Replaced inline element style assignments in the conflict modal with semantic CSS classes in `styles/styles.css`.
  - Fixed multiple warnings: replaced `setTimeout` with `window.setTimeout` and refined `any` types to `unknown` for better type safety.
- Version bumped to 1.0.11.

## [1.0.10] - 2026-07-23
### Fixed
- **Comply with Community Plugin review**: Removed prohibited word "Obsidian" from the manifest description.
- Version bumped to 1.0.10.
### Added
- **Artifact Attestation workflow**: Configured GitHub Actions to generate build provenance attestations for release artifacts (`main.js`, `manifest.json`, `styles.css`) using the official `actions/attest-build-provenance`.

## [1.0.9] - 2026-07-22
### Changed
- **Plugin renamed to "Confluence Page Import"**: the previous name "Confluence Import" collided with an existing plugin in the Obsidian Community Plugins directory. The unique ID `confluence-import` remains unchanged. All UI labels, command prefixes, and documentation updated to the new display name.
- Version bumped to 1.0.9 to reflect the manifest identity change.

## [1.0.8] - 2026-07-22
### Changed (plugin identity — BREAKING for pre-release installs)
- Plugin rebranded for Obsidian Community Plugin submission: id `obsidian-confluence-sync` → **`confluence-import`** (new ids may not contain "obsidian"; `confluence-sync` is already taken), name `Confluence Sync` → **`Confluence Import`**. Manifest description rewritten action-first. Package name and release artifact renamed accordingly (`confluence-import-1.0.8.zip`); installation folder is now `.obsidian/plugins/confluence-import`.
- Command id `push-to-confluence` (a legacy compatibility string) replaced by **`import-from-confluence`** with display name "Import current note from Confluence". Since the plugin has never been published under the new identity, no hotkey migration is needed; users of pre-release builds must rebind hotkeys once.
- All UI surfaces (ribbon, context menus, settings heading, notices, logger tag) now use Import terminology. Behavior is unchanged: strict one-way pull, read-only preview, no remote writes.
### Changed (repository metadata)
- Repository metadata migrated to the final canonical location `hikosalaidarkcommit/confluence-import`: `package.json` author/repository, `manifest.json` author/authorUrl, SECURITY.md advisory link, and all active documentation links (README, CONTRIBUTING, MIGRATION_GUIDE) now point to the new repository. Historical references to prior repository names in past changelog entries are retained as plain text. (Metadata/documentation change only — no code, version, or publish action.)
### Added (supply chain & release integrity)
- Minimal-permission CI workflow (`.github/workflows/ci.yml`): locked install, blocking `npm audit --omit=dev`, tests, build, deterministic package + release verification, and SBOM generation on every push/PR; large-page memory gate runs as a separate advisory job (thresholds are machine-calibrated).
- Dependabot configuration for weekly npm and GitHub Actions dependency updates.
- `THIRD_PARTY_NOTICES.md` with license texts of all bundled runtime dependencies (`diff` BSD-3-Clause, `turndown`/`turndown-plugin-gfm` MIT). Kept in the repository because Obsidian release zips may only contain `main.js`/`manifest.json`/`styles.css`.
- `npm run sbom`: generates a CycloneDX SBOM (`release/sbom.cdx.json`) of the production dependency set; fails closed if local paths would leak into the output. Generated artifact, not committed — `package-lock.json` is the source of truth.
### Changed (supply chain & release integrity)
- Build toolchain hardened: `esbuild` upgraded 0.17.3 → 0.28.1 (clears GHSA-67mh-4wv8-2f99) and remaining dev-dependency advisories resolved via non-breaking `npm audit fix`; full `npm audit` (prod + dev) now reports 0 vulnerabilities.
- Release packaging is now deterministic: staged file timestamps are normalized to a fixed epoch and zip entry order is fixed, so identical source yields an identical zip SHA-256 (reproducible-build verification).
- Packaging/verification scripts now invoke external tools via `execFileSync` argument arrays instead of shell string interpolation.
### Changed (UX redesign — pull-only preview)
- The difference window is now a **read-only Diff Preview**: local lines (green) and incoming Confluence lines (blue) are display-only. Per-block resolution ("Accept Local", "Accept Remote", "Accept Both") has been removed — on a pull-only plugin, keeping a "local" block never propagated anywhere and caused the same difference to reappear every sync.
- Primary action is **Pull & Replace** (replaces the local note body with the Confluence version in full; `confluence-version` updated only after a successful write; other frontmatter properties preserved). Secondary action is **Cancel (Keep Local)** (zero writes, version marker untouched).
- The preview's diff region is keyboard-scrollable with `role="region"` and an aria-label for screen readers.
### Added
- Large-page guardrail: warn once per sync if the remote page is > 1MB, but do not block.
- Diff computing moved to modal opening phase: avoids potentially heavy string allocations during the background fetch phase.
- `syncsInFlight` guard: prevents concurrent syncs on the same file from interleaving writes or opening multiple modals.
- Stale-file protection: at apply time, the plugin re-reads the file and aborts if it was modified externally while the preview was open.
- Unicode support for Cloud auth: email/API tokens containing multi-byte characters are encoded correctly to Base64.
- Specific error handling for HTTP 429 (Rate Limit).
- Response shape validation for Confluence API data.
- Scheme-downgrade prevention: blocks sync if a note URL uses `http` while settings use `https`.
- Empty-remote protection: if the Confluence page converts to an empty or whitespace-only body, the pull is aborted with a clear notice instead of blanking the note; the preview stays open.
- Large-page notice: syncing a Confluence page whose content exceeds 1 MB shows a one-time warning that the sync may take longer and use extra memory. The sync is never blocked.
- External-change protection: if the note is modified while the preview dialog is open, Apply is aborted with a clear notice, nothing is overwritten, and the dialog stays open for retry.
- Typed Confluence error handling with specific notices for 401/403/404/429, network failures, and invalid/unexpected API response shapes; none of these paths modify the local file.
- Page ID cache toggle is now functional: when enabled, resolved page IDs are cached for 1 hour and persist across syncs; when disabled, a fresh resolver is used.
- Standalone verification and packaging tooling: `npm run test:memory` (large-page memory check in a cold child process), `npm run package` (local staged zip build), and `npm run verify:release` (whitelist/hash/manifest checks). Local artifact: `release/confluence-import-1.0.8.zip` (named `obsidian-confluence-sync-1.0.8.zip` before the identity rebrand) containing exactly `main.js`, `manifest.json`, `styles.css`.
### Changed
- Minimum Obsidian version raised to 1.4.4 (`FileManager.processFrontMatter` requirement); `versions.json` mappings corrected accordingly. The plugin is desktop-only.
- Large-page memory usage significantly reduced: the diff engine no longer eagerly allocates per-line diff objects during comparison (difference blocks are computed lazily by the conflict window only when it opens), and the DOM pre-processing stage now releases its full-page DOM before Markdown conversion runs. On a ~3.8MB synthetic page, peak process memory dropped by roughly half in profiling.
- Debug logger rewritten: asynchronous ordered write queue (no sync I/O), 1 MB size bound with single-generation rotation to `debug.log.1`, and flush/close on plugin unload. Logs contain metadata only (lengths, counts, timings, statuses).
- Settings lifecycle: a single sync-service instance lives for the whole plugin load (saving settings no longer resets in-flight state or caches); text fields save with a 400 ms debounce (flushed on unload) while toggles save immediately.
- Test Connection now reports results via Obsidian notices instead of native prompt/alert dialogs, and validates against the configured Base URL field.
- Vault path resolution uses the public `FileSystemAdapter.getBasePath()` API with a desktop guard instead of private adapter fields.
- Markdown escape cleanup during conversion narrowed to provably safe cases (`\[`, `\]`, line-leading `\-`); other escapes are preserved to avoid changing Markdown semantics.
### Fixed
- Unicode credentials (email or API token with non-Latin-1 characters) no longer crash Basic auth encoding.
- Plugin unload now closes any open resolution dialog and prevents pending apply callbacks from writing to disk afterwards.
- Pending debounced settings saves are flushed on unload.
### Removed
- Dead remote-write code: `ConfluenceApiClient.updatePage`, `uploadAttachment`, and the multipart body builder. The API client is now read-only by construction, matching the one-way (Confluence → Obsidian) sync contract.
- Unreachable Markdown→Confluence conversion module (`src/converters/`) and its image upload handler, plus the `marked` dependency.
- The `diff-match-patch` dependency (and its type package), no longer imported anywhere after the unused eager diff pass was removed from the diff engine.
- Unused legacy conflict-marker modules (`src/conflict/`) and the unused conflict confirmation modal.
- Flaky in-Jest memory threshold test (replaced by the standalone `npm run test:memory` child-process check) and stray root-level memory verification drafts.
- Outdated local release archive `obsidian-auto-post-confluence.zip` (predated the pull-only contract), replaced by the current release artifact (now `confluence-import-1.0.8.zip` after the identity rebrand).
### Security
- Credentialed requests are only sent to the exact protocol + host of the configured Base URL; notes whose `confluence-url` points to another host, or downgrades `https` to `http`, are blocked before any client is constructed.
- Host guard now also fails closed on URLs with embedded credentials (`user:pass@host`) and on any non-http(s) scheme (`file:`, `javascript:`, custom schemes) — for both the note URL and the configured Base URL.
- Confluence macro titles are sanitized before being embedded in Obsidian callouts: newlines collapsed, Markdown-structural characters escaped, and length capped, so a remote page author cannot inject extra callouts, headings, or links via a macro title. Callout types remain whitelisted.
- Links with dangerous schemes (`javascript:`, `data:`, `vbscript:`, `file:`, `obsidian:`, and all other non-http(s)/mailto schemes) are stripped at the DOM level during conversion — obfuscation via case, whitespace, control characters, or percent-encoded scheme is normalized first. Link text is preserved; only the hyperlink is removed.
- `searchContent` responses are now shape-validated (results array and every consumed field) before use; invalid responses raise a typed error that never includes the raw response body. Page version numbers must be finite positive integers in both `getPage` and search results.
- Removed a stray `console.log` that printed cached page IDs outside the sanitized logger; plugin load/unload messages now go through the metadata-only logger.
- Added `SECURITY.md` (private reporting via GitHub Security Advisories, plaintext `data.json` token storage disclosure, redirect/server-trust caveat) and MIT `LICENSE`; manifest/package author metadata filled in; `.gitignore` now excludes `data.json`, logs, `.env`, and key files.
- Debug logs never contain note bodies, page content (raw/converted/normalized), tokens, emails, auth headers, or URL query strings; sensitive fields are redacted and content fields are replaced by length placeholders before hitting disk.
### Notes
- No change to the pull-only contract: the plugin has no remote mutation capability. (Historical note: an invisible legacy command id `push-to-confluence` was temporarily retained for hotkey compatibility during the rename; it has since been replaced by `import-from-confluence` as part of the identity rebrand above.)
- Planned but NOT implemented (see `docs/PRD_PULL_ONLY_UX_REDESIGN.md`): pre-pull Undo/backup, `confluence-content-hash`-based local-edit detection, and the differentiated "Pull & Overwrite" label. The current build always uses "Pull & Replace".
- Test suite: 7 Jest suites / 147 tests, plus the standalone memory check.

## [1.0.8] - 2026-01-13
### Changed
- Reordered merge flow: Local file is now saved *before* Confluence upload to prevent data loss.
### Fixed
- Fixed false conflicts caused by Non-Breaking Spaces (NBSP) in Confluence content.

## [1.0.7] - 2026-01-13
### Fixed
- Fixed invalid `querySelector` syntax causing a crash when parsing Confluence macros with namespaced attributes.

## [1.0.6] - 2026-01-13
### Fixed
- "Headless" Confluence tables (missing `<thead>`) now convert correctly to Markdown tables.
- False positive conflicts caused by differences in table separator row dashes.
- Robustness of `turndown-plugin-gfm` import to ensure tables are always processed.

## [1.0.5] - 2026-01-13
### Added
- Conversion of Confluence macros (Info, Note, etc.) back to Obsidian callouts in diff view.
- Enhanced normalization for escaped underscores and whitespace in diff engine.
### Changed
- Improved list formatting consistency during XHTML-to-Markdown conversion.

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
