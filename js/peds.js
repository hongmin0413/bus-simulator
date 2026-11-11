// 行人：在有紅綠燈的路口走斑馬線過馬路。被橫越的那條路是紅燈、而且剩下的時間夠走完才會起步
import { N, CELL, HALF, rand, pick } from './config.js';
import { THREE, scene, lambert, lightState, redLeft } from './world.js';

export const peds = [];   // { x, z, walking, ... }；walking = 正在馬路上
const MAX = 64, EDGE = 7.7;   // EDGE：等候位置離路中線的距離（人行道邊）
const COLORS = [0xe57373, 0x64b5f6, 0xffd54f, 0x81c784, 0xba68c8, 0xff8a65, 0x4dd0e1, 0xf06292, 0xeeeeee, 0x455a64];
const bodies = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.26, 1.15, 8), lambert(0xffffff), MAX);
const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 10, 8), lambert(0xf1c9a5), MAX);
bodies.frustumCulled = heads.frustumCulled = false;   // 行人散在整個城市，不能用單一包圍球裁切
bodies.count = heads.count = 0;
scene.add(bodies, heads);
const dummy = new THREE.Object3D(), tmpColor = new THREE.Color();

function place(p) {
  p.x = p.cx + p.px * p.s;
  p.z = p.cz + p.pz * p.s;
}
// 讓行人直接走到對面（被公車撞到後用，避免連續判定）
export function finishCrossing(p) {
  p.s = p.dir * EDGE; p.dir = -p.dir; p.walking = false; p.wait = rand(8, 20);
  place(p);
}

export function resetPeds(count) {
  peds.length = 0;
  const n = Math.min(count, MAX);
  for (let k = 0; k < n; k++) {
    const i = 1 + Math.floor(rand(0, N - 1)), j = 1 + Math.floor(rand(0, N - 1));
    const u = pick([{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }]);   // 斑馬線在路口的哪一側
    const side = Math.random() < 0.5 ? -1 : 1, c = HALF + 2.3 + rand(-1.1, 1.1);
    const p = {
      i, j, axis: u.x !== 0 ? 0 : 1,            // 被橫越的那條路的行車方向
      cx: i * CELL + u.x * c, cz: j * CELL + u.z * c, px: -u.z, pz: u.x,
      s: side * EDGE, dir: -side, walking: false, wait: rand(0, 15), speed: rand(1.6, 1.9), x: 0, z: 0,
    };
    place(p);
    bodies.setColorAt(k, tmpColor.set(pick(COLORS)));
    peds.push(p);
  }
  bodies.count = heads.count = n;
  if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
  updatePeds(0);
}

export function updatePeds(dt) {
  peds.forEach((p, k) => {
    if (p.walking) {
      p.s += p.dir * p.speed * dt;
      if (p.s * p.dir >= EDGE) { p.s = p.dir * EDGE; p.dir = -p.dir; p.walking = false; p.wait = rand(4, 25); }
    } else {
      p.wait -= dt;
      if (p.wait <= 0 && lightState(p.i, p.j, p.axis) === 'r' && redLeft(p.i, p.j, p.axis) > (2 * EDGE) / p.speed + 0.4) p.walking = true;
    }
    place(p);
    const y = Math.abs(p.s) > HALF ? 0.2 : 0;   // 站在人行道上時高一階
    dummy.position.set(p.x, y + 0.58, p.z);
    dummy.updateMatrix();
    bodies.setMatrixAt(k, dummy.matrix);
    dummy.position.y = y + 1.36;
    dummy.updateMatrix();
    heads.setMatrixAt(k, dummy.matrix);
  });
  bodies.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = true;
}