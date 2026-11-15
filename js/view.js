// 鏡頭與後照鏡。後照鏡是另外從鏡子位置往後拍一張，再左右翻轉貼到畫面上方。
import { $, BODY_MID } from './config.js';
import { THREE, renderer, scene, camera } from './world.js';
import { ext } from './bus.js';
import { cabin, DRIVER_EYE } from './cabin.js';
import { bus, eng, app } from './state.js';

// ───────── 主鏡頭：0 = 駕駛座（左駕）, 1 = 車外（可拖曳繞著看、捏合縮放） ─────────
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tmpV = new THREE.Vector3();
let lastCam = -1;
function updateCamera(dt) {
  const fx = Math.sin(bus.h), fz = Math.cos(bus.h);
  const snap = app.camMode !== lastCam;
  if (snap) {
    camera.near = app.camMode === 0 ? 0.1 : 0.3;
    camera.fov = app.camMode === 0 ? 62 : 66;
    $('hud').classList.toggle('cockpit', app.camMode === 0);
    camera.updateProjectionMatrix();
    lastCam = app.camMode;
  }
  if (app.camMode === 0) {
    // 眼睛、視線與上方向都使用駕駛艙的完整變換，側傾時不再用小角度近似。
    cabin.localToWorld(camPos.copy(DRIVER_EYE));
    camLook.copy(DRIVER_EYE);
    camLook.y += -3.7 + bus.jolt * 0.3;
    camLook.z += 30;
    cabin.localToWorld(camLook);
    camera.up.set(0, 1, 0).transformDirection(cabin.matrixWorld);
  } else {
    const cx = bus.x + fx * BODY_MID, cz = bus.z + fz * BODY_MID;
    const o = app.orbit, a = bus.h + Math.PI + o.yaw, flat = o.dist * Math.cos(o.pitch);
    tmpV.set(cx + Math.sin(a) * flat, 2 + o.dist * Math.sin(o.pitch), cz + Math.cos(a) * flat);
    camPos.lerp(tmpV, snap ? 1 : 1 - Math.exp(-(o.drag ? 18 : 4) * dt));
    const ahead = 9 * Math.max(0, Math.cos(o.yaw));
    camLook.lerp(tmpV.set(cx + fx * ahead, 2, cz + fz * ahead), snap ? 1 : 1 - Math.exp(-8 * dt));
    camera.up.set(0, 1, 0);
  }
  camera.position.copy(camPos);
  camera.lookAt(camLook);
}

// ───────── 後照鏡 ─────────
// pos / look 為車身座標 [左(+)右(-), 高度, 前(+)後(-)]，由 ext 的矩陣套用後軸位移與側傾。
const MIRRORS = [
  // 鏡子架在車頭外側前方，往後、往下、略往外看：內側約四分之一是車身，下緣照得到前輪，後輪在中段
  { id: 'mirL', res: [320, 180], fov: 48, pos: [2.1, 2.5, 9.3], look: [9.6, -3.9, -18.3] },
  { id: 'mirR', res: [320, 180], fov: 48, pos: [-2.1, 2.5, 9.3], look: [-9.6, -3.9, -18.3] },
  // 車頭右前角的廣角圓鏡（大客車的前方下視鏡）：照車頭正前方與右前角的死角，看得到保險桿、前門和緊貼車頭的人車
  { id: 'mirC', res: [200, 200], fov: 105, pos: [-1.75, 3.0, 9.9], look: [0.2, 0, 9.0], round: true },
];
// 行車視野輔助畫面（真車的倒車顯影與轉彎時的側邊影像）：倒車時拍車後、打方向燈時拍那一側，其他時候不顯示、也不拍
const MONITOR = {
  rear: { txt: '後方', fov: 100, pos: [0, 2.9, -3.2], look: [0, 0.2, -9] },
  L: { txt: '左側', fov: 88, pos: [1.5, 2.7, 8.8], look: [2.6, 0.1, 1.0] },
  R: { txt: '右側', fov: 88, pos: [-1.5, 2.7, 8.8], look: [-2.6, 0.1, 1.0] },
};
const mon = { id: 'monitor', res: [256, 144], fov: 100, monitor: true, mode: null };
MIRRORS.push(mon);
const overlay = new THREE.Scene();
const ortho = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
for (const m of MIRRORS) {
  m.el = $(m.id);
  // 隨可見尺寸配置，不在手機上固定畫一張遠大於鏡框的貼圖。
  m.rt = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, stencilBuffer: false });
  m.cam = new THREE.PerspectiveCamera(m.fov, m.res[0] / m.res[1], 0.1, camera.far);
  m.valid = false;
  m.interval = 1 / (m.monitor ? 30 : m.round ? 12 : 24);
  m.nextUpdate = 0;
  const geo = m.round ? new THREE.CircleGeometry(0.5, 40) : new THREE.PlaneGeometry(1, 1);
  m.quad = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: m.rt.texture, side: THREE.DoubleSide, depthTest: false, depthWrite: false, toneMapped: false,
  }));
  overlay.add(m.quad);
}
// info 統計整個畫面，而不是只剩最後一次 overlay 的三個面片。
renderer.info.autoReset = false;
scene.matrixWorldAutoUpdate = false;
const viewport = new THREE.Vector2();
const MAX_PIXELS = 2_000_000;

function layoutMirror(m, invalidate = false) {
  const r = m.el.getBoundingClientRect(), w = m.el.clientWidth, h = m.el.clientHeight;
  m.visible = w > 0 && h > 0;
  if (!m.visible) {
    m.quad.visible = false;
    m.valid = false;
    return;
  }
  // 只填鏡框內側，保留 DOM 的邊框；圓鏡仍由圓形幾何體裁切。
  m.quad.position.set(r.left + m.el.clientLeft + w / 2, innerHeight - (r.top + m.el.clientTop + h / 2), 0);
  m.quad.scale.set(-w, h, 1);
  const scale = Math.min(renderer.getPixelRatio(), m.res[0] / w, m.res[1] / h);
  const rw = Math.max(1, Math.round(w * scale)), rh = Math.max(1, Math.round(h * scale));
  if (m.rt.width !== rw || m.rt.height !== rh) {
    m.rt.setSize(rw, rh);
    invalidate = true;
  }
  m.cam.aspect = w / h;
  m.cam.updateProjectionMatrix();
  if (invalidate) m.valid = false;
  m.quad.visible = m.valid;
}

export function layout() {
  const w = innerWidth, h = innerHeight;
  const ratio = Math.min(devicePixelRatio || 1, 1.5, Math.sqrt(MAX_PIXELS / (w * h)));
  renderer.getSize(viewport);
  if (viewport.x !== w || viewport.y !== h || renderer.getPixelRatio() !== ratio) {
    renderer.setDrawingBufferSize(w, h, ratio);
  }
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  ortho.right = w; ortho.top = h;
  ortho.updateProjectionMatrix();
  for (const m of MIRRORS) layoutMirror(m, true);
}
addEventListener('resize', layout);

function capture(m, view) {
  ext.localToWorld(m.cam.position.fromArray(view.pos));
  m.cam.up.set(0, 1, 0).transformDirection(ext.matrixWorld);
  m.cam.lookAt(ext.localToWorld(tmpV.fromArray(view.look)));
  renderer.setRenderTarget(m.rt);
  renderer.render(scene, m.cam);
  // 保留 deadline 的小數餘數，24／30 Hz 不因 60 Hz 的取樣或浮點誤差降成 20 Hz。
  m.nextUpdate = m.valid
    ? m.nextUpdate + m.interval * Math.max(1, Math.floor((app.time - m.nextUpdate) / m.interval) + 1)
    : app.time + m.interval;
  m.valid = m.quad.visible = true;
}
// 現在該顯示哪個輔助畫面：倒車優先，其次是打著的方向燈（開雙黃燈不算）
function monitorMode() {
  if (!app.running) return null;
  if (eng.gear === 'R') return 'rear';
  return bus.signal && !bus.hazard ? bus.signal : null;
}
export function render(dt) {
  renderer.info.reset();
  renderer.autoClear = true;
  // 動態物件每格只更新一次世界矩陣，主畫面與各鏡面共用同一份姿態。
  scene.updateMatrixWorld();
  updateCamera(dt);
  const mode = monitorMode();
  if (mode !== mon.mode) {
    mon.mode = mode;
    mon.el.hidden = !mode;
    if (mode) {
      $('monitorTxt').textContent = MONITOR[mode].txt;
      mon.cam.fov = MONITOR[mode].fov;
    }
    layoutMirror(mon, true);
  }
  if (app.running) {
    ext.visible = true; cabin.visible = false;
    // 首次出現、重開關卡或改尺寸，先補齊全部鏡面，不能把空白或上一關的畫面貼上去。
    let primed = false;
    for (const m of MIRRORS) {
      if (!m.visible || m.valid) continue;
      capture(m, m.monitor ? MONITOR[mode] : m);
      primed = true;
    }
    if (!app.paused && !primed) {
      // 依模擬時間排程：左右各最多 24 Hz、圓鏡 12 Hz；一般每格最多補一面。
      let due = null, age = -1e-7;
      for (const m of MIRRORS) {
        if (!m.visible || m.monitor) continue;
        const overdue = (app.time - m.nextUpdate) / m.interval;
        if (overdue >= age) { due = m; age = overdue; }
      }
      if (due) capture(due, due);
      // 輔助影像最多 30 Hz，不再每個主畫面都把城市多畫一次。
      if (mode && mon.visible && app.time + 1e-7 >= mon.nextUpdate) capture(mon, MONITOR[mode]);
    }
  }
  renderer.setRenderTarget(null);
  ext.visible = app.camMode !== 0;
  cabin.visible = app.camMode === 0;
  renderer.render(scene, camera);
  if (app.running) {
    renderer.autoClear = false;
    renderer.render(overlay, ortho);
    renderer.autoClear = true;
  }
}