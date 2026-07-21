# Code Review — One-Way Sync (Confluence → Obsidian)

Reviewer: code-reviewer (read-only). Date: 2026-07-20.
Scope: `src/services/sync-service.ts`, `src/main.ts`, `src/ui/conflict-modal.ts`, `src/ui/file-diff-view.ts`, `src/diff/diff-engine.ts`, `src/api/confluence-client.ts`, `src/api/page-resolver.ts`, `src/utils/*`, `tests/unit/sync-service.test.ts`, README/manifest/package.

Verification commands run:
- `npx jest --silent` → 3 suites, 23 tests, all PASS.
- `npx tsc -noEmit -skipLibCheck` → exit 0.

## Contract audit: "Sync may read Confluence, never mutate it" — HOLDS

Traced every caller. `syncFromConfluence` (sync-service.ts:32) reaches only:
- `apiClient.getPage` (confluence-client.ts:33) — GET
- `resolver.resolvePageId` → `getPage` / `searchContent` (page-resolver.ts:17,29) — GET

Mutation methods `updatePage` (confluence-client.ts:69) and `uploadAttachment` (confluence-client.ts:101) exist but their only caller is `ImageHandler.processImages` (src/converters/image-handler.ts:68), which is only reachable from `src/converters/markdown-converter.ts` — which is imported by **nothing** in `src/` (verified by grep; only a test imports it). No push path exists from any entrypoint in main.ts (ribbon :39, command :52, file-menu :70, editor-menu :85 — all call `syncFromConfluence` only).

Caveat: because `confluence-client.ts` is imported as a whole class, `updatePage`/`uploadAttachment` still ship inside the bundled `main.js` (dead but present).

---

## Findings

### HIGH

**H1 — Identical-content path is a silent no-op with the REAL diff engine; the test masks it.**
- Evidence: `DiffEngine.compare` returns `hasConflicts: conflicts.length > 0` (diff-engine.ts:130). For identical content there are zero changed lines → `hasConflicts === false`. In sync-service.ts:111-115 the `else` branch is **empty** (comment only). So a first-time sync of an identical note produces no notice and never writes `confluence-version`.
- The branch that handles "identical" (sync-service.ts:84-88) requires `hasConflicts === true` AND all lines unchanged — unreachable with the real engine.
- Test masking: tests/unit/sync-service.test.ts:171-191 mocks DiffEngine with `hasConflicts: true` + unchanged lines (test defaults at :111-121), a state the real engine never produces. The test passes; the real behavior is broken.
- Failure scenario: user syncs a note identical to remote → "Checking for conflicts..." notice, then silence; version baseline never recorded.

**H2 — "Apply to Local Note" silently rewrites the note body with NORMALIZED content (formatting data loss), even when the user accepts all-local.**
- Evidence chain: `DiffEngine.compare` returns `localContent: normalizedLocal` (diff-engine.ts:134) → passed to modal (conflict-modal.ts:48) → `FileDiffView` splits it into `this.localLines` (file-diff-view.ts:163) → `buildResolvedContent` reconstructs the file from those normalized lines (:377-378) → sync-service writes it via `vault.modify` (sync-service.ts:98).
- Normalization (markdown-normalizer.ts) rewrites: `*` list markers → `-` (:28), unescapes `\[ \* \_ \:` (:32), tabs → spaces (:35), all indentation re-quantized to 2-space units (:39-45), multiple inner spaces collapsed (:57-59), table separators collapsed (:49-55), NBSP → space, trailing blank lines dropped (:79-81).
- Failure scenario: note contains 4-space-indented code-like lists, aligned tables, or intentional double spaces → user clicks Apply with "Accept Local" everywhere → file is rewritten with altered formatting; no warning, no undo hint.

**H3 — Credential exfiltration vector: Authorization header sent to whatever host `confluence-url` points to.**
- Evidence: the target base URL comes from note frontmatter (sync-service.ts:42, url-parser.ts:13), and the client attaches `Bearer <apiToken>` for any non-atlassian.net host (confluence-client.ts:24-27). There is no validation against a configured/trusted base URL.
- Failure scenario: user imports or receives a shared note with `confluence-url: https://evil.example.com/wiki/spaces/X/pages/123/T`, right-clicks "Sync from Confluence" → the plugin sends their Confluence PAT to the attacker's server. One click, silent token theft (OWASP A01/SSRF-adjacent).

**H4 — No same-file reentrancy guard; concurrent syncs interleave writes.**
- Evidence: no in-flight tracking anywhere in sync-service.ts; four independent triggers in main.ts (:39, :52, :70, :85). The modal flow is fire-and-forget (`showConflictResolution` returns right after `modal.open()`, sync-service.ts:150-162), so `syncFromConfluence` resolves while a modal is still pending.
- Failure scenario: user triggers sync, modal opens; triggers sync again (ribbon/hotkey) → second fetch + second modal over the same file. Applying modal A then modal B overwrites A's merge with a resolution computed from a stale snapshot (the local read at sync-service.ts:68 happened before A's write). Lost update, no error.

**H5 — Plugin declares mobile support but uses Node `fs`/`path` and `adapter.basePath` → breaks on mobile.**
- Evidence: manifest.json:9 `"isDesktopOnly": false`; logger.ts:2-3 imports `path`/`fs` and appends synchronously (:49); main.ts:23 reads `this.app.vault.adapter.basePath` (undefined on mobile) and passes it to `path.join` (logger.ts:14) → TypeError during `onload`, plugin fails to load on iOS/Android.

### MEDIUM

**M1 — Modal closes even when the local apply fails; the retry UI is dead code.**
- Evidence: sync-service's `onResolve` callback catches its own errors and does NOT rethrow (sync-service.ts:105-108). Therefore `await this.onResolve(...)` in conflict-modal.ts:52 always succeeds → `this.close()` (:53) runs; the "don't close on error / re-enable button" paths (conflict-modal.ts:54-57, file-diff-view.ts:200-205) can never trigger.
- Failure scenario: disk write fails → error notice appears, but the modal closes as if applied; the user's per-block resolutions are lost and must be redone from a full re-sync.

**M2 — Body/frontmatter write is non-atomic and based on stale captures.**
- Evidence: frontmatter is captured at sync-service.ts:69 (before the modal opens); on Apply (arbitrarily later), `vault.modify` writes `stale frontmatter + merged body` (:97-98), then a SECOND write updates the version (:101 via processFrontMatter). Local content is modified before the version marker.
- Failure scenarios: (a) frontmatter edited (by user/another plugin/Obsidian Sync) while modal open → those edits are overwritten with the stale copy; (b) crash between the two writes → new body with old version marker (fail-safe direction: next sync re-diffs, no remote risk — acceptable, but should be documented); (c) `vault.read` (:68) bypasses unsaved editor buffers; a safer primitive is `vault.process` (atomic read-modify-write).

**M3 — Remote page fetched twice per sync; resolver cache adds a stale layer that is then ignored.**
- Evidence: for URLs containing a pageId, `resolvePageId` calls `getPage` (page-resolver.ts:17), then sync-service calls `getPage` again (:64). The cached version in `CachedPageResolver` (TTL 1h, page-resolver.ts:74) is never used for diffing — good for correctness (the fresh `remotePage.version.number` at :79 is what gets recorded), but the duplicate round-trip doubles latency and API load; the cache never invalidates on 404.

**M4 — Debug logger writes full note + full remote page content to a plaintext file on every sync.**
- Evidence: diff-engine.ts:28-46 logs raw local markdown, raw remote XHTML, and both normalized bodies (full `content`) at info level; logger appends synchronously with `fs.appendFileSync` on the UI thread (logger.ts:49) with no rotation/size cap. With debug enabled, `debug.log` grows unboundedly and duplicates potentially sensitive vault/Confluence content to disk.

**M5 — Remote-version is recorded but never validated.**
- Evidence: `confluence-version` frontmatter is written (sync-service.ts:88,101) but never read/compared. There is no "remote unchanged since last pull" fast path, and no staleness warning if the remote version advanced while the modal was open (fetch at :64 vs Apply arbitrarily later). Pull-only design makes this safe (worst case: version marker says v7 while remote is v9; next sync re-diffs), but it defeats the stated purpose of version tracking.

### LOW (optional cleanup — none block ship)

- **L1** `DiffEngine.convertToLines` maps character-based diff_match_patch output to lines incorrectly for partial-line edits (diff-engine.ts:139-198, self-admitted in comments). Only consumed by the (broken, see H1) identical-check; the modal recomputes its own diff with a different library (`diff`/structuredPatch, file-diff-view.ts:43). Two diff engines can disagree about whether a difference exists.
- **L2** `btoa` throws on non-ASCII email/token characters (confluence-client.ts:23).
- **L3** Dead code shipped in bundle: `updatePage`, `uploadAttachment`, `createMultipartBody`, `ImageHandler`, `markdown-converter` — unreachable but present in main.js.
- **L4** `private get settings()` getter is a no-op passthrough (sync-service.ts:23-25); `saveSettings` recreates the whole service on every settings save (main.ts:115).
- **L5** Stray `test-frontmatter.ts` at repo root; build artifact `main.js` committed at root.
- **L6** `identifyConflicts` `modified` branch is dead (diff-engine.ts:228-233); DMP never emits it.

### Explicitly KEEP (compatibility)

- Command id `'push-to-confluence'` in main.ts:53 — intentionally retained so existing user hotkeys keep working; documented in the comment at main.ts:49-51 and invisible to users (display name is "Sync current note from Confluence"). Keep.

---

## Test fidelity assessment

- All 23 tests pass, but **the "identical content" test (sync-service.test.ts:171-191) validates a code path the real DiffEngine can never enter** (mock returns `hasConflicts: true` with all-unchanged lines; real engine returns `false`). This is false confidence hiding H1.
- The modal and `FileDiffView` are fully mocked — `buildResolvedContent` (the actual merge algorithm) and the normalization-overwrite defect (H2) have zero coverage.
- `expectNoRemoteWrites` (:81-89) checks only the first constructed client instance; adequate today (single client), fragile if a second client is ever constructed.
- `flushAsync` (25 ms setTimeout, :73-75) is timing-based and brittle; the root cause is the fire-and-forget modal design (H4/M1).
- The write-methods-must-reject pattern (:96-102) is good defensive design — keep it.

## Smallest high-value fix set (recommended order)

1. **H1**: collapse the two identical branches — after `compare`, if `normalizedLocal === normalizedRemote` (expose a boolean like `isIdentical` instead of overloading `hasConflicts`) → notice + `updateVersionInFrontmatter`; otherwise open the modal. Removes the dead `else`.
2. **H2**: pass the ORIGINAL `localBody` and un-normalized converted remote markdown to the modal (add `remoteMarkdown` to `DiffResult`); `computeFileDiff` already normalizes internally for comparison, so display/merge can use originals with no algorithm change.
3. **H3**: before creating the API client, verify the parsed host matches the configured base URL (settings already has `baseUrl`) or an explicit allowlist; abort with a clear notice otherwise.
4. **H4**: add a `private syncing = new Set<string>()` guard keyed on `file.path`; refuse (notice) if a sync for that file is already in flight; clear it in the modal's cancel and resolve paths (turn `showConflictResolution` into a real Promise resolved on close/cancel).
5. **H5**: set `"isDesktopOnly": true` in manifest (one line) — or replace the fs-based logger with `vault.adapter.append`.
6. **M1**: rethrow from the `onResolve` catch in sync-service.ts:105-108 (after `handleError`) so the modal's existing keep-open/retry logic activates.

Fixes 1, 2, 4 are pure sync-path changes; 3 is ~10 lines; 5 is one line. M2-M5 and all LOWs can be deferred.

## Regression tests required

1. **Real-DiffEngine identical test** (unmock DiffEngine): identical local/remote → `processFrontMatter` called with fetched version, `vault.modify` NOT called, notice shown. (Fails today → drives H1.)
2. **Round-trip fidelity**: Apply with all blocks "Accept Local" → written body is byte-identical to the original local body (tabs, `*` markers, escapes preserved). (Fails today → drives H2.)
3. **Host validation**: `confluence-url` host differing from configured base → aborts before `ConfluenceApiClient` is constructed; no request, no credential sent.
4. **Reentrancy**: second `syncFromConfluence(sameFile)` while first is pending → rejected with notice; only one modal constructed; only one `vault.modify`.
5. **Apply failure**: `vault.modify` rejects → modal NOT closed, version marker not advanced (extends the existing test at :224-236 with a modal-close assertion).
6. **FileDiffView.buildResolvedContent unit tests**: local/remote/both permutations, unequal-length blocks, adjacent blocks, empty-line blocks.

## Ship verdict

**Not safe to ship as-is.** The core contract (Confluence is never mutated) is verified and holds — no Critical remote-write defect exists. But H1 (silent no-op + test masking), H2 (silent local formatting corruption on every Apply), H3 (one-click credential exfiltration via note frontmatter), and H5 (guaranteed mobile load failure while advertising mobile support) individually justify blocking release. After fixes 1-5 plus regression tests 1-4, this is releasable.
