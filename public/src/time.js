import * as THREE from 'three';

// skyElev: 空のシェーダ上の太陽高度, lightElev: 実際のライト方向 (夜は月明かり)
// azim: 0 = 南(+Z), 90 = 東(+X), -90 = 西
export const PRESETS = [
  { name: '昼', skyElev: 55, lightElev: 55, azim: -20, sun: '#fff6e8', sunI: 3.0, hemiI: 1.9, exposure: 0.6, fog: '#c9d6e3', win: 0.0, rayleigh: 1.2, envI: 0.1, hemiK: 0.8, ao: 0.6, bloom: 0.12, bloomT: 1.1, sat: 1.08 },
  { name: '夕方', skyElev: 4, lightElev: 8, azim: -85, sun: '#ffa865', sunI: 2.2, hemiI: 1.1, exposure: 0.55, fog: '#d8a989', win: 0.45, rayleigh: 2.5, envI: 0.15, hemiK: 0.75, ao: 0.6, bloom: 0.3, bloomT: 0.8, sat: 1.12 },
  { name: '夜', skyElev: -6, lightElev: 40, azim: 20, sun: '#8ea2d8', sunI: 0.6, hemiI: 0.55, exposure: 0.7, fog: '#141c33', win: 1.3, rayleigh: 0.4, envI: 0.5, hemiK: 0.8, ao: 0.5, bloom: 0.7, bloomT: 0.5, sat: 1.05 },
  { name: '朝', skyElev: 12, lightElev: 14, azim: 75, sun: '#ffe2c2', sunI: 2.4, hemiI: 0.75, exposure: 0.5, fog: '#dbe0e8', win: 0.08, rayleigh: 1.8, envI: 0.12, hemiK: 0.8, ao: 0.6, bloom: 0.2, bloomT: 0.9, sat: 1.1 },
];

// envI 以降は look.js (光と空気感) が使う: 空の映り込みの強さ・半球ライトの残す割合・物の陰・にじみの強さとしきい値・彩度
const num = ['skyElev', 'lightElev', 'azim', 'sunI', 'hemiI', 'exposure', 'win', 'rayleigh', 'envI', 'hemiK', 'ao', 'bloom', 'bloomT', 'sat'];

export class TimeOfDay {
  constructor({ renderer, scene, sky, sun, hemi, windowMats }) {
    Object.assign(this, { renderer, scene, sky, sun, hemi, windowMats });
    this.idx = 0;
    this.cur = { ...PRESETS[0], sunC: new THREE.Color(PRESETS[0].sun), fogC: new THREE.Color(PRESETS[0].fog) };
    this.lightDir = new THREE.Vector3();
    this.apply();
  }

  next() { this.idx = (this.idx + 1) % PRESETS.length; return PRESETS[this.idx].name; }

  snap() {
    const t = PRESETS[this.idx];
    this.cur = { ...t, sunC: new THREE.Color(t.sun), fogC: new THREE.Color(t.fog) };
    this.apply();
  }

  update(dt) {
    const tgt = PRESETS[this.idx], k = 1 - Math.exp(-dt * 2.5);
    for (const key of num) this.cur[key] += (tgt[key] - this.cur[key]) * k;
    this.cur.sunC.lerp(new THREE.Color(tgt.sun), k);
    this.cur.fogC.lerp(new THREE.Color(tgt.fog), k);
    this.apply();
  }

  apply() {
    const c = this.cur, az = THREE.MathUtils.degToRad(c.azim);
    const skyDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - c.skyElev), az);
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(skyDir);
    u.rayleigh.value = c.rayleigh;
    this.lightDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - c.lightElev), az);
    this.sun.color.copy(c.sunC);
    this.sun.intensity = c.sunI;
    this.hemi.intensity = c.hemiI;
    this.renderer.toneMappingExposure = c.exposure;
    this.scene.fog.color.copy(c.fogC);
    for (const m of this.windowMats) {
      const v = c.win * (m.userData.glow || 1);   // userData.glow = 光り方の倍率 (店の看板など)
      if (m.userData.opacityOnly) m.opacity = Math.min(1, v); else m.emissiveIntensity = v;   // opacityOnly = 光だまりのような透明な板 (emissive を持たない材質)
    }
    // 太陽が沈んだら Sky シェーダの代わりに紺色の背景
    this.sky.visible = c.skyElev > -2;
    this.scene.background = this.sky.visible ? null : c.fogC;
  }
}
