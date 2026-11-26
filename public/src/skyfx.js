// 空 (雲・星・月・天の川・薄明)。three.js の Sky (Preetham 式) のシェーダに書き足す。
//
// 空は 1 枚のシェーダで描く (テクスチャ・追加の描画なし)。雲は 3 層 (高い巻雲・中ぐらいの高積雲・低い積雲) を
// 視線と水平な面の交点から作った座標で fbm ノイズにして重ね、太陽 (夜は月) の向きにずらした点との濃さの差で陰を付ける。
// 色は太陽の高さで変わる (昼は白、日没は橙、日没後は紫・紺、夜は月明かり)。
// 夜は地平線が霧の色 (scene.fog) になるように空の色を作る (遠くの建物が霧で溶ける色と空の色をそろえるため)。
//
// 映り込み用の空 (look.js) は SKY_DISCS を 0 にして、星・月 (小さくて明るい点) を描かない。
import * as THREE from 'three';

const PARS = /* glsl */`
  uniform float uTime, uCover, uCirrus, uMoonPhase;
  uniform vec3 uFog, uMoonDir, uGalN;
  uniform mat3 uStarRot;
  #define SKY_DISCS 1

  uniform sampler2D uTrans;
  uniform float uSkyI, uMie;

  // ---- 大気 (単散乱。レイリー + ミー + オゾン) ----
  // 太陽までの光学的な深さ (密度の積分) は、JS で作った表 (uTrans: 横 = 太陽の高さの余弦、縦 = 高さ) を引く
  const float Re = 6360.0, Ra = 6420.0;                       // 地球の半径・大気の上端 (km)
  const vec3 bR = vec3(5.8e-3, 13.5e-3, 33.1e-3);             // レイリー散乱 (/km)
  const vec3 bO = vec3(0.65e-3, 1.881e-3, 0.085e-3) * 2.5;          // オゾンの吸収 (/km)
  vec3 lutOD(float h, float mu) {
    float u = 0.5 + 0.5 * sign(mu) * sqrt(abs(mu));
    float v = sqrt(clamp(h / 60.0, 0.0, 1.0));
    return texture2D(uTrans, vec2(u, v)).rgb;
  }
  vec3 skyAtmo(vec3 d, vec3 L) {
    const float h0 = 0.05;
    vec3 P0 = vec3(0.0, Re + h0, 0.0);
    float b = dot(P0, d);
    float tmax = -b + sqrt(b * b - dot(P0, P0) + Ra * Ra);
    vec3 bM = vec3(21e-3) * uMie;
    float odR = 0.0, odM = 0.0, odO = 0.0, tPrev = 0.0;
    vec3 sR = vec3(0.0), sM = vec3(0.0);
    for (int i = 0; i < 14; i++) {
      float t1 = tmax * pow((float(i) + 1.0) / 14.0, 2.0);   // 手前を細かく
      float t = 0.5 * (tPrev + t1), dt = t1 - tPrev; tPrev = t1;
      vec3 p = P0 + d * t;
      float r = length(p), h = r - Re;
      float rR = exp(-h / 8.0) * dt, rM = exp(-h / 1.2) * dt, rO = max(0.0, 1.0 - abs(h - 25.0) / 15.0) * dt;
      odR += rR; odM += rM; odO += rO;
      vec3 od = lutOD(h, dot(p, L) / r);
      vec3 T = exp(-(bR * (odR + od.r) + bM * 1.11 * (odM + od.g) + bO * (odO + od.b)));
      sR += T * rR; sM += T * rM;
    }
    float c = dot(d, L), g = mieDirectionalG;
    float phR = 0.05968 * (1.0 + c * c);
    float phM = 0.07958 * (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * c, 1.5);
    return uSkyI * (bR * sR * phR + bM * sM * phM);
  }

  float h21(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  vec3 h33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
  float vn(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float vn3(vec3 p) {
    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    float a = h33(i).x, b = h33(i + vec3(1, 0, 0)).x, c = h33(i + vec3(0, 1, 0)).x, d = h33(i + vec3(1, 1, 0)).x;
    float e = h33(i + vec3(0, 0, 1)).x, g = h33(i + vec3(1, 0, 1)).x, h = h33(i + vec3(0, 1, 1)).x, k = h33(i + vec3(1, 1, 1)).x;
    return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
  }
  float fbm(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + vec2(17.1, 9.7); a *= 0.5; }
    return s;
  }
  float fbm4(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.07 + vec2(5.3, 11.9); a *= 0.5; }
    return s;
  }

  // 雲 3 層。戻り値は (色 * 不透明度の合成済み rgb, 不透明度)。d = 視線 (y が上)、L = 光の向き、litC / ambC = 日の当たる所 / 陰の色
  vec4 skyClouds(vec3 d, vec3 L, float cosT, vec3 litC, vec3 ambC, float cover) {
    if (d.y <= 0.0) return vec4(0.0);
    float y = d.y;
    float hz = smoothstep(0.01, 0.17, y);
    vec2 Ld = normalize(L.xz + vec2(1e-4));
    vec3 C = vec3(0.0); float A = 0.0;

    // ---- 巻雲 (高い・薄い・筋) ----
    {
      vec2 uv = d.xz / (y + 0.32) * 1.3 + vec2(0.0035, 0.0012) * uTime;
      vec2 q = vec2(uv.x * 0.55 + uv.y * 0.35, uv.y * 3.2 - uv.x * 0.5);
      q += 0.6 * vec2(vn(q * 1.3 + 3.1), vn(q * 1.3 + 7.7));
      float s = fbm4(q * 1.4);
      float a = smoothstep(0.42, 0.86, s) * uCirrus * hz;
      vec3 c = litC * 1.05 + ambC * 0.35;
      C = c * a; A = a;
    }
    // ---- 高積雲 (小さなむら) ----
    {
      vec2 uv = d.xz / (y + 0.05) * 3.3 + vec2(0.0075, 0.0030) * uTime;
      float b = fbm4(uv + 2.0 * vec2(vn(uv * 0.4), vn(uv * 0.4 + 5.0)));
      float thr = mix(0.78, 0.55, cover);
      float a = smoothstep(thr, thr + 0.16, b) * (0.35 + 0.5 * cover) * smoothstep(0.03, 0.22, y);
      float bS = fbm4(uv + Ld * 0.07 + 2.0 * vec2(vn(uv * 0.4), vn(uv * 0.4 + 5.0)));
      float lt = clamp(0.55 + (b - bS) * 6.0, 0.0, 1.0);
      vec3 c = mix(ambC * 0.9, litC, lt);
      C = c * a + C * (1.0 - a); A = a + A * (1.0 - a);
    }
    // ---- 積雲 (低い・大きい・陰がある) ----
    {
      vec2 uv = d.xz / (y + 0.07) * 1.9 + vec2(0.012, 0.0055) * uTime;
      vec2 w = 0.5 * vec2(vn(uv * 0.7 + 1.7), vn(uv * 0.7 + 9.1));   // 形を少しゆがめる (ばらつき)
      float b = fbm(uv + w);
      float thr = mix(0.84, 0.40, cover);
      float soft = mix(0.10, 0.24, cover);
      float a = smoothstep(thr, thr + soft, b) * hz;
      float bS = fbm(uv + w + Ld * 0.11);
      float lt = clamp(0.5 + (b - bS) * 4.5, 0.0, 1.0);
      float thick = smoothstep(thr, thr + 0.42, b);
      // 縁 (薄い所) は光が透けて明るい。太陽の近くはさらに輝く (銀の縁)
      float rim = (1.0 - thick) * pow(max(cosT, 0.0), 6.0);
      vec3 shade = mix(litC, ambC * 0.8, (1.0 - lt) * (0.55 + 0.35 * thick));
      shade = mix(shade, ambC * 0.55, thick * 0.35 * (1.0 - lt));      // 厚い雲の底は暗い
      vec3 c = shade + litC * rim * 0.9;
      C = c * a + C * (1.0 - a); A = a + A * (1.0 - a);
    }
    return vec4(C, A);
  }

#if SKY_DISCS
  // 星 (2 段階の大きさ)。d は星空の座標 (天の北極のまわりを回る)。
  vec3 skyStars(vec3 d, float t) {
    vec3 col = vec3(0.0);
    for (int L = 0; L < 2; L++) {
      float sc = L == 0 ? 52.0 : 110.0;
      vec3 p = d * sc, ip = floor(p), fp = fract(p);
      vec3 r = h33(ip + float(L) * 19.3), r2 = h33(ip.zxy + 3.7 + float(L) * 7.1);
      float dens = L == 0 ? 0.22 : 0.16;
      if (r.x > dens) continue;
      vec3 sp = 0.3 + 0.4 * r2;
      float dist = length(fp - sp);
      float px = length(fwidth(p)) + 1e-4;
      float rad = (L == 0 ? 0.07 : 0.06) + 0.05 * r.y;
      float k = 1.0 - smoothstep(rad * 0.3, rad + px * 0.8, dist);
      float mag = pow(r.y, L == 0 ? 3.5 : 2.0);
      float tw = 1.0 + 0.22 * sin(t * (2.0 + 4.0 * r2.x) + r2.y * 60.0);
      vec3 tint = mix(vec3(1.0, 0.78, 0.6), vec3(0.7, 0.82, 1.0), r2.z);
      col += tint * k * (0.06 + 0.55 * mag) * tw;
    }
    return col;
  }
#endif
`;

const BODY = /* glsl */`
  vec3 sd = vSunDirection;
  float sunE = sd.y;
  float yy = max(direction.y, 0.0);
  float nightK = 1.0 - smoothstep(-0.10, 0.03, sunE);
  vec3 col = skyAtmo(normalize(vec3(direction.x, max(direction.y, 0.0008), direction.z)), sd);
#if SKY_DISCS
  {
    // 太陽の円盤 (大気で赤く減る)
    vec3 odS = lutOD(0.05, sunE);
    vec3 Ts = exp(-(bR * odS.r + vec3(21e-3) * uMie * 1.11 * odS.g + bO * odS.b));
    float disc = smoothstep(sunAngularDiameterCos, sunAngularDiameterCos + 0.00002, dot(direction, sd));
    col += Ts * disc * 150.0 * step(0.0, direction.y);
  }
#endif

  // 夜の空: 地平線は霧の色、天頂ほど深い青
  vec3 nightSky = mix(uFog, vec3(0.0012, 0.0024, 0.0085), pow(yy, 0.45));
  col = mix(col, nightSky, nightK);

  // 薄明 (日の出前・日没後の、地平線の赤〜紫〜紺の帯)
  float tw = smoothstep(-0.26, -0.02, sunE) * (1.0 - smoothstep(-0.02, 0.07, sunE));
  vec2 sdh = normalize(sd.xz + vec2(1e-5)), dh = normalize(direction.xz + vec2(1e-5));
  float az = max(dot(sdh, dh), 0.0);
  float tg = tw * (exp(-yy * 6.5) * (0.25 + 0.75 * pow(az, 3.0)) + 0.35 * exp(-yy * 2.4) * pow(az, 2.0));
  float tt = clamp(-sunE / 0.22, 0.0, 1.0);
  col += mix(vec3(0.50, 0.17, 0.07), vec3(0.05, 0.06, 0.20), pow(tt, 0.7)) * tg;

  // 地平線のかすみ (遠くの建物が溶ける霧の色に合わせる)
  float haze = exp(-yy * 7.0) * 0.6;
  col = mix(col, uFog, haze);
  if (direction.y < 0.0) col = uFog;

  vec3 md = normalize(uMoonDir);
  float moonUp = smoothstep(-0.03, 0.10, md.y);
  float cm = dot(direction, md);

  // 雲の色 (日の当たる所・陰)
  float dayK = smoothstep(-0.04, 0.30, sunE);
  float sunUp = smoothstep(-0.16, 0.04, sunE);
  vec3 warm = mix(vec3(1.0, 0.42, 0.18), vec3(1.0, 0.97, 0.92), smoothstep(0.0, 0.32, sunE));
  float phaseB = 0.5 - 0.5 * cos(6.2831853 * uMoonPhase);
  float moonL = moonUp * (0.12 + 0.88 * phaseB);
  vec3 litC = warm * sunUp * 2.0 + vec3(0.55, 0.65, 1.0) * moonL * 0.055 * (1.0 - sunUp);
  vec3 ambDay = vec3(0.50, 0.60, 0.84);
  vec3 ambTw = mix(vec3(0.42, 0.26, 0.30), vec3(0.06, 0.07, 0.15), pow(tt, 0.6));
  vec3 ambC = mix(mix(nightSky * 2.2 + vec3(0.004, 0.005, 0.009), ambTw, tw * 1.6), ambDay * 1.1, dayK);
  float cosT = dot(direction, sd);

#if SKY_DISCS
  // 星と天の川 (雲より奥)
  if (nightK > 0.01 && yy > 0.0) {
    vec3 dd = uStarRot * direction;
    float ext = smoothstep(0.0, 0.22, yy) * nightK * (1.0 - 0.75 * moonL);
    vec3 st = skyStars(dd, uTime);
    float gb = dot(dd, uGalN);
    float band = exp(-gb * gb / 0.018);
    float mw = band * (0.25 + 0.9 * vn3(dd * 6.0)) * (0.5 + 0.5 * vn3(dd * 15.0 + 4.0));
    vec3 mwc = vec3(0.50, 0.55, 0.80) * 0.0055 * mw;
    // 天の川の中は星が多い
    vec3 st2 = skyStars(dd * 1.37 + 0.31, uTime + 9.0) * band * 0.8;
    col += (st + st2 + mwc) * ext;
  }
  // 月 (満ち欠けと模様つき)
  {
    float R = 0.0115;
    vec3 rgt = normalize(cross(md, vec3(0.0, 1.0, 0.0)) + vec3(1e-5, 0.0, 0.0));
    vec3 upv = cross(rgt, md);
    float mx = dot(direction, rgt) / R, my = dot(direction, upv) / R;
    float r = length(vec2(mx, my));
    float vis = moonUp * mix(0.55, 1.0, nightK);
    if (cm > 0.0 && vis > 0.0) {
      float ang = acos(clamp(cm, -1.0, 1.0));
      // かすかな光輪
      float halo = exp(-ang / (R * 5.0)) * 0.05 + exp(-ang / (R * 22.0)) * 0.012;
      col += vec3(0.62, 0.70, 1.0) * halo * vis * (0.3 + 0.7 * phaseB) * nightK;
      if (r < 1.15) {
        float edge = 1.0 - smoothstep(0.94, 1.0, r);
        float zz = sqrt(max(1.0 - r * r, 0.0));
        float al = 6.2831853 * uMoonPhase;
        vec3 Lm = vec3(sin(al), 0.0, -cos(al));
        float lit = smoothstep(-0.03, 0.08, dot(vec3(mx, my, zz), Lm));
        vec2 q = vec2(mx, my);
        float maria = smoothstep(0.46, 0.62, fbm4(q * 1.3 + vec2(4.2, 1.3)));
        float crat = vn(q * 9.0) * 0.18 + vn(q * 22.0) * 0.08;
        float alb = mix(1.0, 0.55, maria) - crat + 0.12;
        vec3 mc = mix(vec3(1.0, 0.72, 0.5), vec3(1.0, 0.97, 0.9), smoothstep(0.0, 0.30, md.y));
        vec3 disc = mc * alb * (1.5 * lit + 0.02) + vec3(0.12, 0.15, 0.2) * 0.03 * (1.0 - lit);
        col = mix(col, disc * mix(0.6, 1.0, nightK) , edge * vis);
      }
    }
  }
#endif

  // 雲 (光は日中は太陽、夜は月から)
  {
    vec3 Lc = normalize(mix(md, sd, sunUp));
    vec4 cl = skyClouds(direction, Lc, mix(dot(direction, md), cosT, sunUp), litC, ambC, uCover);
    cl.rgb = mix(cl.rgb, uFog, (1.0 - smoothstep(0.0, 0.16, yy)) * 0.5 * cl.a);   // 地平線の近くはかすむ
    col = col * (1.0 - cl.a) + cl.rgb;
  }
  retColor = col;
  gl_FragColor = vec4( retColor, 1.0 );
`;

// 大気の表: 高さ h・太陽の高さの余弦 mu の点から太陽の向きへ、大気の上端までの密度の積分 (レイリー・ミー・オゾン。km)。
// 地球に隠れる向きは大きな値 (光が届かない)。横軸 u = 0.5 + 0.5 sign(mu) sqrt|mu|、縦軸 v = sqrt(h / 60 km)
function buildTransmittance(W = 256, H = 32) {
  const RE = 6360, RA = 6420, data = new Uint16Array(W * H * 4), hf = THREE.DataUtils.toHalfFloat;
  for (let j = 0; j < H; j++) {
    const v = (j + 0.5) / H, r = RE + v * v * 60;
    for (let i = 0; i < W; i++) {
      const u = (i + 0.5) / W, s2 = 2 * u - 1, mu = Math.sign(s2) * s2 * s2;
      let a = 0, m = 0, o = 0;
      if (mu < 0 && r * Math.sqrt(1 - mu * mu) < RE) { a = m = o = 5000; }
      else {
        const b = r * mu, len = -b + Math.sqrt(b * b - r * r + RA * RA), N = 192, ds = len / N;
        for (let k = 0; k < N; k++) {
          const sk = (k + 0.5) * ds, hh = Math.sqrt(r * r + 2 * r * mu * sk + sk * sk) - RE;
          a += Math.exp(-hh / 8) * ds; m += Math.exp(-hh / 1.2) * ds; o += Math.max(0, 1 - Math.abs(hh - 25) / 15) * ds;
        }
      }
      const q = (j * W + i) * 4;
      data[q] = hf(Math.min(a, 5000)); data[q + 1] = hf(Math.min(m, 5000)); data[q + 2] = hf(Math.min(o, 5000)); data[q + 3] = hf(1);
    }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
  return t;
}

// Sky のシェーダに書き足し、時間帯 (time.js) が設定する uniform を足す
export function patchSky(sky) {
  const m = sky.material, u = m.uniforms;
  Object.assign(u, {
    uTime: { value: 0 }, uCover: { value: 0.45 }, uCirrus: { value: 0.45 }, uMoonPhase: { value: 0.5 },
    uFog: { value: new THREE.Color('#c9d6e3') }, uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    uGalN: { value: new THREE.Vector3(0, 1, 0) }, uStarRot: { value: new THREE.Matrix3() },
    uTrans: { value: buildTransmittance() }, uSkyI: { value: 28 }, uMie: { value: 1 },
  });
  let f = m.fragmentShader;
  f = f.replace('void main() {', PARS + '\n void main() {');
  f = f.replace('gl_FragColor = vec4( retColor, 1.0 );', BODY);
  m.fragmentShader = f;
  m.needsUpdate = true;
}

// 月齢 (0 = 新月、0.5 = 満月)。2000-01-06 18:14 UTC の新月からの経過日数
export function moonPhase(date = new Date()) {
  const d = (date.getTime() / 86400000 + 2440587.5) - 2451550.26;
  return (((d / 29.530588861) % 1) + 1) % 1;
}

// 星空: 天の北極 (北緯 35.4°) のまわりの回転と、天の川の面の法線
const LAT = THREE.MathUtils.degToRad(35.4);
const POLE = new THREE.Vector3(0, Math.sin(LAT), -Math.cos(LAT)); // 北 = -Z
const GAL = (() => {
  const e = new THREE.Vector3(1, 0, 0), t = new THREE.Vector3().crossVectors(POLE, e).normalize();
  const a = THREE.MathUtils.degToRad(62.9);
  return POLE.clone().multiplyScalar(Math.cos(a)).addScaledVector(t, Math.sin(a)).normalize();
})();
const _m4 = new THREE.Matrix4();
export function setStars(u, siderealHours) {
  _m4.makeRotationAxis(POLE, -siderealHours / 24 * Math.PI * 2);
  u.uStarRot.value.setFromMatrix4(_m4);
  u.uGalN.value.copy(GAL);
}
