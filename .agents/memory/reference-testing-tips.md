# 測試注意事項

## 啟動與關閉
- 背景執行 `node server.js`（工作目錄為專案根目錄），用 claude in chrome 開 `http://127.0.0.1:8765/`。
- 測完用 TaskStop 關掉背景伺服器，並關掉自己開的分頁。使用者要求過「背景程式關掉」。
- 剛啟動時伺服器可能還沒好，第一次開頁面出現錯誤頁就再開一次。

## 自動化分頁的更新率很低
- claude in chrome 的分頁通常不在前景，`requestAnimationFrame` 每秒只跑約 1 格，而且遊戲的 `dt` 上限是 0.05 秒，所以遊戲時間幾乎不前進。用鍵盤事件加等待的方式測不出東西，等待太久還會讓 javascript 工具逾時（45 秒）。
- 改用 `window.__sim`（在 `js/main.js` 最下面）：`__sim.step(n)` 同步推進 n 格（每格 1/60 秒），並直接設定 `__sim.input.gas / brake / clutch`（0～1）、呼叫 `__sim.shift('1')`、`__sim.toggleDoors()`，再讀 `__sim.bus`、`__sim.eng`、`__sim.game`、`__sim.zone`。
- `step` 不會更新 HUD 文字與聲音；要看 HUD 就讀狀態物件，不要讀畫面文字。
- 要先點「開始駕駛」（`document.getElementById('startBtn').click()` 後等約 1.5 秒），`app.running` 為 true 後 `shift`、`toggleDoors` 才有作用。

## 離合器
- 設定 `__sim.input.clutch` 後要 `step` 幾格，`eng.clutch` 才會跟上（每秒最多變 12～14）；剛設定就呼叫 `shift` 會用到舊的踏板深度。
- 測「慢放」：每格把 `input.clutch` 減一點再 `step(1)`；測「直接放開」：設 0 後 `step`。量每格的速度差 ×60 就是加速度。

## 傾斜感應
- 可以 `dispatchEvent(new Event('devicemotion'))` 並掛上 `accelerationIncludingGravity = {x, y, z}` 來模擬。電腦的 `screen.orientation.angle` 是 0，手機橫放是 90 或 270，測試資料要用同一個角度換算。
- 已驗證：順時針轉 20 度得到 +20（右轉），逆時針得到 -20；Android 與 iOS 的重力正負號相反，校正時用 `tilt.sign` 處理。
- 重新測校正時把 `__sim.tilt.needCal` 設為 true。

## 無法自動測的項目
- 觸控手感、多指同時操作、實際旋轉手機的靈敏度、聲音、手機效能（後照鏡每兩格重畫一次），都要請使用者在手機上玩過再回報。