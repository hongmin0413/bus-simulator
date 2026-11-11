# AGENTS.md

## 新 session 開場
- 每次開新 session，在第一次回覆前，先用 Skill 工具呼叫 `caveman`（等同下指令 `/caveman 用中文回覆我`），之後都使用中文回覆。

## 專案簡介
- 手排公車模擬器：原創的 3D 公車駕駛遊戲，純前端網頁（HTML + CSS + ES module），目標是在手機瀏覽器橫放遊玩。
- 沒有建置步驟。`server.js` 只是本機靜態檔案伺服器；唯一用到的函式庫是 Three.js，直接放在 `lib/three.module.js`（有提交到版本庫），沒有任何要 `npm install` 的套件。
- 線上版用 GitHub Pages 發布（`main` 分支根目錄），所以所有路徑都要用相對路徑，不能依賴 `server.js` 或 `node_modules`。推到 `main` 就會更新線上版，推之前要先問使用者。
- 檔案分工：`index.html`（畫面結構）、`css/style.css`、`js/`（各模組，進入點 `js/main.js`）、`server.js`、`start.bat`。各 js 檔的職責寫在檔案第一行註解。

## 本機環境
- 本機沒有安裝 Python（`python`、`python3` 只是 Windows 商店的空殼，執行會失敗）。批次改檔、文字處理不要用 Python，改用 Node.js（`node`）、PowerShell 或 Edit 工具。
- 使用者不開 IDE，啟動方式是點兩下根目錄的 `start.bat`（會檢查 Node、開瀏覽器、執行 `node server.js`）。
- 埠：HTTP `8765`（電腦）、HTTPS `8766`（手機，自簽憑證放在 `.cert/`，由 `server.js` 用 Git for Windows 內附的 openssl 自動產生）。

## 記憶
- 記憶放在 `.agents/memory/`，依主題分檔，索引見 `.agents/memory/README.md`。

## 工作紀錄
- 每次做了什麼工作，都要記錄在【.agents/memory/worklog.md】。
- 標題為「工作日誌」，內容由上到下為舊到新，同一天寫在一起，底下用列點呈現。
- 寫完工作日誌後，檢查本次內容是否重要（使用者偏好、慣例、測試陷阱、踩過的坑、未完成事項等）；重要的就依主題寫進【.agents/memory/】對應檔案並更新 README.md 索引。README.md 最上方的「最後整理時間」只在「更新各檔現況、整理 worklog」時更新（年月日加時分），不用每次改檔都改。寫入前先看既有記憶，內容不可重覆（已有就更新該檔，不要新增）。
- 所有 md 檔（含 AGENTS.md、memory/）不可寫入機密資訊（帳號、密碼、token、API key、憑證內容、電腦的實際 IP 等）。寫入前與修改後都要檢查。

## 測試
- 需要測試時自己在背景執行 `node server.js`，用 claude in chrome 開 `http://127.0.0.1:8765/` 測試，測試時不用截圖（要確認版面時才截）。**測完一定要把背景的伺服器關掉。**
- 自動化的分頁畫面更新率很低（約每秒 1 格），不能靠真實時間測行駛。改用主控台的 `__sim.step(n)` 同步推進模擬，細節見 `.agents/memory/reference-testing-tips.md`。
- 觸控手感、旋轉手機轉向、聲音只能由使用者在手機上實測，回報時要明講哪些沒測到。

## 發現 bug 時
- 可自行修正。
- 修正後重整頁面即可（`server.js` 回應 `Cache-Control: no-store`，不會有快取）。改了 `server.js` 或 `start.bat` 才需要重新啟動。

## 檔案格式
- 所有檔案使用 UTF-8（不含 BOM）。`start.bat` 用 CRLF 換行，其餘用 LF。
- 所有檔案（程式、設定檔、md、腳本，包含新建與修改的）的最後一行後面都不要多一個空白行，也不要補結尾換行；寫入或修改後檢查檔案尾端。