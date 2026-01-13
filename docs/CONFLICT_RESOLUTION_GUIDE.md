# Conflict Resolution Behaviors Explained

**Document Version**: 1.0  
**Last Updated**: 2026-01-12  
**Applies To**: Obsidian Confluence Sync Plugin v1.0.0+

---

## Overview

When you push a note to Confluence and the remote page has been modified, the plugin detects a **conflict** and presents you with resolution options. This document explains each behavior in detail.

---

## When Do Conflicts Occur?

Conflicts happen when:
1. **You have local changes** in your Obsidian note
2. **Someone else has made changes** to the Confluence page
3. **Both changes affect the same content**

**Example Scenario:**
```
1. You edit your note: "Project deadline: Friday"
2. Colleague edits Confluence: "Project deadline: Monday"
3. You try to push → Conflict detected!
```

---

## Resolution Options

The plugin offers **6 resolution strategies**:

### 1. **Keep Local** (Default)

**What it does:**
- Keeps YOUR changes from Obsidian
- Discards the remote changes from Confluence
- Pushes your version to Confluence (overwriting remote)

**When to use:**
- You know your changes are correct
- The remote changes are outdated or incorrect
- You want to overwrite what's on Confluence

**Example:**
```markdown
Local (Yours):     "Project deadline: Friday"
Remote (Theirs):   "Project deadline: Monday"
Result:            "Project deadline: Friday"  ← Your version wins
```

**Code behavior:**
```typescript
// From conflict-modal.ts line 268
if (resolution === 'local') return localPart;
```

---

### 2. **Keep Remote**

**What it does:**
- Discards YOUR local changes
- Accepts the remote changes from Confluence
- Updates your Obsidian note with Confluence content

**When to use:**
- The remote changes are more up-to-date
- You want to accept what's on Confluence
- You made a mistake locally and want to revert

**Example:**
```markdown
Local (Yours):     "Project deadline: Friday"
Remote (Theirs):   "Project deadline: Monday"
Result:            "Project deadline: Monday"  ← Remote version wins
```

**Code behavior:**
```typescript
// From conflict-modal.ts line 269
if (resolution === 'remote') return remotePart;
```

---

### 3. **Keep Both (Local First)**

**What it does:**
- Combines BOTH your local changes AND remote changes
- Appends remote content **after** local content
- Creates a merged version with both sets of changes

**When to use:**
- Both changes are valuable and don't conflict
- You want YOUR changes to appear first
- You'll manually clean up the merged result later

**Example:**
```markdown
Local (Yours):     "Project deadline: Friday"
Remote (Theirs):   "Project deadline: Monday"
Result:            "Project deadline: Friday
                    Project deadline: Monday"  ← Local first, then remote
```

**Code behavior:**
```typescript
// From conflict-modal.ts line 267
if (resolution === 'both') return localPart + '\n' + remotePart;  // Local first
```

**⚠️ Warning:** This can create duplicate or contradictory content. You may need to manually edit the result.

---

### 4. **Keep Both (Remote First)** 🆕

**What it does:**
- Combines BOTH your local changes AND remote changes
- Appends local content **after** remote content
- Creates a merged version with remote changes prioritized

**When to use:**
- You want to preserve both versions but prioritize remote
- Remote changes are more authoritative
- You want to see remote version first for context

**Example:**
```markdown
Local (Yours):     "Project deadline: Friday"
Remote (Theirs):   "Project deadline: Monday"
Result:            "Project deadline: Monday
                    Project deadline: Friday"  ← Remote first, then local
```

**Code behavior:**
```typescript
// From conflict-modal.ts line 268
if (resolution === 'both-remote-first') return remotePart + '\n' + localPart;  // Remote first
```

**💡 Tip:** This is useful when you want to see the "official" version first, followed by your alternative or notes.

---

### 5. **Manual Edit**

**What it does:**
- Shows a text area where you can manually edit the content
- Pre-fills with your local content by default
- Gives you complete control over the final result

**When to use:**
- You want to cherry-pick parts from both versions
- You need to write a completely new version
- The conflict requires human judgment to resolve

**Example:**
```markdown
Local (Yours):     "Project deadline: Friday"
Remote (Theirs):   "Project deadline: Monday"
Manual Edit:       "Project deadline: TBD (discuss with team)"  ← Custom resolution
```

**Code behavior:**
```typescript
// From conflict-modal.ts line 261-262
if (resolution === 'manual') {
    return this.manualContents.get(index) || '';
}
```

**UI Behavior:**
- A textarea appears below the resolution dropdown
- You can type or paste your desired content
- Changes are saved as you type

---

### 6. **Skip (Resolve Later)** 🆕

**What it does:**
- Keeps your LOCAL content unchanged for this conflict
- Defers resolution to later
- Allows you to resolve other conflicts first
- Useful when you have multiple conflicts and want to handle them separately

**When to use:**
- You're not ready to decide on this conflict yet
- You want to resolve easier conflicts first
- You need more information before deciding
- You want to discuss with team before merging

**Example:**
```markdown
Local (Yours):     "Project deadline: Friday"
Remote (Theirs):   "Project deadline: Monday"
Resolution: Skip   → Keeps "Friday" (your local version) for now
```

**Code behavior:**
```typescript
// From conflict-modal.ts
if (resolution === 'skip') {
    return lines.filter(l => l.type === 'added').map(l => l.content).join('\n');
    // Keeps local content unchanged
}
```

**💡 Important Notes:**
- **Skip ≠ Cancel**: Skip keeps your local content; Cancel aborts the entire push
- **Multiple conflicts**: You can skip some conflicts and resolve others
- **Next push**: Skipped conflicts will appear again on your next push attempt
- **Local preserved**: Your local changes remain safe and unchanged

**Difference from Cancel:**

| Action | Skip | Cancel |
|--------|------|--------|
| **What happens** | Keeps local content for this conflict | Aborts entire push operation |
| **Other conflicts** | Still resolved and pushed | Nothing is pushed |
| **Your local file** | Unchanged | Unchanged |
| **Confluence** | Other resolved conflicts are pushed | No changes made |
| **Next push** | Skipped conflicts reappear | All conflicts reappear |

---

## Visual Conflict Resolution UI

### Current Implementation (v1.0.0)

The conflict modal shows:

```
┌─────────────────────────────────────────────────────┐
│  Confluence Sync - Conflicts Detected               │
├─────────────────────────────────────────────────────┤
│  Conflict 1 of 3          [Previous] [Next]         │
├──────────────────────┬──────────────────────────────┤
│  Local (Yours)       │  Remote (Theirs)             │
│  ┌────────────────┐  │  ┌────────────────┐          │
│  │ Your changes   │  │  │ Their changes  │          │
│  │ shown here     │  │  │ shown here     │          │
│  └────────────────┘  │  └────────────────┘          │
├──────────────────────┴──────────────────────────────┤
│  Resolution: [Keep Local ▼]                         │
│                                                      │
│  [Cancel]                    [Merge & Push]         │
└─────────────────────────────────────────────────────┘
```

**Features:**
- **Side-by-side comparison** of local vs remote changes
- **Navigation** between multiple conflicts (if any)
- **Dropdown selector** for resolution strategy
- **Manual edit textarea** (appears when "Manual Edit" selected)
- **Color-coded diff** (added lines, removed lines, unchanged)

---

## Future Implementation (Phase 3)

### FR-5: 3-Way Merge Resolution

**Planned for Phase 3 (Weeks 6-9):**

```
┌─────────────────────────────────────────────────────────────────┐
│  3-Way Merge - Conflict Resolution                              │
├──────────────┬──────────────┬──────────────┬────────────────────┤
│  Local       │  Remote      │  Base        │  Merged Result     │
│  (Yours)     │  (Theirs)    │  (Original)  │  (Editable)        │
│  ┌────────┐  │  ┌────────┐  │  ┌────────┐  │  ┌──────────────┐ │
│  │ Your   │  │  │ Their  │  │  │ Last   │  │  │ Final result │ │
│  │ changes│  │  │ changes│  │  │ synced │  │  │ (you edit)   │ │
│  └────────┘  │  └────────┘  │  └────────┘  │  └──────────────┘ │
├──────────────┴──────────────┴──────────────┴────────────────────┤
│  Quick Actions:                                                  │
│  [Use Local]  [Use Remote]  [Auto-Merge]  [Manual Edit]        │
│                                                                  │
│  [Cancel]                                  [Apply Merge]        │
└──────────────────────────────────────────────────────────────────┘
```

**Enhancements:**
- **Base version** panel showing last synced state
- **Intelligent auto-merge** for non-conflicting changes
- **Editable merged result** panel
- **Word-level diff** (not just line-level)
- **Syntax highlighting** for code blocks

---

## Detailed Behavior Matrix

| Scenario | Keep Local | Keep Remote | Keep Both (Local First) | Keep Both (Remote First) | Manual Edit |
|----------|-----------|-------------|------------------------|-------------------------|-------------|
| **You added a line** | ✅ Your line | ❌ Line removed | ✅ Your line first | ✅ Your line second | ✏️ You decide |
| **They added a line** | ❌ Line ignored | ✅ Their line | ✅ Their line second | ✅ Their line first | ✏️ You decide |
| **Both added different lines** | ✅ Your line | ✅ Their line | ✅ Yours, then theirs | ✅ Theirs, then yours | ✏️ You decide |
| **You modified a line** | ✅ Your version | ❌ Original kept | ⚠️ Duplicate (yours first) | ⚠️ Duplicate (yours second) | ✏️ You decide |
| **They modified a line** | ❌ Your version | ✅ Their version | ⚠️ Duplicate (theirs second) | ⚠️ Duplicate (theirs first) | ✏️ You decide |
| **Both modified same line** | ✅ Your version | ✅ Their version | ⚠️ Yours, then theirs | ⚠️ Theirs, then yours | ✏️ You decide |

**Legend:**
- ✅ = Content included in result
- ❌ = Content discarded
- ⚠️ = May create duplicates or conflicts
- ✏️ = You manually decide

---

## Code Implementation Details

### How Conflicts Are Detected

```typescript
// From diff-engine.ts (conceptual)
1. Fetch remote Confluence content
2. Convert to markdown
3. Compare with local markdown using diff algorithm
4. Identify conflicting blocks:
   - Lines added locally (type: 'added')
   - Lines removed remotely (type: 'removed')
   - Lines modified by both (type: 'modified')
```

### How Resolutions Are Applied

```typescript
// From conflict-modal.ts line 259-272
private resolveConflictBlock(
    index: number, 
    lines: DiffLine[], 
    resolution: 'local' | 'remote' | 'both' | 'manual'
): string {
    if (resolution === 'manual') {
        return this.manualContents.get(index) || '';
    }

    const localPart = lines
        .filter(l => l.type === 'added')
        .map(l => l.content)
        .join('\n');
    
    const remotePart = lines
        .filter(l => l.type === 'removed')
        .map(l => l.content)
        .join('\n');

    if (resolution === 'local') return localPart;
    if (resolution === 'remote') return remotePart;
    if (resolution === 'both') return localPart + '\n' + remotePart;
    
    return localPart; // Default to local
}
```

### Full Merge Process

```typescript
// From conflict-modal.ts line 136-256
1. Iterate through all diff lines
2. Group consecutive changed lines into conflict blocks
3. For each conflict block:
   a. Check user's resolution choice
   b. Apply resolution strategy
   c. Add resolved content to result
4. Preserve unchanged lines between conflicts
5. Return merged content
```

---

## Best Practices

### ✅ Recommended Approaches

1. **Review before resolving**
   - Always read both local and remote changes
   - Understand what changed and why

2. **Use "Keep Local" for minor formatting**
   - If you just fixed typos or formatting
   - If remote changes are clearly outdated

3. **Use "Keep Remote" for collaborative edits**
   - If colleague added important information
   - If you want to sync with team's latest version

4. **Use "Keep Both" temporarily**
   - When you need to see both versions side-by-side
   - Plan to manually clean up afterward

5. **Use "Manual Edit" for complex conflicts**
   - When both versions have valuable content
   - When you need to merge intelligently

### ❌ Common Pitfalls

1. **Don't blindly choose "Keep Local"**
   - You might lose important remote updates
   - Always review what's being discarded

2. **Don't use "Keep Both" as final solution**
   - It often creates duplicate or contradictory content
   - Use it as a stepping stone to manual edit

3. **Don't ignore conflicts**
   - Clicking "Cancel" doesn't resolve the issue
   - The conflict will reappear on next push

---

## Examples from Real Scenarios

### Example 1: Documentation Update

**Scenario:** You and a colleague both updated the same documentation page.

```markdown
# Original (Last Sync)
Project Status: In Progress
Deadline: TBD

# Local (Yours)
Project Status: In Progress
Deadline: January 15, 2026
Team: Alice, Bob

# Remote (Theirs)
Project Status: In Progress
Deadline: January 20, 2026
Budget: $50,000
```

**Best Resolution:** **Manual Edit**
```markdown
# Merged Result
Project Status: In Progress
Deadline: January 20, 2026  ← Take remote (more recent)
Team: Alice, Bob             ← Keep local (new info)
Budget: $50,000              ← Keep remote (new info)
```

---

### Example 2: Typo Fix vs Content Update

**Scenario:** You fixed a typo while colleague added content.

```markdown
# Original
The project requiers attention.

# Local (Yours)
The project requires attention.  ← Fixed typo

# Remote (Theirs)
The project requiers immediate attention and budget approval.
```

**Best Resolution:** **Manual Edit**
```markdown
# Merged Result
The project requires immediate attention and budget approval.
← Fixed typo + kept new content
```

---

### Example 3: Conflicting Decisions

**Scenario:** You and colleague made opposite decisions.

```markdown
# Original
Feature X: Under Review

# Local (Yours)
Feature X: Approved ✅

# Remote (Theirs)
Feature X: Rejected ❌
```

**Best Resolution:** **Manual Edit** (or discuss with team!)
```markdown
# Merged Result
Feature X: Pending team discussion (conflicting decisions)
```

---

## Troubleshooting

### "I chose 'Keep Local' but my changes are gone!"

**Cause:** You may have had multiple conflicts and resolved them differently.

**Solution:** 
- Review all conflicts before clicking "Merge & Push"
- Use "Previous/Next" buttons to check each conflict
- Consider using "Cancel" and reviewing changes first

---

### "Keep Both created duplicate content"

**Cause:** This is expected behavior - both versions are appended.

**Solution:**
- Use "Manual Edit" instead
- Or use "Keep Both" then manually clean up the result

---

### "I can't see what changed"

**Cause:** The diff view shows line-level changes, which may be hard to read.

**Solution:**
- Phase 3 will add word-level diff highlighting
- For now, carefully read both panels
- Copy content to external diff tool if needed

---

## Future Enhancements

### Phase 3 (Weeks 6-9)

- ✅ **3-way merge** with base version
- ✅ **Intelligent auto-merge** for non-conflicting changes
- ✅ **Word-level diff** highlighting
- ✅ **Editable merged result** panel

### Phase 4 (Weeks 10-12)

- ✅ **Conflict templates** for common scenarios
- ✅ **Merge history** to undo bad merges
- ✅ **AI-powered merge suggestions** (future consideration)

---

## Summary

| Resolution | Use When | Result | Risk |
|-----------|----------|--------|------|
| **Keep Local** | Your changes are correct | Your version wins | May lose remote updates |
| **Keep Remote** | Remote is more up-to-date | Remote version wins | May lose your work |
| **Keep Both (Local First)** | Need both, yours prioritized | Local + Remote | Creates duplicates |
| **Keep Both (Remote First)** | Need both, remote prioritized | Remote + Local | Creates duplicates |
| **Manual Edit** | Complex conflict | You decide exactly | Requires careful review |
| **Skip (Resolve Later)** 🆕 | Not ready to decide | Keeps local, defer resolution | Conflict reappears next push |

**Default:** Keep Local (safest for your work)  
**Recommended:** Manual Edit (most control)  
**New Options:**  
- **Keep Both (Remote First)** - See "official" version first  
- **Skip** - Defer this conflict, resolve others now

---

## Related Documentation

- **PRD**: `PRD_VERSION_CONTROL_PULL.md` - FR-5 (3-Way Merge Resolution)
- **Roadmap**: `ROADMAP_VERSION_CONTROL.md` - Phase 3 (Smart Merge)
- **Code**: `src/ui/conflict-modal.ts` - Implementation details

---

**Questions?** See `MIGRATION_GUIDE.md` or open a GitHub issue.
