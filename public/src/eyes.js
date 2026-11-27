// キャラメイク: 目の色。今のキャラの虹彩 (材質名に EyeIris) の色を付け替える (tint.js。髪色と同じ方式)。
//   虹彩の模様 (茶色の中の青い影・光) は、明るさの模様として残り、色だけが変わる。白目・ハイライト・まつげは変えない。
import { tintMaterial } from './tint.js';

export class Eyedresser {
  constructor(vrm) {
    this.mats = [];
    vrm.scene.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (/EyeIris/.test(m.name) && !this.mats.includes(m)) this.mats.push(m);
    });
    this.color = null;
  }

  // 目の色を変える ('#rrggbb'。null = 元の色)
  setColor(hex) {
    this.color = hex || null;
    for (const m of this.mats) tintMaterial(m, this.color, 'eye');
  }
}
