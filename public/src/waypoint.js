// 目的地マーカー: 光の柱 + 地面のリング + 画面上の距離表示
import * as THREE from 'three';
import { H } from './terrain.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

export class Waypoints {
  constructor(list, scene, hudEl, world) {
    this.list = list || [];
    this.world = world;
    this.hudEl = hudEl;
    this.items = this.list.map((w) => {
      const g = new THREE.Group();
      g.position.set(w.x, H(w.x, w.z), w.z);
      const beamMat = new THREE.MeshBasicMaterial({ color: '#ffb02e', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 120, 16, 1, true).translate(0, 60, 0), beamMat);
      const ringMat = new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.0, 40).rotateX(-Math.PI / 2), ringMat);
      ring.position.y = 0.2;
      const el = document.createElement('div');
      el.className = 'label waypoint';
      const label = new CSS2DObject(el);
      label.position.y = 6;
      g.add(beam, ring, label);
      scene.add(g);
      // 目的地が建物の中なら、その建物の外壁に着いた時点で到着とする
      const host = world ? world.query(w.x, w.z, w.x, w.z).find(b => world.contains(b, w.x, w.z)) : null;
      if (host) { beam.scale.set(4, 1, 4); ring.visible = false; label.position.y = host.topY - H(w.x, w.z) + 6; }
      return { w, g, ring, el, host, reached: false };
    });
    this.t = 0;
  }

  update(dt, px, pz) {
    this.t += dt;
    let nearest = null;
    for (const it of this.items) {
      const d = it.host ? this.world.closest(it.host, px, pz).d : Math.hypot(it.w.x - px, it.w.z - pz);
      it.ring.scale.setScalar(1 + 0.15 * Math.sin(this.t * 3));
      it.el.textContent = `◆ ${it.w.name}  ${fmt(d)}`;
      if (d < (it.host ? 2.5 : 6) && !it.reached) { it.reached = true; toast(`${it.w.name} に到着しました`); }
      if (it.first === undefined) { it.first = false; if (d < 15) it.reached = true; }
      if (d > 15) it.reached = false;
      if (!nearest || d < nearest.d) nearest = { it, d };
    }
    if (this.hudEl) this.hudEl.textContent = nearest ? `目的地 ${nearest.it.w.name}：${fmt(nearest.d)}` : '';
  }
}

function fmt(d) { return d >= 1000 ? (d / 1000).toFixed(2) + ' km' : Math.round(d) + ' m'; }

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
