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
import { Editor } from './editor.js';
import { openStreetView } from './streetview.js';
import { setTerrain } from './terrain.js';

const $ = (id) => document.getElementById(id);
const status = (t) => { $('status').textContent = t; };

async function main() {
  status('地図データを読み込み中…');
  const city = await (await fetch('data/city.json')).json();
  // 地形 (無ければ平らな地面)
  try { const r = await fetch('data/terrain.json'); if (r.ok) setTerrain(await r.json()); } catch { /* 平らなまま */ }
  // 木・小物・建物の飾りの配置と当たり判定 (tools/build_props.py が作る。無ければそれらを置かない)
  let props = null;
  try { const r = await fetch('data/props.json'); if (r.ok) props = await r.json(); } catch { /* 無し */ }

  $('credit').textContent = '地図データ ' + city.attribution;

  // ---- renderer / scene ----
  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  $('app').appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(innerWidth, innerHeight);
  Object.assign(labelRenderer.domElement.style, { position: 'fixed', inset: '0', pointerEvents: 'none' });
  document.body.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#c9d6e3', 250, 1300);
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 4000);

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
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 400 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  // ---- world ----
  status('街を生成中…');
  await new Promise(r => setTimeout(r, 0));
  const world = new World(city.buildings, city.bounds);
  const built = buildCity(city, world, props);
  scene.add(built.group);
  if (props) world.addColliders({ circle: props.colliders.tree }, true); // 木の幹 (V キーに関係なく常に有効)
  const detail = await loadDetail({ scene, city, world, built, props }); built.windowMats.push(...detail.emissive); // detail (お試し)

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
  const bigmap = new BigMap({ minimap, city, pois: labels.pois, canvas: $('bigmap'), onWarp: (x, z) => warpTo(x, z) });
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

  // ---- UI ----
  const overlay = $('overlay');
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
    if (qs.has('nodetail')) detail.on = false; // detail (お試し)
    if (qs.has('edit')) { editor.show(); cam.dist = +(qs.get('dist') || cam.dist); }
    if (qs.has('map')) { bigmap.show(player.pos.x, player.pos.z); if (qs.has('zoom')) bigmap.scale = +qs.get('zoom'); }
    cam.update(0, player.pos, true);
  }
  if (restore) { overlay.hidden = true; editor.show(); cam.dist = restore.dist; cam.update(0, player.pos, true); }
  overlay.addEventListener('click', () => renderer.domElement.requestPointerLock());
  renderer.domElement.addEventListener('click', () => { if (!cam.locked && !editor.open) renderer.domElement.requestPointerLock(); });
  document.addEventListener('pointerlockchange', () => { overlay.hidden = document.pointerLockElement === renderer.domElement || bigmap.open || editor.open; });
  const toggleMap = () => {
    if (bigmap.open) {
      bigmap.hide(); $('map-help').hidden = true;
      renderer.domElement.requestPointerLock();
    } else {
      bigmap.show(player.pos.x, player.pos.z); $('map-help').hidden = false;
      overlay.hidden = true;
      document.exitPointerLock();
    }
  };
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
    if (bigmap.open) bigmap.resize();
  });

  let placeTimer = 0;
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 1 / 30);

    if (input.pressed('KeyV')) detail.on = !detail.on; // detail (お試し)
    if (input.pressed('KeyT')) $('hud-time').textContent = tod.next();
    if (input.pressed('KeyR')) respawn();
    if (input.pressed('KeyH')) $('help').hidden = !$('help').hidden;
    if (input.pressed('KeyG')) exportGLB(built.group);

    if (input.pressed('KeyM')) toggleMap();
    if (bigmap.open && input.pressed('KeyF')) bigmap.centerOnPlayer();

    // マップ表示中はキャラを止める
    if (!bigmap.open) {
      player.update(dt, input, cam);
      cam.update(dt, player.pos);
    }
    tod.update(dt);
    detail.update(clock.elapsedTime); // detail (お試し)

    // 影は常にプレイヤー周辺
    sun.target.position.copy(player.pos);
    sun.position.copy(player.pos).addScaledVector(tod.lightDir, 200);

    labels.update(dt, player.pos.x, player.pos.z);
    waypoints.update(dt, player.pos.x, player.pos.z);
    minimap.update(player.pos.x, player.pos.z, cam.yaw, player.facing);
    bigmap.draw(player.pos.x, player.pos.z, player.facing);
    if ((placeTimer -= dt) <= 0) {
      placeTimer = 0.5;
      const p = labels.nearest(player.pos.x, player.pos.z);
      $('place').textContent = p ? p.label + ' 付近' : '戸塚';
    }

    renderer.render(scene, camera);
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
