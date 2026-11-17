// 光と空気感 (画面全体の仕上げ)。街の建物・道路には手を入れず、描き方だけを変える。
//
//  1. 空の映り込み (環境光): 空のシェーダを小さな立方体に描いてぼかし (PMREM)、scene.environment に入れる。
//     ガラス・金属・濡れたような面に空が映り、日陰も空の色で少し照らされる。時間帯が変わったら作り直す。
//  2. 空気遠近 (かすみ): 線形の霧を「距離に応じて指数的に濃くなる」霧に替える。数十 m 先から少しずつかすむ。
//  3. 物の陰 (AO): 建物の足元・軒下・すき間・物どうしの接する所を暗くする (three.js の GTAO。
//     法線は深度から復元するので、街をもう 1 回描く必要はない)。
//  4. にじみ (ブルーム): 明るい所 (夜の窓・看板・街灯、昼の強い照り返し) が周りにじむ。
//  5. 色の仕上げ: 露出 → ACES のトーンマッピング → 彩度・コントラスト・周辺減光。
//
// 3〜5 は画面の大きさの描画先を何枚か使うので、スマホ・タブレット (メモリが少ない) では使わない (1・2 だけ)。
// URL: ?plain で以前の見え方 (全部なし)、?post でスマホでも 3〜5 を使う、?noao で AO だけ無し、?nobloom でにじみだけ無し、?noenv で映り込みだけ無し
// 強さは time.js の時間帯ごとの値 (envI・hemiK・ao・bloom・bloomT・sat)。調整用に URL で上書きできる (?envI=0.2&aoK=0.8 など)
// 注意: 空の映り込みは強くすると日陰まで明るくなり影が消える (空の光がとても強いため)。envI は 0.1 前後にしてある
import * as THREE from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// 霧: scene.fog (THREE.Fog) の near / far をそのまま使い、near からの距離で指数的に濃くする。far で約 80%
const FOG_EXP = `
#ifdef USE_FOG
  float fogFactor = 1.0 - exp( -1.6 * max( vFogDepth - fogNear, 0.0 ) / ( fogFar - fogNear ) );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;

const COMPOSITE = {
  uniforms: { tScene: { value: null }, tAO: { value: null }, aoK: { value: 1 }, exposure: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    uniform sampler2D tScene, tAO; uniform float aoK, exposure; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tScene, vUv);
      float ao = texture2D(tAO, vUv).r;
      c.rgb *= mix(1.0, ao, aoK);
      gl_FragColor = vec4(c.rgb * exposure, 1.0);
    }`,
};

const FINAL = {
  uniforms: { tDiffuse: { value: null }, sat: { value: 1.1 }, contrast: { value: 1.06 }, vignette: { value: 0.22 }, tint: { value: new THREE.Vector3(1, 1, 1) } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float sat, contrast, vignette; uniform vec3 tint; varying vec2 vUv;
    // three.js と同じ ACES Filmic (露出は前の段で掛け済み)
    vec3 lookRRT(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
    vec3 lookACES(vec3 color) {
      const mat3 lookIn = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 lookOut = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      color *= 1.0 / 0.6; color = lookIn * color; color = lookRRT(color); color = lookOut * color;
      return clamp(color, 0.0, 1.0);
    }
    vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    void main() {
      // 彩度・コントラストは表示用の値 (sRGB) で掛ける (線形のまま掛けると暗い所がつぶれて窓が真っ黒になる)
      vec3 c = toSRGB(lookACES(texture2D(tDiffuse, vUv).rgb * tint));
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, sat);
      c = (c - 0.5) * contrast + 0.5;
      vec2 d = vUv - 0.5; c *= 1.0 - vignette * dot(d, d) * 2.0;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

export class Look {
  constructor({ renderer, scene, camera, sky, hemi, touch }) {
    const Q = new URLSearchParams(location.search);
    Object.assign(this, { renderer, scene, camera, sky, hemi });
    this.plain = Q.has('plain');
    this.post = !this.plain && (!touch || Q.has('post'));
    this.noenv = Q.has('noenv');
    // 調整用: ?envI=0.2&hemiK=0.6&aoK=0.6 で時間帯の値を上書き
    this.over = {}; for (const k of ['envI', 'hemiK', 'aoK', 'bloom', 'bloomT', 'sat']) if (Q.has(k)) this.over[k] = +Q.get(k);
    if (this.plain) return;

    THREE.ShaderChunk.fog_fragment = FOG_EXP; // 材質を作る前に差し替える (シェーダは最初の描画で組まれる)
    if (scene.fog) { scene.fog.near = 80; scene.fog.far = 2500; } // 80 m 先から薄くかすみ始め、250 m で約 11%・600 m で約 29%

    // ---- 1. 空の映り込み ----
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.skyScene = new THREE.Scene();
    // 映り込み用の空は太陽の円盤を消す (円盤はとても明るく、ぼかすと日陰まで照らして影が消える。太陽の光は sun ライトが受け持つ)
    const skyMat = new THREE.ShaderMaterial({
      name: 'SkyEnv', uniforms: sky.material.uniforms, vertexShader: sky.material.vertexShader,
      fragmentShader: sky.material.fragmentShader.replace('* sundisk;', '* 0.0;'), side: THREE.BackSide, depthWrite: false,
    });
    this.skyMesh = new THREE.Mesh(sky.geometry, skyMat);
    this.skyMesh.scale.setScalar(100);
    this.skyScene.add(this.skyMesh);
    this.envRT = null; this.envKey = ''; this.envT = 0;

    if (!this.post) return;
    // ---- 3〜5. 画面の仕上げ ----
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.sceneRT = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: Q.has('noaa') ? 0 : 4 });
    this.sceneRT.depthTexture = new THREE.DepthTexture(size.x, size.y);
    this.sceneRT.depthTexture.type = THREE.UnsignedIntType;
    this.midRT = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
    this.aoOn = !Q.has('noao');
    if (this.aoOn) {
      // AO は半分の解像度で十分 (ぼかすので)
      const ao = this.ao = new GTAOPass(scene, camera, Math.ceil(size.x / 2), Math.ceil(size.y / 2));
      ao.output = GTAOPass.OUTPUT.Off;
      // 法線を描くための 2 回目の描画をやめ、深度から法線を復元する (GTAOPass.setGBuffer は深度だけを渡す形に対応していないので、ここで設定する)
      ao._renderGBuffer = false;
      ao.normalRenderTarget?.dispose();
      for (const m of [ao.gtaoMaterial, ao.pdMaterial]) {
        m.defines.NORMAL_VECTOR_TYPE = 0; m.defines.DEPTH_SWIZZLING = 'x';
        m.uniforms.tNormal.value = null; m.uniforms.tDepth.value = this.sceneRT.depthTexture; m.needsUpdate = true;
      }
      // 半径は街の大きさに合わせる (m)。軒下・足元・すき間に効く程度
      ao.updateGtaoMaterial({ radius: 2.5, distanceExponent: 1.5, thickness: 4, scale: 1.0, samples: 12 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    }
    this.bloomOn = !Q.has('nobloom');
    if (this.bloomOn) this.bloom = new UnrealBloomPass(new THREE.Vector2(Math.ceil(size.x / 2), Math.ceil(size.y / 2)), 0.2, 0.5, 0.9);
    this.composite = new FullScreenQuad(new THREE.ShaderMaterial({ ...COMPOSITE, uniforms: THREE.UniformsUtils.clone(COMPOSITE.uniforms), depthTest: false, depthWrite: false, toneMapped: false }));
    this.final = new FullScreenQuad(new THREE.ShaderMaterial({ ...FINAL, uniforms: THREE.UniformsUtils.clone(FINAL.uniforms), depthTest: false, depthWrite: false, toneMapped: false }));
  }

  // 時間帯の値 (time.js の cur) を受け取って、映り込み・にじみ・色を合わせる。毎コマ呼ぶ
  update(dt, cur) {
    if (this.plain) return;
    const o = this.over;
    cur = { ...cur, ...o, ao: o.aoK ?? cur.ao };
    // 空の映り込み: 空の形 (太陽の高さ・向き・散乱) が変わったら作り直す。移り変わりの途中は 0.3 秒ごと
    const key = [cur.skyElev, cur.azim, cur.rayleigh].map(v => v.toFixed(1)).join() + (this.sky.visible ? '' : cur.fogC.getHexString());
    this.envT -= dt;
    if (key !== this.envKey && this.envT <= 0 && !this.noenv) {
      this.envKey = key; this.envT = 0.3;
      this.skyMesh.visible = this.sky.visible;
      this.skyScene.background = this.sky.visible ? null : cur.fogC;
      const rt = this.pmrem.fromScene(this.skyScene, 0, 1, 1000, { size: 128 });
      this.envRT?.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
    }
    // 空の光は映り込みで入るので、半球ライトはその分弱める
    this.scene.environmentIntensity = cur.envI ?? 0.1;
    this.hemi.intensity = cur.hemiI * (cur.hemiK ?? 0.8);
    if (!this.post) return;
    const u = this.composite.material.uniforms;
    u.exposure.value = cur.exposure;
    u.aoK.value = cur.ao ?? 0.6;
    if (this.bloom) { this.bloom.strength = cur.bloom ?? 0.15; this.bloom.threshold = cur.bloomT ?? 1.0; }
    this.final.material.uniforms.sat.value = cur.sat ?? 1.1;
  }

  setSize() {
    if (!this.post) return;
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.sceneRT.setSize(s.x, s.y);
    this.midRT.setSize(s.x, s.y);
    this.ao?.setSize(Math.ceil(s.x / 2), Math.ceil(s.y / 2));
    this.bloom?.setSize(Math.ceil(s.x / 2), Math.ceil(s.y / 2));
  }

  render() {
    const r = this.renderer;
    if (!this.post) { r.render(this.scene, this.camera); return; }
    // 描画先に描くとき three.js はトーンマッピングをしないので、明るさはそのまま (HDR) で残る
    r.setRenderTarget(this.sceneRT);
    r.render(this.scene, this.camera);
    if (this.ao) this.ao.render(r, null, this.sceneRT);
    const u = this.composite.material.uniforms;
    u.tScene.value = this.sceneRT.texture;
    u.tAO.value = this.ao ? this.ao.gtaoMap : null;
    if (!this.ao) u.aoK.value = 0;
    r.setRenderTarget(this.midRT); this.composite.render(r);
    if (this.bloom) this.bloom.render(r, null, this.midRT, 0, false); // midRT の上ににじみを足す
    this.final.material.uniforms.tDiffuse.value = this.midRT.texture;
    r.setRenderTarget(null); this.final.render(r);
  }
}
