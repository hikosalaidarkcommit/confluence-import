# PRD：Pull-Only 單向同步 UX 全面重設計

**產品**：Confluence Page Import（Obsidian Plugin，原名 Confluence Sync）  
**文件版本**：1.1  
**撰寫日期**：2026-07-21  
**狀態**：**方案 B 核心已實作**（2026-07-21）；進階項目仍為 future work  
**前提假設**：Confluence 是唯一事實來源；本地端 Obsidian 只能接收，永不寫回

> **實作狀態（2026-07-21）**
>
> ✅ **已實作（方案 B 核心）**：
> - 唯讀 Diff Preview（display-only 差異區塊，無 per-block 按鈕；
>   `role=region` / aria-label / 鍵盤可捲動）
> - 主按鈕 **Pull & Replace**（整份採用 remote content），
>   次按鈕 **Cancel (Keep Local)**（零寫入、零 version 更新）
> - Apply 直接寫入 raw `remoteContent`；成功後才更新 `confluence-version`；
>   其他 frontmatter properties 保留
> - Empty/whitespace-only remote body fail-closed 保護
> - 既有 stale-file guard、same-file lock、unload guard、host/protocol
>   guard 全部保持
> - 舊 per-block merge UX（Accept Local/Remote/Both、buildResolvedContent）
>   已自 source/styles/tests 移除
>
> ⏳ **未實作（future work，本文件中相關章節僅為設計提案）**：
> - Undo / pre-sync backup（`vault.copy`）
> - `confluence-content-hash` 與 hash-based local-edit 偵測
> - Local-edit 分類與差異化按鈕文案（`Pull & Overwrite` vs `Pull & Replace`
>   — 現行實作統一使用 `Pull & Replace`，不做未實作的判斷）

---

## 一、問題根診斷：為何現有設計是一個假同步

### 1.1 現象還原

使用者選擇 **Accept Local** 之後，發生的事情：

```
Before Pull:
  Local body:            "Project deadline: Friday"   ← 使用者本地版本
  Remote (Confluence):   "Project deadline: Monday"   ← 官方事實來源
  confluence-version:    10

After "Accept Local" + Apply:
  Local body:            "Project deadline: Friday"   ← 完全不變
  confluence-version:    11 (remote version)          ← 但這個更新了！
  Remote (Confluence):   "Project deadline: Monday"   ← 永遠沒變

Next Pull:
  Diff detected again!   ← 因為 local body 跟 remote 還是不同
  → 又跑出 conflict modal
```

**這就是假同步循環**：`confluence-version` 被更新，暗示「同步完成」，但 body 根本沒同步。使用者每次 Pull 都會看到一模一樣的 diff，永遠解決不了。

### 1.2 Accept Both 的問題

```
Local:   "- Reviewed by Alice"
Remote:  "- Reviewed by Bob"

After Accept Both:
  Local:  "- Reviewed by Alice"
          "- Reviewed by Bob"    ← 兩份內容全部接在一起
```

這不是「同步」，這是「串接」。在 Pull-Only 前提下，本地端串接兩份內容毫無意義，且在多次操作後會不斷累積，形成內容膨脹。

### 1.3 心智模型根本錯誤

現有 UI 繼承自雙向 Merge 的設計語言（Accept Local / Accept Remote / Accept Both），這套語言的隱含前提是「兩端都是有效來源，可以任意組合」。

但本產品的業務定義是：**Confluence 是唯一真相，Obsidian 只是鏡像**。

這兩個前提完全衝突，所以所有問題都源自此。

---

## 二、核心產品原則（重新定義）

### 2.1 單一 Job-to-be-Done

> **「讓我的 Obsidian 筆記反映 Confluence 頁面的最新狀態。」**

沒有第二個 Job。使用者不需要「合併」，不需要「雙向同步」，只需要「拿到最新版本」。

### 2.2 三條不可違反的產品原則

| # | 原則 | 意涵 |
|---|------|------|
| P1 | **Confluence 永遠是真相** | 任何 Pull 操作的終態，是「local = remote」 |
| P2 | **不執行就不改動** | 使用者明確確認前，本地檔案零異動 |
| P3 | **version 更新 = 內容已同步** | `confluence-version` 只在「local body 已成功寫入 remote body」後才更新；從不在 body 不一致的狀態下更新版本號 |

### 2.3 移除的心智模型

- ❌ Accept Local（在 Pull-Only 場景毫無意義）
- ❌ Accept Both（串接兩份內容製造噪音）
- ❌ 3-Way Merge（本產品沒有共同祖先 base，不是真 3-way）
- ❌ 「你的版本 vs 他們的版本」語言（沒有「他們」，只有「Confluence 事實」）

---

## 三、推薦的新 UX 流程（明確推薦，非選項列表）

### 3.1 核心流程圖

```
使用者觸發 Pull
        ↓
  [1] 取得 Remote 內容
        ↓
  [2] 比對 remote == local body？
     ├─ 是 → "Already up to date" Toast → 結束
     └─ 否 → [3] 本地有自訂修改？*
                ├─ 否（乾淨）→ [4a] Preview Modal（純展示）→ 使用者確認 → Apply
                └─ 是（有差異）→ [4b] Override Warning Modal → 使用者確認 → Apply
                                                                └─ 使用者 Keep Local → 不更新 version → 結束
        ↓
  [5] 寫入 local body = remote body
        ↓
  [6] 更新 confluence-version
        ↓
  "Pulled successfully" Toast
```

> \* **「本地有自訂修改」的判斷**：local body ≠ remote body，且 `confluence-content-hash` 存在且不符。
> 若無 hash（首次 Pull），預設走 [4a] Preview 路徑，不假設有衝突。

### 3.2 四種主要狀態的精確定義

---

#### 狀態 A：已是最新（Already Up to Date）

**觸發條件**：`local body == remote body`（content-hash 相符，或逐字比對相符）

**行為**：
- 更新 `confluence-version` 至 remote 版本號（保持 version 精準）
- 顯示 Toast：不打斷使用者

**文案**：
```
✓ Already up to date  (Confluence v{N})
```

**無任何 Modal**，直接靜默完成。

---

#### 狀態 B：乾淨 Pull（Clean Pull — 無本地修改）

**觸發條件**：`local body ≠ remote body`，且本地沒有自訂修改（`confluence-content-hash` 符合，代表自上次同步以來本地未改動）

**行為**：顯示 Preview Modal（不是衝突 Modal）

**Modal 設計**：
```
┌─────────────────────────────────────────────────────┐
│  Pull from Confluence                               │
│  Confluence is v{N} · {X} section(s) changed       │
├─────────────────────────────────────────────────────┤
│                                                     │
│  [Diff 預覽]                                        │
│  ─ 舊內容（紅色刪除線）                             │
│  + 新內容（綠色）                                   │
│                                                     │
├─────────────────────────────────────────────────────┤
│  [Cancel]                    [Pull & Replace →]     │
└─────────────────────────────────────────────────────┘
```

**文案規格**：
- 標題：`Pull from Confluence`
- 副標：`Confluence is v{N} · {X} section(s) changed`
- 主按鈕（Primary）：`Pull & Replace →`（強調「取代」而非「合併」）
- 次按鈕（Secondary）：`Cancel`
- **無** Accept Local / Accept Remote / Accept Both 任何按鈕
- **無** 逐區塊選擇，整份文件一次取代

**成功 Toast**：
```
✓ Pulled v{N} from Confluence
```

---

#### 狀態 C：有本地修改的 Pull（Local Edits Exist）

**觸發條件**：`local body ≠ remote body`，且 `confluence-content-hash` 不符（代表使用者在 Obsidian 本地有過編輯）

**設計決策**：**不提供 block-level 選擇**。理由：
1. 本產品沒有雙向同步需求
2. 使用者若真的有重要的本地修改，應先到 Confluence 頁面更新，再 Pull
3. Block-level 選擇 + 預設 Accept Local = 假同步 Bug 的根源

**行為**：顯示 Override Warning Modal

```
┌─────────────────────────────────────────────────────┐
│  ⚠ You Have Local Edits                             │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Your Obsidian note has been edited locally since   │
│  the last sync. Pulling will overwrite those edits  │
│  with the Confluence version.                       │
│                                                     │
│  Confluence is the source of truth for this note.  │
│  To keep your edits, copy them to Confluence first. │
│                                                     │
│  [Diff 預覽（可選折疊）]                            │
│                                                     │
├─────────────────────────────────────────────────────┤
│  [Keep Local Edits]          [Pull & Overwrite →]   │
└─────────────────────────────────────────────────────┘
```

**文案規格**：
- 標題：`⚠ You Have Local Edits`
- 主按鈕（破壞性，紅色或警告色）：`Pull & Overwrite →`
- 次按鈕：`Keep Local Edits`
- 無「Accept Both」選項

**「Keep Local Edits」的精確語意**（重要）：
- **不執行任何 body 寫入**
- **不更新 `confluence-version`**（因為 local ≠ remote，更新 version 是謊言）
- 顯示 Toast：`Local edits kept. Note is out of sync with Confluence.`
- 在 frontmatter 設置 `confluence-sync-status: local-override`（可選，作為視覺提示）
- 下次 Pull：**再次顯示此 Modal**（因為狀態未改變）——這是正確行為，不是 Bug

**這與現有「Accept Local」的根本差異**：現有設計會更新 `confluence-version`，製造假同步；新設計完全不更新，誠實地保持「本地偏離 Confluence」的狀態。

---

#### 狀態 D：首次 Pull（No Previous Sync）

**觸發條件**：frontmatter 中無 `confluence-version`

**行為**：直接走 Clean Pull 路徑（狀態 B），視為「乾淨」Pull。

理由：沒有 hash，無法判斷本地是否有有意義的修改，預設取 Confluence 版本是最安全的起點。

**Modal 標題調整**：
```
Pull from Confluence (First Time)
This note hasn't been synced yet.
```

---

## 四、全狀態覆蓋規格

### 4.1 錯誤與邊緣狀態

| 狀態 | 觸發條件 | 主按鈕 | 次按鈕 | Notice 文案 |
|------|----------|--------|--------|-------------|
| **API 錯誤** | 網路失敗、401、403、500 | `Retry` | `Cancel` | `❌ Failed to reach Confluence. Check your network and settings.` |
| **404 頁面已刪** | API 回 404 | `Unlink Note` | `Cancel` | `❌ Confluence page not found. It may have been deleted.` |
| **版本異常（local > remote）** | `local_version > remote_version` | `Reset Version` | `Cancel` | `⚠ Version mismatch detected. Local version appears ahead of Confluence.` |
| **超大頁面** | 頁面 > 10MB | `Pull Anyway` | `Cancel` | `⚠ This page is very large ({X} MB). Pulling may be slow.` |
| **空 Remote 內容** | Confluence 頁面為空 | `Replace with Empty` | `Cancel` | `⚠ The Confluence page is empty. Pulling will clear your note.` |
| **同步進行中（鎖）** | same-file lock 觸發 | — | — | `A sync is already in progress for this note.`（Toast，無 Modal）|
| **外部變更偵測** | Apply 前 snapshot 不符 | `Retry Pull` | `Cancel` | `⚠ Your note was modified while the dialog was open. Please pull again.` |

### 4.2 Undo / Backup 規格

**決策：提供單次 Undo，不提供永久 Backup 檔案**

理由：
- Obsidian File Recovery 插件已提供完整歷史
- 生成 `.backup` 檔案會污染 vault
- 單次 Undo 覆蓋 99% 的「誤觸確認」場景

**Undo 實作**：
- Pull 成功後，在記憶體保留前一版 body（不寫入磁碟）
- 成功 Toast 追加 Undo 連結：
  ```
  ✓ Pulled v{N} from Confluence  [Undo]
  ```
- `[Undo]` 點擊後：
  - 還原 body 為 Pull 前版本
  - **清除** `confluence-version`（還原至「未同步」狀態，誠實）
  - 顯示：`Reverted. Note is back to your previous local state.`
- Undo 有效期：30 秒（Toast 消失後失效）或離開該分頁後失效

**Cancel 的語意**：
- 任何 Modal 上的 Cancel = 零副作用，body 不變、version 不變
- 下次 Pull 同一狀態再次出現（正確行為）

---

## 五、Preview（Diff 視圖）保留決策

**結論：保留 Diff 預覽，但調整為純展示用**

保留原因：
- 使用者需要知道「Confluence 改了什麼」才能做出是否 Pull 的決定
- 沒有預覽 = 盲目覆蓋 = 使用者信任度下降

**調整項目**：
- 移除每個 block 的 Accept Local / Remote / Both 按鈕
- Diff 視圖改為純展示（read-only），只高亮「什麼將被替換」
- 整份文件只有一個全域決定：`Pull & Replace` 或 `Cancel`

**Diff 視圖 UX**：
```
[展示模式，不可互動]
  ─ 舊內容（紅底）
  + 新內容（綠底）
  （灰色：未改動的 context 行）

[可折疊：Show/Hide unchanged sections]
```

---

## 六、MVP 邊界與後續規劃

### 6.1 MVP（必須包含）

| 功能 | 說明 |
|------|------|
| Clean Pull（狀態 B） | Pull & Replace，整份取代 |
| Local Edits Warning（狀態 C） | Override 警告，Keep Local 不更新 version |
| Already Up to Date（狀態 A） | 靜默 Toast |
| First-Time Pull（狀態 D） | 走 Clean Pull 路徑 |
| Undo（30 秒） | 記憶體 Undo，成功後 Toast 顯示 |
| 錯誤處理（API 失敗、404） | 見 4.1 |
| version 誠實性修正 | Accept Local 不再更新 version |

### 6.2 MVP 明確排除

| 功能 | 排除原因 |
|------|----------|
| Block-level 選擇（Accept Local/Remote/Both） | 假同步根因，完全移除 |
| 3-Way Merge UI | 本產品沒有 Pull-Only 的 3-way 場景 |
| 自動背景同步 | 後續版本，需要更多設計 |
| Backup 檔案（.backup） | Obsidian File Recovery 已覆蓋 |
| 批次 Pull（多筆記） | 後續版本 |

### 6.3 後續版本規劃

**v2.1**：
- `confluence-sync-status` 在側邊欄顯示同步狀態徽章（up-to-date / local-override / never-synced）
- 批次 Pull 所有連結筆記

**v2.2**：
- 自動 Pull on Vault Open（opt-in 設定）
- Pull 歷史記錄（顯示最後 5 次 Pull 的時間戳與版本號）

---

## 七、Acceptance Criteria（可測）

### AC-1：Accept Local 不再更新 version（核心 Bug 修正）

**Given** 使用者 Pull 並選擇保留本地（Keep Local Edits）  
**When** 操作完成  
**Then**：
- `confluence-version` 未改動（保持 Pull 前的值）
- `confluence-content-hash` 未改動
- 本地 body 未改動
- 下次 Pull 依然顯示相同 diff

### AC-2：Clean Pull 整份取代

**Given** local body ≠ remote body，且無本地修改  
**When** 使用者點擊 `Pull & Replace`  
**Then**：
- local body = remote body（逐字相符）
- `confluence-version` = remote version
- 顯示成功 Toast 含 `[Undo]`

### AC-3：Undo 正確還原

**Given** Pull & Replace 成功  
**When** 使用者在 30 秒內點擊 `[Undo]`  
**Then**：
- local body 還原至 Pull 前版本
- `confluence-version` 清除（不保留 remote version）
- 顯示：`Reverted. Note is back to your previous local state.`

### AC-4：Cancel 零副作用

**Given** 任何 Modal 顯示中  
**When** 使用者點擊 Cancel  
**Then**：
- local body 不變
- `confluence-version` 不變
- 下次 Pull 觸發相同狀態（同一個 Modal）

### AC-5：首次 Pull 走 Clean Pull 路徑

**Given** frontmatter 無 `confluence-version`  
**When** 使用者觸發 Pull  
**Then**：顯示 Clean Pull Preview Modal（不顯示 Override Warning）

### AC-6：空 Remote 保護

**Given** Confluence 頁面為空  
**When** 使用者觸發 Pull  
**Then**：顯示警告 Modal，不自動執行取代

### AC-7：同步鎖生效

**Given** 同一筆記有 Pull 進行中  
**When** 使用者再次觸發 Pull  
**Then**：顯示 Toast 提示「進行中」，不開啟第二個 Modal

---

## 八、Migration 風險與處理

### 8.1 現有使用者的 version 污染

現有使用者可能已有大量筆記處於「version 已更新但 body 未同步」的狀態（假同步循環）。

**處理方案**：
- 升級後的第一次 Pull，強制以 **content 比對**（body 逐字比對）決定是否有 diff，不依賴 version number
- 若 body 有 diff，走正常流程（根據 hash 判斷是狀態 B 或 C）
- 若無 `confluence-content-hash`（老版本），預設走狀態 B（Clean Pull）

### 8.2 破壞性變更

| 變更項目 | 影響 | 緩解 |
|----------|------|------|
| 移除 Accept Local / Remote / Both | 使用者需要重新學習 | 升級公告 + In-app tooltip 說明新設計 |
| version 不再隨 Keep Local 更新 | 部分依賴 version 判斷的腳本可能受影響 | CHANGELOG 明確說明此語意變更 |
| 移除 Accept Both | 少數使用者依賴此功能做筆記整合 | 提供 Migration Guide，建議改用手動編輯 Confluence 後 Pull |

### 8.3 移除 Accept Both 的風險聲明

**用途分析**：Accept Both 的合理使用場景唯一是「我想在本地臨時保留兩份內容做比較」。但在 Pull-Only 設計下：
- 若使用者想保留本地版本 → 使用 Keep Local Edits
- 若使用者想要 Confluence 版本 → 使用 Pull & Replace
- 若使用者想合併 → 這不是 Pull-Only 的設計範疇，請直接編輯 Confluence 頁面

**Migration 路徑**：若有使用者強烈需求，後續版本可在「Keep Local Edits」後提供「Open in Confluence」連結，引導使用者直接編輯 Confluence。

---

## 九、文案完整規格（精確字串）

| 情境 | 文案 |
|------|------|
| 已是最新（Toast） | `✓ Already up to date  (Confluence v{N})` |
| Pull 成功（Toast） | `✓ Pulled v{N} from Confluence  [Undo]` |
| Undo 成功（Toast） | `Reverted. Note is back to your previous local state.` |
| Keep Local（Toast） | `Local edits kept. Note is out of sync with Confluence.` |
| 進行中鎖（Toast） | `A sync is already in progress for this note.` |
| Clean Pull Modal 標題 | `Pull from Confluence` |
| Clean Pull Modal 副標 | `Confluence is v{N} · {X} section(s) changed` |
| Clean Pull 主按鈕 | `Pull & Replace →` |
| Override Warning 標題 | `⚠ You Have Local Edits` |
| Override Warning 主按鈕 | `Pull & Overwrite →` |
| Override Warning 次按鈕 | `Keep Local Edits` |
| 首次 Pull Modal 副標 | `This note hasn't been synced yet.` |
| API 錯誤（Toast） | `❌ Failed to reach Confluence. Check your network and settings.` |
| 404 錯誤標題 | `❌ Page Not Found` |
| 404 錯誤說明 | `The Confluence page may have been deleted.` |
| 版本異常（Toast） | `⚠ Version mismatch detected. Local version appears ahead of Confluence.` |
| 超大頁面（Modal 說明） | `⚠ This page is very large ({X} MB). Pulling may be slow.` |
| 空 Remote（Modal 說明） | `⚠ The Confluence page is empty. Pulling will clear your note.` |
| 外部變更（Toast） | `⚠ Your note was modified while the dialog was open. Please pull again.` |
| Cancel（任何 Modal） | `Cancel` |
| Unlink（404 後） | `Unlink Note` |

---

## 十、決策摘要

| 決策項目 | 結論 |
|----------|------|
| 是否保留 Preview（Diff 視圖） | **保留**，但改為純展示，移除 block-level 選擇 |
| 是否需要 Backup 檔案 | **不需要**，用 30 秒記憶體 Undo 取代 |
| 是否允許 Keep Local | **允許**，但明確定義：不更新 version，不是 Sync |
| Keep Local 是否更新 version | **絕對不更新**（這是現有 Bug 的根源） |
| Accept Local / Remote / Both | **全部移除** |
| 3-Way Merge UI | **移除**（Pull-Only 場景無需） |
| 整份取代 vs. 逐 block 選擇 | **整份取代**（Pull-Only 的自然設計） |
| Block-level 選擇的未來 | **不規劃**，若有需求應推動雙向 Sync 的完整設計 |

---

_文件狀態：Product 推薦方案，供 Engineering 評估實作。_
