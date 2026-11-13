// 街並みディテール (お試し) の入口。V キーでまとめてオン/オフ。
import { DETAIL } from './config.js';
import { buildProps } from './props.js';
import { applyTextures } from './textures.js';
import { buildShapes } from './shapes.js';
import { buildSites } from './site.js';

export async function loadDetail({ scene, city, world, built }) {
  const c = city.start || { x: 0, z: 0 };
  const ctx = { city, world, built, cx: c.x, cz: c.z, R: DETAIL.radius };
  const parts = [];
  const emissive = [];

  if (DETAIL.props) {
    const p = buildProps(ctx);
    scene.add(p.group);
    emissive.push(...p.emissive);
    parts.push({ set: (v) => { p.group.visible = v; } });
  }

  if (DETAIL.textures) {
    try {
      parts.push(await applyTextures(ctx));
    } catch (e) { console.warn('[detail] textures skipped:', e); }
  }

  if (DETAIL.shapes) {
    const s = buildShapes(ctx);
    scene.add(s.group);
    emissive.push(...s.emissive);
    parts.push({ set: (v) => { s.group.visible = v; } });
  }

  if (DETAIL.shapes) {
    const st = buildSites(ctx);
    scene.add(st.group);
    emissive.push(...(st.group.userData.emissive || []));
    parts.push({ set: (v) => { st.group.visible = v; } });
  }

  let on = true;
  return {
    emissive, // 夜に光らせるマテリアル (TimeOfDay に渡す)
    get on() { return on; },
    set on(v) { on = v; parts.forEach(p => p.set(v)); },
  };
}
