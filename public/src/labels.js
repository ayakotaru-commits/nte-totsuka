import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { H } from './terrain.js';

const POOL = 24, RANGE = 160;

// 駅は遠くから、建物・公園は中距離、店や施設は近づいたときだけ表示
function rangeOf(p) {
  if (p.cat === 'railway:station') return 500;
  if (p.cat === 'building' || p.cat.startsWith('area:')) return RANGE;
  return 45;
}

function displayName(p) {
  if (p.cat === 'railway:station') return p.name.endsWith('駅') ? p.name : p.name + '駅';
  return p.name;
}

export class Labels {
  constructor(pois, scene) {
    // 同名・近接の重複を除去
    const seen = new Map();
    this.pois = [];
    const skipCat = /^highway:(traffic_signals|crossing|stop)$/;
    for (const p of pois) {
      if (skipCat.test(p.cat)) continue;
      const name = displayName(p);
      const prev = seen.get(name);
      if (prev && Math.hypot(prev.x - p.x, prev.z - p.z) < (p.cat === 'railway:station' ? 250 : 80)) continue;
      const q = { ...p, label: name, y: H(p.x, p.z) + (p.cat === 'railway:station' ? 16 : (p.h || 6) + 2.5) };
      seen.set(name, q);
      this.pois.push(q);
    }
    this.objs = [];
    for (let i = 0; i < POOL; i++) {
      const el = document.createElement('div');
      el.className = 'label';
      const o = new CSS2DObject(el);
      o.visible = false;
      scene.add(o);
      this.objs.push(o);
    }
    this.timer = 0;
  }

  nearest(x, z, max = 90) {
    let best = null, bd = max;
    for (const p of this.pois) {
      const d = Math.hypot(p.x - x, p.z - z) - (p.cat === 'railway:station' ? 40 : 0);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  update(dt, x, z) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.25;
    const near = this.pois
      .map(p => [p, Math.hypot(p.x - x, p.z - z)])
      .filter(([p, d]) => d < rangeOf(p))
      .sort((a, b) => a[1] - b[1])
      .slice(0, POOL);
    this.objs.forEach((o, i) => {
      const n = near[i];
      if (!n) { o.visible = false; return; }
      const [p] = n;
      o.visible = true;
      o.position.set(p.x, p.y, p.z);
      if (o.element.textContent !== p.label) {
        o.element.textContent = p.label;
        o.element.className = 'label' + (p.cat === 'railway:station' ? ' station' : '');
      }
    });
  }
}
