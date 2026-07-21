# Apples-to-Apples 記憶體驗證報告(Phase 2 Before/After)

Verifier: code-reviewer(獨立量測,未引用實作者數據)。日期:2026-07-20。
所有量測工件在 `/tmp/memverify/`,工作樹零污染(驗證前後 `git status --porcelain` 均為實作者原有 25 個項目)。

## Verdict: PASS — peak memory 改善 51.9%(門檻 ≥15%),語義指標完全一致,零 crash

---

## 1. Before 版本重建:來源與可比性論證

**Git 無法重建**:`git log` 最後 commit `372dc99` 遠早於 Phase 1/2(工作樹是單一 dirty state,Phase 1 清理與 Phase 2 優化都未分段 commit,`git stash` 只有 v1.0.0 時代的 WIP)。無法從 Git 取得「Phase 1 後、Phase 2 前」邊界。

**改用 review 時保存的 baseline artifact**(依任務指示的 fallback):
- `/tmp/prof-diff-engine.js`(629,933 bytes,mtime Jul 20 23:06)— 本人於技術債審核時以 esbuild 從當時磁碟 source bundle 而成,複製為 `/tmp/memverify/before-diff-engine.js`。
- **邊界證明(符號指紋)**:before bundle 含 `diff_match_patch`×100、`convertToLines`×2、`identifyConflicts`×2、`isIdentical`×1、`preprocessStorageToCleanHtml`×0 → 已含 H1 修正(isIdentical)、未含 Phase 2 修改 = 正確的「Phase 2 前」狀態。After bundle(現行磁碟 source 以**同一 esbuild 0.17.3、同一命令**重建):`diff_match_patch`×0、`preprocessStorageToCleanHtml`×2。
- **Phase 1 不影響可比性**:Phase 1 只刪 converters/conflict/client mutation 方法,未觸碰 `diff-engine.ts`/`file-diff-view.ts`/`markdown-normalizer.ts`,故此 artifact 同時等價於「Phase 1 清理後」的量測邊界。
- `file-diff-view` bundle before/after `cmp` **byte-identical** → Phase 2 未動 modal diff 路徑,`computeFileDiff` 為共同 control。

**可比性限制**:artifact 是 bundle 而非 source,無法逐行 diff 對應原始 TS;但其符號指紋唯一對應 Phase-2 前實作,且 fixture/runner/Node 完全相同,對 RSS/heap 對比無影響。

## 2. 方法(exact)

- **環境**:Node v20.12.0、esbuild 0.17.3、jsdom(workspace node_modules)、macOS arm64。
- **Bundle 命令(兩版相同)**:`npx esbuild <entry> --bundle --format=cjs --platform=node --outfile=<out> --external:obsidian`
- **Fixture(兩版相同、determinstic)**:`makeStorage(15000, 100)` = 3,766,120 bytes storage XHTML(15000 段落 + 100 個 20×3 表格含 colgroup/cell 內 `<p>`);local = remote markdown 每 20 行加 ` [local edit]`(5%)。與審核 baseline 腳本同款。
- **Runner**:`/tmp/memverify/runner.js` — 每次執行為**獨立冷啟動子程序**(排除 jest/jsdom 累積污染);流程 = compare(空,storage) 導出 remoteMd → makeLocal → 量測目標 compare(local,storage) → computeFileDiff;輸出 md5、語義指標、in-process heap/rss。
- **量測命令(兩版相同,各 3 次)**:
  `/usr/bin/time -l node --expose-gc runner.js <engine-bundle> <fdv-bundle>`
  外部 `maximum resident set size` 為主指標(不受 in-process GC 時點影響);in-process `heapUsed` 為輔。

## 3. 原始數據(每次)

### Before(3 runs)
| run | max RSS (bytes→MB) | heapUsed after compare | 2nd compare | computeFileDiff | fdvDiffs | crash |
|---|---|---|---|---|---|---|
| 1 | 2,368,225,280 → 2258.5 | 1220.8MB | 14,915ms | 2189ms | 3110 | no |
| 2 | 2,315,927,552 → 2208.6 | 858.4MB | 17,087ms | 2140ms | 3110 | no |
| 3 | 2,380,988,416 → 2270.7 | 981.8MB | 16,904ms | 2338ms | 3110 | no |

### After(3 runs)
| run | max RSS (bytes→MB) | heapUsed after compare | 2nd compare | computeFileDiff | fdvDiffs | crash |
|---|---|---|---|---|---|---|
| 1 | 1,161,773,056 → 1079.9* | 164.0MB | 12,391ms | 2229ms | 3110 | no |
| 2 | 1,132,314,624 → 1086.7* | 507.4MB | 12,677ms | 1982ms | 3110 | no |
| 3 | 1,139,441,664 → 1108.0* | 255.0MB | 12,004ms | 1893ms | 3110 | no |

\* 排序後對應值;原始順序 run1=1107.98、run2=1079.88、run3=1086.68MB。

## 4. 計算(中位數)

| 指標 | Before median | After median | 改善 |
|---|---|---|---|
| **max RSS(外部量測,主指標)** | **2258.5MB** | **1086.7MB** | **-51.9%** |
| heapUsed after compare(輔) | 981.8MB | 255.0MB | -74.0% |
| 2nd compare 時間 | 16,904ms | 12,391ms | -26.7% |
| computeFileDiff(control,未修改路徑) | 2140ms | 1982ms | ~雜訊內 |

計算式:improvement = 1 − median(After)/median(Before)。max RSS 三次變異 Before ±1.4%、After ±1.3%,遠小於 51.9% 效果量。

## 5. 語義一致性(兩版 6 次全部相同)

- `remoteMd_md5 = 7c58cc55210f4a83bedb3d24a4e3c193`(轉換輸出 byte-identical)
- `resultLocal_md5 = ba1ad3dd33727cee2b15fb700a7e3679`、`isIdentical=false`、`hasConflicts=true`
- `fdvDifferences = 3110`(衝突塊數一致)
- 契約差異符合預期:Before `hasDiffLinesField=true`、After `false`(DiffResult 瘦身)
- 6 個子程序全部正常結束,零 crash

## 6. 與實作者報告的對照(獨立取得,非引用)

實作者報告 max RSS 2334→1157MB(-50.4%);本次獨立量測 2258.5→1086.7MB(-51.9%)。兩者一致在同一效果量級,交叉印證成立。

## 7. 限制

1. Before 來自 review 時的 bundle artifact 而非 Git 重建(Git 歷史缺 Phase 邊界 commit);符號指紋 + Phase 1 不觸及此路徑的論證見 §1。
2. jsdom 環境的絕對值高於 Electron/Chromium 原生 DOMParser;但兩版同環境同 fixture,相對改善有效。
3. `--expose-gc` 僅供 runner 內部快照一致性,量測期間未手動觸發 GC 影響 max RSS。
4. in-process heapUsed 變異較大(GC 時點非決定性),故以外部 max RSS 為准。

## 8. 結論

門檻「peak memory 改善 ≥15%」以主指標 max RSS **-51.9%** 明確通過(輔指標 heap -74.0% 同向),語義輸出 md5 級一致、衝突數一致、零 crash。**PASS。**
