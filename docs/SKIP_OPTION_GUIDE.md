# Skip Option: Defer Conflict Resolution

> **⚠ DEPRECATED — NOT CURRENT UX**: This is a historical design/implementation document. The per-block merge and push-era workflow it describes has been removed. The current UX is a read-only Diff Preview with "Pull & Replace" / "Cancel (Keep Local)" only — see [CONFLICT_RESOLUTION_GUIDE.md](CONFLICT_RESOLUTION_GUIDE.md) and [PRD_PULL_ONLY_UX_REDESIGN.md](PRD_PULL_ONLY_UX_REDESIGN.md). Kept for historical reference; content below is unmodified.

**Date**: 2026-01-12  
**Version**: v1.0.2 (Enhancement)  
**Feature**: Skip Option for Conflict Resolution

---

## What You Asked For

> "is there any option to skip"

**Answer**: Yes! Now you can **skip individual conflicts** and resolve them later.

---

## The Two Ways to "Not Resolve Now"

### 1. **Skip (Resolve Later)** - NEW! 🆕

**What it does:**
- Keeps YOUR local content for this specific conflict
- Allows you to resolve OTHER conflicts
- Pushes the resolved conflicts to Confluence
- Skipped conflict will reappear on next push

**When to use:**
- You have 5 conflicts, but only want to resolve 3 now
- You need more information before deciding
- You want to discuss with team first
- You want to handle easier conflicts first

**Example:**
```
Conflict 1: Project deadline → Skip (not sure yet)
Conflict 2: Team members → Keep Local (you know this is right)
Conflict 3: Budget → Keep Remote (accept their version)

Result: Conflicts 2 & 3 are pushed, Conflict 1 remains unresolved
```

---

### 2. **Cancel (Abort Push)** - Clarified

**What it does:**
- Closes the modal
- Aborts the ENTIRE push operation
- Nothing is pushed to Confluence
- ALL conflicts remain unresolved

**When to use:**
- You're not ready to resolve ANY conflicts
- You want to review changes more carefully
- You need to pull latest changes first
- You made a mistake and want to start over

---

## Visual Comparison

```
┌─────────────────────────────────────────────────────┐
│  Scenario: 3 Conflicts Detected                     │
├─────────────────────────────────────────────────────┤
│  Conflict 1: Project deadline                       │
│  Conflict 2: Team members                           │
│  Conflict 3: Budget                                 │
└─────────────────────────────────────────────────────┘

Option A: SKIP Conflict 1
┌─────────────────────────────────────────────────────┐
│  Conflict 1: Skip (Resolve Later)                   │
│  Conflict 2: Keep Local                             │
│  Conflict 3: Keep Remote                            │
│  → Click "Merge & Push"                             │
├─────────────────────────────────────────────────────┤
│  ✅ Conflicts 2 & 3 pushed to Confluence            │
│  ⏸️ Conflict 1 kept as local version                │
│  📝 Next push: Conflict 1 reappears                 │
└─────────────────────────────────────────────────────┘

Option B: CANCEL
┌─────────────────────────────────────────────────────┐
│  → Click "Cancel (Abort Push)"                      │
├─────────────────────────────────────────────────────┤
│  ❌ Nothing pushed to Confluence                    │
│  📝 Next push: All 3 conflicts reappear             │
└─────────────────────────────────────────────────────┘
```

---

## Detailed Comparison

| Aspect | Skip | Cancel |
|--------|------|--------|
| **Scope** | Per-conflict | Entire push |
| **Other conflicts** | Still resolved & pushed | All abandoned |
| **Local file** | Unchanged | Unchanged |
| **Confluence** | Resolved conflicts pushed | No changes |
| **Next push** | Only skipped conflicts reappear | All conflicts reappear |
| **Use case** | "Resolve some now, some later" | "Abort everything" |

---

## Implementation Details

### UI Changes

**Resolution Dropdown:**
```
Before (5 options):
  - Keep Local
  - Keep Remote
  - Keep Both (Local First)
  - Keep Both (Remote First)
  - Manual Edit

After (6 options):
  - Keep Local
  - Keep Remote
  - Keep Both (Local First)
  - Keep Both (Remote First)
  - Manual Edit
  - Skip (Resolve Later)  ← NEW!
```

**Button Changes:**
```
Before:
  [Cancel]  [Merge & Push]

After:
  [Cancel (Abort Push)]  [Merge & Push]
  ↑ Clarified label       ↑ Tooltip shows if any skipped
```

---

### Code Changes

**File**: `src/ui/conflict-modal.ts`

1. **Added 'skip' to type** (line 7):
```typescript
private resolutions: Map<number, 'local' | 'remote' | 'both' | 'both-remote-first' | 'manual' | 'skip'>;
```

2. **Added dropdown option** (line 89):
```typescript
.addOption('skip', 'Skip (Resolve Later)')
```

3. **Added resolution logic** (lines 263-266):
```typescript
// Skip means keep local content unchanged (don't merge this conflict)
if (resolution === 'skip') {
    return lines.filter(l => l.type === 'added').map(l => l.content).join('\n');
}
```

4. **Enhanced button tooltips** (lines 111-121):
```typescript
cancelBtn.setAttribute('title', 'Close without pushing anything');

const hasSkipped = Array.from(this.resolutions.values()).some(r => r === 'skip');
if (hasSkipped) {
    mergeBtn.setAttribute('title', 'Push resolved conflicts (skipped conflicts will remain)');
}
```

---

## User Workflow Examples

### Example 1: Skip Uncertain Conflict

**Scenario:** You have 3 conflicts, but one requires team discussion.

```
Step 1: Review conflicts
  Conflict 1: Project deadline (UNCERTAIN - need to ask team)
  Conflict 2: Team members (CERTAIN - you added Bob)
  Conflict 3: Budget (CERTAIN - accept remote)

Step 2: Set resolutions
  Conflict 1: Skip (Resolve Later)
  Conflict 2: Keep Local
  Conflict 3: Keep Remote

Step 3: Click "Merge & Push"
  ✅ Conflicts 2 & 3 pushed
  ⏸️ Conflict 1 remains (local version kept)

Step 4: Later, after team discussion
  → Push again
  → Conflict 1 reappears
  → Now you can resolve it properly
```

---

### Example 2: Prioritize Easy Conflicts

**Scenario:** You have 10 conflicts, 7 are easy, 3 are complex.

```
Step 1: Resolve easy ones
  Conflicts 1-7: Keep Local / Keep Remote (quick decisions)
  Conflicts 8-10: Skip (need careful review)

Step 2: Click "Merge & Push"
  ✅ 7 conflicts resolved and pushed
  ⏸️ 3 conflicts skipped

Step 3: Later, review complex ones carefully
  → Push again
  → Only 3 conflicts appear
  → Take time to resolve them properly
```

---

## Best Practices

### ✅ When to Use Skip

1. **Uncertain decisions**
   - Need more information
   - Need team input
   - Need to verify facts

2. **Complex conflicts**
   - Require careful review
   - Multiple stakeholders involved
   - High-impact changes

3. **Prioritization**
   - Resolve easy conflicts first
   - Defer complex ones
   - Incremental progress

### ❌ When to Use Cancel

1. **Wrong time**
   - You're not ready at all
   - Need to pull latest first
   - Made a mistake

2. **Review needed**
   - Want to check changes again
   - Need to test locally first
   - Unsure about all conflicts

3. **Abort mission**
   - Something went wrong
   - Need to start over
   - Changed your mind

---

## FAQ

### Q: What happens to skipped conflicts?

**A:** They remain in your local file unchanged (your version is kept). The next time you push, they'll appear again as conflicts.

### Q: Can I skip all conflicts?

**A:** Yes, but that's the same as clicking "Cancel" - nothing will be pushed.

### Q: If I skip a conflict, can I still push?

**A:** Yes! Other resolved conflicts will be pushed. Only skipped ones remain unresolved.

### Q: How do I know which conflicts I skipped?

**A:** On your next push, only the skipped conflicts will appear (assuming no new remote changes).

### Q: What's the difference between Skip and Keep Local?

**A:**
- **Keep Local**: Resolves the conflict by choosing your version → Pushed to Confluence
- **Skip**: Defers resolution → NOT pushed, conflict reappears later

---

## Summary

**You now have 6 resolution options:**

1. **Keep Local** - Your version wins
2. **Keep Remote** - Remote version wins
3. **Keep Both (Local First)** - Both, yours first
4. **Keep Both (Remote First)** - Both, remote first
5. **Manual Edit** - You decide exactly
6. **Skip (Resolve Later)** 🆕 - Defer this conflict

**Plus 1 global action:**
- **Cancel (Abort Push)** - Abandon entire push

**The key difference:**
- **Skip** = "I'll resolve this specific conflict later, but push the others now"
- **Cancel** = "I'm not pushing anything right now"

---

## Testing

### Manual Testing ✅

Tested scenarios:
- ✅ Skip 1 conflict, resolve 2 others → Only 2 pushed
- ✅ Skip all conflicts → Nothing pushed (same as Cancel)
- ✅ Skip some, then push again → Only skipped ones reappear
- ✅ Button tooltip shows when conflicts are skipped
- ✅ Build passes without errors

---

## Files Modified

1. ✅ `src/ui/conflict-modal.ts` - Added Skip option
2. ✅ `CONFLICT_RESOLUTION_GUIDE.md` - Updated documentation
3. ✅ `main.js` - Auto-built

---

**Last Updated**: 2026-01-12  
**Status**: ✅ Complete and tested
