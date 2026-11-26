import * as THREE from 'three';
import { moonPhase, setStars } from './skyfx.js';

// skyElev: 空のシェーダ上の太陽高度, lightElev: 実際のライト方向 (夜は月明かり)
// azim: 0 = 南(+Z), 90 = 東(+X), -90 = 西
export const PRESETS = [
  { name: '昼', skyElev: 55, lightElev: 55, azim: -20, sun: '#fff6e8', sunI: 3.0, hemiI: 1.9, exposure: 0.6, fog: '#c9d6e3', win: 0.0, rayleigh: 1.2, envI: 0.1, hemiK: 0.8, ao: 0.6, bloom: 0.12, bloomT: 1.1, sat: 1.08 },
  { name: '夕方', skyElev: 4, lightElev: 8, azim: -85, sun: '#ffa865', sunI: 2.2, hemiI: 1.1, exposure: 0.55, fog: '#d8a989', win: 0.45, rayleigh: 2.5, envI: 0.15, hemiK: 0.75, ao: 0.6, bloom: 0.3, bloomT: 0.8, sat: 1.12 },
  { name: '夜', skyElev: -6, lightElev: 40, azim: 20, sun: '#8ea2d8', sunI: 0.6, hemiI: 0.55, exposure: 0.7, fog: '#141c33', win: 1.3, rayleigh: 0.4, envI: 0.5, hemiK: 0.8, ao: 0.5, bloom: 0.7, bloomT: 0.5, sat: 1.05 },
  { name: '朝', skyElev: 12, lightElev: 14, azim: 75, sun: '#ffe2c2', sunI: 2.4, hemiI: 0.75, exposure: 0.5, fog: '#dbe0e8', win: 0.08, rayleigh: 1.8, envI: 0.12, hemiK: 0.8, ao: 0.6, bloom: 0.2, bloomT: 0.9, sat: 1.1 },
];

// envI 以降は look.js (光と空気感) が使う: 空の映り込みの強さ・半球ライトの残す割合・物の陰・にじみの強さとしきい値・彩度
const num = ['sunI', 'hemiI', 'exposure', 'win', 'rayleigh', 'envI', 'hemiK', 'ao', 'bloom', 'bloomT', 'sat', 'cloud'];

// ---- 1 日の流れ (連続した時刻) ----
// 太陽は時刻 (0〜24) から計算する: 6 時に東の地平線から出て、12 時に南で最も高く (SUN_MAX 度)、18 時に西へ沈む。
// 色・光の強さ・明かりなどの値は、下の KEYS (時刻ごとの見本) の間をなめらかにつなぐ。
// 「昼・夕方・夜・朝」(T キー・メニュー) は、それぞれの時刻 (PRESET_HOUR) へ向かって時間が進む。
const SUN_MAX = 56;
export const PRESET_HOUR = { 昼: 12, 夕方: 17.6, 夜: 22, 朝: 6.8 };
const by = Object.fromEntries(PRESETS.map((p) => [p.name, p]));
for (const p of PRESETS) p.cloud = { 昼: 0.58, 夕方: 0.5, 夜: 0.4, 朝: 0.5 }[p.name];
const DAWN = { ...by.夜, sun: '#ffb48a', sunI: 0.9, hemiI: 0.62, exposure: 0.6, fog: '#9a93a6', win: 0.9, rayleigh: 1.0, envI: 0.3, hemiK: 0.8, ao: 0.55, bloom: 0.45, bloomT: 0.7, sat: 1.08, cloud: 0.42 };
const DUSK = { ...by.夕方, sun: '#ff8f72', sunI: 1.0, hemiI: 0.66, exposure: 0.62, fog: '#8c7d93', win: 0.95, rayleigh: 1.4, envI: 0.3, hemiK: 0.8, ao: 0.55, bloom: 0.45, bloomT: 0.7, sat: 1.1, cloud: 0.48 };
const KEYS = [
  [0, by.夜], [4.9, by.夜], [5.7, DAWN], [6.8, by.朝], [10, by.昼], [14.5, by.昼], [17.6, by.夕方], [18.3, DUSK], [19.6, by.夜], [24, by.夜],
];
const ss = (t) => t * t * (3 - 2 * t);
const wrap24 = (h) => ((h % 24) + 24) % 24;
const sunElevOf = (h) => SUN_MAX * Math.sin(Math.PI * (h - 6) / 12);
const aziOf = (h) => -15 * (h - 12);
const _c = new THREE.Color(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const dirOf = (v, azDeg, elDeg) => v.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elDeg), THREE.MathUtils.degToRad(azDeg));

export class TimeOfDay {
  constructor({ renderer, scene, sky, sun, hemi, windowMats }) {
    Object.assign(this, { renderer, scene, sky, sun, hemi, windowMats });
    const Q = new URLSearchParams(location.search);
    this.idx = 0;
    this.hour = PRESET_HOUR.昼;
    if (Q.has('hour')) this.hour = wrap24(+Q.get('hour'));
    this.target = this.hour;
    this.jumping = false;
    this.speed = +(Q.get('tspeed') || 0);        // ゲーム内の時間が進む速さ (1 分あたり何時間。0 = 止めておく。T で時間帯へジャンプ)
    this.t = 0;                                   // 雲・星の動き用の経過秒
    this.over = {};                               // ?cloud=0.7 (雲の量 0〜1)、?moon=0.5 (月齢 0 = 新月、0.5 = 満月)
    if (Q.has('cloud')) this.over.cloud = +Q.get('cloud');
    this.phase = Q.has('moon') ? +Q.get('moon') : moonPhase();
    this.doy = ((Date.now() / 86400000) % 365.25);   // 星空の季節 (恒星時のずれ)
    this.cur = { sunC: new THREE.Color(), fogC: new THREE.Color() };
    this.lightDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.apply();
  }

  get name() {
    const h = this.hour;
    return h >= 19.3 || h < 5 ? '夜' : h < 9 ? '朝' : h < 16.5 ? '昼' : '夕方';
  }

  label() {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60 / 10) * 10;
    return `${this.name} ${h}:${String(m).padStart(2, '0')}`;
  }

  // 次の時間帯 (昼 → 夕方 → 夜 → 朝 → 昼) へ、時間を進めて向かう
  next() {
    this.idx = (this.idx + 1) % PRESETS.length;
    const name = PRESETS[this.idx].name;
    this.target = PRESET_HOUR[name];
    this.jumping = true;
    return this.label();
  }

  snap() {
    this.hour = this.target;
    this.jumping = false;
    this.apply();
  }

  update(dt) {
    this.t += dt;
    if (this.jumping || !this.speed) {
      const d = wrap24(this.target - this.hour);
      if (d > 0.005 && d < 23.995) this.hour = wrap24(this.hour + d * (1 - Math.exp(-dt * 2.5)));
      else { this.hour = this.target; this.jumping = false; }
    } else {
      this.hour = wrap24(this.hour + dt * this.speed / 60);
      this.target = this.hour;
    }
    this.apply();
  }

  // 時刻 h の見本の間をつないで cur に入れる
  blend(h) {
    let i = 0;
    while (i < KEYS.length - 2 && h >= KEYS[i + 1][0]) i++;
    const [h0, a] = KEYS[i], [h1, b] = KEYS[i + 1];
    const t = ss(THREE.MathUtils.clamp((h - h0) / (h1 - h0), 0, 1)), c = this.cur;
    for (const k of num) c[k] = a[k] + (b[k] - a[k]) * t;
    c.sunC.set(a.sun).lerp(_c.set(b.sun), t);
    c.fogC.set(a.fog).lerp(_c.set(b.fog), t);
  }

  apply() {
    const c = this.cur, h = this.hour;
    this.blend(h);
    if (this.over.cloud != null) c.cloud = this.over.cloud;
    const sunEl = sunElevOf(h), sunAz = aziOf(h);
    c.skyElev = sunEl; c.azim = sunAz;
    // 月: 太陽から月齢ぶん (満月で 12 時間) 遅れて同じ道を通る
    const mh = h - 24 * this.phase, moonEl = sunElevOf(mh), moonAz = aziOf(mh);
    dirOf(this.moonDir, moonAz, moonEl);
    // 光の向き: 昼は太陽 (沈む前に低さの下限)、夜は月の向き (低すぎない高さ)
    const sunL = dirOf(new THREE.Vector3(), sunAz, Math.max(sunEl, 8));
    const moonL = dirOf(new THREE.Vector3(), moonAz, THREE.MathUtils.clamp(moonEl, 28, 60));
    // 沈む前後は月の向きから太陽の向きへ、回転でなめらかに移す (向きを足して割ると、反対向きのとき急に振れる)
    const wSun = ss(THREE.MathUtils.clamp((sunEl + 10) / 16, 0, 1));
    _q.setFromUnitVectors(moonL, sunL); _q2.identity().slerp(_q, wSun);
    this.lightDir.copy(moonL).applyQuaternion(_q2).normalize();
    c.lightElev = 90 - THREE.MathUtils.radToDeg(Math.acos(this.lightDir.y));

    const skyDir = dirOf(new THREE.Vector3(), sunAz, sunEl);
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(skyDir);
    u.rayleigh.value = c.rayleigh;
    u.uTime.value = this.t;
    u.uCover.value = c.cloud;
    u.uCirrus.value = 0.18 + 0.32 * c.cloud;
    u.uFog.value.copy(c.fogC);
    u.uMoonDir.value.copy(this.moonDir);
    u.uMoonPhase.value = this.phase;
    setStars(u, h + this.doy * 24 / 365.25 * 1.0);
    this.sun.color.copy(c.sunC);
    this.sun.intensity = c.sunI;
    this.hemi.intensity = c.hemiI;
    this.renderer.toneMappingExposure = c.exposure;
    this.scene.fog.color.copy(c.fogC);
    for (const m of this.windowMats) {
      const v = c.win * (m.userData.glow || 1);   // userData.glow = 光り方の倍率 (店の看板など)
      if (m.userData.opacityOnly) m.opacity = Math.min(1, v); else m.emissiveIntensity = v;   // opacityOnly = 光だまりのような透明な板 (emissive を持たない材質)
    }
    // 空は昼も夜も空のシェーダ (skyfx.js) が描く
    this.sky.visible = true;
    this.scene.background = null;
  }
}
