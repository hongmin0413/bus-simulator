# 測試注意事項（現況：2026-11-12 整理）

## 啟動與關閉
- 先看 8765 埠有沒有被占用。被使用者自己開的 `start.bat` 占用時直接用它測，測完不要關。
- 沒被占用就背景執行 `node server.js`，用 claude in chrome 開 `http://127.0.0.1:8765/`；測完用 TaskStop 關掉，並關掉自己開的分頁。
- 剛啟動時伺服器可能還沒好，第一次開頁面失敗就再開一次。

## 自動化分頁的更新率很低
- 分頁通常不在前景，`requestAnimationFrame` 每秒約 1 格，遊戲時間幾乎不前進。改用 `window.__sim`（`js/main.js` 最下面）：`__sim.step(n)` 同步推進 n 格（每格 1/60 秒），直接設 `__sim.input.gas / brake / clutch`，呼叫 `shift`、`startEngine`、`toggleDoors`、`toggleHand`、`setSignal`，再讀 `bus`、`bg`、`eng`、`game`、`zone`。
- `step` 不會更新 HUD 文字與聲音；要看畫面就等 1 秒左右再截圖。
- 路是彎的：測行駛時每格先 `__sim.hold(lat)`（沿目前這條路自動轉向，lat 為離中線的距離，右側為正）再 `step(1)`。
- 位置判斷用 `__sim.bg`（格子座標），不要用 `bus.x / z`（世界座標）。擺放公車：`(await import('./js/state.js')).placeBusAt(x, z, h)`，參數是格子座標。同一頁動態 import 拿到的是同一份模組。
- 開場引擎是熄火的：`input.clutch = 1` → `step(20)` → `startEngine()` → `step(70)`，再 `toggleHand()`。
- 設定 `input.clutch` 後要 `step` 幾格 `eng.clutch` 才跟上。

## 手機版面與觸控（一定要做命中測試）
- 在已開啟遊戲的分頁裡加 iframe（`src="/"`、固定寬高、z-index 很大），用 `contentWindow.__sim` 與 `contentDocument` 操作，再用 zoom 截那一塊。
- 尺寸至少測 568×320、640×330（使用者的手機）、667×375、725×334、844×390、932×430。電腦全螢幕寬度測過不代表手機沒問題。
- **直接對按鈕 `dispatchEvent` 會繞過「這個座標點到誰」的判定，按鈕被蓋住也測不出來**（曾因此把手機上按不到的手煞車與發動鈕推上線）。正確做法：`doc.elementFromPoint(x, y)` 取得該座標實際的目標，確認是按鈕本身或子元素，再把事件送給它。每個控制項檢查中心與四個角。
- 只負責排版的外框（`#left`、`#right`、`#center`）不要設 pointer-events: auto；只有真正要按的元素才設。
- 踏板與排檔會呼叫 `setPointerCapture`，合成事件沒有真的指標，要把 `Element.prototype.setPointerCapture` 換成空函式、`hasPointerCapture` 換成回傳 true。多指用不同的 pointerId。
- 需要「按住」的按鈕（發動、喇叭）不要把 pointercancel、pointerleave 當成放開：手機長按可能被系統取消。
- 排檔桿的起點用目前檔位換算，不要量畫面上圓鈕的位置（有 0.09 秒動畫，同步推進模擬時位置會落後）。
- 轉向可以用 devicemotion 模擬傾斜：`dispatchEvent(new Event('devicemotion'))` 並掛上 `accelerationIncludingGravity`；先送一次角度 0 讓它校正。電腦的 `screen.orientation.angle` 是 0。
- 整趟自動駕駛的測試腳本，停車後要記得重新走起步流程，否則會以為遊戲卡住。

## 渲染像素回歸
- 在獨立測試分頁選關卡後執行 `await import('./tests/rendering.js').then(({ run }) => run())`。同步比較 WebGL 像素：瞬移／重設首格不能殘留舊鏡面，左右與倒車影像切換不能延後；分區邊界的主畫面和三面鏡子必須與關掉視錐裁切相同。
- 測試暫時改動公車、鏡頭與暫停狀態，`finally` 還原；不要拿使用者正在玩的分頁測。`readPixels` 必須在同一段同步程式內緊接 `render()`，避免畫布清空。
- `renderer.info.render` 現在統計整格所有 render passes 的 calls／triangles，不是只有 overlay；比較個別鏡頭時需取前後差值。
- 主畫面用大批次，鏡面用 200 公尺分區；幾何、材質共用，instance buffer 各存一份。不要把主畫面也直接換成細分批次：實測主畫面 draw calls 曾由 118 暴增至 386，窄鏡面才適合這個取捨。
- 靜態物件不自動更新矩陣；`view.render()` 每格先更新動態世界矩陣一次。若新增會動的場景物件，不可放進靜態批次；鏡頭的 `localToWorld` 要在矩陣更新後呼叫。
- 建築立面的 UV 校正使用 vendored Three.js r160 的 `uv_vertex` shader chunk，在頂點階段依 instance 尺寸計算完整窗格；更新 Three.js 時需重新確認 shader 編譯與近／遠景窗格，不可只跑語法檢查。
- GPU 成本用 `EXT_disjoint_timer_query_webgl2` 的 elapsed query，等 `QUERY_RESULT_AVAILABLE` 並排除 `GPU_DISJOINT_EXT` 後讀取；JS `render()` 耗時或 `gl.finish()` 的 CPU 計時不能當成 GPU 幀時間。正常排程和「每格強制重拍全部鏡面」要分開記錄，桌面 GPU 數字不能保證手機 FPS／溫度。
- 新增 Three.js 貼圖／幾何時，UUID 建立也會消耗 `Math.random()`，所以相同亂數種子不一定得到相同城市。比較美術效果成本時，在同一份活場景切換材質／背景，保持幾何與相機固定；地面顆粒本身使用局部 PRNG，不逐格重畫。
- 駕駛艙與 `DRIVER_EYE` 在 `js/cabin.js`，不再由 `bus.js` 匯出；`syncBusMesh()` 也會同步指針、警示燈、方向盤與雨刷。車內 62°／車外 66°；車內 HUD 隱藏重複的 SVG 指針但保留數字，切車外要確認雙錶恢復。
- 車內動態儀表需檢查實際像素，不只讀 instanceColor 或角度：曾出現手煞車燈顏色有更新、卻被實體台面完全遮住。現有回歸會逐一改時速、轉速及手煞車，確認可見畫面確實變化；儀表罩下方台面須留空間，警示燈設在錶面上緣。

## 其他
- 測結算畫面會寫入 localStorage 的最佳紀錄（`bus-best`），測完要把假資料刪掉。
- 要把畫面存成圖檔（例如重做 `images/og-image.png`）：把 `app.running` 暫時設成 false 後呼叫 `view.render(0)`，同一段程式裡立刻把 WebGL 畫布畫到另一張 2D 畫布，再用 fetch 把 data URL 送到暫時開的本機 Node 接收程式存檔。
- 改完程式先在瀏覽器實際載入一次：`node --check` 抓不到「常數在宣告前就被使用」這類載入時才出現的錯誤。

## 測不到的項目
- 手指實際的手感、旋轉手機、聲音、手機溫度與流暢度。回報時要明講。