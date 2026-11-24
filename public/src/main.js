import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { buildCity } from './city.js';
import { World } from './world.js';
import { Player } from './player.js';
import { ThirdPersonCamera } from './camera.js';
import { Input } from './input.js';
import { Minimap } from './minimap.js';
import { Labels } from './labels.js';
import { TimeOfDay, PRESETS } from './time.js';
import { Crowd } from './crowd.js';
import { Traffic } from './traffic.js';
import { Waypoints } from './waypoint.js';
import { BigMap } from './bigmap.js';
import { loadDetail } from './detail/index.js'; // detail (お試し)
import { DoorControl } from './doors.js';
import { Ride } from './ride.js';
import { getBridges } from './bridges.js';
import { Editor } from './editor.js';
import { openStreetView } from './streetview.js';
import { setTerrain, setCover, setLowMemory } from './terrain.js';
import { TOUCH, setupTouch } from './touch.js';
import { loadWardrobe } from './wardrobe.js';
import { Menu } from './menu.js';
import { loadShops, ShopTrigger } from './shop.js';
import { releaseGeometryAfterUpload } from './lowmem.js';
import { startMultiplayer } from './net/index.js';
import { Look } from './look.js';
import { useMocap } from './attack.js';
import { loadMotion } from './motion.js';
import { preloadVRM } from './character.js';
import { Swarm, SITE as SWARM_SITE } from './swarm/event.js';
import { Rhythm, SITE as RHYTHM_SITE } from './rhythm/event.js';
import { Arcade, SITE as ARCADE_SITE } from './arcade/event.js';
import { buildShrines } from './shrine.js';

// 攻撃の 1 撃目を動きのデータ (Quaternius の Sword_Attack) で。URL に ?handmade で手作りに戻す (歩き・走りも。character.js)
if (!new URLSearchParams(location.search).has('handmade')) { useMocap(); loadMotion('ual_sword_attack'); loadMotion('ual_sword_attack_rm'); }

const $ = (id) => document.getElementById(id);
const status = (t) => { $('status').textContent = t; };

async function main() {
  preloadVRM(); // キャラのモデル (8MB) を、地図データ・街の生成と並行して読み始める
  setLowMemory(TOUCH); // スマホ・タブレットはメモリが少ないので、頂点データを小さい型で持つ
  status('地図データを読み込み中…');
  // 地図データは 4〜5 個を同時に取り始める (以前は 1 つずつ順に取っていたので、通信の往復待ちが重なっていた)。
  // 使う順番 (地形 → 地面の種類) は以前と同じ。city.json 以外は、無い・読めないときは使わない
  const QS = new URLSearchParams(location.search);
  const getJSON = (url, on = true) => on ? fetch(url).then((r) => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null);
  const cityP = fetch('data/city.json').then((r) => r.json());
  const terrainP = getJSON('data/terrain.json');                      // 地形 (無ければ平らな地面)
  const coverP = getJSON('data/cover.json', !QS.has('nocover'));      // 地面の種類 (tools/lidar_cover.py。見比べ用に ?nocover で使わない)
  const wallsP = getJSON('data/walls.json', QS.has('walls'));         // 擁壁 (tools/lidar_walls.py --osm。見た目が不十分なので ?walls のときだけ)
  const propsP = getJSON('data/props.json');                          // 木・小物・建物の飾りの配置と当たり判定 (tools/build_props.py)
  const extP = getJSON('data/rail_ext.json', !QS.has('noext'));      // 線路の延長 (東戸塚駅まで。tools/rail_ext.py。?noext で使わない)
  const [city, terrain, cover, walls, props, ext] = await Promise.all([cityP, terrainP, coverP, wallsP, propsP, extP]);
  if (terrain) setTerrain(terrain);
  if (cover) setCover(cover);
  if (walls) city.walls = walls.walls;

  $('credit').textContent = '地図データ ' + city.attribution;

  // ---- renderer / scene ----
  // 重さの切り分け用 (URL): ?pr=1 解像度の倍率, ?log 対数深度バッファを使う (標準は使わない。重いので), ?noaa アンチエイリアス無し, ?noshadow 影なし
  const Q = new URLSearchParams(location.search);
  const renderer = new THREE.WebGLRenderer({ antialias: !Q.has('noaa'), logarithmicDepthBuffer: Q.has('log') });
  // スマホ・タブレット (タッチ操作) は軽くする: 解像度の倍率の上限 1.5、影の解像度は半分
  renderer.setPixelRatio(Q.has('pr') ? +Q.get('pr') : Math.min(devicePixelRatio, TOUCH ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = !Q.has('noshadow');
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  $('app').appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(innerWidth, innerHeight);
  Object.assign(labelRenderer.domElement.style, { position: 'fixed', inset: '0', pointerEvents: 'none' });
  labelRenderer.domElement.id = 'labels';
  document.body.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#c9d6e3', 250, 1300);
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, +(Q.get('near') || 0.3), 3000);

  const sky = new Sky();
  sky.scale.setScalar(10000);
  sky.material.uniforms.turbidity.value = 6;
  sky.material.uniforms.mieCoefficient.value = 0.005;
  sky.material.uniforms.mieDirectionalG.value = 0.8;
  scene.add(sky);

  const hemi = new THREE.HemisphereLight('#e3edff', '#a39a88', 1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffffff', 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(TOUCH ? 1024 : 2048, TOUCH ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 400 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  // 光と空気感 (空の映り込み・かすみ・物の陰・にじみ・色の仕上げ。look.js。?plain で以前の見え方)
  const look = new Look({ renderer, scene, camera, sky, hemi, touch: TOUCH });

  // ---- world ----
  status('街を生成中…');
  await new Promise(r => setTimeout(r, 0));
  // 外観を別に描く建物・道 (hide。神社の社殿と参道 = tools/shrine.py → shrine.js) は、街の形・当たり判定・階段から外す (ミニマップには残す)
  const shown = city.buildings.some((b) => b.hide) || city.roads.some((r) => r.hide) ? { ...city, buildings: city.buildings.filter((b) => !b.hide), roads: city.roads.filter((r) => !r.hide) } : city;
  // ホームの上の屋根データ (車庫・駐輪場と同じ「屋根だけ」の建物) は、ホームの屋根を detail/station.js が作るときは描かない (city.js)。
  // 当たり判定からも外す (残すと、見えない高さ 2 m ほどの板がホームの上のキャラを押し出す)
  const platRings = props && props.rail ? (city.areas || []).filter((a) => a.kind === 'platform').map((a) => a.outer) : [];
  const overPlatform = (b) => {
    if (b.style !== 'carport' || !platRings.length) return false;
    const cx = b.outer.reduce((t, q) => t + q[0], 0) / b.outer.length, cz = b.outer.reduce((t, q) => t + q[1], 0) / b.outer.length;
    return platRings.some((r) => { let ins = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { if ((r[i][1] > cz) !== (r[j][1] > cz) && cx < (r[j][0] - r[i][0]) * (cz - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) ins = !ins; } return ins; });
  };
  const world = new World(platRings.length ? shown.buildings.filter((b) => !overPlatform(b)) : shown.buildings, city.bounds);
  const t0 = performance.now();
  const built = buildCity(shown, world, props);
  scene.add(built.group);
  if (new URLSearchParams(location.search).has('perf')) { // 計測用: 街の生成時間と三角形の数
    let tris = 0; const per = {};
    built.group.traverse((o) => { if (o.geometry) { const n = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; tris += n; per[o.name || o.type] = (per[o.name || o.type] || 0) + n; } });
    console.info('[perf] buildCity ms=' + Math.round(performance.now() - t0) + ' tris=' + Math.round(tris) + ' ' + JSON.stringify(per));
  }
  if (props) world.addColliders({ circle: props.colliders.tree }, true); // 木の幹 (V キーに関係なく常に有効)
  const shrineG = props ? buildShrines(props.shrines, scene, world) : null; // 神社の社殿 (shrine.js。V キーに関係なく描く)
  const detail = await loadDetail({ scene, city: shown, world, built, props, ext }); built.windowMats.push(...detail.emissive); // detail (お試し)
  if (shrineG) built.windowMats.push(...(shrineG.userData.emissive || [])); // 灯籠・提灯の明かり (夜に光る。time.js)
  const doors = new DoorControl(world); // 開け閉めできる扉 (時計の棟。形は detail が作って登録する)

  releaseGeometryAfterUpload(scene); // スマホ・タブレットだけ: 頂点データの JS 側の控えを、GPU に送った後に手放す

  const input = new Input();
  const player = new Player(world, scene);
  const wardrobe = await loadWardrobe();                       // お金・買った服・着ている服 (端末に保存)
  player.model.setOutfits(wardrobe.urls());                     // 着ていた服を着る (キャラの読み込み後)
  let menu = null;                                              // メニュー (下で作る)
  let shops = null;                                             // 洋服屋の入口 (下で作る)
  const cam = new ThirdPersonCamera(camera, world, renderer.domElement);
  const minimap = new Minimap(city, $('minimap'));
  if (ext) minimap.setExt(ext, TOUCH);   // 線路の延長 (東戸塚など) も地図に描く
  const labels = new Labels(city.pois, scene);
  // マップで選んだ場所へワープ (建物の中なら一番近い屋外)。向きはそのまま
  let ride = null;                                              // 電車の乗り降り (下で作る)
  const warpTo = (x, z) => {
    ride?.cancel();
    // 電車の乗り場 (改札) の印を選んだとき: 下の地面ではなく、デッキの上の改札の前に立つ
    const gate = ride && !ride.disabled ? ride.gates.find((g) => Math.hypot(g.top.x - x, g.top.z - z) < 3) : null;
    if (gate) { ride.place(gate.top.x, gate.top.y, gate.top.z, -Math.PI / 2); toggleMap(); return; }
    const p = findFree(world, x, z);
    player.teleport(p.x, p.z);
    cam.update(0, player.pos, true);
    toggleMap();
  };
  const bigmap = new BigMap({ minimap, city, pois: labels.pois, canvas: $('bigmap'), onWarp: (x, z) => warpTo(x, z), touch: TOUCH });
  const waypoints = new Waypoints(city.waypoints, scene, $('hud-goal'), world);
  const tod = new TimeOfDay({ renderer, scene, sky, sun, hemi, windowMats: built.windowMats });
  // 街を歩く人 (crowd.js。動きは crowdsim.js、通り道は props.json の crowd)。?nocrowd で無し、?crowd=人数 で上限を変える (確認用)
  const crowd = new Crowd(scene, props, { low: TOUCH, cap: Q.has('crowd') ? +Q.get('crowd') : undefined });
  if (Q.has('nocrowd')) crowd.setVisible(false);
  window.__crowd = crowd; // 確認用
  // 街を走る車 (traffic.js。動きは trafficsim.js、道は props.json の traffic)。?notraffic で無し、?traffic=台数 で上限を変える (確認用)
  const traffic = new Traffic(scene, props, { low: TOUCH, cap: Q.has('traffic') ? +Q.get('traffic') : undefined });
  if (Q.has('notraffic')) traffic.setVisible(false);
  window.__traffic = traffic; // 確認用
  // 電車に乗る (ride.js。改札・ホーム・乗り降り)。?noride で無効
  ride = new Ride({ trains: Q.has('noride') ? null : detail.trains, props, world, player, cam, camera, bridges: getBridges(), scene, ext });
  const streetView = () => openStreetView(city, player.pos.x, player.pos.z, cam.yaw);
  const editor = new Editor({ scene, camera, renderer, world, built, cam, player, streetView });

  // スポーン: city.start (建物の中なら一番近い屋外)。建物から離れる向きで立つ
  const st = city.start || { x: -45, z: 20 };
  const spawn = findFree(world, st.x, st.z);
  // city.start.face があればその地点を向く。なければ建物から離れる向き
  const spawnFacing = st.face ? Math.atan2(st.face[0] - spawn.x, st.face[1] - spawn.z)
    : Math.hypot(spawn.x - st.x, spawn.z - st.z) > 0.5 ? Math.atan2(spawn.x - st.x, spawn.z - st.z) : Math.PI / 2;
  const respawn = () => { ride?.cancel(); player.teleport(spawn.x, spawn.z); player.facing = spawnFacing; cam.yaw = spawnFacing + Math.PI; cam.update(0, player.pos, true); };
  respawn();
  // 修正ツールで保存した後の再読み込み: 位置と視点、修正モードを復元
  const restore = Editor.takeRestore();
  if (restore) {
    player.teleport(restore.x, restore.z);
    Object.assign(cam, { yaw: restore.yaw, pitch: restore.pitch, dist: restore.dist });
  }

  // イベント「うな○ー大量発生クエスト」(グランシティの中庭に入ると、受けるか聞く。swarm/event.js)。?noswarm で無効、?swarm で開いてすぐ始める (確認用)
  const swarm = new Swarm({ scene, world, player, camera, onRespawn: (x, z, face) => {
    const p = findFree(world, x, z); player.teleport(p.x, p.z); player.facing = face; cam.yaw = face + Math.PI; cam.update(0, player.pos, true);
  } });
  if (Q.has('noswarm') || (Q.has('shot') && !Q.has('swarm'))) swarm.disabled = true;
  if (Q.has('swarm')) { swarm.auto = true; const p = findFree(world, -246, 1449); player.teleport(p.x, p.z); player.facing = Math.PI / 2; cam.yaw = player.facing + Math.PI; cam.update(0, player.pos, true); }

  // イベント「リズム地獄(八坂神社)」(八坂神社の境内に入ると、参加するか聞く。rhythm/event.js)。?norhythm で無効、?rhythm で開いてすぐ始める、?rhythm=auto で自動で打つ (確認用)
  const rhythm = new Rhythm({ scene, world, player, camera, cam });
  if (Q.has('norhythm') || (Q.has('shot') && !Q.has('rhythm'))) rhythm.disabled = true;
  if (Q.has('rhythm')) { rhythm.auto = true; rhythm.autoPlay = Q.get('rhythm') === 'auto'; player.teleport(RHYTHM_SITE.me[0], RHYTHM_SITE.me[1]); }
  window.__rhythm = rhythm; window.__rhythmSite = RHYTHM_SITE; // 確認用 (tools/dev/rhythmcheck.js)

  // イベント「ゲームセンター リズムステージ」(戸塚駅西口の路地の、赤いゲームセンターの入口。arcade/event.js)。
  // ?noarcade で無効、?arcade で開いてすぐ曲えらびへ、?arcade=auto で自動で打つ (&diff=HARD &bot=0.15 = 15% は打たない)、?arcade=ask で入口に立つだけ (確認用)
  const arcade = new Arcade({ player, onClose: () => { if (!TOUCH) lock(); } });
  if (Q.has('noarcade') || (Q.has('shot') && !Q.has('arcade'))) arcade.disabled = true;
  if (Q.has('arcade')) {
    arcade.autoOpen = Q.get('arcade') !== 'ask'; arcade.autoPlay = Q.get('arcade') === 'auto'; arcade.botSkip = +(Q.get('bot') || 0); // =ask: 入口に立つだけ (聞く表示の確認)
    if (Q.get('diff') === 'HARD' || Q.get('diff') === 'NORMAL') arcade.cfg.diff = Q.get('diff');
    player.teleport(ARCADE_SITE.center[0], ARCADE_SITE.center[1]); player.facing = -Math.PI / 2;
  }
  window.__arcade = arcade; // 確認用 (tools/dev/arcadecheck.js)
  const NOIN = { ax: 0, az: 0, pressed: () => false, held: () => false, press() {}, setHeld() {}, endFrame() {} }; // ゲーム画面の間、キャラに渡す (S D F J K L で歩かない)

  // イベントの場所の印 (ミニマップ・大きい地図。eventmarks.js)。大きい地図で印をクリック・タップすると、そこをワープ先に選ぶ
  const EVENTS = [
    { name: 'うな○ー大量発生クエスト', x: SWARM_SITE.center[0], z: SWARM_SITE.center[1], color: '#2f9e64', active: () => swarm.running, off: swarm.disabled },
    { name: 'リズム地獄(八坂神社)', x: RHYTHM_SITE.me[0], z: RHYTHM_SITE.me[1], color: '#d23c34', active: () => rhythm.playing, off: rhythm.disabled },
    { name: 'プロジェクトセマイ ワンルームステージ！', x: ARCADE_SITE.center[0], z: ARCADE_SITE.center[1], color: '#ff6fae', active: () => arcade.active, off: arcade.disabled },
    // 電車の乗り場 (戸塚駅の改札 = 東口のデッキが駅舎に入る所。ride.js)。印を選んでワープすると改札の前に立つ (warpTo)
    ...(!ride.disabled && ride.gates.length ? [{ name: '電車の乗り場（戸塚駅 改札）', x: ride.gates[0].top.x, z: ride.gates[0].top.z, color: '#1f5fae', glyph: '電', active: () => !!ride.riding }] : []),
  ].filter((e) => !e.off);
  minimap.events = bigmap.events = EVENTS;

  // マルチプレイ (サーバーが設定されているときだけ。net/config.js)
  const mp = startMultiplayer({ scene, player, respawn, bigmapOpen: () => bigmap.open });

  // ---- UI ----
  const overlay = $('overlay');
  // キャラのモデルが届くまで待つ (開始直後に組み立て式のキャラから差し替わるのを防ぐ。無いとき・読めないときもここで解決する)
  // 待つ間に、見た目の計算プログラム (シェーダ) を作っておく。以前は最初の 1 コマでまとめて作っていたので、
  // 「準備完了」の直後に数秒止まり、歩いて新しい物が画面に入るたびにも引っかかっていた。
  // 画面外・遠くの物も含めて、表示中の物を全部作る (?nocompile で以前どおり)
  status('キャラを読み込み中…');
  const precompile = () => {
    if (Q.has('nocompile')) return Promise.resolve();
    // 光と空気感 (look.js) が有効なときは、街を描画先 (sceneRT) に描くので、その条件で作る (色の仕上げの有無でプログラムが別になる)
    renderer.setRenderTarget(look.post ? look.sceneRT : null);
    const p = renderer.compileAsync(scene, camera).catch((e) => console.warn('シェーダの先読みに失敗:', e));
    renderer.setRenderTarget(null);
    return p;
  };
  const compiling = precompile();
  await player.model.ready;
  status('見た目を準備中…');
  await compiling;
  await precompile(); // キャラのモデルの分 (作り済みのものは飛ばされる)
  look.render(); // 最初の 1 コマを読み込み画面の裏で描いておく (影・物の陰・にじみの処理もここで作られる)
  status('準備完了');
  // スクリーンショット確認用: ?shot&yaw=1.5&pitch=0.8&dist=60&t=2
  const qs = new URLSearchParams(location.search);
  if (qs.has('shot')) {
    overlay.hidden = true;
    if (qs.has('x')) player.teleport(+qs.get('x'), +qs.get('z'));
    if (qs.has('yaw')) cam.yaw = +qs.get('yaw');
    if (qs.has('pitch')) cam.pitch = +qs.get('pitch');
    if (qs.has('dist')) cam.dist = +qs.get('dist');
    for (let i = 0; i < +(qs.get('t') || 0); i++) $('hud-time').textContent = tod.next();
    tod.snap();
    if (qs.has('face')) player.facing = +qs.get('face');
    if (qs.has('pose')) player.poseSpeed = +qs.get('pose'); // その場で歩き (2.2)・走り (5.5) の姿勢にする
    if (qs.has('nodetail')) detail.on = false; // detail (お試し)
    if (qs.has('edit')) { editor.show(); cam.dist = +(qs.get('dist') || cam.dist); }
    if (qs.has('map')) { bigmap.show(player.pos.x, player.pos.z); if (qs.has('zoom')) bigmap.scale = +qs.get('zoom'); }
    cam.update(0, player.pos, true);
  }
  if (restore) { overlay.hidden = true; editor.show(); cam.dist = restore.dist; cam.update(0, player.pos, true); }
  // 操作の開始・中断。PC はマウスを固定する。タッチ操作は固定が要らない (使えない端末もある) ので、開始の表示を消すだけ
  const lock = () => { // Esc キーは「操作」と数えられず、固定が断られることがある (メニューを Esc で閉じたとき)。その場合は「クリックで再開」を出す
    if (TOUCH) overlay.hidden = true;
    else { const p = renderer.domElement.requestPointerLock?.(); p?.catch?.(() => { overlay.hidden = false; }); }
  };
  const unlock = () => document.exitPointerLock?.();
  overlay.addEventListener('click', lock);
  renderer.domElement.addEventListener('click', () => { if (!TOUCH && !cam.locked && !editor.open) lock(); });
  document.addEventListener('pointerlockchange', () => { overlay.hidden = document.pointerLockElement === renderer.domElement || bigmap.open || editor.open || !!menu?.open; });
  const toggleMap = () => {
    if (bigmap.open) {
      bigmap.hide(); $('map-help').hidden = true; $('map-touch').hidden = true;
      lock();
    } else {
      bigmap.show(player.pos.x, player.pos.z); $('map-help').hidden = TOUCH; $('map-touch').hidden = !TOUCH;
      overlay.hidden = true;
      unlock();
    }
  };
  if (TOUCH) setupTouch({ dom: renderer.domElement, input, cam, streetView, warp: () => bigmap.warp() });
  menu = new Menu({
    wardrobe, player, cam, dom: renderer.domElement, lock, unlock,
    actions: { map: () => { rhythm.stop(); toggleMap(); }, time: () => { $('hud-time').textContent = tod.next(); }, help: () => { $('help').hidden = !$('help').hidden; } },
  });
  $('menu-btn').addEventListener('click', () => { if (!bigmap.open && !arcade.active) menu.toggle(); });
  shops = new ShopTrigger({ places: await loadShops(), player, menu }); // 洋服屋の入口 (とどまると「入りますか？」)
  addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (e.code === 'Escape' && bigmap.open) toggleMap();
    if (e.code === 'Enter' && bigmap.open) bigmap.warp();
    if (e.code === 'KeyP') streetView(); // ポップアップ許可のためキー操作の中で開く
    if (e.code === 'KeyE' && !bigmap.open) { overlay.hidden = true; editor.toggle(); }
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    labelRenderer.setSize(innerWidth, innerHeight);
    look.setSize();
    if (bigmap.open) bigmap.resize();
  });

  let placeTimer = 0;
  const clock = new THREE.Clock();
  const perfOn = new URLSearchParams(location.search).has('perf'); // 計測用: タブの題名にフレームレートを出す
  let fpsN = 0, fpsT = performance.now();
  if (perfOn) $('fps').hidden = false; // スマホではタブの題名が見えないので、画面にも出す
  renderer.setAnimationLoop(() => {
    if (perfOn && ++fpsN >= 60) { const t = performance.now(); document.title = $('fps').textContent = Math.round(fpsN * 1000 / (t - fpsT)) + ' fps / ' + renderer.info.render.triangles + ' tris'; fpsN = 0; fpsT = t; }
    // 1 コマの経過時間。描画が遅い端末 (30 fps 未満) でも、キャラの速さが実時間で変わらないようにする。
    // 以前は 1/30 秒で頭打ちにしていたので、重い場所ほどスローモーションになり、走りもダッシュも遅くなっていた。
    // 長く止まった後 (タブの切り替えなど) に飛ばないよう、上限は 0.25 秒
    const dt = Math.min(clock.getDelta(), 0.25);

    if (input.pressed('Tab') && (menu.open || (!bigmap.open && !arcade.active))) menu.toggle(); // メニュー (着替えなど)
    const keys = menu.open ? NOIN : input; // メニューを開いている間は、ほかのキー (T・R・M など) を効かせない
    if (keys.pressed('KeyV')) detail.on = !detail.on; // detail (お試し)
    if (keys.pressed('KeyT')) $('hud-time').textContent = tod.next();
    if (keys.pressed('KeyR')) respawn();
    if (keys.pressed('KeyH')) $('help').hidden = !$('help').hidden;
    if (keys.pressed('KeyG')) exportGLB(built.group);

    if (keys.pressed('KeyM') && !arcade.active) { rhythm.stop(); toggleMap(); }
    if (bigmap.open && input.pressed('KeyF')) bigmap.centerOnPlayer();

    // マップ表示中はキャラを止める
    if (!bigmap.open) {
      // キャラの動きは 1/30 秒以下に刻んで進める (すり抜け防止)。ジャンプなどの「押した瞬間」は最初の 1 刻みだけに効かせる
      const n = Math.ceil(dt / (1 / 30) - 1e-6) || 1;
      const inp = (arcade.active || menu.open) ? NOIN : input; // ゲームセンターのゲーム画面の間は、キャラ・扉・ほかのイベントに入力を渡さない
      doors.update(dt, player, inp);     // 扉の開け閉め (F)。押した瞬間を player より先に見る
      swarm.update(dt, inp);             // イベント (受けるか聞く表示の Y / N も、押した瞬間を player より先に見る)
      rhythm.update(dt, inp);            // イベント「お札まき」(同上。曲の間のカメラもここで決めるので、cam.update の後でもう一度)
      arcade.update(dt, input);          // イベント「ゲームセンター リズムステージ」(同上)
      ride.update(dt, inp);              // 電車の乗り降り (F。乗っている間はキャラを動かさない)
      if (ride.riding) ride.view(dt);
      else {
        for (let i = 0; i < n; i++) { player.update(dt / n, inp, cam); if (n > 1) input.endFrame(); }
        cam.update(dt, player.pos, false, player);
      }
      if (!menu.open && !arcade.active && !rhythm.playing) shops.update(dt); // 洋服屋の入口
      if (rhythm.playing) rhythm.view();
    }
    if (mp) mp.update(dt, arcade.active ? NOIN : input);
    tod.update(dt);
    if (!Q.has('nocrowd') && !arcade.active) crowd.update(dt, camera, player.pos.x, player.pos.z, PRESETS[tod.idx].name, clock.elapsedTime);
    if (!Q.has('notraffic') && !arcade.active) traffic.update(dt, camera, player.pos.x, player.pos.z, PRESETS[tod.idx].name, clock.elapsedTime, tod.cur.win);
    look.update(dt, tod.cur);
    detail.update(clock.elapsedTime); // detail (お試し)

    // 影は常にプレイヤー周辺
    sun.target.position.copy(player.pos);
    sun.position.copy(player.pos).addScaledVector(tod.lightDir, 200);

    labels.update(dt, player.pos.x, player.pos.z);
    waypoints.update(dt, player.pos.x, player.pos.z);
    minimap.update(player.pos.x, player.pos.z, cam.yaw, player.facing, mp ? mp.dots() : null);
    bigmap.draw(player.pos.x, player.pos.z, player.facing);
    if ((placeTimer -= dt) <= 0) {
      placeTimer = 0.5;
      const B = city.bounds, px = player.pos.x, pz = player.pos.z;
      if (px < B.minX || px > B.maxX || pz < B.minZ || pz > B.maxZ) { // 地図の外 (線路の延長。rail_ext.json)
        const st = ((ext && ext.stations) || []).find((q) => Math.hypot(px - q.center[0], pz - q.center[1]) < 400);
        $('place').textContent = st ? st.name + '駅 付近' : '線路沿い';
        $('area').textContent = st && st.ward ? '横浜市' + st.ward : '横浜市';   // 区は駅ごと (rail_ext_config.json の ward)
      } else {
        $('area').textContent = '横浜市戸塚区';
        const p = labels.nearest(px, pz);
        $('place').textContent = p ? p.label + ' 付近' : '戸塚';
      }
    }

    if (!arcade.active) { look.render(); labelRenderer.render(scene, camera); } // ゲーム画面の間は街を描かない (画面が全部おおわれるので、軽くなる)
    input.endFrame();
  });
}

function findFree(world, x0, z0) {
  for (let r = 0; r < 200; r += 2) {
    for (let a = 0; a < 16; a++) {
      const x = x0 + Math.cos(a / 16 * Math.PI * 2) * r, z = z0 + Math.sin(a / 16 * Math.PI * 2) * r;
      let ok = !world.insideAny(x, z);
      for (let k = 0; ok && k < 8; k++) ok = !world.insideAny(x + Math.cos(k) * 1.5, z + Math.sin(k) * 1.5);
      if (ok) return { x, z };
    }
  }
  return { x: x0, z: z0 };
}

function exportGLB(group) {
  new GLTFExporter().parse(group, (glb) => {
    const url = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'totsuka_city.glb' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, (err) => console.error(err), { binary: true });
}

main().catch((e) => { console.error(e); status('エラー: ' + e.message); });
