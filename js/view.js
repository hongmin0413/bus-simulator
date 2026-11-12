// 鏡頭與後照鏡。後照鏡是另外從鏡子位置往後拍一張，再左右翻轉貼到畫面上方。
import { $, BODY_Z } from './config.js';
import { THREE, renderer, scene, camera } from './world.js';
import { ext, cabin } from './bus.js';
import { bus, app, busCenter } from './state.js';

// ───────── 主鏡頭：0 = 駕駛座（左駕）, 1 = 車外（可拖曳繞著看、捏合縮放） ─────────
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tmpV = new THREE.Vector3();
let lastCam = -1;
function updateCamera(dt) {
  const fx = Math.sin(bus.h), fz = Math.cos(bus.h), c = busCenter();
  const snap = app.camMode !== lastCam;
  lastCam = app.camMode;
  if (app.camMode === 0) {
    // 駕駛座：貼著左側車窗、在前輪前方，眼睛離地約 2.3 公尺
    // 車身側傾時，駕駛的頭跟著車身一起偏
    // 眼睛在車身座標 [0.8, 2.3, 7.3]：離車身中線 0.8 公尺（離左側車壁約 0.45）、離擋風玻璃約 1.7 公尺、離地 2.3 公尺
    const ez = 7.3 + BODY_Z, ex = 0.8 + 2.3 * bus.roll;
    camPos.set(bus.x + fx * ez + fz * ex, 2.3 - 0.8 * bus.roll, bus.z + fz * ez - fx * ex);
    camLook.set(camPos.x + fx * 30, 1.1 + bus.jolt * 0.3, camPos.z + fz * 30);
  } else {
    // 車外：以公車為中心，可以用手指拖曳繞著看（yaw 0 = 正後方，轉到 180 度就是看車頭）
    const o = app.orbit, a = bus.h + Math.PI + o.yaw, flat = o.dist * Math.cos(o.pitch);
    tmpV.set(c.x + Math.sin(a) * flat, 2 + o.dist * Math.sin(o.pitch), c.z + Math.cos(a) * flat);
    camPos.lerp(tmpV, snap ? 1 : 1 - Math.exp(-(o.drag ? 18 : 4) * dt));
    const ahead = 9 * Math.max(0, Math.cos(o.yaw));   // 從後面看時視線落在車頭前方，繞到側面或前面就看車身中心
    camLook.lerp(tmpV.set(c.x + fx * ahead, 2, c.z + fz * ahead), snap ? 1 : 1 - Math.exp(-8 * dt));
  }
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  if (app.camMode === 0) camera.rotateZ(bus.roll);
}

// ───────── 後照鏡 ─────────
// pos / look 為車身座標 [左(+)右(-), 高度, 前(+)後(-)]（車身從 z = -3 到 9；實際位置還要加 BODY_Z）
const MIRRORS = [
  // 鏡子架在車頭外側前方，往後、往下、略往外看：內側約四分之一是車身，下緣照得到前輪，後輪在中段
  { id: 'mirL', res: [320, 180], fov: 48, pos: [2.1, 2.5, 9.3], look: [9.6, -3.9, -18.3] },
  { id: 'mirR', res: [320, 180], fov: 48, pos: [-2.1, 2.5, 9.3], look: [-9.6, -3.9, -18.3] },
  // 車頭右前角的廣角圓鏡（大客車的前方下視鏡）：照車頭正前方與右前角的死角，看得到保險桿、前門和緊貼車頭的人車
  { id: 'mirC', res: [200, 200], fov: 105, pos: [-1.75, 3.0, 9.9], look: [0.2, 0, 9.0], round: true },
];
const overlay = new THREE.Scene();
const ortho = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
for (const m of MIRRORS) {
  m.el = $(m.id);
  m.rt = new THREE.WebGLRenderTarget(m.res[0], m.res[1]);
  m.cam = new THREE.PerspectiveCamera(m.fov, m.res[0] / m.res[1], 0.3, 260);
  const geo = m.round ? new THREE.CircleGeometry(0.5, 40) : new THREE.PlaneGeometry(1, 1);
  m.quad = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: m.rt.texture, side: THREE.DoubleSide, depthTest: false }));
  overlay.add(m.quad);
}

export function layout() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  ortho.right = w; ortho.top = h;
  ortho.updateProjectionMatrix();
  for (const m of MIRRORS) {
    const r = m.el.getBoundingClientRect();
    m.quad.visible = r.width > 0;
    m.quad.position.set(r.left + r.width / 2, h - (r.top + r.height / 2), 0);
    m.quad.scale.set(-r.width, r.height, 1); // 負值 = 左右翻轉，才是鏡中影像
    if (r.width > 0) { m.cam.aspect = r.width / r.height; m.cam.updateProjectionMatrix(); }
  }
}
addEventListener('resize', layout);

function local(p, out) {
  const fx = Math.sin(bus.h), fz = Math.cos(bus.h);
  const pz = p[2] + BODY_Z;
  return out.set(bus.x + p[0] * fz + pz * fx, p[1], bus.z - p[0] * fx + pz * fz);
}

let frameNo = 0;
const ORDER = ['mirL', 'mirR', 'mirL', 'mirR', 'mirC'];
export function render(dt) {
  updateCamera(dt);
  // 後照鏡很吃效能（每面鏡子都要把場景再畫一次），所以每格畫面只更新其中一面：左、右、左、右、圓鏡輪流
  if (app.running) {
    ext.visible = true; cabin.visible = false;
    const turn = ORDER[frameNo++ % ORDER.length];
    for (const m of MIRRORS) {
      if (!m.quad.visible || m.id !== turn) continue;
      local(m.pos, m.cam.position);
      m.cam.lookAt(local(m.look, tmpV));
      renderer.setRenderTarget(m.rt);
      renderer.render(scene, m.cam);
    }
    renderer.setRenderTarget(null);
  }
  ext.visible = app.camMode !== 0;
  cabin.visible = app.camMode === 0;
  renderer.autoClear = true;
  renderer.render(scene, camera);
  if (app.running) {
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(overlay, ortho);
  }
}