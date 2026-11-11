// 鏡頭與後照鏡。後照鏡是另外從鏡子位置往後拍一張，再左右翻轉貼到畫面上方。
import { $ } from './config.js';
import { THREE, renderer, scene, camera } from './world.js';
import { ext, cabin } from './bus.js';
import { bus, app, busCenter } from './state.js';

// ───────── 主鏡頭：0 = 駕駛座（左駕）, 1 = 車後跟隨, 2 = 俯視 ─────────
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tmpV = new THREE.Vector3();
let lastCam = -1;
function updateCamera(dt) {
  const fx = Math.sin(bus.h), fz = Math.cos(bus.h), c = busCenter();
  const snap = app.camMode !== lastCam;
  lastCam = app.camMode;
  camera.up.set(0, app.camMode === 2 ? 0 : 1, app.camMode === 2 ? -1 : 0);
  if (app.camMode === 0) {
    camPos.set(bus.x + fx * 7.0 + fz * 0.62, 2.25, bus.z + fz * 7.0 - fx * 0.62);
    camLook.set(camPos.x + fx * 30, 1.2 + bus.jolt * 0.3, camPos.z + fz * 30);
  } else if (app.camMode === 1) {
    tmpV.set(c.x - fx * 19, 9, c.z - fz * 19);
    camPos.lerp(tmpV, snap ? 1 : 1 - Math.exp(-4 * dt));
    camLook.lerp(tmpV.set(c.x + fx * 9, 2, c.z + fz * 9), snap ? 1 : 1 - Math.exp(-8 * dt));
  } else {
    camPos.set(c.x, 95, c.z);
    camLook.set(c.x, 0, c.z);
  }
  camera.position.copy(camPos);
  camera.lookAt(camLook);
}

// ───────── 後照鏡 ─────────
// pos / look 為公車區域座標 [左(+)右(-), 高度, 前(+)後(-)]
const MIRRORS = [
  // 鏡子架在車頭外側前方，往後、往下、略往外看：內側約四分之一是車身，下緣照得到前輪，後輪在中段
  { id: 'mirL', res: [320, 180], fov: 48, pos: [2.1, 2.5, 9.3], look: [9.6, -3.9, -18.3] },
  { id: 'mirR', res: [320, 180], fov: 48, pos: [-2.1, 2.5, 9.3], look: [-9.6, -3.9, -18.3] },
  // 右前方的廣角圓鏡：看車門側的路緣與停靠區
  { id: 'mirC', res: [200, 200], fov: 100, pos: [-1.6, 2.8, 9.0], look: [-3.4, 0, 2], round: true },
];
const overlay = new THREE.Scene();
const ortho = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
for (const m of MIRRORS) {
  m.el = $(m.id);
  m.rt = new THREE.WebGLRenderTarget(m.res[0], m.res[1]);
  m.cam = new THREE.PerspectiveCamera(m.fov, m.res[0] / m.res[1], 0.3, 420);
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
  return out.set(bus.x + p[0] * fz + p[2] * fx, p[1], bus.z - p[0] * fx + p[2] * fz);
}

let frameNo = 0;
export function render(dt) {
  updateCamera(dt);
  // 後照鏡隔一格畫面更新一次，節省手機效能
  if (app.running && frameNo++ % 2 === 0) {
    ext.visible = true; cabin.visible = false;
    for (const m of MIRRORS) {
      if (!m.quad.visible) continue;
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