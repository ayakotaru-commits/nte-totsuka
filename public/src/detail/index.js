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
import { buildTrains } from './trains.js';
import { buildRailExt } from './railext.js';
import { createParkCut, buildPark } from './park.js';
import { LOW_MEM } from '../lowmem.js';
import { buildTrackbed } from './trackbed.js';

export async function loadDetail({ scene, city, world, built, props, ext = null, park = null }) {
  const c = city.start || { x: 0, z: 0 };
  const ctx = { city, world, built, cx: c.x, cz: c.z, R: DETAIL.radius };
  const parts = [];
  const emissive = [];
  const updaters = []; // 毎フレーム呼ぶもの (信号の切り替え)
  let trains = null;
  let parkApi = null; // フェアリー・リールパーク (detail/park.js。設定 data/park.json があるときだけ。main.js が毎コマ update(カメラの位置) を呼ぶ)
  let railExt = null; // 線路の延長 (区間ごとに読み込む。main.js が毎コマ update(カメラの位置) を呼ぶ)
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

  if (DETAIL.shapes && props) {
    const tb = buildTrackbed(city); // 線路のバラスト・枕木・レール
    scene.add(tb.group);
    parts.push({ set: (v) => { tb.group.visible = v; } });
    if (ext) { // 線路の延長 (地図の北の端 → 横浜駅。data/rail_ext/)。V キーに関係なく出す (ホームの当たり判定があるので)
      railExt = buildRailExt(ext, world, city.bounds, { low: LOW_MEM, park: park ? createParkCut(park, ext) : null });
      scene.add(railExt.group);
      if (park) { parkApi = buildPark(park, world); scene.add(parkApi.group); emissive.push(...parkApi.emissive); }
    }
    const tr = buildTrains(props, ext); // 走る電車 (道筋は props.json の rail.routes + rail_ext.json の延長)
    trains = tr.api;               // 乗り降り (ride.js) が時刻と位置を使う
    scene.add(tr.group);
    emissive.push(...tr.emissive);
    updaters.push(tr.update);
    parts.push({ set: (v) => { tr.group.visible = v; } });
  }

  // 当たり判定 (V キーで見た目を消すと一緒に外す)
  if (props) world.addColliders(props.colliders);
  // ホームの床: 見た目 (上面) の高さに立てるようにする。床がないと足元が地面の高さのままで、ホームに腰まで埋まる
  if (props && props.rail) {
    const poly = [];
    const lift = props.rail.dims.platH;
    for (const pf of props.rail.platforms) {
      for (let k = 0; k + 1 < pf.y.length; k++) {
        const y = (pf.y[k] + pf.y[k + 1]) / 2;
        poly.push([[pf.left[k], pf.left[k + 1], pf.right[k + 1], pf.right[k]], y - lift, y]);
      }
    }
    world.addColliders({ poly });
  }

  let on = true;
  return {
    park: parkApi, // フェアリー・リールパーク (detail/park.js。update(x, z)。無いときは null)
    railExt, // 線路の延長 (detail/railext.js。update(x, z)・map・stats。無いときは null)
    trains,  // 電車の時刻・位置の計算 (detail/trains.js の api。電車が無いときは null)
    emissive, // 夜に光らせるマテリアル (TimeOfDay に渡す)
    get on() { return on; },
    set on(v) { on = v; parts.forEach(p => p.set(v)); world.propsOn = v; },
    update(t) { if (on) updaters.forEach(f => f(t)); }, // t = 経過秒
  };
}
