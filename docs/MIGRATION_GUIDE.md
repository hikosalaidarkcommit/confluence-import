# Migration Guide: Version Control Feature

**From**: v1.0.0  
**To**: v2.0.0-alpha.1  
**Date**: 2026-01-12

---

## Overview

Version 2.0.0 introduces **version tracking** to prepare for bidirectional sync capabilities. This guide helps existing users understand what's changed and what to expect.

---

## What's New

### Automatic Version Tracking

Starting with v2.0.0-alpha.1, the plugin automatically tracks the Confluence page version after each successful push. This enables:

1. **Concurrent Edit Detection**: The plugin can now detect when someone else has edited the Confluence page
2. **Conflict Prevention**: You'll be warned before accidentally overwriting someone else's changes
3. **Future Pull Support**: Version tracking is the foundation for pulling changes from Confluence (coming in Phase 2)

---

## Changes to Your Notes

### Before (v1.0.0)

```yaml
---
confluence-url: https://mycompany.atlassian.net/wiki/spaces/DOCS/pages/123456
---
```

### After First Push (v2.0.0+)

```yaml
---
confluence-url: https://mycompany.atlassian.net/wiki/spaces/DOCS/pages/123456
confluence-version: 42
---
```

**The `confluence-version` field is added automatically** - you don't need to do anything!

---

## Migration Steps

### For Existing Users

**Good news**: No action required! 🎉

1. **Update the plugin** to v2.0.0-alpha.1
2. **Continue using as normal** - push your notes as you always have
3. **Version tracking starts automatically** on your next push

### What Happens to Existing Notes?

- **First push after upgrade**: The plugin will add `confluence-version` to your frontmatter
- **No data loss**: All your existing notes continue to work exactly as before
- **Gradual adoption**: Version tracking is added note-by-note as you push them

---

## New Behavior

### Concurrent Edit Detection

**Scenario**: You push a note, then a colleague edits the same page on Confluence, then you try to push again.

**Old Behavior (v1.0.0)**:
- Your changes would overwrite your colleague's changes
- No warning given
- Potential data loss

**New Behavior (v2.0.0+)**:
- ⚠️ **Warning displayed**: "Someone else edited this page. Please pull latest changes before pushing."
- Push is blocked
- No data loss

### Version Mismatch Handling

If the plugin detects a version conflict (409 error from Confluence API):

1. **You see a clear warning** explaining what happened
2. **Your local changes are safe** - nothing is overwritten
3. **You can resolve the conflict** by reviewing the changes (in Phase 2, you'll be able to pull and merge)

---

## Troubleshooting

### "Version updated on Confluence but failed to update local metadata"

**Cause**: The push succeeded, but the plugin couldn't update your note's frontmatter.

**Impact**: Low - your content is safely on Confluence, but version tracking may be out of sync.

**Solution**:
1. Check if your note file is read-only
2. Ensure Obsidian has write permissions
3. Try pushing again - the plugin will auto-correct the version

### Manual Version Editing

**⚠️ Warning**: Don't manually edit the `confluence-version` field unless you know what you're doing.

**If you accidentally change it**:
- The plugin will detect the mismatch on next push
- You may see a 409 conflict error
- Simply delete the `confluence-version` field and push again to reset

---

## Backward Compatibility

### Can I downgrade to v1.0.0?

**Yes**, but:
- The `confluence-version` field will be ignored by v1.0.0
- It won't cause errors, but you'll lose concurrent edit protection
- Not recommended - v2.0.0 is strictly better

### Will my old notes work?

**Yes!** Notes without `confluence-version` are treated as "first-time sync" and work normally.

---

## What's Coming Next

### Phase 2: Pull from Confluence (Weeks 3-5)

- Pull latest content from Confluence into Obsidian
- See what changed since your last sync
- Merge remote changes with your local edits

### Phase 3: Smart Merge (Weeks 6-9)

- Automatic conflict detection
- 3-way merge UI
- Transaction safety (rollback on errors)

### Phase 4: Advanced Features (Weeks 10-12)

- Auto-sync on vault open
- Batch operations
- Conflict queue management

---

## FAQ

### Q: Do I need to add `confluence-version` manually?

**A**: No! It's added automatically after your first push.

### Q: What if I delete the `confluence-version` field?

**A**: No problem. The plugin will treat it as a first-time sync and add it back on the next push.

### Q: Can I use v2.0.0 without version tracking?

**A**: Version tracking is automatic and can't be disabled. It's a core feature that prevents data loss.

### Q: Will this slow down my pushes?

**A**: No. Version tracking adds negligible overhead (< 10ms).

### Q: What if two people push at the exact same time?

**A**: Confluence's API handles this with 409 errors. The second person will be warned and can retry after reviewing changes.

---

## Getting Help

- **Issues**: Report bugs on [GitHub Issues](https://github.com/yourusername/obsidian-confluence-sync/issues)
- **Discussions**: Ask questions in [GitHub Discussions](https://github.com/yourusername/obsidian-confluence-sync/discussions)
- **Documentation**: See [README.md](../README.md) for full documentation

---

**Last Updated**: 2026-01-12  
**Plugin Version**: v2.0.0-alpha.1
