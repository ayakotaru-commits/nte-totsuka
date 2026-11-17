// 街並みディテール (お試し) の入口。V キーでまとめてオン/オフ。
// 小物・敷地の外構・ベランダ・看板の配置は data/props.json (tools/build_props.py が city.json から作る。main.js が読んで渡す)。
import { DETAIL } from './config.js';
import { buildProps } from './props.js';
import { buildStreet } from './street.js';
import { applyTextures } from './textures.js';
import { buildShapes } from './shapes.js';
import { buildSites } from './site.js';
import { buildStation } from './station.js';
import { buildWalkways } from './walkways.js';
import { buildYard } from './yard.js';

export async function loadDetail({ scene, city, world, built, props }) {
  const c = city.start || { x: 0, z: 0 };
  const ctx = { city, world, built, cx: c.x, cz: c.z, R: DETAIL.radius };
  const parts = [];
  const emissive = [];
  const updaters = []; // 毎フレーム呼ぶもの (信号の切り替え)
  if (!props) console.warn('[detail] data/props.json がありません。python tools/build_props.py で作ってください (小物・外構・ベランダ・看板なし)');

  if (DETAIL.props && props) {
    const p = buildProps(props);
    scene.add(p.group);
    emissive.push(...p.emissive);
    parts.push({ set: (v) => { p.group.visible = v; } });
    const st = buildStreet(props); // 信号機・バス停
    scene.add(st.group);
    parts.push({ set: (v) => { st.group.visible = v; } });
    updaters.push(st.update);
  }

  if (DETAIL.textures) {
    try {
      parts.push(await applyTextures(ctx));
    } catch (e) { console.warn('[detail] textures skipped:', e); }
  }

  if (DETAIL.shapes && props) {
    const s = buildShapes(props);
    scene.add(s.group);
    emissive.push(...s.emissive);
    parts.push({ set: (v) => { s.group.visible = v; } });
  }

  if (DETAIL.shapes && props) {
    const st = buildSites(props);
    scene.add(st.group);
    emissive.push(...(st.group.userData.emissive || []));
    parts.push({ set: (v) => { st.group.visible = v; } });
  }

  if (DETAIL.shapes && props) {
    const st = buildStation(props); // ホーム・屋根・架線柱・架線
    scene.add(st.group);
    parts.push({ set: (v) => { st.group.visible = v; } });
  }

  if (DETAIL.shapes && props) {
    const wk = buildWalkways(props); // 歩道橋・デッキ・階段の手すり
    scene.add(wk.group);
    parts.push({ set: (v) => { wk.group.visible = v; } });
  }

  if (DETAIL.shapes && props) {
    const yd = buildYard(props); // 塀・生け垣・物置・室外機 (点群から。tools/lidar_small.py)
    scene.add(yd.group);
    parts.push({ set: (v) => { yd.group.visible = v; } });
  }

  // 当たり判定 (V キーで見た目を消すと一緒に外す)
  if (props) world.addColliders(props.colliders);

  let on = true;
  return {
    emissive, // 夜に光らせるマテリアル (TimeOfDay に渡す)
    get on() { return on; },
    set on(v) { on = v; parts.forEach(p => p.set(v)); world.propsOn = v; },
    update(t) { if (on) updaters.forEach(f => f(t)); }, // t = 経過秒
  };
}
