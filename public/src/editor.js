// 修正モード (E キー): 建物をクリックして 削除 / 高さ変更、地面をクリックして新しい建物を描く。
// 「保存して反映」で tools/server.py に送り、data/corrections.json に追記 → city.json を再生成して再読み込み。
import * as THREE from 'three';
import { H } from './terrain.js';

const RESTORE_KEY = 'totsuka-restore';

export class Editor {
  constructor({ scene, camera, renderer, world, built, cam, player, streetView }) {
    Object.assign(this, { scene, camera, renderer, world, built, cam, player, streetView });
    this.open = false;
    this.sel = null;
    this.remove = new Map();      // id -> {id, at}
    this.heights = new Map();     // id -> {id, at, h}
    this.adds = [];               // {id, outer, h}
    this.drawing = null;          // [[x,z], ...]
    this.group = new THREE.Group();
    this.group.name = 'editor_overlay';
    scene.add(this.group);
    this.ray = new THREE.Raycaster();
    this.buildPanel();

    renderer.domElement.addEventListener('pointerdown', (e) => {
      if (!this.open || e.button !== 0) return;
      this.click(e);
    });
    renderer.domElement.addEventListener('contextmenu', (e) => { if (this.open) e.preventDefault(); });
    addEventListener('keydown', (e) => {
      if (!this.open || e.target.tagName === 'INPUT') return;
      if (e.code === 'Delete' || e.code === 'Backspace') {
        if (this.drawing) { this.drawing.pop(); this.refreshDraw(); } else this.doRemove();
      }
      if (e.code === 'Enter' && this.drawing) this.finishDraw();
      if (e.code === 'Escape') { if (this.drawing) this.cancelDraw(); else this.select(null); }
      if (e.code === 'BracketRight') this.bumpHeight(1);
      if (e.code === 'BracketLeft') this.bumpHeight(-1);
      if (e.code === 'KeyN') this.startDraw();
    });
  }

  // ---------- UI ----------
  buildPanel() {
    const p = document.createElement('div');
    p.id = 'editor';
    p.hidden = true;
    p.innerHTML = `
      <h3>修正モード</h3>
      <div class="ed-hint">左クリック: 建物を選ぶ / 右ドラッグ: 視点 / ホイール: ズーム / WASD: 移動</div>
      <div id="ed-sel" class="ed-box">建物をクリックして選んでください</div>
      <div id="ed-actions" class="ed-row" hidden>
        <button data-a="remove">削除 (Del)</button>
        <span>高さ</span>
        <button data-a="h-3">−3</button><button data-a="h-1">−1</button>
        <input id="ed-h" type="number" step="0.5" min="1" max="300">
        <button data-a="h+1">+1</button><button data-a="h+3">+3</button>
      </div>
      <div class="ed-row">
        <button data-a="draw">新しい建物を描く (N)</button>
        <button data-a="sv">ストリートビュー (P)</button>
      </div>
      <div id="ed-draw" class="ed-box" hidden>
        地面をクリックして角を順に置く（${'Backspace'} で1つ戻す）<br>
        高さ <input id="ed-newh" type="number" value="7" step="0.5" min="1" max="300"> m
        <button data-a="finish">完了 (Enter)</button><button data-a="cancel">やめる (Esc)</button>
      </div>
      <div id="ed-pending" class="ed-box"></div>
      <div class="ed-row">
        <button data-a="save" class="primary">保存して反映</button>
        <button data-a="discard">未保存の変更を破棄</button>
        <button data-a="undo">前回の保存を取り消す</button>
      </div>
      <div id="ed-msg" class="ed-msg"></div>
      <div class="ed-hint">E: 修正モードを閉じる</div>`;
    document.body.appendChild(p);
    this.panel = p;
    p.addEventListener('click', (e) => {
      const a = e.target.dataset && e.target.dataset.a;
      if (!a) return;
      if (a === 'remove') this.doRemove();
      if (a.startsWith('h')) this.bumpHeight(+a.slice(1));
      if (a === 'draw') this.startDraw();
      if (a === 'finish') this.finishDraw();
      if (a === 'cancel') this.cancelDraw();
      if (a === 'sv') this.streetView();
      if (a === 'save') this.save();
      if (a === 'discard') this.discard();
      if (a === 'undo') this.undo();
    });
    p.querySelector('#ed-h').addEventListener('change', (e) => this.setHeight(+e.target.value));
    this.updatePending();
  }

  toggle() { this.open ? this.close() : this.show(); }

  show() {
    this.open = true;
    this.panel.hidden = false;
    document.exitPointerLock();
    this.cam.maxDist = 250;
    this.cam.freeRotate = true;
  }

  close() {
    this.open = false;
    this.panel.hidden = true;
    this.cancelDraw();
    this.select(null);
    this.cam.maxDist = 30;
    this.cam.dist = Math.min(this.cam.dist, 30);
    this.cam.freeRotate = false;
    this.renderer.domElement.requestPointerLock();
  }

  msg(t, err) { const m = this.panel.querySelector('#ed-msg'); m.textContent = t; m.className = 'ed-msg' + (err ? ' err' : ''); }

  // ---------- 選択 ----------
  pick(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hits = this.ray.intersectObjects(this.built.group.children, false);
    const h = hits.find(x => x.object.visible && !(x.object.isInstancedMesh));
    if (!h) return null;
    const q = h.point.clone().addScaledVector(this.ray.ray.direction, 0.3); // 面の少し内側
    return { point: h.point, q };
  }

  click(e) {
    const hit = this.pick(e);
    if (!hit) return;
    if (this.drawing) {
      this.drawing.push([+hit.point.x.toFixed(2), +hit.point.z.toFixed(2)]);
      this.refreshDraw();
      return;
    }
    const { q } = hit;
    const cands = this.world.query(q.x, q.z, q.x, q.z).filter(b => this.world.contains(b, q.x, q.z));
    if (!cands.length) { this.select(null); return; }
    // 縦方向も含む建物を優先、なければ一番高いもの
    const b = cands.find(b => q.y >= b.minY - 0.5 && q.y <= b.topY + 0.5) || cands.sort((a, b) => b.topY - a.topY)[0];
    this.select({ rec: b, at: [+q.x.toFixed(2), +q.z.toFixed(2)] });
  }

  select(s) {
    this.sel = s;
    this.refreshOverlay();
    const box = this.panel.querySelector('#ed-sel');
    const act = this.panel.querySelector('#ed-actions');
    if (!s) { box.textContent = '建物をクリックして選んでください'; act.hidden = true; return; }
    const b = s.rec;
    const src = { gsi: '国土地理院', plateau: 'PLATEAU', user: '自分で追加' }[b.src] || 'OpenStreetMap';
    const area = Math.abs(ringArea(b.rings[0]));
    const removed = this.remove.has(b.id);
    box.innerHTML = `<b>${b.name || '（名前なし）'}</b><br>高さ ${b.h} m ・ 面積 ${area.toFixed(0)} ㎡ ・ 出典 ${src}${removed ? '<br><span class="err">削除予定</span>' : ''}`;
    act.hidden = false;
    this.panel.querySelector('#ed-h').value = (this.heights.get(b.id) || b).h;
  }

  // ---------- 編集操作 ----------
  doRemove() {
    if (!this.sel) return;
    const b = this.sel.rec;
    if (this.remove.has(b.id)) this.remove.delete(b.id);
    else { this.remove.set(b.id, { id: b.id, at: this.sel.at }); this.heights.delete(b.id); }
    this.select(this.sel);
    this.updatePending();
  }

  bumpHeight(d) {
    if (!this.sel) return;
    const cur = (this.heights.get(this.sel.rec.id) || this.sel.rec).h;
    this.setHeight(cur + d);
  }

  setHeight(h) {
    if (!this.sel || !(h > 0)) return;
    const b = this.sel.rec;
    h = Math.round(h * 2) / 2;
    if (Math.abs(h - b.h) < 0.01) this.heights.delete(b.id);
    else this.heights.set(b.id, { id: b.id, at: this.sel.at, h });
    this.remove.delete(b.id);
    this.select(this.sel);
    this.updatePending();
  }

  startDraw() {
    this.select(null);
    this.drawing = [];
    this.panel.querySelector('#ed-draw').hidden = false;
    this.refreshDraw();
  }

  finishDraw() {
    if (!this.drawing) return;
    if (this.drawing.length < 3) { this.msg('角を3つ以上置いてください', true); return; }
    const h = +this.panel.querySelector('#ed-newh').value || 7;
    this.adds.push({ id: 'u' + Date.now().toString(36), outer: this.drawing, h });
    this.cancelDraw();
    this.updatePending();
  }

  cancelDraw() {
    this.drawing = null;
    this.panel.querySelector('#ed-draw').hidden = true;
    this.refreshOverlay();
  }

  discard() {
    this.remove.clear(); this.heights.clear(); this.adds = [];
    this.select(this.sel ? this.sel : null);
    this.updatePending();
    this.msg('未保存の変更を破棄しました');
  }

  updatePending() {
    const n = this.remove.size + this.heights.size + this.adds.length;
    this.panel.querySelector('#ed-pending').textContent =
      n ? `未保存: 削除 ${this.remove.size} ・ 高さ変更 ${this.heights.size} ・ 追加 ${this.adds.length}` : '未保存の変更はありません';
    this.refreshOverlay();
  }

  // ---------- 表示 ----------
  refreshOverlay() {
    for (const c of [...this.group.children]) { this.group.remove(c); c.geometry.dispose(); }
    const add = (ring, y0, y1, color, opacity) => {
      const m = prism(ring, y0, y1, color, opacity);
      this.group.add(m);
    };
    for (const r of this.remove.values()) {
      const b = this.findRec(r.id); if (b) add(b.rings[0], b.base - 0.1, b.topY + 0.3, '#ff3b3b', 0.55);
    }
    for (const r of this.heights.values()) {
      const b = this.findRec(r.id); if (b) add(b.rings[0], b.base, b.base + r.h, '#ffd23b', 0.45);
    }
    for (const a of this.adds) { const y = Math.min(...a.outer.map(([x, z]) => H(x, z))); add(a.outer, y, y + a.h, '#3bff7a', 0.55); }
    if (this.sel) add(this.sel.rec.rings[0], this.sel.rec.base - 0.05, this.sel.rec.base + (this.heights.get(this.sel.rec.id) || this.sel.rec).h + 0.2, '#3bd5ff', 0.35);
    if (this.drawing && this.drawing.length) {
      const pts = this.drawing.map(([x, z]) => new THREE.Vector3(x, H(x, z) + 0.4, z));
      if (pts.length > 2) pts.push(pts[0]);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#3bff7a', depthTest: false }));
      line.renderOrder = 10;
      this.group.add(line);
      for (const p of this.drawing) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ color: '#3bff7a', depthTest: false }));
        s.position.set(p[0], H(p[0], p[1]) + 0.4, p[1]); s.renderOrder = 10;
        this.group.add(s);
      }
    }
  }
  refreshDraw() { this.refreshOverlay(); }

  findRec(id) {
    if (this.sel && this.sel.rec.id === id) return this.sel.rec;
    this._byId ||= new Map(this.world.list.map(b => [b.id, b]));
    return this._byId.get(id);
  }

  // ---------- 保存 ----------
  async post(path, body) {
    let res;
    try {
      res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    } catch { res = null; }
    if (!res || res.status === 501 || res.status === 404) {
      this.msg('保存できません。start.bat（tools/server.py）でゲームを起動してください', true);
      return null;
    }
    const j = await res.json();
    if (!j.ok) { this.msg((j.message || '再生成に失敗しました') + (j.log ? '\n' + j.log : ''), true); return null; }
    return j;
  }

  async save() {
    const n = this.remove.size + this.heights.size + this.adds.length;
    if (!n) { this.msg('保存する変更がありません'); return; }
    this.msg('保存して街を作り直しています…');
    const ok = await this.post('api/corrections', {
      remove: [...this.remove.values()],
      set_height: [...this.heights.values()],
      add: this.adds,
    });
    if (ok) this.reload();
  }

  async undo() {
    this.msg('前回の保存を取り消しています…');
    const ok = await this.post('api/corrections/undo');
    if (ok) this.reload();
  }

  reload() {
    const p = this.player.pos, c = this.cam;
    try { sessionStorage.setItem(RESTORE_KEY, JSON.stringify({ x: p.x, z: p.z, yaw: c.yaw, pitch: c.pitch, dist: c.dist, editor: true })); } catch { /* ignore */ }
    location.reload();
  }

  static takeRestore() {
    try {
      const s = sessionStorage.getItem(RESTORE_KEY);
      sessionStorage.removeItem(RESTORE_KEY);
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  }
}

function ringArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
}

function prism(ring, y0, y1, color, opacity) {
  const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.1, y1 - y0), bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  m.renderOrder = 5;
  return m;
}
