# Product Requirements Document: Version Control & Pull Feature

> **⚠ DEPRECATED — NOT CURRENT UX**: This is a historical design/implementation document. The per-block merge and push-era workflow it describes has been removed. The current UX is a read-only Diff Preview with "Pull & Replace" / "Cancel (Keep Local)" only — see [CONFLICT_RESOLUTION_GUIDE.md](CONFLICT_RESOLUTION_GUIDE.md) and [PRD_PULL_ONLY_UX_REDESIGN.md](PRD_PULL_ONLY_UX_REDESIGN.md). Kept for historical reference; content below is unmodified.

**Product**: Obsidian Confluence Sync Plugin  
**Feature**: Version Control & Bidirectional Sync  
**Version**: 2.0.0  
**Author**: Development Team  
**Date**: 2026-01-12  
**Status**: Draft

---

## 1. Executive Summary

### 1.1 Overview
This PRD defines the addition of version control tracking and pull (fetch) capabilities to the Obsidian Confluence Sync plugin. Currently, the plugin only supports pushing content from Obsidian to Confluence. This feature enables bidirectional synchronization, allowing users to pull updates from Confluence into Obsidian while preventing data loss through intelligent conflict detection and resolution.

### 1.2 Problem Statement
**Current Pain Points**:
1. Users cannot retrieve updates made to Confluence pages by colleagues
2. No version tracking leads to potential overwrites and lost work
3. Concurrent editing scenarios result in "last write wins" behavior
4. No way to detect if local changes will be overwritten by remote changes

**Business Impact**:
- User frustration from lost work
- Reduced collaboration effectiveness
- Risk of data loss in team environments

### 1.3 Success Criteria
- Zero data loss incidents from sync operations
- 95% of users successfully complete pull operations without manual intervention
- Conflict resolution success rate > 90%
- User satisfaction score > 4.5/5 for sync reliability

---

## 2. Functional Requirements

### FR-1: Version Tracking on Push

**Description**: Store Confluence page version number in Obsidian note frontmatter after successful push operations.

**User Story**: As a user, I want the plugin to track which version of the Confluence page my local note corresponds to, so that I can detect when the remote page has been updated.

**Behavior**:
- After successful push to Confluence, update note frontmatter with `confluence-version: <number>`
- Version number must match the Confluence page version after push
- Version must only be updated after successful API response (atomic operation)
- If push fails, version must NOT be updated

**Acceptance Criteria**: See AC-1

---

### FR-2: Pull from Confluence

**Description**: Fetch content from Confluence and merge it into the local Obsidian note.

**User Story**: As a user, I want to pull the latest content from Confluence into my Obsidian note, so that I can see updates made by my colleagues.

**Behavior**:
- Command: "Pull from Confluence" available in command palette and context menu
- Fetch remote page content and version number
- Compare remote version with local `confluence-version`
- Show diff preview before applying changes
- Update local content and version on user confirmation
- Preserve local changes when possible (3-way merge)

**Acceptance Criteria**: See AC-2

---

### FR-3: Version Comparison Logic

**Description**: Compare local and remote versions to determine sync strategy.

**User Story**: As a user, I want the plugin to intelligently determine whether to pull, skip, or warn based on version comparison.

**Behavior**:

| Condition | Action |
|-----------|--------|
| `remote_version > local_version` | Offer to pull (show diff) |
| `remote_version == local_version` | Show "Already up to date" |
| `remote_version < local_version` | Show error (invalid state) |
| `local_version` missing | Treat as first-time sync |

**Acceptance Criteria**: See AC-3

---

### FR-4: Conflict Detection

**Description**: Detect when both local and remote content have changed since last sync.

**User Story**: As a user, I want to be warned when pulling would overwrite my uncommitted local changes, so that I don't lose work.

**Behavior**:
- Store content hash of last synced state in frontmatter
- Before pull, compare current content hash with stored hash
- If hashes differ, local changes exist
- If local changes exist AND remote version > local version, trigger 3-way merge
- Show merge UI with local changes, remote changes, and merged result

**Acceptance Criteria**: See AC-4

---

### FR-5: 3-Way Merge Resolution

**Description**: Provide UI for resolving conflicts when both local and remote have changes.

**User Story**: As a user, when both my local note and the remote Confluence page have been edited, I want to see both sets of changes and choose how to merge them.

**Behavior**:
- Display three panels:
  - Local changes (editable)
  - Remote changes (read-only)
  - Merged result (editable)
- Provide quick actions:
  - "Use Local" - Keep local content
  - "Use Remote" - Accept remote content
  - Manual edit - User edits merged result
- Only apply merge on explicit user confirmation
- Allow cancellation (no changes made)

**Acceptance Criteria**: See AC-5

---

### FR-6: First-Time Sync Handling

**Description**: Handle pull operations for notes that have never been synced.

**User Story**: As a user, when I pull a note that has no version tracking, I want to choose whether to overwrite my local content or keep it.

**Behavior**:
- Detect missing `confluence-version` property
- Show dialog: "This note has never been synced. Remote content exists."
- Options:
  - Pull (overwrite local)
  - Keep local (will push on next sync)
  - Show diff (review before deciding)
- Default to "Show diff" for safety

**Acceptance Criteria**: See AC-6

---

### FR-7: Invalid State Detection

**Description**: Detect and handle impossible version states.

**User Story**: As a user, if my local version number is somehow ahead of the remote, I want to be notified and offered a way to fix it.

**Behavior**:
- Detect when `local_version > remote_version`
- Show error: "Local version ahead of remote (invalid state)"
- Possible causes:
  - Manual frontmatter edit
  - Page deleted and recreated
  - Plugin bug
- Options:
  - Reset to remote version
  - Cancel (investigate manually)

**Acceptance Criteria**: See AC-7

---

### FR-8: URL Change Detection

**Description**: Detect when the Confluence URL in frontmatter changes and reset version tracking.

**User Story**: As a user, when I change the Confluence URL to point to a different page, I want the version tracking to reset so it doesn't use the old page's version number.

**Behavior**:
- Store `confluence-page-id` separately from URL
- On each sync operation, extract page ID from current URL
- Compare with stored page ID
- If different:
  - Show notification: "Confluence URL changed. Resetting version tracking."
  - Clear `confluence-version` and `confluence-content-hash`
  - Treat as first-time sync

**Acceptance Criteria**: See AC-8

---

### FR-9: Transaction Safety

**Description**: Ensure pull operations are atomic (all-or-nothing).

**User Story**: As a user, if a pull operation fails partway through, I want my note to remain in its original state without partial updates.

**Behavior**:
- Before modifying file, create backup of content and frontmatter
- Perform content update
- Perform frontmatter update
- If any step fails, rollback all changes
- Show clear error message on failure
- Log error details for debugging

**Acceptance Criteria**: See AC-9

---

### FR-10: Active Edit Protection

**Description**: Warn users before pulling when the note is currently open in the editor.

**User Story**: As a user, when I'm actively editing a note, I want to be warned before pulling so I don't lose my current work-in-progress.

**Behavior**:
- Detect if file is currently open in active editor
- Show warning: "You are currently editing this note. Pulling may disrupt your work."
- Options:
  - Cancel (default)
  - Pull anyway (with warning)
- If user continues, preserve cursor position if possible

**Acceptance Criteria**: See AC-10

---

### FR-11: Concurrent Edit Handling

**Description**: Handle race conditions when multiple users edit the same page simultaneously.

**User Story**: As a user, when I try to push changes but someone else has already pushed, I want to be notified and given a chance to merge their changes.

**Behavior**:
- On push, send current `confluence-version` to API
- If API returns 409 Conflict (version mismatch):
  - Fetch latest remote version
  - Show notification: "Someone else edited this page. Please review their changes."
  - Auto-trigger pull/merge workflow
  - Allow user to resolve conflicts
  - Retry push after resolution
- Limit retry attempts to 3 to prevent infinite loops

**Acceptance Criteria**: See AC-11

---

### FR-12: Deleted Page Handling

**Description**: Handle pull operations when the remote Confluence page has been deleted.

**User Story**: As a user, when I try to pull a page that has been deleted, I want to be notified and offered options to unlink or create a new page.

**Behavior**:
- On 404 error during pull:
  - Show error: "Page not found. It may have been deleted."
  - Options:
    - Unlink (remove `confluence-url` and `confluence-version`)
    - Create new page (push current content as new page)
    - Cancel
- Clear version tracking if user chooses to unlink

**Acceptance Criteria**: See AC-12

---

## 3. Non-Functional Requirements

### NFR-1: Performance

**Requirement**: Pull operations must complete within acceptable time limits.

**Metrics**:
- Pull operation (single note): < 3 seconds for pages < 100KB
- Version comparison: < 100ms
- Content hash calculation: < 50ms
- Batch pull (10 notes): < 30 seconds

**Rationale**: Users expect near-instant feedback for sync operations.

---

### NFR-2: Reliability

**Requirement**: Sync operations must be reliable and prevent data loss.

**Metrics**:
- Zero data loss incidents in production
- Transaction rollback success rate: 100%
- Error recovery success rate: > 95%
- Atomic operation guarantee: 100%

**Rationale**: Data loss is unacceptable for a sync tool.

---

### NFR-3: Usability

**Requirement**: Users must be able to understand and use sync features without extensive training.

**Metrics**:
- First-time pull success rate: > 90%
- Conflict resolution completion rate: > 85%
- User satisfaction (ease of use): > 4.0/5
- Support ticket rate: < 5% of active users

**Rationale**: Complex sync UX leads to user frustration and abandonment.

---

### NFR-4: Compatibility

**Requirement**: Feature must work with existing plugin functionality and Obsidian versions.

**Metrics**:
- Backward compatibility: 100% (existing notes continue working)
- Obsidian version support: v1.0.0+
- Confluence Cloud support: 100%
- Confluence Server/Data Center support: 100%

**Rationale**: Breaking changes alienate existing users.

---

### NFR-5: Scalability

**Requirement**: Feature must handle large vaults and frequent sync operations.

**Metrics**:
- Support vaults with 1000+ linked notes
- Handle notes up to 10MB
- Batch operations: up to 100 notes concurrently
- Memory usage: < 100MB additional overhead

**Rationale**: Power users have large vaults and expect good performance.

---

### NFR-6: Security

**Requirement**: Version tracking must not expose sensitive information.

**Metrics**:
- No credentials stored in frontmatter
- Content hashes are one-way (non-reversible)
- API tokens remain encrypted
- Audit log for all sync operations

**Rationale**: Security is critical for enterprise users.

---

### NFR-7: Maintainability

**Requirement**: Code must be maintainable and testable.

**Metrics**:
- Unit test coverage: > 80%
- Integration test coverage: > 70%
- Code documentation: 100% of public APIs
- Cyclomatic complexity: < 10 per function

**Rationale**: Complex code leads to bugs and maintenance burden.

---

### NFR-8: Error Handling

**Requirement**: All error states must be handled gracefully with clear user messaging.

**Metrics**:
- Error message clarity score: > 4.0/5
- Error recovery options provided: 100%
- Unhandled exceptions: 0
- Error logging: 100% of errors logged

**Rationale**: Poor error handling frustrates users and makes debugging difficult.

---

## 4. Data Model

### 4.1 Frontmatter Schema

**Note Metadata (stored in YAML frontmatter)**:

```yaml
---
# Existing fields
confluence-url: string  # URL to Confluence page (required)

# New fields (Phase 1)
confluence-version: number  # Confluence page version number (optional)

# New fields (Phase 3)
confluence-page-id: string  # Confluence page ID for stable reference (optional)
confluence-content-hash: string  # Hash of last synced content (optional)
confluence-last-sync: string  # ISO 8601 timestamp of last sync (optional)
---
```

**Field Definitions**:

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| `confluence-url` | string | Yes | Full URL to Confluence page | `https://mycompany.atlassian.net/wiki/spaces/DOCS/pages/123456` |
| `confluence-version` | number | No | Version number from Confluence API | `42` |
| `confluence-page-id` | string | No | Stable page identifier | `123456` |
| `confluence-content-hash` | string | No | Hash of content at last sync | `a1b2c3d4` |
| `confluence-last-sync` | string | No | Timestamp of last sync | `2026-01-12T10:30:00Z` |

**Constraints**:
- `confluence-version` must be a positive integer
- `confluence-page-id` must match the ID in `confluence-url`
- `confluence-content-hash` must be a hexadecimal string
- `confluence-last-sync` must be valid ISO 8601 format

---

### 4.2 API Data Models

**Confluence Page Response** (from API):

```typescript
interface PageContent {
  id: string;                    // Page ID
  type: string;                  // "page"
  status: string;                // "current"
  title: string;                 // Page title
  body: {
    storage: {
      value: string;             // XHTML content
      representation: string;    // "storage"
    };
  };
  version: {
    number: number;              // Version number
    when: string;                // ISO 8601 timestamp
  };
  space: {
    key: string;                 // Space key
    name: string;                // Space name
  };
}
```

**Version Comparison Result**:

```typescript
interface VersionComparisonResult {
  localVersion: number;          // Local version (0 if missing)
  remoteVersion: number;         // Remote version from API
  status: 'up-to-date' | 'pull-available' | 'invalid-state' | 'first-sync';
  versionDiff: number;           // remoteVersion - localVersion
}
```

**Conflict Detection Result**:

```typescript
interface ConflictDetectionResult {
  hasLocalChanges: boolean;      // Local content differs from last sync
  hasRemoteChanges: boolean;     // Remote version > local version
  requiresMerge: boolean;        // Both have changes
  localContentHash: string;      // Current local hash
  lastSyncHash: string;          // Stored hash from frontmatter
}
```

---

### 4.3 State Transitions

**Pull Operation State Machine**:

```
[Start Pull]
    ↓
[Fetch Remote] → [404 Error] → [Show Delete Dialog] → [End]
    ↓
[Compare Versions]
    ↓
    ├─ remote == local → [Show "Up to date"] → [End]
    ├─ remote < local  → [Show Invalid State] → [End]
    └─ remote > local  → [Check Local Changes]
                              ↓
                              ├─ No local changes → [Show Diff] → [User Confirms] → [Apply Pull] → [End]
                              └─ Has local changes → [Show 3-Way Merge] → [User Resolves] → [Apply Merge] → [End]
```

**Push Operation State Machine** (with version conflict handling):

```
[Start Push]
    ↓
[Fetch Remote Version]
    ↓
[Send Update with Version]
    ↓
    ├─ Success → [Update Local Version] → [End]
    └─ 409 Conflict → [Show Conflict Dialog] → [Trigger Pull] → [Retry Push] → [End]
```

---

## 5. Acceptance Criteria

### AC-1: Version Tracking on Push

**Given** a user pushes a note to Confluence  
**When** the push succeeds  
**Then** the note's frontmatter must contain `confluence-version: <number>` matching the Confluence page version

**Given** a user pushes a note to Confluence  
**When** the push fails  
**Then** the note's frontmatter must NOT be updated with a new version

**Given** a note with `confluence-version: 10`  
**When** the user pushes successfully  
**Then** the version must increment to `11`

---

### AC-2: Pull from Confluence

**Given** a note with `confluence-version: 10` and remote version is `15`  
**When** the user triggers "Pull from Confluence"  
**Then** the plugin must:
1. Show a diff preview comparing local and remote content
2. Display version information: "Remote is 5 versions ahead (10 → 15)"
3. Provide "Pull & Replace Local" and "Cancel" buttons

**Given** the user confirms the pull  
**When** the pull completes successfully  
**Then** the plugin must:
1. Update the note content with remote content (converted to markdown)
2. Update `confluence-version` to `15`
3. Show success message: "✅ Pulled version 15 from Confluence"

**Given** the user cancels the pull  
**When** the cancel button is clicked  
**Then** no changes must be made to the note

---

### AC-3: Version Comparison Logic

**Given** `local_version = 20` and `remote_version = 20`  
**When** the user triggers pull  
**Then** show message "✓ Already up to date (version 20)" and exit

**Given** `local_version = 25` and `remote_version = 20`  
**When** the user triggers pull  
**Then** show error "⚠️ Local version (25) is ahead of remote (20)" with reset option

**Given** no `confluence-version` in frontmatter  
**When** the user triggers pull  
**Then** treat as first-time sync and show appropriate dialog

---

### AC-4: Conflict Detection

**Given** a note with `confluence-content-hash: abc123`  
**When** the user edits the note locally (hash changes to `def456`)  
**And** the remote version has also been updated  
**And** the user triggers pull  
**Then** the plugin must:
1. Detect local changes (hash mismatch)
2. Detect remote changes (version mismatch)
3. Show 3-way merge UI

**Given** a note with matching content hash (no local changes)  
**When** the remote version is newer  
**And** the user triggers pull  
**Then** show simple diff (not 3-way merge)

---

### AC-5: 3-Way Merge Resolution

**Given** both local and remote have changes  
**When** the 3-way merge UI is shown  
**Then** the UI must display:
1. Local changes panel (editable)
2. Remote changes panel (read-only)
3. Merged result panel (editable, initially set to local content)
4. "Use Local" button
5. "Use Remote" button
6. "Apply Merge" button
7. "Cancel" button

**Given** the user clicks "Use Local"  
**When** the button is clicked  
**Then** the merged result panel must be populated with local content

**Given** the user clicks "Use Remote"  
**When** the button is clicked  
**Then** the merged result panel must be populated with remote content

**Given** the user clicks "Apply Merge" with "Use Remote" selected  
**When** the button is clicked  
**Then** the plugin must:
1. Discard local unpushed changes
2. Update note content with remote content
3. Update `confluence-version` to remote version
4. Update `confluence-content-hash` to hash of remote content
5. Show neutral completion message: "ℹ️ Local changes discarded. Synced to remote version X."

**Given** the user clicks "Apply Merge" with "Use Local" or custom merge  
**When** the button is clicked  
**Then** the plugin must:
1. Update note content with merged result
2. Update `confluence-version` to remote version
3. Update `confluence-content-hash` to hash of merged content
4. Show success message: "✅ Merge applied successfully"

---

### AC-6: First-Time Sync Handling

**Given** a note without `confluence-version` property  
**When** the user triggers pull  
**Then** show dialog: "This note has never been synced. Remote content exists."

**Given** the first-time sync dialog is shown  
**When** the user selects "Pull"  
**Then** overwrite local content with remote content and set version

**Given** the first-time sync dialog is shown  
**When** the user selects "Keep Local"  
**Then** close dialog without making changes

**Given** the first-time sync dialog is shown  
**When** the user selects "Show Diff"  
**Then** show diff preview modal

---

### AC-7: Invalid State Detection

**Given** `local_version = 25` and `remote_version = 20`  
**When** the user triggers pull  
**Then** show error modal with:
1. Title: "⚠️ Invalid Version State"
2. Message: "Local version (25) is ahead of remote (20). This shouldn't happen."
3. Possible causes listed
4. "Reset to Remote Version" button
5. "Cancel" button

**Given** the invalid state error is shown  
**When** the user clicks "Reset to Remote Version"  
**Then** set `confluence-version` to `20` and show confirmation

---

### AC-8: URL Change Detection

**Given** a note with `confluence-page-id: 111111` and `confluence-version: 5`  
**When** the user changes `confluence-url` to point to page `222222`  
**And** the user triggers pull or push  
**Then** the plugin must:
1. Detect page ID change (111111 → 222222)
2. Show notification: "⚠️ Confluence URL changed. Resetting version tracking."
3. Update `confluence-page-id` to `222222`
4. Clear `confluence-version`
5. Clear `confluence-content-hash`
6. Treat as first-time sync

---

### AC-9: Transaction Safety

**Given** a pull operation is in progress  
**When** the network fails after fetching remote content but before updating frontmatter  
**Then** the plugin must:
1. Detect the error
2. Rollback any partial changes to content
3. Leave frontmatter unchanged
4. Show error: "❌ Network error during pull. Please try again."
5. Leave note in original state

**Given** a pull operation is in progress  
**When** the content update succeeds but frontmatter update fails  
**Then** the plugin must:
1. Rollback content update
2. Show error message
3. Log error details

---

### AC-10: Active Edit Protection

**Given** a note is currently open in the editor  
**When** the user triggers pull  
**Then** show warning: "⚠️ You are currently editing this note. Pulling may disrupt your work."

**Given** the active edit warning is shown  
**When** the user clicks "Cancel"  
**Then** close dialog without making changes

**Given** the active edit warning is shown  
**When** the user clicks "Pull Anyway"  
**Then** proceed with pull operation

---

### AC-11: Concurrent Edit Handling

**Given** a user has `confluence-version: 10` locally  
**When** the user pushes changes  
**And** the remote version is now `15` (someone else pushed)  
**Then** the Confluence API must return 409 Conflict

**Given** a 409 Conflict error is received  
**When** the error is caught  
**Then** the plugin must:
1. Fetch latest remote version
2. Show notification: "⚠️ Remote has 5 new versions (10 → 15). Please pull latest changes."
3. Offer "Pull & Merge" button
4. Not update local version

**Given** the user clicks "Pull & Merge"  
**When** the button is clicked  
**Then** trigger pull workflow with conflict detection

**Given** a 409 Conflict occurs during push  
**When** the user is presented with conflict resolution options  
**And** the user selects "Keep Remote"  
**Then** the plugin must:
1. Trigger pull workflow to fetch remote content
2. Show 3-way merge UI (or simple pull UI if no local changes detected)
3. Pre-select "Use Remote" option
4. Follow the "Keep Remote" behavior defined in AC-5
5. NOT perform a push operation after resolution

**Note**: The detailed "Keep Remote" behavior (discarding local changes, updating version, confirmation flow) is defined in AC-5 and applies to all conflict resolution scenarios including:
- 3-way merge during pull
- Conflict resolution after 409 error during push
- First-time sync with conflicting content
- Any scenario where user chooses to discard local changes in favor of remote

---

### AC-12: Deleted Page Handling

**Given** a note linked to a Confluence page  
**When** the page is deleted on Confluence  
**And** the user triggers pull  
**Then** the API must return 404 Not Found

**Given** a 404 error is received during pull  
**When** the error is caught  
**Then** show error modal with:
1. Title: "❌ Page Not Found"
2. Message: "The Confluence page may have been deleted."
3. "Unlink from Confluence" button
4. "Cancel" button

**Given** the user clicks "Unlink from Confluence"  
**When** the button is clicked  
**Then** the plugin must:
1. Remove `confluence-url` from frontmatter
2. Remove `confluence-version` from frontmatter
3. Remove `confluence-page-id` from frontmatter
4. Remove `confluence-content-hash` from frontmatter
5. Show confirmation: "Unlinked from Confluence"

---

## 6. API Specifications

### 6.1 New Methods

#### `pullFromConfluence(file: TFile): Promise<void>`

**Description**: Pull content from Confluence into local note.

**Parameters**:
- `file: TFile` - The Obsidian file to pull into

**Returns**: `Promise<void>`

**Throws**:
- `Error` - If no confluence-url in frontmatter
- `ConfluenceApiError` - If API call fails
- `Error` - If network error occurs

**Side Effects**:
- Updates file content
- Updates frontmatter (`confluence-version`, `confluence-content-hash`, `confluence-last-sync`)
- Shows UI modals for user interaction

**Example**:
```typescript
await syncService.pullFromConfluence(file);
```

---

#### `detectLocalChanges(file: TFile): Promise<boolean>`

**Description**: Detect if local content has changed since last sync.

**Parameters**:
- `file: TFile` - The file to check

**Returns**: `Promise<boolean>` - True if local changes detected

**Algorithm**:
1. Read current file content
2. Calculate hash of current content
3. Read `confluence-content-hash` from frontmatter
4. Compare hashes
5. Return true if different, false if same

**Example**:
```typescript
const hasChanges = await syncService.detectLocalChanges(file);
if (hasChanges) {
  // Trigger 3-way merge
}
```

---

#### `updateSyncMetadata(file: TFile, version: number, content: string): Promise<void>`

**Description**: Update all sync-related metadata in frontmatter.

**Parameters**:
- `file: TFile` - The file to update
- `version: number` - New version number
- `content: string` - Content to hash

**Returns**: `Promise<void>`

**Side Effects**:
- Updates `confluence-version`
- Updates `confluence-content-hash`
- Updates `confluence-last-sync`

**Example**:
```typescript
await syncService.updateSyncMetadata(file, 42, mergedContent);
```

---

### 6.2 Modified Methods

#### `pushToConfluence(file: TFile): Promise<void>` (Enhanced)

**Changes**:
- Add 409 Conflict error handling
- Auto-trigger pull on version conflict
- Update version tracking after successful push

**New Behavior**:
```typescript
try {
  await apiClient.updatePage(pageId, title, content, currentVersion);
  await this.updateSyncMetadata(file, currentVersion + 1, content);
} catch (error) {
  if (error.status === 409) {
    // Handle concurrent edit
    await this.handleVersionConflict(file);
  }
}
```

---

## 7. User Interface Specifications

### 7.1 Pull Confirmation Modal

**Trigger**: User initiates pull when remote version > local version (no local changes)

**Layout**:
```
┌─────────────────────────────────────────────┐
│ Pull from Confluence                        │
├─────────────────────────────────────────────┤
│ Remote is 5 version(s) ahead (10 → 15)      │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ [Diff View]                             │ │
│ │ - Old content                           │ │
│ │ + New content                           │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│              [Cancel]  [Pull & Replace]     │
└─────────────────────────────────────────────┘
```

**Elements**:
- Title: "Pull from Confluence"
- Version info: "Remote is X version(s) ahead (A → B)"
- Diff view (scrollable)
- Cancel button (default focus)
- Pull & Replace button (primary action)

---

### 7.2 Three-Way Merge Modal

**Trigger**: User initiates pull when both local and remote have changes

**Layout**:
```
┌───────────────────────────────────────────────────────────────┐
│ ⚠️ Merge Required                                             │
├───────────────────────────────────────────────────────────────┤
│ Both local and remote have changes. Please review and merge.  │
│                                                               │
│ ┌──────────────────┐ ┌──────────────────┐                    │
│ │ Local (v10)      │ │ Remote (v15)     │                    │
│ │ [Editable]       │ │ [Read-only]      │                    │
│ │                  │ │                  │                    │
│ └──────────────────┘ └──────────────────┘                    │
│                                                               │
│ ┌────────────────────────────────────────────────────────┐   │
│ │ Merged Result                                          │   │
│ │ [Editable]                                             │   │
│ │                                                        │   │
│ └────────────────────────────────────────────────────────┘   │
│                                                               │
│ [Use Local] [Use Remote]         [Cancel] [Apply Merge]      │
└───────────────────────────────────────────────────────────────┘
```

**Elements**:
- Title: "⚠️ Merge Required"
- Description text
- Local changes panel (textarea, editable)
- Remote changes panel (textarea, read-only)
- Merged result panel (textarea, editable)
- Use Local button
- Use Remote button
- Cancel button
- Apply Merge button (primary action)

---

### 7.3 First-Time Sync Modal

**Trigger**: User initiates pull on note without version tracking

**Layout**:
```
┌─────────────────────────────────────────────┐
│ First-Time Sync                             │
├─────────────────────────────────────────────┤
│ This note has never been synced.            │
│ Remote content exists (version 5).          │
│                                             │
│ What would you like to do?                  │
│                                             │
│ [Pull]       - Replace local with remote    │
│ [Keep Local] - Keep local, push later       │
│ [Show Diff]  - Review changes first         │
│                                             │
│                              [Cancel]        │
└─────────────────────────────────────────────┘
```

---

## 8. Testing Strategy

### 8.1 Unit Tests

**Coverage Target**: > 80%

**Test Cases**:
- Version comparison logic (all combinations)
- Content hash calculation
- Frontmatter parsing and updating
- Error handling for each error type
- State transition logic

---

### 8.2 Integration Tests

**Coverage Target**: > 70%

**Test Scenarios**:
- Full pull workflow (happy path)
- Pull with conflicts
- Push with version conflict
- First-time sync
- URL change detection
- Transaction rollback
- API error handling

---

### 8.3 End-to-End Tests

**Test Scenarios**:
1. User creates note, pushes, colleague edits in Confluence, user pulls
2. User edits locally, colleague edits remotely, user pulls (merge)
3. User changes URL, triggers sync (version reset)
4. Network failure during pull (rollback)
5. Concurrent push by two users (409 conflict)

---

### 8.4 Performance Tests

**Metrics to Measure**:
- Pull operation latency (p50, p95, p99)
- Content hash calculation time
- Diff generation time
- Memory usage during batch operations

---

## 9. Migration & Rollout Plan

### 9.1 Backward Compatibility

**Existing Notes**:
- Notes without `confluence-version` continue to work
- First push adds version automatically
- No manual migration required

**Existing Functionality**:
- All existing push features remain unchanged
- No breaking changes to API or UI

---

### 9.2 Phased Rollout

**Phase 1** (Week 1-2): Version tracking on push
- Low risk, no user-facing changes except frontmatter
- Monitor for version update failures

**Phase 2** (Week 3-5): Basic pull functionality
- Beta release to 10% of users
- Monitor pull success rate and error logs

**Phase 3** (Week 6-9): Conflict detection and merge
- Beta release to 50% of users
- Monitor merge completion rate

**Phase 4** (Week 10-12): Advanced features
- Full release to 100% of users
- Monitor overall satisfaction

---

### 9.3 Rollback Plan

**If critical issues arise**:
1. Disable pull command via feature flag
2. Push functionality remains operational
3. Version tracking continues (for future use)
4. Investigate and fix issues
5. Re-enable pull when stable

---

## 10. Success Metrics

### 10.1 Adoption Metrics

- % of users who use pull feature: Target > 60%
- Pull operations per user per week: Target > 3
- Time to first pull (new users): Target < 7 days

### 10.2 Quality Metrics

- Pull success rate: Target > 95%
- Conflict resolution success rate: Target > 90%
- Data loss incidents: Target = 0
- Rollback success rate: Target = 100%

### 10.3 User Satisfaction

- Feature satisfaction score: Target > 4.5/5
- Net Promoter Score (NPS): Target > 50
- Support ticket rate: Target < 5%

---

## 11. Open Questions & Risks

### 11.1 Open Questions

1. **Q**: Should we support pulling specific version (not just latest)?  
   **A**: Deferred to future version

2. **Q**: Should we show version history in UI?  
   **A**: Deferred to future version

3. **Q**: Should we support auto-sync on vault open?  
   **A**: Yes, in Phase 4 with opt-in setting

### 11.2 Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Data loss from merge bugs | High | Low | Extensive testing, transaction safety |
| Performance issues with large notes | Medium | Medium | Performance testing, optimization |
| User confusion with merge UI | Medium | Medium | User testing, clear documentation |
| API rate limiting | Low | Low | Rate limiting implementation |

---

## 12. Appendices

### Appendix A: Glossary

- **Pull**: Fetch content from Confluence and merge into local note
- **Push**: Send content from local note to Confluence
- **Version**: Confluence page version number (increments on each edit)
- **Content Hash**: One-way hash of note content for change detection
- **3-Way Merge**: Merge algorithm using base, local, and remote versions
- **Transaction Safety**: Atomic operations that rollback on failure

### Appendix B: References

- Confluence REST API Documentation
- Obsidian Plugin API Documentation
- Git 3-Way Merge Algorithm
- Specification-Driven Development Principles

---

**Document Version**: 1.0  
**Last Updated**: 2026-01-12  
**Next Review**: 2026-02-12
