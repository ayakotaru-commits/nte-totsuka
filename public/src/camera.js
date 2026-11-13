import * as THREE from 'three';

export class ThirdPersonCamera {
  constructor(camera, world, dom) {
    this.camera = camera;
    this.world = world;
    this.yaw = 0;
    this.pitch = 0.25;
    this.dist = 5.5;
    this.curDist = 5.5;
    this.target = new THREE.Vector3();
    this.locked = false;
    this.freeRotate = false; // 修正モード: マウス解放中に右ドラッグで回転
    this.maxDist = 30;

    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === dom; });
    addEventListener('mousemove', (e) => {
      if (!this.locked && !(this.freeRotate && (e.buttons & 2))) return;
      this.yaw -= e.movementX * 0.0025;
      this.pitch = Math.max(-0.45, Math.min(1.35, this.pitch + e.movementY * 0.0025));
    });
    addEventListener('wheel', (e) => {
      this.dist = Math.max(1.8, Math.min(this.maxDist, this.dist * (e.deltaY > 0 ? 1.1 : 0.9)));
    }, { passive: true });
  }

  update(dt, playerPos, snap = false) {
    const want = new THREE.Vector3(playerPos.x, playerPos.y + 1.45, playerPos.z);
    if (snap) this.target.copy(want);
    else this.target.lerp(want, 1 - Math.exp(-dt * 18));

    const cp = Math.cos(this.pitch);
    const dir = new THREE.Vector3(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);

    // 建物にめり込まないよう距離を縮める
    let free = this.dist;
    for (let t = 0.5; t <= this.dist; t += 0.25) {
      const x = this.target.x + dir.x * t, y = this.target.y + dir.y * t, z = this.target.z + dir.z * t;
      if (this.world.blockedAt(x, y, z)) { free = Math.max(0.6, t - 0.35); break; }
    }
    if (free < this.curDist || snap) this.curDist = free;
    else this.curDist += (free - this.curDist) * (1 - Math.exp(-dt * 4));

    this.camera.position.copy(this.target).addScaledVector(dir, this.curDist);
    this.camera.lookAt(this.target);
  }
}
