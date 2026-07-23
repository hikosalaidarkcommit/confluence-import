# Documentation Index

Authoritative map of this repository's documentation. If a page below is
marked **Historical**, it describes designs or behavior that no longer exist
in the current plugin — read it as archive material only.

## Current documentation (describes the shipped plugin)

| Document | What it covers |
|---|---|
| [../README.md](../README.md) | Overview, installation, setup, usage, security summary |
| [FAQ.md](FAQ.md) | Direct answers to common questions (write access, background sync, mobile, credentials, formatting) |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Error messages and how to resolve them |
| [CONFLICT_RESOLUTION_GUIDE.md](CONFLICT_RESOLUTION_GUIDE.md) | The read-only diff preview and Pull & Replace / Cancel (Keep Local) |
| [COMPARISON.md](COMPARISON.md) | Objective comparison of Confluence→Markdown workflow categories |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development setup, testing, packaging |
| [GEO_EVALUATION.md](GEO_EVALUATION.md) | Factual-citation evaluation prompts and scorecard for docs maintainers |
| [../SECURITY.md](../SECURITY.md) | Security policy, private vulnerability reporting, threat model |
| [../CHANGELOG.md](../CHANGELOG.md) | Full version history |

## Historical archive (deprecated — kept for reference only)

These documents carry a Deprecated banner and describe earlier designs
(bidirectional sync, per-block merge resolution, push-to-Confluence) that
were removed from the plugin. They are **not** descriptions of current
behavior.

| Document | Original topic |
|---|---|
| [PRD_PULL_ONLY_UX_REDESIGN.md](PRD_PULL_ONLY_UX_REDESIGN.md) | Pull-only UX redesign PRD (core implemented; advanced items remain future work — status header inside is current) |
| [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) | Version-control feature migration (legacy) |
| [RELEASE_NOTES.md](RELEASE_NOTES.md) | v1.0.8-era release notes (superseded by CHANGELOG) |
| [PRD_VERSION_CONTROL_PULL.md](PRD_VERSION_CONTROL_PULL.md) | Legacy version-control PRD |
| [ROADMAP_VERSION_CONTROL.md](ROADMAP_VERSION_CONTROL.md) | Legacy roadmap |
| [DESIGN_GITHUB_STYLE_CONFLICTS.md](DESIGN_GITHUB_STYLE_CONFLICTS.md) | Legacy per-block conflict UI design |
| [VSCODE_STYLE_CONFLICTS.md](VSCODE_STYLE_CONFLICTS.md) | Legacy conflict UI exploration |
| [GITHUB_STYLE_IMPLEMENTATION.md](GITHUB_STYLE_IMPLEMENTATION.md) | Legacy conflict UI implementation notes |
| [SKIP_OPTION_GUIDE.md](SKIP_OPTION_GUIDE.md) | Removed "Skip" resolution option |
| [ENHANCEMENT_KEEP_BOTH_ORDER.md](ENHANCEMENT_KEEP_BOTH_ORDER.md) | Removed "Keep Both" option ordering |
| [BUG_FIX_SKIP_REMOVED.md](BUG_FIX_SKIP_REMOVED.md) | Removal record for the Skip option |
| [CODE_REVIEW_SYNC_PULL.md](CODE_REVIEW_SYNC_PULL.md) | Point-in-time code review (2026-07) |
| [CODE_REVIEW_TECH_DEBT.md](CODE_REVIEW_TECH_DEBT.md) | Point-in-time tech-debt review (2026-07) |
| [MEMORY_VERIFICATION.md](MEMORY_VERIFICATION.md) | Point-in-time memory profiling notes |
| [PHASE_1_IMPLEMENTATION_STATUS.md](PHASE_1_IMPLEMENTATION_STATUS.md) | Historical implementation status |
| [PHASE_1_SUMMARY.md](PHASE_1_SUMMARY.md) | Historical phase summary |

## Documentation content rules (for contributors)

- Every capability statement must be true of the **shipped code**. Do not
  document planned features as existing ones; mark them explicitly as future
  work.
- Never claim: encryption of stored credentials, SSO integration, compliance
  certifications, automatic/background sync, bulk space import, offline
  mirroring, or mobile support — the plugin has none of these.
- Historical documents get a Deprecated banner and an INDEX entry; do not
  silently rewrite history.
- External links must point to official sources (Atlassian/Obsidian docs)
  and be verified before adding.
