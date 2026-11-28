import * as THREE from 'three';

const FOLLOW_WAIT = 0.8;       // マウスで視点を動かした後、自動追従が効き始めるまでの秒数
const FOLLOW_RAMP = 0.8;       // そこから効きが最大になるまでの秒数
const FOLLOW_YAW = 1.0;        // 後ろへ回り込む速さ (真横へ進むときの rad/s)
const FOLLOW_PITCH = 0.3;      // 落ち着く見下ろし角 (rad、約 17°)
const FOLLOW_PITCH_RATE = 1.5; // 見下ろし角が戻る速さ

const MIN_DIST = 0.8;          // ホイール・ピンチで寄れる最短距離 (m。以前は 1.8)

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
    this.targetY = null; // 注視点の高さ (足元から m)。null = 足元 + 1.45 m (キャラメイクの顔のアップで、頭の高さにする)
    this.view = null;    // 画面の中心をずらす割合 { x, y } (メニューに隠れない側へキャラを寄せる。+ = 左・上へ寄る)
    this.freeRotate = false; // 修正モード: マウス解放中に右ドラッグで回転
    this.maxDist = 30;
    // 自動追従: 歩き出すと、キャラの後ろ・少し上へゆっくり回り込む。マウスで視点を動かした直後は手動を優先
    this.autoFollow = !new URLSearchParams(location.search).has('nofollow');
    this.idle = 9; // マウスで視点を動かしてからの秒数

    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === dom; });
    addEventListener('mousemove', (e) => {
      if (!this.locked && !(this.freeRotate && (e.buttons & 2))) return;
      this.rotate(e.movementX * 0.0025, e.movementY * 0.0025);
    });
    addEventListener('wheel', (e) => this.zoom(e.deltaY > 0 ? 1.1 : 0.9), { passive: true });
  }

  // 視点を回す (rad。マウスとタッチの両方から呼ぶ)
  rotate(dYaw, dPitch) {
    if (dYaw || dPitch) this.idle = 0;
    this.yaw -= dYaw;
    this.pitch = Math.max(-0.45, Math.min(1.35, this.pitch + dPitch));
  }

  // カメラの距離を k 倍にする
  zoom(k) { this.dist = Math.max(MIN_DIST, Math.min(this.maxDist, this.dist * k)); }

  // player を渡すと自動追従する (修正モード中は無効)
  update(dt, playerPos, snap = false, player = null) {
    this.idle += dt;
    if (player && this.autoFollow && !this.freeRotate && dt > 0) {
      const speed = player.vel.length();
      // 効き具合: マウスを止めて FOLLOW_WAIT 秒後から徐々に、止まっているときは 0
      const s = Math.min(1, Math.max(0, (this.idle - FOLLOW_WAIT) / FOLLOW_RAMP)) * Math.min(1, speed / 1.5);
      if (s > 0) {
        // 後ろ = 向き + 180°。sin を使うので、横へ進むと最も速く回り、カメラへ向かって来るとき (180°) は回らない
        const d = player.facing + Math.PI - this.yaw;
        this.yaw += Math.sin(d) * FOLLOW_YAW * s * dt;
        this.pitch += (FOLLOW_PITCH - this.pitch) * (1 - Math.exp(-FOLLOW_PITCH_RATE * s * dt));
      }
    }
    const want = new THREE.Vector3(playerPos.x, playerPos.y + (this.targetY ?? 1.45), playerPos.z);
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
    if (this.view) { const w = innerWidth, h = innerHeight; this.camera.setViewOffset(w, h, this.view.x * w, this.view.y * h, w, h); this.viewSet = true; }
    else if (this.viewSet) { this.camera.clearViewOffset(); this.viewSet = false; }
  }
}
