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
import { TimeOfDay } from './time.js';
import { Waypoints } from './waypoint.js';
import { BigMap } from './bigmap.js';
import { loadDetail } from './detail/index.js'; // detail (お試し)
import { DoorControl } from './doors.js';
import { Editor } from './editor.js';
import { openStreetView } from './streetview.js';
import { setTerrain, setCover, setLowMemory } from './terrain.js';
import { TOUCH, setupTouch } from './touch.js';
import { releaseGeometryAfterUpload } from './lowmem.js';
import { startMultiplayer } from './net/index.js';
import { Look } from './look.js';
import { useMocap } from './attack.js';
import { loadMotion } from './motion.js';
import { preloadVRM } from './character.js';
import { Swarm } from './swarm/event.js';

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
  const [city, terrain, cover, walls, props] = await Promise.all([cityP, terrainP, coverP, wallsP, propsP]);
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
  const world = new World(city.buildings, city.bounds);
  const t0 = performance.now();
  const built = buildCity(city, world, props);
  scene.add(built.group);
  if (new URLSearchParams(location.search).has('perf')) { // 計測用: 街の生成時間と三角形の数
    let tris = 0; const per = {};
    built.group.traverse((o) => { if (o.geometry) { const n = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; tris += n; per[o.name || o.type] = (per[o.name || o.type] || 0) + n; } });
    console.info('[perf] buildCity ms=' + Math.round(performance.now() - t0) + ' tris=' + Math.round(tris) + ' ' + JSON.stringify(per));
  }
  if (props) world.addColliders({ circle: props.colliders.tree }, true); // 木の幹 (V キーに関係なく常に有効)
  const detail = await loadDetail({ scene, city, world, built, props }); built.windowMats.push(...detail.emissive); // detail (お試し)
  const doors = new DoorControl(world); // 開け閉めできる扉 (時計の棟。形は detail が作って登録する)

  releaseGeometryAfterUpload(scene); // スマホ・タブレットだけ: 頂点データの JS 側の控えを、GPU に送った後に手放す

  const input = new Input();
  const player = new Player(world, scene);
  const cam = new ThirdPersonCamera(camera, world, renderer.domElement);
  const minimap = new Minimap(city, $('minimap'));
  const labels = new Labels(city.pois, scene);
  // マップで選んだ場所へワープ (建物の中なら一番近い屋外)。向きはそのまま
  const warpTo = (x, z) => {
    const p = findFree(world, x, z);
    player.teleport(p.x, p.z);
    cam.update(0, player.pos, true);
    toggleMap();
  };
  const bigmap = new BigMap({ minimap, city, pois: labels.pois, canvas: $('bigmap'), onWarp: (x, z) => warpTo(x, z), touch: TOUCH });
  const waypoints = new Waypoints(city.waypoints, scene, $('hud-goal'), world);
  const tod = new TimeOfDay({ renderer, scene, sky, sun, hemi, windowMats: built.windowMats });
  const streetView = () => openStreetView(city, player.pos.x, player.pos.z, cam.yaw);
  const editor = new Editor({ scene, camera, renderer, world, built, cam, player, streetView });

  // スポーン: city.start (建物の中なら一番近い屋外)。建物から離れる向きで立つ
  const st = city.start || { x: -45, z: 20 };
  const spawn = findFree(world, st.x, st.z);
  // city.start.face があればその地点を向く。なければ建物から離れる向き
  const spawnFacing = st.face ? Math.atan2(st.face[0] - spawn.x, st.face[1] - spawn.z)
    : Math.hypot(spawn.x - st.x, spawn.z - st.z) > 0.5 ? Math.atan2(spawn.x - st.x, spawn.z - st.z) : Math.PI / 2;
  const respawn = () => { player.teleport(spawn.x, spawn.z); player.facing = spawnFacing; cam.yaw = spawnFacing + Math.PI; cam.update(0, player.pos, true); };
  respawn();
  // 修正ツールで保存した後の再読み込み: 位置と視点、修正モードを復元
  const restore = Editor.takeRestore();
  if (restore) {
    player.teleport(restore.x, restore.z);
    Object.assign(cam, { yaw: restore.yaw, pitch: restore.pitch, dist: restore.dist });
  }

  // イベント「ミズタマンの襲来」(グランシティの中庭。swarm/event.js)。?noswarm で無効、?swarm で開いてすぐ始める (確認用)
  const swarm = new Swarm({ scene, world, player, camera, onRespawn: (x, z, face) => {
    const p = findFree(world, x, z); player.teleport(p.x, p.z); player.facing = face; cam.yaw = face + Math.PI; cam.update(0, player.pos, true);
  } });
  if (Q.has('noswarm') || (Q.has('shot') && !Q.has('swarm'))) swarm.disabled = true;
  if (Q.has('swarm')) { const p = findFree(world, -246, 1449); player.teleport(p.x, p.z); player.facing = Math.PI / 2; cam.yaw = player.facing + Math.PI; cam.update(0, player.pos, true); }

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
  const lock = () => { if (TOUCH) overlay.hidden = true; else renderer.domElement.requestPointerLock?.(); };
  const unlock = () => document.exitPointerLock?.();
  overlay.addEventListener('click', lock);
  renderer.domElement.addEventListener('click', () => { if (!TOUCH && !cam.locked && !editor.open) lock(); });
  document.addEventListener('pointerlockchange', () => { overlay.hidden = document.pointerLockElement === renderer.domElement || bigmap.open || editor.open; });
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

    if (input.pressed('KeyV')) detail.on = !detail.on; // detail (お試し)
    if (input.pressed('KeyT')) $('hud-time').textContent = tod.next();
    if (input.pressed('KeyR')) respawn();
    if (input.pressed('KeyH')) $('help').hidden = !$('help').hidden;
    if (input.pressed('KeyG')) exportGLB(built.group);

    if (input.pressed('KeyM')) toggleMap();
    if (bigmap.open && input.pressed('KeyF')) bigmap.centerOnPlayer();

    // マップ表示中はキャラを止める
    if (!bigmap.open) {
      // キャラの動きは 1/30 秒以下に刻んで進める (すり抜け防止)。ジャンプなどの「押した瞬間」は最初の 1 刻みだけに効かせる
      const n = Math.ceil(dt / (1 / 30) - 1e-6) || 1;
      doors.update(dt, player, input);   // 扉の開け閉め (F)。押した瞬間を player より先に見る
      for (let i = 0; i < n; i++) { player.update(dt / n, input, cam); if (n > 1) input.endFrame(); }
      cam.update(dt, player.pos, false, player);
      swarm.update(dt);
    }
    if (mp) mp.update(dt, input);
    tod.update(dt);
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
      const p = labels.nearest(player.pos.x, player.pos.z);
      $('place').textContent = p ? p.label + ' 付近' : '戸塚';
    }

    look.render();
    labelRenderer.render(scene, camera);
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
