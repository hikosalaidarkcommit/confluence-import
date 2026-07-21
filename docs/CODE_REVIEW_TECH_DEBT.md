# 技術債審核報告 — 死碼移除 + 大型頁面記憶體

Reviewer: code-reviewer(唯讀,未修改任何檔案)。日期:2026-07-20。
Baseline:`npx jest --silent` → 4 suites / 37 tests 全數通過;`npx tsc -noEmit -skipLibCheck` → exit 0。Node v20.12.0。

---

## Part 1 — 不可達遠端寫入鏈:逐項可刪性證明

追蹤方法:grep 全部 `src/`+`tests/` 的 import 與呼叫點,並 grep 現行 `main.js` bundle。

### 可刪(無 active caller)

| 項目 | 位置 | 證據 |
|---|---|---|
| `updatePage` | confluence-client.ts:69 | 唯一 caller 是 docs 範例與 mock;src/ 內零呼叫 |
| `uploadAttachment` | confluence-client.ts:101 | 唯一 caller `ImageHandler.processImages`(image-handler.ts:68),本身死碼 |
| `createMultipartBody` | confluence-client.ts:134 | 唯一 caller 是 `uploadAttachment` |
| `src/converters/markdown-converter.ts` | 整檔 | 唯一 importer 是 `tests/unit/markdown-converter.test.ts`;src/ 內零 importer |
| `src/converters/image-handler.ts` | 整檔 | 唯一 importer 是 markdown-converter.ts 與其測試 |
| `tests/unit/markdown-converter.test.ts` | 整檔 | 只測死碼;隨死碼一併刪除 |
| `marked` dependency | package.json:34 | 唯一 importer 是 markdown-converter.ts(`grep -rln "from 'marked'" src/ tests/` 僅此一檔) |

**Bundle 證據**:現行 `main.js`(158KB)仍含 `updatePage`×1、`uploadAttachment`×1、`createMultipartBody`×2 —— esbuild `treeShaking:true` 無法搖掉「已 import 類別上的未用方法」;`MarkdownToConfluenceConverter`/`ImageHandler`/`marked` 為 0 次(整檔未被 entry 觸及,已被搖掉)。刪除 client 上的三個 mutation 方法才是讓 bundle 真正歸零的唯一途徑。

### 相鄰死碼(同批可刪,選擇性)

- `src/conflict/conflict-editor-extension.ts`、`src/conflict/conflict-marker.ts`、`src/ui/conflict-confirm-modal.ts`:三檔互相引用但無任何外部 importer(grep 證實)。conflict-editor-extension 是 `@codemirror/*` 的唯一 importer;刪除後 esbuild external 清單可保留不動(無害)。

### 必須保留

| 項目 | 理由 |
|---|---|
| `getPage` | sync-service.ts:85 + page-resolver.ts:17 |
| `searchContent` | page-resolver.ts:29(display URL 解析) |
| `testConnection` | settings.ts:91(Test Connection 按鈕) |
| `request()`、`ConfluenceApiError`、auth heuristic | 上列三者的共用基礎;sync-service.ts:253 依賴 `ConfluenceApiError` |
| command id `'push-to-confluence'`(main.ts:53) | hotkey 相容字串,main.ts:49-51 已註明;顯示名稱正確,不可改 id |
| `sync-service.test.ts` 的 `REMOTE_WRITE_METHODS` 防禦測試(:37,:96-102) | 刪除方法後此測試仍成立(`if (api[method])` 已容忍不存在)——保留作為契約回歸防線 |
| `@types/diff`、`diff`、`diff-match-patch`、`turndown`、`turndown-plugin-gfm` | 均有 active importer(file-diff-view.ts:1、diff-engine.ts:1-5) |

型別/設定契約:`tsconfig include: src/**/*.ts`,刪檔無 dangling 引用;`models.ts` 不 import converters;jest 無 converters 相關設定。**風險評級:Low,無破壞面。**

---

## Part 2 — 大型頁面記憶體/時間 profiling(可重現)

### 方法與限制

- 以 esbuild 將現行 `src/diff/diff-engine.ts`、`src/ui/file-diff-view.ts`、`src/utils/markdown-normalizer.ts` 各自 bundle 成 CJS,在 Node 20 + jsdom(提供 DOMParser/document)下執行;`node --expose-gc`,每 case 前強制 GC。
- 合成輸入:段落 + 20 列×3 欄表格(含 `<colgroup>`、cell 內 `<p>`),local = remote markdown 加 5% 行尾編輯。
- 限制:jsdom 的 DOM/serializer 效能與 Electron(Chromium)不同,絕對值僅供相對比較;Obsidian 內 DOMParser 為原生實作,convert 時間預期較短、但配置模式(雙 DOM、全量字串)相同。腳本:`/tmp/prof-sync-large.js`、`/tmp/prof-phase.js`、`/tmp/prof-convert.js`。

### Baseline(命令:`node --expose-gc /tmp/prof-sync-large.js`)

| Case | storage | convert+diff 一輪 | computeFileDiff | peak heapUsed | RSS |
|---|---|---|---|---|---|
| small | 80KB | ~0.1s | 6ms | 58MB | 134MB |
| medium | 0.77MB | ~1.1s | 97ms | 329MB | 490MB |
| large | 3.8MB | ~17-19s | 2.6s | **991MB** | **1058MB** |

### 熱點歸因(`/tmp/prof-phase.js`、`/tmp/prof-convert.js`,large case)

| 階段 | 時間 | heap delta |
|---|---|---|
| **Turndown(cleanHtml string → 內部重新 parse → walk → serialize)** | **10.3s / 15.8s(65%)** | convert 全段 752MB 的主要成分 |
| DOMParser.parseFromString | 0.8s | 雙 DOM 之一 |
| DOM 前處理(tables/headings/attrs) | ~0.6s | — |
| innerHTML serialize + ac:/ri: regex | 0.06s | 產生第二份全文字串 |
| normalizeMarkdown ×2 | 66ms | 30MB |
| dmp char-mode diff + cleanupSemantic | 280ms | 28MB(diffLines 68,419 個物件) |
| computeFileDiff(structuredPatch,modal 才執行) | 2.6s | ~60MB |

**結論:主要來源是 Turndown 對整頁字串的重新解析與遍歷,以及「前處理 DOM + cleanHtml 字串 + Turndown 內部 DOM」三份全文同時存活。** normalization 與 dmp 是次要項。dmp `Diff_Timeout` 預設 1s,超時會降級但不會爆記憶體。

另證實:`DiffResult.diffLines` 與 `conflicts` 在 production 的唯一消費者是 sync-service.ts:101 的一行 log(modal 用 `computeFileDiff` 自行重算)——68k 物件陣列純為 logging 而生。

---

## Part 3 — 核准的最小高價值修正集

### A. 死碼移除(核准,Low risk)

1. 刪 `src/converters/`(2 檔)+ `tests/unit/markdown-converter.test.ts`;`package.json` 移除 `marked`,重跑 `npm install` 更新 lockfile。
2. 刪 `confluence-client.ts` 的 `updatePage`/`uploadAttachment`/`createMultipartBody`(:69-157);保留 `getPage`/`searchContent`/`testConnection`/`request`/`ConfluenceApiError`。
3. (選擇性同批)刪 `src/conflict/` 兩檔 + `src/ui/conflict-confirm-modal.ts`。
4. 保留:command id `'push-to-confluence'`、`REMOTE_WRITE_METHODS` 防禦測試、其餘全部依賴。

### B. 記憶體/時間(核准,Low-Medium risk)

1. **移除純 logging 用的 dmp pass**(diff-engine.ts:83-91):`isIdentical` 由字串相等判定(:75),`hasConflicts` 可改為 `!areIdentical`;`diffLines`/`conflicts` 無 production 消費者 → 直接省 280ms + 28MB + 68k 物件。`DiffResult` 介面同步瘦身(models.ts:40-51),sync-service.ts:101 的 log 改用長度差。此為最高 CP 值單點修改。
2. **縮短 doc 存活期**(diff-engine.ts:255-467):把 DOM 前處理抽成獨立函式、回傳 `cleanHtml` 字串,使 `doc` 在 Turndown 執行前離開作用域而可回收 —— 這是結構性 scope 修正,非「設 null 求 GC」;可用 `--expose-gc` 前後 heap 快照驗證(預期削掉三份全文同存中的一份)。
3. **大輸入護欄**:`remotePage.body.storage.value.length` 超過閾值(建議 1MB)時顯示 Notice 警告再繼續;>5MB 建議要求確認。純加法,零回歸面。

### C. 明確不要做

- Streaming/chunked 轉換 rewrite(高風險,破壞格式保真與 diff 對位)。
- `WeakRef`/手動 GC hint/`global.gc` 類不可驗證手段。
- 換掉 Turndown 或改寫其內部。
- **Turndown 直接吃 DOM node**(實測 node 輸入比 string 快 1.6x:5.8s→3.6s,輸出 byte-identical——但那是無 `ac:` 前綴的樣本;現行 :463-467 的 regex 前綴清理依賴 serialize 步驟,node-direct 會改變 `ac:structured-macro` 等巨集的處理路徑)。**列為後續選項**,前提是先補齊含巨集/task-list 的 conversion fidelity 測試;本輪不做。
- 動 `computeFileDiff`/`buildResolvedContent` 演算法(2.6s 只在開 modal 時發生,且是格式保真核心,H2 修正剛落地)。

---

## Part 4 — 驗收門檻與測試

**功能正確性(既有,必須全綠)**:`npx jest` 4 suites / 37 tests;`npm run build` exit 0。diff-fidelity.test.ts 已覆蓋 isIdentical、Accept Local/Remote/Both、tab/雙空格/星號保真。

**新增驗收**:
1. 遠端 mutation 不存在:grep production `main.js` 中 `updatePage|uploadAttachment|createMultipartBody|MarkdownToConfluenceConverter|ImageHandler` = 0 hits;`REMOTE_WRITE_METHODS` 測試維持通過。
2. 依賴清理:`npm ls marked` → empty;lockfile 無 `marked`;`tsc` + `jest` + production build 全綠。
3. DiffResult 瘦身回歸:isIdentical=true/false 兩路徑行為不變(diff-fidelity 既有 4 測試);sync-service.test.ts 中依賴 `diffLines` 的 mock 欄位同步更新,不得靠 `as any` 繞過。
4. 大型輸入不崩潰:以本報告腳本同款合成輸入(storage ≈3.8MB)重跑 —— 門檻:**完成不 crash;convert+diff 一輪 peak heapUsed 較 baseline 991MB 降 ≥15%**(B1+B2 合計預期可達);記錄命令與數字入 PR。
5. EOF/no-newline:沿用 file-diff-view.ts:63 已處理的 `\ No newline` 過濾,對「無結尾換行」輸入補一條 fidelity 測試(現缺)。
6. 文件同步:README 移除任何殘餘 push 敘述(現已正確)、CHANGELOG 新增 1.0.9 條目說明「移除不可達的舊版上傳程式碼、無功能變更」與大頁面警告行為;manifest/package description 不需變(已為 pull-only 敘述)。

## Severity / 出貨判定

- 死碼鏈:**Low(cleanup)** — 不可達已證實,現狀不影響 pull-only 契約;刪除是 bundle 衛生與攻擊面縮減。
- 大頁面記憶體:**Medium(robustness)** — 3.8MB storage 在 jsdom 環境見 ~1GB heap;絕對值在 Electron 會較低,但雙 DOM + 全文多副本的配置模式相同,超大頁面確有 OOM/凍結風險。B1-B3 為核准範圍;不構成 merge blocker。
- 現行程式碼(未修前)可以出貨;本輪為技術債清理,非缺陷修復。
