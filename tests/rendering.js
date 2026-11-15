// 瀏覽器回歸測試：在獨立測試分頁選好關卡後，從主控台呼叫 run()；不需要套件。
import { renderer, scene, camera } from '../js/world.js';
import { bus, app, eng } from '../js/state.js';
import { syncBusMesh } from '../js/bus.js';
import { cabin, DRIVER_EYE } from '../js/cabin.js';
import { layout, render } from '../js/view.js';

function assert(ok, message) { if (!ok) throw new Error(message); }
function pixels() {
  const gl = renderer.getContext(), cv = renderer.domElement;
  const out = new Uint8Array(cv.width * cv.height * 4);
  gl.readPixels(0, 0, cv.width, cv.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
  return out;
}
function sameImage(a, b, label) {
  assert(a.length === b.length, label + '：畫面尺寸不同');
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > 2 || Math.abs(a[i + 1] - b[i + 1]) > 2 || Math.abs(a[i + 2] - b[i + 2]) > 2) changed++;
  }
  assert(changed === 0, `${label}：${changed} 個像素不一致`);
}
function changedImage(a, b, label) {
  assert(a.some((value, i) => Math.abs(value - b[i]) > 2), label + '：實際畫面沒有變化');
}

export function run() {
  assert(app.running, '先在獨立測試分頁選擇一個關卡');
  const savedBus = { ...bus }, savedApp = { ...app }, gear = eng.gear, rpm = eng.rpm;
  const culled = [];
  scene.traverse((object) => { if (object.isMesh) culled.push([object, object.frustumCulled]); });
  const results = [];
  try {
    app.camMode = 0;
    app.paused = true;
    bus.signal = null; bus.hazard = false; eng.gear = 'N';
    for (let k = 0; k < 6; k++) render(0);
    // 模擬重開／換關卡的瞬移；第一格不能混用舊位置的鏡面貼圖。
    bus.x += 140; bus.z += 40;
    syncBusMesh(); layout(); render(0);
    const first = pixels();
    for (let k = 0; k < 10; k++) render(0);
    sameImage(first, pixels(), '瞬移後的第一格與穩定畫面');
    results.push('重設後三面鏡子第一格即完成更新');

    // 側邊影像與倒車影像切換時，第一格就必須是新鏡頭的影像。
    for (const mode of ['L', 'R', 'rear', null]) {
      bus.signal = mode === 'L' || mode === 'R' ? mode : null;
      eng.gear = mode === 'rear' ? 'R' : 'N';
      render(0);
      const initial = pixels();
      render(0); render(0);
      sameImage(initial, pixels(), `輔助影像 ${mode} 的第一格`);
    }
    results.push('左右輔助影像、倒車與隱藏切換無舊影像');
    // 不是裝飾指針：停住模擬，單獨改時速、轉速與手煞車，檢查可見的車內像素。
    for (const [label, change] of [
      ['時速錶指針', () => { bus.v = bus.v === 0 ? 12 : 0; }],
      ['轉速錶指針', () => { eng.rpm = eng.rpm === 0 ? 1600 : 0; }],
      ['手煞車警示燈', () => { bus.hand = !bus.hand; }],
    ]) {
      syncBusMesh(); render(0);
      const before = pixels();
      change(); syncBusMesh(); render(0);
      changedImage(before, pixels(), label);
    }
    results.push('立體時速／轉速指針與手煞車燈確實改變可見畫面');

    // 與完全不裁切的實際像素比較，主畫面與三面鏡子在分區邊界都不能漏畫。
    for (const [x, z, h, roll] of [[199, 201, 0, 0.045], [201, 199, 1.4, -0.045], [399, 401, 3.1, 0]]) {
      Object.assign(bus, { x, z, h, roll });
      syncBusMesh(); layout(); render(0);
      const eye = cabin.localToWorld(DRIVER_EYE.clone());
      assert(camera.position.distanceTo(eye) < 1e-8, '駕駛眼睛必須貼合側傾後的駕駛艙');
      const clipped = pixels();
      for (const [object] of culled) object.frustumCulled = false;
      layout(); render(0);
      sameImage(clipped, pixels(), `分區邊界 ${x},${z} 的視錐裁切`);
      for (const [object, flag] of culled) object.frustumCulled = flag;
    }
    results.push('分區邊界與不同朝向的畫面和不裁切相同，側傾視點貼合車身');
    assert(renderer.getContext().getError() === 0, 'WebGL 不可產生錯誤');
    return results;
  } finally {
    Object.assign(bus, savedBus); Object.assign(app, savedApp); eng.gear = gear; eng.rpm = rpm;
    for (const [object, flag] of culled) object.frustumCulled = flag;
    syncBusMesh(); layout(); render(0);
  }
}