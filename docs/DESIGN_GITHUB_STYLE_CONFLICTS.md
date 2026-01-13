# Design: GitHub-Style Conflict Resolution

**Date**: 2026-01-12  
**Status**: Proposed  
**Inspiration**: GitHub, VS Code, Git merge conflicts

---

## 🎯 Goal

Replace the current modal-based conflict resolution with **inline conflict markers** similar to GitHub/VS Code.

---

## 📊 Current vs Proposed

### Current (Modal-based)
```
User pushes → Conflicts detected → Modal opens
  ┌─────────────────────────────────────┐
  │ Conflict Resolution Modal           │
  ├─────────────────────────────────────┤
  │ Local (Yours)  │  Remote (Theirs)   │
  │ ┌───────────┐  │  ┌───────────┐     │
  │ │ Your text │  │  │ Their text│     │
  │ └───────────┘  │  └───────────┘     │
  ├─────────────────────────────────────┤
  │ Resolution: [Keep Local ▼]          │
  │ [Cancel] [Resolve & Push]           │
  └─────────────────────────────────────┘
```

**Problems:**
- ❌ Requires switching between modal and file
- ❌ Can't see full context
- ❌ Can't edit directly
- ❌ Unfamiliar to developers

### Proposed (Inline markers)
```
User pushes → Conflicts detected → Markers inserted into file

# Your Note

Some unchanged content...

<<<<<<< Local (Your Version)
Project deadline: Friday
Team: Alice, Bob
=======
Project deadline: Monday
Budget: $50,000
>>>>>>> Remote (Confluence)

[Accept Current] [Accept Incoming] [Accept Both] [Edit Manually]

More unchanged content...
```

**Benefits:**
- ✅ Familiar to developers (GitHub/Git style)
- ✅ Edit directly in the file
- ✅ See full context
- ✅ Quick action buttons
- ✅ Can manually edit the conflict region

---

## 🔧 Implementation Design

### 1. Conflict Marker Format

```markdown
<<<<<<< Local (Your Version)
[Your local content here]
=======
[Remote Confluence content here]
>>>>>>> Remote (Confluence)
```

**Terminology:**
- `<<<<<<< Local` = "Current Change" (your version)
- `=======` = Separator
- `>>>>>>> Remote` = "Incoming Change" (their version)

---

### 2. UI Components

#### A. Inline Action Buttons (CodeMirror Extension)

Display above each conflict block:

```
┌─────────────────────────────────────────────────────────┐
│ 🔀 Conflict 1 of 3                                      │
│ [Accept Current] [Accept Incoming] [Accept Both] [Edit] │
└─────────────────────────────────────────────────────────┘
<<<<<<< Local (Your Version)
Your content
=======
Their content
>>>>>>> Remote (Confluence)
```

#### B. Status Bar Indicator

```
┌─────────────────────────────────────────────────────────┐
│ 🔀 3 conflicts remaining | [Resolve All] [Push Anyway]  │
└─────────────────────────────────────────────────────────┘
```

---

### 3. User Workflow

#### Step 1: Push with Conflicts
```
User clicks "Push to Confluence"
  ↓
Detect conflicts
  ↓
Insert conflict markers into file
  ↓
Show notification: "3 conflicts detected. Resolve them in the file."
  ↓
File opens with markers and action buttons
```

#### Step 2: Resolve Conflicts

**Option A: Quick Actions**
```
Click [Accept Current]
  ↓
Replace conflict block with local content
  ↓
Remove markers
  ↓
Update conflict count
```

**Option B: Manual Edit**
```
Click [Edit]
  ↓
Remove action buttons
  ↓
User edits the conflict region directly
  ↓
User deletes markers manually
  ↓
Update conflict count
```

**Option C: Accept Both**
```
Click [Accept Both]
  ↓
Replace conflict block with:
  Local content
  Remote content
  ↓
Remove markers
```

#### Step 3: Push After Resolution
```
All conflicts resolved
  ↓
Status bar shows: "✅ All conflicts resolved"
  ↓
User clicks "Push to Confluence"
  ↓
Content pushed successfully
```

---

## 💻 Technical Implementation

### File Structure

```
src/
  conflict/
    conflict-marker.ts       # Insert/remove markers
    conflict-detector.ts     # Detect conflicts in file
    conflict-resolver.ts     # Handle resolution actions
    conflict-widget.ts       # CodeMirror widget for buttons
  ui/
    conflict-status-bar.ts   # Status bar component
```

---

### Core Classes

#### 1. ConflictMarker

```typescript
class ConflictMarker {
    // Insert conflict markers into content
    insertMarkers(
        content: string,
        conflicts: ConflictBlock[]
    ): string {
        // For each conflict, insert:
        // <<<<<<< Local (Your Version)
        // [local content]
        // =======
        // [remote content]
        // >>>>>>> Remote (Confluence)
    }

    // Detect conflicts in marked content
    detectMarkers(content: string): ConflictRegion[] {
        // Parse content for conflict markers
        // Return array of conflict regions
    }

    // Remove markers after resolution
    removeMarkers(
        content: string,
        region: ConflictRegion,
        resolution: 'current' | 'incoming' | 'both'
    ): string {
        // Replace conflict region with resolved content
    }
}
```

#### 2. ConflictWidget (CodeMirror Extension)

```typescript
class ConflictWidget extends WidgetType {
    constructor(
        private conflictIndex: number,
        private totalConflicts: number,
        private onResolve: (action: string) => void
    ) {}

    toDOM(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'conflict-actions';
        
        // Title
        const title = container.createEl('span', {
            text: `🔀 Conflict ${this.conflictIndex + 1} of ${this.totalConflicts}`
        });

        // Buttons
        const acceptCurrent = container.createEl('button', {
            text: 'Accept Current'
        });
        acceptCurrent.onclick = () => this.onResolve('current');

        const acceptIncoming = container.createEl('button', {
            text: 'Accept Incoming'
        });
        acceptIncoming.onclick = () => this.onResolve('incoming');

        const acceptBoth = container.createEl('button', {
            text: 'Accept Both'
        });
        acceptBoth.onclick = () => this.onResolve('both');

        return container;
    }
}
```

#### 3. ConflictStatusBar

```typescript
class ConflictStatusBar {
    private statusBarItem: HTMLElement;

    update(conflictCount: number) {
        if (conflictCount === 0) {
            this.statusBarItem.setText('✅ All conflicts resolved');
        } else {
            this.statusBarItem.setText(
                `🔀 ${conflictCount} conflict${conflictCount > 1 ? 's' : ''} remaining`
            );
        }
    }

    addResolveAllButton(onClick: () => void) {
        // Add "Resolve All" button to status bar
    }
}
```

---

### Modified Push Workflow

```typescript
async pushToConfluence(file: TFile): Promise<void> {
    // ... existing code to fetch remote ...

    // Perform diff
    const diffResult = await diffEngine.compare(localMarkdown, remoteContent);

    if (diffResult.hasConflicts) {
        // NEW: Insert conflict markers instead of showing modal
        const markedContent = this.conflictMarker.insertMarkers(
            localMarkdown,
            diffResult.conflicts
        );

        // Update file with markers
        await this.app.vault.modify(file, markedContent);

        // Show notification
        new Notice(
            `🔀 ${diffResult.conflicts.length} conflicts detected. ` +
            `Resolve them in the file and push again.`,
            10000
        );

        // Update status bar
        this.statusBar.update(diffResult.conflicts.length);

        // Add CodeMirror widgets for action buttons
        this.addConflictWidgets(file, diffResult.conflicts);

        // Don't push yet - wait for user to resolve
        return;
    }

    // No conflicts - proceed with push
    await this.uploadContent(...);
}
```

---

## 🎨 UI Design

### Conflict Marker Styling

```css
/* Conflict region background */
.conflict-region {
    background-color: rgba(255, 0, 0, 0.1);
    border-left: 3px solid #ff0000;
    padding: 4px 0;
}

/* Conflict markers */
.conflict-marker {
    color: #888;
    font-family: monospace;
    font-size: 0.9em;
    user-select: none;
}

.conflict-marker.current {
    color: #4CAF50; /* Green for current */
}

.conflict-marker.incoming {
    color: #2196F3; /* Blue for incoming */
}

/* Action buttons */
.conflict-actions {
    display: flex;
    gap: 8px;
    padding: 8px;
    background-color: rgba(0, 0, 0, 0.05);
    border-radius: 4px;
    margin: 4px 0;
}

.conflict-actions button {
    padding: 4px 12px;
    border-radius: 3px;
    border: 1px solid #ccc;
    background-color: white;
    cursor: pointer;
}

.conflict-actions button:hover {
    background-color: #f0f0f0;
}

.conflict-actions button.accept-current {
    border-color: #4CAF50;
    color: #4CAF50;
}

.conflict-actions button.accept-incoming {
    border-color: #2196F3;
    color: #2196F3;
}

.conflict-actions button.accept-both {
    border-color: #FF9800;
    color: #FF9800;
}
```

---

## 📝 Example Scenarios

### Scenario 1: Simple Text Conflict

**Before resolution:**
```markdown
# Project Status

<<<<<<< Local (Your Version)
Status: In Progress
Deadline: Friday, Jan 15
=======
Status: In Progress
Deadline: Monday, Jan 18
>>>>>>> Remote (Confluence)

[Accept Current] [Accept Incoming] [Accept Both]
```

**After clicking "Accept Incoming":**
```markdown
# Project Status

Status: In Progress
Deadline: Monday, Jan 18
```

---

### Scenario 2: Multiple Conflicts

**File with 3 conflicts:**
```markdown
# Project Plan

<<<<<<< Local (Your Version)
Team: Alice, Bob
=======
Team: Alice, Bob, Charlie
>>>>>>> Remote (Confluence)

[Accept Current] [Accept Incoming] [Accept Both]

## Budget

<<<<<<< Local (Your Version)
Budget: $100,000
=======
Budget: $150,000
>>>>>>> Remote (Confluence)

[Accept Current] [Accept Incoming] [Accept Both]

## Timeline

<<<<<<< Local (Your Version)
Timeline: 3 months
=======
Timeline: 4 months
>>>>>>> Remote (Confluence)

[Accept Current] [Accept Incoming] [Accept Both]
```

**Status bar shows:** `🔀 3 conflicts remaining`

---

### Scenario 3: Manual Edit

**User clicks "Edit" or manually edits:**
```markdown
# Project Status

<<<<<<< Local (Your Version)
Status: In Progress
Deadline: Friday, Jan 15
=======
Status: In Progress
Deadline: Monday, Jan 18
>>>>>>> Remote (Confluence)
```

**User manually edits to:**
```markdown
# Project Status

Status: In Progress
Deadline: TBD (discuss with team)
```

**Markers removed, conflict resolved!**

---

## 🚀 Implementation Phases

### Phase 1: Basic Markers (Week 1)
- ✅ Insert conflict markers on conflict detection
- ✅ Detect markers in file
- ✅ Remove markers on resolution
- ✅ Basic "Accept Current/Incoming/Both" logic

### Phase 2: UI Widgets (Week 2)
- ✅ CodeMirror widgets for action buttons
- ✅ Status bar indicator
- ✅ Conflict region highlighting
- ✅ Click handlers for quick actions

### Phase 3: Advanced Features (Week 3)
- ✅ "Resolve All" command
- ✅ Keyboard shortcuts
- ✅ Conflict navigation (next/previous)
- ✅ Undo resolution

---

## 🎯 Benefits

### For Users
1. **Familiar** - Same as GitHub/VS Code
2. **Contextual** - See full file while resolving
3. **Flexible** - Quick actions OR manual edit
4. **Visual** - Clear markers and highlighting
5. **Efficient** - Resolve multiple conflicts quickly

### For Development
1. **Standard** - Uses well-known conflict marker format
2. **Simple** - No complex modal UI
3. **Extensible** - Easy to add more actions
4. **Testable** - Clear input/output for markers

---

## 📚 References

- **Git conflict markers**: Standard `<<<<<<<`, `=======`, `>>>>>>>` format
- **VS Code merge editor**: Inline action buttons
- **GitHub conflict resolution**: Web-based conflict editor
- **CodeMirror decorations**: For widgets and highlighting

---

## ✅ Next Steps

1. **Prototype** conflict marker insertion/removal
2. **Design** CodeMirror widget for action buttons
3. **Implement** basic resolution actions
4. **Test** with real conflicts
5. **Polish** UI and styling
6. **Document** user guide

---

**Status**: Design complete, ready for implementation  
**Estimated effort**: 2-3 weeks  
**Priority**: High (better UX than modal)
