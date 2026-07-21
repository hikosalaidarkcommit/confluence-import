# Roadmap: Version Control & Pull Feature

> **⚠ DEPRECATED — NOT CURRENT UX**: This is a historical design/implementation document. The per-block merge and push-era workflow it describes has been removed. The current UX is a read-only Diff Preview with "Pull & Replace" / "Cancel (Keep Local)" only — see [CONFLICT_RESOLUTION_GUIDE.md](CONFLICT_RESOLUTION_GUIDE.md) and [PRD_PULL_ONLY_UX_REDESIGN.md](PRD_PULL_ONLY_UX_REDESIGN.md). Kept for historical reference; content below is unmodified.

**Product**: Obsidian Confluence Sync Plugin  
**Feature**: Version Control & Bidirectional Sync  
**Timeline**: Q1-Q2 2026 (12 weeks)  
**Version**: 2.0.0

---

## Overview

This roadmap outlines the development and delivery of version control tracking and pull capabilities for the Obsidian Confluence Sync plugin. The feature will be delivered in 4 phases over 12 weeks, with each phase building upon the previous one.

---

## Timeline Summary

```
Week 1-2   │ Phase 1: Foundation
Week 3-5   │ Phase 2: Core Pull
Week 6-9   │ Phase 3: Smart Merge
Week 10-12 │ Phase 4: Polish & Advanced Features
Week 13    │ Release & Monitoring
```

---

## Phase 1: Foundation - Version Tracking
**Duration**: 2 weeks (Week 1-2)  
**Release**: v2.0.0-alpha.1  
**Goal**: Establish version tracking infrastructure

### Week 1: Development

#### Deliverables
- [ ] **FR-1**: Version tracking on push
  - Add `updateVersionInFrontmatter()` method
  - Update version after successful push
  - Ensure atomic operation (only update on success)
  
- [ ] **FR-11**: Basic 409 conflict detection
  - Add error handler for 409 Conflict responses
  - Show user-friendly error message
  - Log version mismatch for debugging

- [ ] **Data Model**: Update frontmatter schema
  - Add `confluence-version: number` field
  - Document field in README

#### Code Changes
```typescript
// New methods
updateVersionInFrontmatter(file: TFile, version: number): Promise<void>
handleVersionConflict(file: TFile, error: ConfluenceApiError): Promise<void>

// Modified methods
uploadContent() // Add version update after success
```

#### Testing
- Unit tests for version update logic
- Integration tests for push workflow
- Error handling tests for 409 responses

### Week 2: Testing & Documentation

#### Deliverables
- [ ] **FR-15**: Auto-correction for version typos
  - Detect version mismatch on push
  - Auto-fetch correct version
  - Update local frontmatter
  - Prompt user to retry

- [ ] **Testing**: Comprehensive test suite
  - Push with version update
  - Push failure (no version update)
  - 409 conflict handling
  - Version auto-correction

- [ ] **Documentation**:
  - Update README with version tracking feature
  - Add migration guide for existing users
  - Document frontmatter schema

#### Success Criteria
- ✅ All tests passing
- ✅ Version tracking works on 100% of pushes
- ✅ 409 errors handled gracefully
- ✅ Documentation complete

### Phase 1 Release
- **Version**: v2.0.0-alpha.1
- **Release Date**: End of Week 2
- **Rollout**: Internal testing only
- **Metrics to Monitor**:
  - Version update success rate
  - 409 error frequency
  - Version auto-correction success rate

---

## Phase 2: Core Pull - Basic Sync
**Duration**: 3 weeks (Week 3-5)  
**Release**: v2.0.0-beta.1  
**Goal**: Enable pulling content from Confluence

### Week 3: Pull Infrastructure

#### Deliverables
- [ ] **FR-2**: Pull from Confluence command
  - Add "Pull from Confluence" command
  - Add context menu item
  - Implement basic pull workflow

- [ ] **FR-3**: Version comparison logic
  - Compare local vs remote versions
  - Determine sync strategy (pull/skip/error)
  - Handle all version comparison cases

- [ ] **API**: New methods
  ```typescript
  pullFromConfluence(file: TFile): Promise<void>
  compareVersions(local: number, remote: number): VersionComparisonResult
  ```

#### Testing
- Unit tests for version comparison
- Integration tests for pull workflow
- Mock API responses for testing

### Week 4: Pull UI & User Experience

#### Deliverables
- [ ] **UI**: Pull Confirmation Modal
  - Show diff preview
  - Display version information
  - Provide confirm/cancel actions

- [ ] **FR-6**: First-time sync handling
  - Detect missing version
  - Show first-time sync dialog
  - Provide pull/keep/diff options

- [ ] **FR-7**: Invalid state detection
  - Detect local version > remote
  - Show error dialog
  - Provide reset option

#### Code Changes
```typescript
// New UI components
PullConfirmationModal
FirstTimeSyncModal
InvalidStateModal

// New methods
showPullDiff(file: TFile, remotePage: PageContent): Promise<void>
applyPull(file: TFile, remotePage: PageContent): Promise<void>
```

#### Testing
- UI interaction tests
- First-time sync scenarios
- Invalid state handling

### Week 5: Error Handling & Polish

#### Deliverables
- [ ] **FR-12**: Deleted page handling
  - Detect 404 errors
  - Show deleted page dialog
  - Provide unlink/create options

- [ ] **NFR-8**: Comprehensive error handling
  - Handle all API error codes
  - Provide clear error messages
  - Log errors for debugging

- [ ] **Testing**: End-to-end scenarios
  - Complete pull workflow
  - Error scenarios (404, 403, 401)
  - Edge cases (empty content, large files)

- [ ] **Documentation**:
  - Pull feature documentation
  - Troubleshooting guide
  - FAQ updates

#### Success Criteria
- ✅ Pull command works for all version states
- ✅ All error cases handled gracefully
- ✅ User testing feedback positive (> 4.0/5)
- ✅ Documentation complete

### Phase 2 Release
- **Version**: v2.0.0-beta.1
- **Release Date**: End of Week 5
- **Rollout**: Beta release to 10% of users
- **Metrics to Monitor**:
  - Pull success rate (target > 90%)
  - Error rate by type
  - User satisfaction score
  - Time to first pull (new users)

---

## Phase 3: Smart Merge - Conflict Resolution
**Duration**: 4 weeks (Week 6-9)  
**Release**: v2.0.0-rc.1  
**Goal**: Prevent data loss through intelligent conflict detection

### Week 6: Content Hash Tracking

#### Deliverables
- [ ] **FR-4**: Content hash implementation
  - Implement hash calculation function
  - Store hash in frontmatter after sync
  - Add `confluence-content-hash` field

- [ ] **FR-4**: Local change detection
  - Compare current hash vs stored hash
  - Detect uncommitted local changes
  - Return boolean result

- [ ] **Data Model**: Enhanced frontmatter
  ```yaml
  confluence-page-id: string
  confluence-content-hash: string
  confluence-last-sync: string
  ```

#### Code Changes
```typescript
// New methods
hashContent(content: string): string
detectLocalChanges(file: TFile): Promise<boolean>
updateSyncMetadata(file: TFile, version: number, content: string): Promise<void>

// Modified methods
applyPull() // Update hash after pull
uploadContent() // Update hash after push
```

#### Testing
- Hash calculation accuracy
- Local change detection
- Hash persistence in frontmatter

### Week 7: 3-Way Merge UI

#### Deliverables
- [ ] **FR-5**: Three-way merge modal
  - Local changes panel
  - Remote changes panel
  - Merged result panel
  - Quick action buttons

- [ ] **UI**: Merge resolution workflow
  - Show both versions side-by-side
  - Allow manual editing
  - Provide "Use Local" / "Use Remote" shortcuts

#### Code Changes
```typescript
// New UI component
ThreeWayMergeModal

// New methods
performThreeWayMerge(file: TFile, remotePage: PageContent): Promise<void>
showMergeUI(local: string, remote: string): Promise<string>
```

#### Testing
- UI rendering tests
- Merge resolution scenarios
- User acceptance testing

### Week 8: Transaction Safety & Protection

#### Deliverables
- [ ] **FR-9**: Transaction safety
  - Implement backup before changes
  - Atomic content + frontmatter updates
  - Rollback on failure

- [ ] **FR-10**: Active edit protection
  - Detect if file is open in editor
  - Show warning before pull
  - Preserve cursor position if possible

- [ ] **FR-8**: URL change detection
  - Store page ID separately
  - Detect URL changes
  - Reset version tracking

#### Code Changes
```typescript
// New methods
createBackup(file: TFile): Promise<FileBackup>
rollbackChanges(file: TFile, backup: FileBackup): Promise<void>
detectActiveEdit(file: TFile): boolean
detectUrlChange(file: TFile): Promise<boolean>

// Modified methods
applyPull() // Wrap in transaction
performThreeWayMerge() // Wrap in transaction
```

#### Testing
- Transaction rollback scenarios
- Network failure simulation
- Active edit detection
- URL change detection

### Week 9: Integration & Testing

#### Deliverables
- [ ] **Integration**: Connect all components
  - Pull workflow with conflict detection
  - Merge workflow with transaction safety
  - Error handling across all scenarios

- [ ] **Testing**: Comprehensive test suite
  - All 18 scenarios from analysis
  - Performance testing (large files)
  - Stress testing (rapid operations)

- [ ] **Documentation**:
  - Conflict resolution guide
  - Best practices for team collaboration
  - Troubleshooting advanced scenarios

#### Success Criteria
- ✅ Zero data loss in testing
- ✅ All 18 scenarios pass
- ✅ Transaction rollback works 100%
- ✅ Performance meets NFR-1 targets

### Phase 3 Release
- **Version**: v2.0.0-rc.1
- **Release Date**: End of Week 9
- **Rollout**: Beta release to 50% of users
- **Metrics to Monitor**:
  - Data loss incidents (target = 0)
  - Merge completion rate (target > 90%)
  - Rollback success rate (target = 100%)
  - User satisfaction (target > 4.5/5)

---

## Phase 4: Polish - Advanced Features
**Duration**: 3 weeks (Week 10-12)  
**Release**: v2.0.0  
**Goal**: Enhance UX with automation and batch operations

### Week 10: Auto-Sync & Batch Operations

#### Deliverables
- [ ] **FR-13**: Auto-sync on vault open
  - Add setting: "Auto-sync on vault open"
  - Implement batch pull for all linked notes
  - Queue conflicts for manual resolution

- [ ] **FR-14**: Rate limiting
  - Implement request queue
  - Limit to 5 requests/second
  - Exponential backoff on 429 errors

- [ ] **UI**: Conflict queue management
  - Show list of conflicted notes
  - Allow one-click resolution
  - Batch conflict resolution

#### Code Changes
```typescript
// New classes
RateLimitedQueue
ConflictQueue

// New methods
autoSyncAllNotes(): Promise<void>
showConflictQueue(): void
batchPull(files: TFile[]): Promise<void>

// New settings
enableAutoSync: boolean
rateLimitRequestsPerSecond: number
```

#### Testing
- Auto-sync workflow
- Rate limiting behavior
- Batch operation performance

### Week 11: Advanced Features & Warnings

#### Deliverables
- [ ] **FR-9**: Duplicate link warnings
  - Detect multiple notes → same page
  - Show informational warning
  - Don't block operation

- [ ] **FR-10**: Enhanced offline support
  - Better error messages for offline edits
  - Quick "Pull & Merge" action
  - Version diff summary

- [ ] **FR-16**: Space change detection
  - Detect when page moves to different space
  - Auto-update URL in frontmatter
  - Show notification

- [ ] **FR-17**: Image conflict handling
  - Detect image differences
  - Show image preview in merge UI
  - Download remote images

#### Code Changes
```typescript
// New methods
checkForDuplicateLinks(file: TFile, pageId: string): Promise<void>
detectSpaceChange(file: TFile, remotePage: PageContent): Promise<void>
handleImageConflicts(local: string, remote: string): Promise<void>
```

#### Testing
- Duplicate link detection
- Space change scenarios
- Image conflict resolution

### Week 12: Final Polish & Release Prep

#### Deliverables
- [ ] **Performance**: Optimization
  - Profile slow operations
  - Optimize hash calculation
  - Cache version checks

- [ ] **UX**: Final polish
  - Improve error messages
  - Add loading indicators
  - Enhance diff view styling

- [ ] **Documentation**: Complete package
  - User guide (with screenshots)
  - API documentation
  - Migration guide
  - Video tutorials

- [ ] **Testing**: Final validation
  - Full regression test suite
  - Performance benchmarks
  - User acceptance testing

#### Success Criteria
- ✅ All features complete
- ✅ Performance meets all NFR targets
- ✅ Documentation complete
- ✅ User testing score > 4.5/5

### Phase 4 Release
- **Version**: v2.0.0
- **Release Date**: End of Week 12
- **Rollout**: Full release to 100% of users
- **Metrics to Monitor**:
  - Adoption rate (target > 60%)
  - Pull operations per user per week (target > 3)
  - Overall satisfaction (target > 4.5/5)

---

## Week 13: Release & Monitoring
**Duration**: 1 week  
**Goal**: Ensure stable release and gather feedback

### Deliverables
- [ ] **Release**: v2.0.0 to production
  - Publish to Obsidian Community Plugins
  - Announce on forum and social media
  - Update plugin description

- [ ] **Monitoring**: Track metrics
  - Monitor error logs
  - Track adoption metrics
  - Gather user feedback

- [ ] **Support**: User assistance
  - Monitor support channels
  - Create FAQ from common questions
  - Fix critical bugs (hotfix releases)

### Success Criteria
- ✅ No critical bugs reported
- ✅ Adoption > 10% in first week
- ✅ User satisfaction > 4.5/5
- ✅ Zero data loss incidents

---

## Milestones & Dependencies

### Critical Path
```
Version Tracking (P1) 
    ↓
Pull Infrastructure (P2)
    ↓
Content Hash Tracking (P3)
    ↓
3-Way Merge (P3)
    ↓
Transaction Safety (P3)
    ↓
Release (P4)
```

### Dependencies
- **Phase 2** depends on **Phase 1** (version tracking required for pull)
- **Phase 3** depends on **Phase 2** (pull infrastructure required for merge)
- **Phase 4** depends on **Phase 3** (conflict detection required for auto-sync)

### Parallel Work Opportunities
- Documentation can be written in parallel with development
- UI design can be done ahead of implementation
- Testing can start as soon as features are code-complete

---

## Risk Management

### High-Risk Items
| Risk | Mitigation | Owner | Status |
|------|------------|-------|--------|
| Data loss from merge bugs | Extensive testing, transaction safety | Dev Team | Planned |
| Performance issues | Performance testing, optimization | Dev Team | Planned |
| User confusion | User testing, clear documentation | Product | Planned |
| API rate limiting | Rate limiting implementation | Dev Team | Planned |

### Contingency Plans
- **If Phase 3 takes longer**: Delay Phase 4, release Phase 3 as v2.0.0
- **If critical bug found**: Rollback to previous version, fix, re-release
- **If adoption is low**: Gather feedback, iterate on UX, re-launch

---

## Success Metrics

### Adoption Metrics
- **Week 1**: > 10% of users try pull feature
- **Week 4**: > 30% of users use pull regularly
- **Week 12**: > 60% of users use pull feature

### Quality Metrics
- **Pull success rate**: > 95%
- **Conflict resolution success rate**: > 90%
- **Data loss incidents**: 0
- **Rollback success rate**: 100%

### User Satisfaction
- **Feature satisfaction**: > 4.5/5
- **Net Promoter Score**: > 50
- **Support ticket rate**: < 5%

---

## Resource Requirements

### Development Team
- **1 Senior Developer**: Lead implementation, architecture
- **1 Mid-Level Developer**: Feature implementation, testing
- **1 QA Engineer**: Test planning, execution
- **1 Technical Writer**: Documentation

### Tools & Infrastructure
- Development environment (Obsidian, Node.js, TypeScript)
- Testing infrastructure (Jest, integration test framework)
- Monitoring tools (error logging, analytics)
- Documentation platform (GitHub Pages, video hosting)

---

## Communication Plan

### Weekly Updates
- **Monday**: Sprint planning, task assignment
- **Wednesday**: Mid-week sync, blocker resolution
- **Friday**: Demo, retrospective, metrics review

### Stakeholder Updates
- **Bi-weekly**: Progress report to stakeholders
- **End of each phase**: Demo and feedback session
- **Pre-release**: Beta user communication

### User Communication
- **Phase 1**: Internal announcement
- **Phase 2**: Beta user invitation
- **Phase 3**: Beta expansion announcement
- **Phase 4**: Full release announcement
- **Post-release**: Feature highlight blog posts

---

## Post-Release Roadmap

### v2.1.0 (Future)
- Version history viewer
- Pull specific version (not just latest)
- Scheduled auto-sync
- Conflict resolution templates

### v2.2.0 (Future)
- Real-time collaboration indicators
- Merge conflict auto-resolution (AI-powered)
- Bulk operations UI
- Advanced diff view (word-level, syntax highlighting)

### v3.0.0 (Future)
- Bidirectional real-time sync
- Operational Transform (OT) support
- Multi-user presence indicators
- Collaborative editing

---

## Appendix

### Definition of Done
A feature is "done" when:
- ✅ Code complete and reviewed
- ✅ Unit tests written and passing (> 80% coverage)
- ✅ Integration tests passing
- ✅ Documentation complete
- ✅ User testing completed (> 4.0/5 satisfaction)
- ✅ Performance benchmarks met
- ✅ Accessibility requirements met

### Release Checklist
- [ ] All tests passing
- [ ] Documentation updated
- [ ] CHANGELOG updated
- [ ] Version bumped
- [ ] Release notes written
- [ ] Beta testing completed
- [ ] Performance benchmarks met
- [ ] Security review completed
- [ ] Accessibility review completed
- [ ] Community announcement prepared

---

**Roadmap Version**: 1.0  
**Last Updated**: 2026-01-12  
**Next Review**: 2026-01-26 (bi-weekly)
