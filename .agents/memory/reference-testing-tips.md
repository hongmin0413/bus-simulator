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

## 2026-11-12 補充
- 路是彎的：測行駛時每格先呼叫 `__sim.hold(lat)`（沿目前這條路自動轉向，lat 為離中線的距離，右側為正）再 `step(1)`，不然會撞上人行道。
- 開場引擎是熄火的：`input.clutch = 1` → `step(20)` → `__sim.startEngine()`，再 `toggleHand()` 放手煞車。
- 要把公車擺到指定位置：`(await import('./js/state.js')).placeBusAt(x, z, h)`，參數是格子座標（見 reference-world-model.md）。同一頁裡動態 import 拿到的是同一份模組。
- 位置判斷用 `__sim.bg`（格子座標的車身中心與朝向），不要用 `bus.x / z`（世界座標）。
- 測結算畫面會寫入 localStorage 的最佳紀錄（`bus-best`），測完要把假資料刪掉。
- 要把畫面存成圖檔（例如重做 `images/og-image.png`）：把 `app.running` 暫時設成 false 後呼叫 `view.render(0)`，同一段程式裡立刻把 WebGL 畫布畫到另一張 2D 畫布，再用 fetch 把 data URL 送到暫時開的本機 Node 接收程式存檔。

## 手機版面與觸控可以在電腦上測（2026-11-12 使用者提醒）
- 版面：在已開啟遊戲的分頁裡加一個 `<iframe src="/" style="position:fixed;left:20px;top:20px;width:725px;height:334px;z-index:99999">`（使用者手機的可視範圍約 725×334），用 `iframe.contentWindow.__sim` 與 `contentDocument` 操作，再用 zoom 截那一塊。量 `getBoundingClientRect()` 檢查元件有沒有重疊、按鈕離踏板多遠。
- 觸控：對元件 `dispatchEvent(new w.PointerEvent('pointerdown' / 'pointermove' / 'pointerup', { pointerId, clientX, clientY, bubbles: true, pointerType: 'touch' }))`。踏板與排檔會呼叫 `setPointerCapture`，合成事件沒有真的指標，要先把該元件的 `setPointerCapture` 換成空函式、`hasPointerCapture` 換成回傳 true。多指就用不同的 pointerId。
- 發動要等：`startEngine()` 後要 `step(60)` 以上引擎才會點著（啟動馬達 0.9 秒）。
- 還是測不到的：手指實際的手感、旋轉手機、聲音、手機溫度與流暢度。
- 開測試伺服器前先看 8765 埠是不是已經被使用者的 `start.bat` 占用；是的話直接用，測完不要關。