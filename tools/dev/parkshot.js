// 千葉ドリームランド (舞浜の架空のテーマパーク。PARK_PLAN.md) の画面を撮る。視点はゲームの座標 (x, z) で書く。
// 使い方: node tools/dev/parkshot.js <出力フォルダ> [--nopark] [--nocastle] [--noentrance] [--noreflect] [--only 名前,名前] [--night|--dusk|--morning] [--touch] [--probe]   (1 枚 1〜2 分。--probe = 壁の柄の確かめの箱だけを撮る。--nopark = 修正前 = 実在のままの舞浜)
// 視点 (VIEWS): at = キャラの位置 [x, z]、look = 見る向き [dx, dz]、pitch・dist = カメラ。キャラは地面に立つ (高さは地形から)
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC = path.join(ROOT, 'public');
const THREE_DIR = path.join(__dirname, '.cache', 'package');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png' };

const VIEWS = [
  // ライブ会場 (サンライズ・ライブステージ。コースターの跡地。中心 31353, -25583、前 = (0.84, -0.545) = 広場の向き)
  { name: 'lv1_stage_front', at: [31362, -25593], look: [-0.853, 0.522], pitch: 0.14, dist: 30 },        // 客席の中から、ステージと大画面
  { name: 'lv2_aerial', at: [31373, -25600], look: [0.853, -0.522], pitch: 1.0, dist: 230 },              // 上から (会場・広場・湖・城)
  { name: 'lv3_from_avenue', at: [31490, -25735], look: [0, 1], pitch: 0.12, dist: 22 },                  // アベニューの出口から (城が隠れないか)
  { name: 'lv4_from_plaza', at: [31450, -25672], look: [-0.64, 0.77], pitch: 0.1, dist: 20 },            // 広場の西から会場へ
  { name: 'lv5_stage_close', at: [31355, -25589], look: [-0.853, 0.522], pitch: 0.25, dist: 12 },      // ステージの前の花道
  { name: 'lv7_night', at: [31362, -25593], look: [-0.853, 0.522], pitch: 0.2, dist: 30, show: { idle: true } },   // 夜のステージ (光線・大画面・電球。--night)
  { name: 'lv8_back', at: [31305, -25558], look: [0.853, -0.522], pitch: 0.12, dist: 25 },                   // ステージの裏 (楽屋・テント・木)
  { name: 'lv9_far_end', at: [31403, -25618], look: [-0.853, 0.522], pitch: 0.16, dist: 28 },                // 扇の先 (入口の門・広場から来る道) からステージへ
  { name: 'lv6_castle_axis', at: [31490, -25690], look: [0, 1], pitch: 0.08, dist: 16 },                  // 広場の軸 (城の方向)。会場は左に入る
  { name: 'e1_arch_night', at: [31121, -25830], look: [-0.230, -0.973], pitch: 0.17, dist: 12 },       // エリアの門 (英語の名前・字体)
  { name: 'e2_arch_town', at: [31367, -25675], look: [-0.992, -0.129], pitch: 0.17, dist: 12 },       // エリアの門 (英語の名前・字体)
  { name: 'e3_arch_valley', at: [31661, -25664], look: [0.995, 0.101], pitch: 0.17, dist: 12 },       // エリアの門 (英語の名前・字体)
  { name: 'e4_arch_sweet', at: [31725, -25460], look: [0.808, 0.590], pitch: 0.17, dist: 12 },       // エリアの門 (英語の名前・字体)
  { name: 'e5_arch_forest', at: [31326, -25464], look: [-1.000, 0.001], pitch: 0.17, dist: 12 },       // エリアの門 (英語の名前・字体)
  { name: 'e6_arch_harbor', at: [31510, -25403], look: [0.000, 1.000], pitch: 0.17, dist: 12 },       // エリアの門 (英語の名前・字体)
  { name: 'e7_arch_station', at: [31385, -25902], look: [0.980, 0.199], pitch: 0.17, dist: 12 },       // エリアの門 (英語の名前・字体)
  { name: 'e8_town_street', at: [31301, -25684], look: [-0.992, -0.129], pitch: 0.1, dist: 9 },       // ターボ・ダウンタウンの通り (店ごとの字体)
  { name: 'a1_site_aerial', at: [31480, -25760], look: [0, 1], pitch: 1.1, dist: 700 },        // 敷地の上から (北の駅の側から南へ)
  { name: 'a2_gate_aerial', at: [31330, -25919], look: [0.5, 0.866], pitch: 0.7, dist: 120 },  // ゲートとその前の道
  { name: 'a3_approach', at: [31306, -25986], look: [0.2, 1], pitch: 0.25, dist: 24 },          // 駅からの歩道が敷地に入る所から
  { name: 'a4_gate_front', at: [31310, -25950], look: [0.5, 0.866], pitch: 0.12, dist: 16 },    // ゲートの看板を正面から
  { name: 'a5_gate_close', at: [31330, -25919], look: [0.5, 0.866], pitch: 0.18, dist: 7 },     // 柱の間から
  { name: 'a6_plaza', at: [31440, -25760], look: [0.3, 1], pitch: 0.2, dist: 20 },              // ネオン・アベニューから広場の円へ
  { name: 'a7_plaza_aerial', at: [31490, -25672], look: [0, 1], pitch: 0.9, dist: 260 },        // 広場の円を上から
  { name: 'p1_walls_probe', at: [31262, -25905], look: [0.35, 1], pitch: 0.12, dist: 60, probe: true },   // 壁の柄の確かめ: 延長の建物の材質に、街の本体と同じ柄 (matId 0〜5) を付けた箱を並べる (--probe のときだけ)
  { name: 'p2_walls_close', at: [31246, -25892], look: [0.15, 1], pitch: 0.04, dist: 15, probe: true },   // 近くから (吹き付け・サイディング・タイル・打ち放しが見える距離)
  { name: 'b1_lake', at: [31510, -25548], look: [0, 1], pitch: 0.16, dist: 36 },             // 湖の北の散歩道から (水面・岸の縁石)
  { name: 'b2_lake_aerial', at: [31510, -25464], look: [0, 1], pitch: 1.1, dist: 480 },    // 湖と広場・塔・道を上から
  { name: 'b3_tower', at: [31560, -25662], look: [0.7, 0.7], pitch: 0.1, dist: 30 },        // サーチライト・タワー
  { name: 'b4_avenue', at: [31352, -25896], look: [0.66, 0.76], pitch: 0.1, dist: 14 },    // ネオン・アベニュー (街灯・ベンチ)
  { name: 'b5_fence', at: [30992, -25801], look: [-1, 0.05], pitch: 0.1, dist: 12 },       // 外周の柵 (西の辺)
  { name: 'b6_guide', at: [31612, -26047], look: [-0.95, -0.3], pitch: 0.08, dist: 9 },    // 駅からゲートへの案内板
  { name: 'b7_beams', at: [31470, -25760], look: [0.6, 0.8], pitch: 0.3, dist: 90 },       // 塔の光線 (夜)
  // 段階 4: ショー・夜の光 (show = 時計を差し替える: { parade: 先頭の山車の道のり m } / { fw: 'burst:N' (N 発目の爆発の直後) | 'finale' | 'end' | 秒 } / { idle: true } = ショーの無い時刻)。--night と合わせて使う
  { name: 'n1_plaza_lights', at: [31440, -25700], look: [0.3, 1], pitch: 0.3, dist: 30, show: { idle: true } },     // プラザの光の輪・アベニューの縁 (夜)
  { name: 'n2_lake_jets', at: [31510, -25548], look: [0, 1], pitch: 0.12, dist: 40, show: { idle: true } },      // 湖の水上ショー (噴水の光の柱・しぶき・岸の光)
  { name: 'n3_avenue_night', at: [31352, -25896], look: [0.66, 0.76], pitch: 0.1, dist: 16, show: { idle: true } },
  { name: 'n4_lake_aerial', at: [31510, -25464], look: [0, 1], pitch: 1.1, dist: 480, show: { idle: true } },
  { name: 'f1_fw_north', at: [31510, -25640], look: [0, 1], pitch: 0.02, dist: 150, show: { fw: 'burst:8' } },   // 花火 (プラザの側から湖の上を見る)
  { name: 'f2_fw_finale', at: [31510, -25640], look: [0, 1], pitch: 0.02, dist: 150, show: { fw: 'finale' } },
  { name: 'f3_fw_south', at: [31510, -25379], look: [0, -1], pitch: 0.03, dist: 260, show: { fw: 'finale' } },
  { name: 'f4_fw_end', at: [31510, -25640], look: [0, 1], pitch: 0.02, dist: 150, show: { fw: 'end' } },
  { name: 'f5_fw_lake', at: [31510, -25548], look: [0, 1], pitch: 0.2, dist: 70, show: { fw: 'burst:20' } },         // 湖のきらめき (花火の光が水に映る)
  { name: 'q1_parade_avenue', at: [31440, -25794], look: [-0.66, -0.76], pitch: 0.12, dist: 10, show: { parade: 154 } },   // パレード (アベニューで山車が来る)
  { name: 'q2_parade_avenue2', at: [31440, -25794], look: [-0.66, -0.76], pitch: 0.1, dist: 10, show: { parade: 190 } },
  { name: 'q3_parade_plaza', at: [31490, -25672], look: [1, 0], pitch: 0.25, dist: 80, show: { parade: 300 } },        // プラザを半周する山車
  { name: 'q4_parade_aerial', at: [31490, -25672], look: [0, 1], pitch: 1.0, dist: 200, show: { parade: 300 } },
  { name: 'q5_parade_lake', at: [31510, -25560], look: [0, -1], pitch: 0.15, dist: 40, show: { parade: 560 } },
  { name: 'q6_float_close', at: [31440, -25794], look: [-0.66, -0.76], pitch: 0.2, dist: 8, show: { parade: 160 } },
  { name: 'q7_parade_gate', at: [31330, -25919], look: [0.5, 0.866], pitch: 0.2, dist: 16, show: { parade: 40 } },
  // 段階 5: 園内の人・観客・地図 (settle = 人が出て歩き出すまで待つコマ数。map = 大きい地図を開いて撮る { zoom })
  { name: 'x1_crowd_plaza', at: [31440, -25720], look: [0.3, 1], pitch: 0.2, dist: 18, settle: 12 },            // 昼のプラザ (歩く人・スマホを見る人)
  { name: 'x2_crowd_avenue', at: [31352, -25896], look: [0.66, 0.76], pitch: 0.12, dist: 14, settle: 12 },     // ネオン・アベニューの人
  { name: 'x3_crowd_aerial', at: [31490, -25672], look: [0, 1], pitch: 0.9, dist: 120, settle: 12 },            // プラザを上から (人の散らばり)
  { name: 'x4_viewers_parade', at: [31440, -25794], look: [-0.66, -0.76], pitch: 0.12, dist: 10, show: { parade: 154 }, settle: 14 },   // パレードを待つ観客 (アベニューの両側)
  { name: 'x5_viewers_aerial', at: [31440, -25794], look: [0.66, 0.76], pitch: 0.7, dist: 70, show: { parade: 154 }, settle: 14 },
  { name: 'x6_viewers_fw', at: [31510, -25548], look: [0, 1], pitch: 0.12, dist: 22, show: { fw: 'burst:20' }, settle: 14 },      // 花火を見る観客 (湖の北の岸。--night)
  { name: 'x7_viewers_before', at: [31440, -25794], look: [-0.66, -0.76], pitch: 0.12, dist: 10, show: { parade: -150 }, settle: 14 },   // パレードの 40 秒ほど前 (集まり始め)
  { name: 'm1_bigmap_park', at: [31490, -25672], look: [0, 1], pitch: 0.5, dist: 20, map: { zoom: 0.9 } },      // 大きい地図 (園全体)
  { name: 'm2_bigmap_plaza', at: [31490, -25672], look: [0, 1], pitch: 0.5, dist: 20, map: { zoom: 2.4 } },     // 大きい地図 (拡大。建物・道)
  { name: 'm3_bigmap_wide', at: [31490, -25672], look: [0, 1], pitch: 0.5, dist: 20, map: { zoom: 0.3 } },      // 大きい地図 (縮小。ゲートの印だけ)
  { name: 'm4_minimap_show', at: [31410, -25827], look: [0.66, 0.76], pitch: 0.2, dist: 14, show: { parade: -100 }, settle: 4 },   // ミニマップ (パレードの印が点滅 = 始まる 40 秒以内)
  // 段階 8: 強制遠近法 (アベニュー = 入口 (31330, -25919) からプラザ (31490, -25735) へ。向き (0.656, 0.755))
  { name: 'g1_av_long', at: [31340, -25905], look: [0.656, 0.755], pitch: 0.06, dist: 8 },       // 入口から奥を見る (通りが長く見えるか)
  { name: 'g2_av_back', at: [31480, -25746], look: [-0.656, -0.755], pitch: 0.06, dist: 8 },    // プラザの側から入口を見る
  { name: 'g3_av_side', at: [31365, -25789], look: [0.755, -0.656], pitch: 0.05, dist: 34 },     // 通りの横から (階の縮み・奥ほど低い)
  // 段階 9: 象徴の城 (リール・キャッスル。ムーンレイクの島。中心 (31510, -25464)、前 = ワールドの -z)
  { name: 'k1_castle_avenue', at: [31440, -25794], look: [0.2, 0.98], pitch: 0.06, dist: 12 },            // ネオン・アベニューの途中から城を遠くに
  { name: 'k2_castle_plaza', at: [31490, -25640], look: [0.1, 1], pitch: 0.1, dist: 24 },                 // プラザの北の縁から (湖越しに正面)
  { name: 'k3_castle_shore', at: [31510, -25550], look: [0, 1], pitch: 0.12, dist: 16 },                  // 湖の岸 (堤道の入口)
  { name: 'k4_castle_causeway', at: [31510, -25518], look: [0, 1], pitch: 0.18, dist: 12 },               // 堤道の途中から門を見上げる
  { name: 'k5_castle_tunnel', at: [31510, -25486], look: [0, 1], pitch: 0.08, dist: 7 },                  // 門塔のトンネルの中 (奥の中庭の方を見る)
  { name: 'k6_castle_bailey', at: [31510, -25474], look: [0, 1], pitch: 0.22, dist: 10 },                 // 門を抜けた中庭から主塔を見上げる
  { name: 'k7_castle_rear', at: [31510, -25392], look: [0, -1], pitch: 0.12, dist: 30 },                  // 城の裏 (北の岸) から
  { name: 'k8_castle_aerial', at: [31510, -25464], look: [0, 1], pitch: 1.05, dist: 260 },                // 上から (島と堤道)
  { name: 'k9_castle_side', at: [31310, -25470], look: [1, 0], pitch: 0.1, dist: 40 },                    // 湖の西の岸から横顔
  { name: 'k13_keep_hall', at: [31510, -25466], look: [0.3, -1], pitch: 0.25, dist: 7, dy: 0.4 },              // 主塔の大広間 (改善 1。扉から入った所)
  { name: 'k14_keep_up', at: [31510, -25466], look: [0.3, -1], pitch: -0.9, dist: 6, dy: 0.4 },              // 大広間を見上げる (階段・シャンデリア)
  { name: 'k15_keep_terrace', at: [31506, -25471], look: [0, -1], pitch: 0.2, dist: 8, dy: 22.7 },            // 屋上のテラス (正面側。プラザの方を見る = 扉の上)
  { name: 'k16_castle_reflect', at: [31345, -25500], look: [1, 0.2], pitch: 0.1, dist: 14 },                // 湖の西の岸から島の城の横顔 (水面への映り込み。改善 2)
  // 湖の縁 (石垣の土手・柵・外側に沿う散歩道)
  { name: 'w1_wall_west', at: [31318, -25470], look: [1, 0], pitch: 0.1, dist: 9 },                      // 西の岸の散歩道から土手と柵 (水際の石垣)
  { name: 'w2_wall_north_gap', at: [31545, -25541], look: [-0.7, 0.7], pitch: 0.18, dist: 20 },           // 北の堤道が岸を越える所 (土手の切れ目のふた)
  { name: 'w3_wall_aerial', at: [31420, -25520], look: [0.9, 0.4], pitch: 0.55, dist: 70 },              // 湖の北西の岸を上から (土手・散歩道・広場からの 2 本の道)
  { name: 't1_blossom', at: [31833, -25405], look: [0, -1], pitch: 0.1, dist: 10 }, { name: 't1b_blossom', at: [31833, -25445], look: [0, 1], pitch: 0.1, dist: 10 },                    // 桜の木 (葉の板の木。trees.js)
  { name: 't2_pine', at: [31060, -25930], look: [1, 0], pitch: 0.1, dist: 20 },                          // 松 (針葉樹)
  { name: 't3_round', at: [31270, -25830], look: [0, 1], pitch: 0.12, dist: 20 },                         // 丸い木
  { name: 'w4_wall_south', at: [31600, -25395], look: [0, -1], pitch: 0.12, dist: 16 },                   // 南の岸 (ハーバーの側) から湖を見る
  { name: 'k17_castle_reflect_n', at: [31345, -25500], look: [1, 0.2], pitch: 0.1, dist: 14, show: { idle: true } },   // 同じ場所の夜 (--night)
  { name: 'k18_castle_garden', at: [31476, -25548], look: [0, 1], pitch: 0.25, dist: 10 },      // 湖の南の岸から、島の前の芝の花壇・噴水 (改善 3)
  { name: 'k19_avenue_exit', at: [31470, -25756], look: [0.65, 0.76], pitch: 0.08, dist: 14 },      // ネオン・アベニューの出口 (広場の手前)。歩いて出てきた人の見え方 (改善 4)
  { name: 'k20_plaza_front', at: [31488, -25700], look: [0.15, 0.99], pitch: 0.1, dist: 14 },      // 広場に入ったところから城 (改善 4。前の門塔と主塔の見え方)
  { name: 'k10_castle_night', at: [31490, -25640], look: [0.1, 1], pitch: 0.1, dist: 24, show: { idle: true } },   // 夜 (--night)
  { name: 'k11_castle_show', at: [31490, -25640], look: [0.1, 1], pitch: 0.1, dist: 24, show: { castle: 30 } },    // 夜の映写のライトアップ (--night)
  { name: 'k12_castle_fw', at: [31490, -25640], look: [0.1, 1], pitch: 0.06, dist: 30, show: { fw: 'burst:20' } },  // 花火の夜 (--night)
  { name: 'a8_station_side', at: [31730, -25950], look: [-1, 0.2], pitch: 0.4, dist: 60 },      // 駅の南口のロータリー (敷地の縁。省いた所と残した所の境目)  // 段階 10: タイム・ステーション (ネオン・アベニューとロスト・バレーの間)
  { name: 't1_ts_aerial', at: [31560, -25830], look: [0, 1], pitch: 1.1, dist: 330 },            // 3 つのエリアの境目を上から (北が上)
  { name: 't2_ts_entrance', at: [31356, -25904], look: [0.989, 0.148], pitch: 0.12, dist: 14 },  // ネオン・アベニューの入口の側から、東の道 (門) へ
  { name: 't3_ts_street', at: [31452, -25896], look: [0.81, 0.585], pitch: 0.1, dist: 14 },      // 主な通りを奥 (駅舎) へ
  { name: 't4_ts_hall', at: [31596, -25796], look: [0.83, 0.56], pitch: 0.1, dist: 12 },          // 駅舎 (時計) と広場
  { name: 't5_ts_clockwork', at: [31604, -25792], look: [0.7, 0.71], pitch: 0.1, dist: 9 },       // 広場の大時計と歯車
  { name: 't6_ts_loco', at: [31598, -25849], look: [-0.58, 0.81], pitch: 0.1, dist: 12 },           // 蒸気機関車の展示
  { name: 't7_ts_to_lost', at: [31624, -25785], look: [0.63, -0.77], pitch: 0.12, dist: 14 },    // 広場からロストへの道 (門)
  { name: 't8_lost_side', at: [31690, -25840], look: [0.6, 0.8], pitch: 0.12, dist: 16 },        // ロストの側から見た境目
  { name: 't9_ts_neon_aerial', at: [31430, -25880], look: [0.8, 0.6], pitch: 0.55, dist: 120 },  // ネオンとの境目 (東の並びが切れる所)
  { name: 'en1_front', at: [31304, -25980], look: [0.500, 0.866], pitch: 0.12, dist: 26 },      // 入口: 前庭の入り口 (柵の隙間の近く) から、広間と大門
  { name: 'en2_front_close', at: [31307, -25959], look: [0.500, 0.866], pitch: 0.14, dist: 16 },      // 入口: 前庭の中ほどから、大門 (名前の板・冠)
  { name: 'en3_aerial', at: [31320, -25936], look: [0.500, 0.866], pitch: 0.95, dist: 170 },      // 入口: 入口を上から (前庭・広間・内庭)
  { name: 'en4_lanes', at: [31282, -25930], look: [0.500, 0.866], pitch: 0.12, dist: 12 },      // 入口: 右の改札の列 (屋根・番号・ガラスの仕切り) と切符売り場
  { name: 'en5_inner', at: [31340, -25902], look: [-0.500, -0.866], pitch: 0.10, dist: 16 },      // 入口: 内庭から広間の裏 (Welcome の板) と花の築山
  { name: 'en6_arch', at: [31315, -25945], look: [0.500, 0.866], pitch: 0.20, dist: 7 },      // 入口: 大門の開きの前 (歩いて入る人の目)
  { name: 'en7_tower', at: [31336, -25961], look: [0.500, 0.866], pitch: 0.20, dist: 14 },      // 入口: 左の塔と改札の屋根
  { name: 'en8_wall', at: [31263, -25938], look: [0.500, 0.866], pitch: 0.12, dist: 16 },      // 入口: 右の壁 (前庭を囲む) と切符売り場の列
  { name: 'en9_pylon', at: [31303, -25989], look: [0.500, 0.866], pitch: 0.10, dist: 14 },      // 入口: 柵の隙間の門柱
];

// 段階 2: 各エリアの視点を、設定 (public/data/park.json の gen) から作る。<n>_arch = 門の前から入る向き、<n>_aerial = 建物の中心を上から、<n>_street = 主な通りを歩く目の高さ
try {
  const park = JSON.parse(fs.readFileSync(process.env.PARK_JSON || path.join(PUBLIC, 'data', 'park.json')));   // PARK_JSON = 視点だけ別の設定から取る (修正前の作業コピーで撮るとき)
  if (park.gen) {
    const ROM = ['midnight', 'town', 'avenue', 'valley', 'sweet', 'forest', 'harbor', 'station'];
    park.gen.areas.forEach((a, i) => {
      const nm = 'c' + i + '_' + (a.kind || ROM[i]);
      const bs = park.gen.buildings.filter((b) => b.a === i);
      const arch = park.gen.arches.find((q) => q.a === i);
      if (arch) VIEWS.push({ name: nm + '_arch', at: [arch.x - Math.sin(arch.yaw) * 14, arch.z - Math.cos(arch.yaw) * 14], look: [Math.sin(arch.yaw), Math.cos(arch.yaw)], pitch: 0.12, dist: 14 });
      if (bs.length) {
        const cx = bs.reduce((s, b) => s + b.x, 0) / bs.length, cz = bs.reduce((s, b) => s + b.z, 0) / bs.length;
        VIEWS.push({ name: nm + '_aerial', at: [cx, cz], look: [0, 1], pitch: 0.95, dist: 170 });
      }
      if (a.detail) {   // 段階 7: 建物の細部があるエリア。店先・上の階・横を、建物 4 棟ぶん
        const dbs = bs.filter((b) => b.det);
        [3, 8, 14, 19].forEach((k, n) => {   // 名前は d<エリアの番号>_<n>_front・_upper・_shop・_side
          const b = dbs[Math.min(k, dbs.length - 1)]; if (!b) return;
          const ux = Math.sin(b.yaw), uz = Math.cos(b.yaw), r = b.d / 2 + 6;
          VIEWS.push({ name: 'd' + i + '_' + n + '_front', at: [b.x + ux * r, b.z + uz * r], look: [-ux, -uz], pitch: 0.1, dist: 9 });
          VIEWS.push({ name: 'd' + i + '_' + n + '_upper', at: [b.x + ux * (r + 4), b.z + uz * (r + 4)], look: [-ux, -uz], pitch: 0.28, dist: 13 });
          VIEWS.push({ name: 'd' + i + '_' + n + '_shop', at: [b.x + ux * (b.d / 2 + 3), b.z + uz * (b.d / 2 + 3)], look: [-ux, -uz], pitch: 0.06, dist: 4.5 });
          VIEWS.push({ name: 'd' + i + '_' + n + '_side', at: [b.x + ux * r - uz * 9, b.z + uz * r + ux * 9], look: [-ux * 0.6 + uz * 0.8, -uz * 0.6 - ux * 0.8], pitch: 0.12, dist: 12 });
        });
      }
      const mp = park.gen.paths.find((p2) => p2.a === i);
      if (mp) { const q = mp.pts[Math.floor(mp.pts.length / 2)], r = mp.pts[Math.floor(mp.pts.length / 2) + 1] || mp.pts[0]; const d = Math.hypot(r[0] - q[0], r[1] - q[1]) || 1; VIEWS.push({ name: nm + '_street', at: [q[0], q[1]], look: [(r[0] - q[0]) / d, (r[1] - q[1]) / d], pitch: 0.1, dist: 10 }); }
    });
    // 段階 7: 通りの小物 (屋台のワゴン・案内標識・ごみ箱)。種類ごとに最初の 3 つ (f_<種類>_<n>)。ちょうちんは旗の綱 (b4_avenue・c1_town_street で見える)
    {
      const seen = {};
      for (const [kind, fx, fz, fyaw, fa] of park.gen.furn || []) {
        const n = seen[kind + fa] = (seen[kind + fa] || 0) + 1; if (n > 1) continue;
        const ck = Math.cos(fyaw), sk = Math.sin(fyaw), kn = park.gen.areas[fa].kind;
        VIEWS.push({ name: 'f_' + kind + '_' + kn, at: [fx + sk * 5, fz + ck * 5], look: [-sk, -ck], pitch: 0.12, dist: kind === 'wagon' ? 6 : 5 });   // 前 (局所 +Z) から見る
      }
    }
    // 段階 3: 乗り物 (観覧車 = のりばの側から・近くから、メリーゴーラウンド = 近く・上から、コースター = 上から・のりばの近く)
    const rd = park.gen.rides || {}, W = (o, lx, lz) => [o.x + lx * Math.cos(o.yaw) + lz * Math.sin(o.yaw), o.z - lx * Math.sin(o.yaw) + lz * Math.cos(o.yaw)];
    if (rd.ferris) {
      const f = rd.ferris, fl = [-Math.sin(f.yaw), -Math.cos(f.yaw)];
      VIEWS.push({ name: 'r1_ferris', at: W(f, 0, 14), look: fl, pitch: 0.2, dist: 55 });
      VIEWS.push({ name: 'r2_ferris_close', at: W(f, 0, 5), look: fl, pitch: 0.1, dist: 14 });
      VIEWS.push({ name: 'r3_ferris_side', at: W(f, 22, 0), look: [-Math.cos(f.yaw), Math.sin(f.yaw)], pitch: 0.12, dist: 50 });
    }
    if (rd.ferris) {   // 観覧車に乗った視点 (外から・ゴンドラの中から。時計を差し替えて、ゴンドラ 0 が底に来た時刻から 50 秒)
      const f = rd.ferris;
      VIEWS.push({ name: 'r9_ride_out', at: W(f, 0, 4.2), look: [-Math.sin(f.yaw), -Math.cos(f.yaw)], pitch: 0.18, dist: 13, board: { sec: 50, view: 'out', yawAdd: 0.7 } });
      VIEWS.push({ name: 'r10_ride_in', at: W(f, 0, 4.2), look: [-Math.sin(f.yaw), -Math.cos(f.yaw)], pitch: 0.18, dist: 13, board: { sec: 50, view: 'in', yawAdd: 0.5 } });
    }
    if (rd.carousel) {
      const c = rd.carousel;
      for (const [k, a] of [['e', 1.57], ['w', -1.57], ['n', 3.14]]) VIEWS.push({ name: 'r4_carousel_' + k, at: [c.x + Math.sin(c.yaw + a) * 11, c.z + Math.cos(c.yaw + a) * 11], look: [-Math.sin(c.yaw + a), -Math.cos(c.yaw + a)], pitch: 0.3, dist: 16 });
      VIEWS.push({ name: 'r4_carousel', at: W(c, 0, 11), look: [-Math.sin(c.yaw), -Math.cos(c.yaw)], pitch: 0.15, dist: 16 });
      VIEWS.push({ name: 'r5_carousel_aerial', at: [c.x, c.z], look: [0, 1], pitch: 1.0, dist: 40 });
    }
    for (const pr of park.gen.props) VIEWS.push({ name: 'p_' + pr.k + '_' + pr.a, at: [pr.x - Math.sin(pr.yaw || 0) * 0, pr.z], look: [0.3, 1], pitch: 0.2, dist: Math.max(30, pr.r * 3.5) });
  }
} catch (e) { /* 設定が無ければ段階 1 の視点だけ */ }

(async () => {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); return i < 0 ? null : (args.splice(i, 2)[1] || true); };
  const night = args.includes('--night'); if (night) args.splice(args.indexOf('--night'), 1);
  const dusk = args.includes('--dusk'); if (dusk) args.splice(args.indexOf('--dusk'), 1);
  const morning = args.includes('--morning'); if (morning) args.splice(args.indexOf('--morning'), 1);
  const touch = args.includes('--touch'); if (touch) args.splice(args.indexOf('--touch'), 1);   // スマホの設定 (?touch。壁の柄なし・小物をまとめる・人を減らす)
  const nopark = args.includes('--nopark'); if (nopark) args.splice(args.indexOf('--nopark'), 1);
  const simple = args.includes('--simpletrees'); if (simple) args.splice(args.indexOf('--simpletrees'), 1);   // 木を以前の簡単な形に (?simpletrees)
  const noreflect = args.includes('--noreflect'); if (noreflect) args.splice(args.indexOf('--noreflect'), 1);   // 城の水面への映り込みを出さない (改善 2 の修正前。?noreflect)
  const noentrance = args.includes('--noentrance'); if (noentrance) args.splice(args.indexOf('--noentrance'), 1);   // 入口を以前の看板だけの門に (入口の作り込みの修正前。?noentrance)
  const nocastle = args.includes('--nocastle'); if (nocastle) args.splice(args.indexOf('--nocastle'), 1);   // 城だけ出さない (段階 9 の修正前の見た目。?nocastle)
  const only = flag('--only');
  const [out] = args;
  if (!out) { console.error('usage: node tools/dev/parkshot.js <出力フォルダ> [--nopark] [--only 名前,..] [--night|--dusk|--morning] [--touch]'); process.exit(1); }
  fs.mkdirSync(out, { recursive: true });
  const server = http.createServer((req, res) => {
    const p = path.join(PUBLIC, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
    if (!p.startsWith(PUBLIC) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.setDefaultTimeout(300000);
  await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', r =>
    r.fulfill({ path: path.join(THREE_DIR, r.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.170.0/', '')), contentType: 'application/javascript' }));
  await page.route('**/src/main.js', async r => {
    const t = (await (await r.fetch()).text()).replace('const qs = new URLSearchParams', 'window.__g = { player, cam, scene, world, camera };\n  const qs = new URLSearchParams');
    r.fulfill({ body: t, contentType: 'application/javascript' });
  });
  page.on('pageerror', e => console.log('ERR', e.message));
  page.on('console', m => { if (/rror/.test(m.text())) console.log('LOG', m.text()); });
  await page.goto(base + '/?shot&novrm' + (night ? '&t=2' : dusk ? '&t=1' : morning ? '&t=3' : '') + (touch ? '&touch' : '') + (nopark ? '&nopark' : '') + (nocastle ? '&nocastle' : '') + (noentrance ? '&noentrance' : '') + (noreflect ? '&noreflect' : '') + (simple ? '&simpletrees' : ''), { timeout: 300000 });
  await page.waitForFunction(() => window.__g && window.__ride, null, { timeout: 300000 });
  await page.addStyleTag({ content: '#help{display:none!important}' });
  await page.evaluate(() => { window.__trains.hold = Date.now() / 1000; });
  const frames = (n) => page.evaluate((n) => new Promise((r) => { let k = 0; const fn = () => (++k >= n ? r() : requestAnimationFrame(fn)); requestAnimationFrame(fn); }), n);
  const extIdle = async () => { for (let k = 0; k < 200; k++) { await frames(2); if (await page.evaluate(() => !window.__railext || window.__railext.stats.idle)) return; } console.log('区間の読み込みが終わらない'); };
  const probe = args.includes('--probe'); if (probe) args.splice(args.indexOf('--probe'), 1);
  let probed = false;
  for (const v of VIEWS) {
    if (only && !only.split(',').includes(v.name)) continue;
    if (v.probe && !probe) continue;
    if (!v.probe && probe && !only) continue;
    const [x, z] = v.at, face = Math.atan2(v.look[0], v.look[1]);
    // 区間 (地形) が読み込まれるまで、いったん駅の前に置く → 地面の高さを聞いて立つ
    await page.evaluate(([x, z, face]) => window.__ride.place(x, -11, z, face), [x, z, face]);
    await frames(3); await extIdle();
    const gy = await page.evaluate(async ([x, z]) => (await import('/src/terrain.js')).H(x, z), [x, z]);
    await page.evaluate(([x, y, z, face, v]) => { window.__ride.place(x, y + (v.dy || 0), z, face); const c = window.__g.cam; c.yaw = face + Math.PI; c.pitch = v.pitch; c.dist = v.dist; }, [x, gy + 0.1, z, face, v]);
    if (v.probe && !probed) {   // 箱を並べる (左端 = 元の材質のまま、あとは matId 0〜5 = 吹き付け・サイディング・タイル・打ち放し・角波・ALC)
      probed = true;
      await page.evaluate(async () => {
        const THREE = await import('three'), T = await import('/src/terrain.js'), X = await import('/src/detail/textures.js');
        const patch = await X.makeWallPatcher(31330, -25919, 2000);
        const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d');   // railext.js の窓の絵と同じ
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#5d6670'; g.fillRect(14, 16, 36, 26); g.fillStyle = '#d8d8d4'; g.fillRect(0, 56, 64, 8);
        const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        const grp = new THREE.Group(); grp.name = 'probe_walls';
        for (let i = 0; i < 7; i++) {
          const w = 12, h = 14, x = 31200 + i * 18, z = -25860, y = T.H(x, z);
          const geo = new THREE.BoxGeometry(w, h, w);
          const uv = geo.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 4, uv.getY(k) * 4.67);   // 3 m に窓 1 つ
          geo.setAttribute('matId', new THREE.Uint8BufferAttribute(new Uint8Array(geo.attributes.position.count).fill(Math.max(0, i - 1)), 1));
          const mat = new THREE.MeshStandardMaterial({ map: tex, color: '#d9cdb8', roughness: 0.85 });
          if (i > 0) patch(mat, 'probe');
          const m = new THREE.Mesh(geo, mat); m.position.set(x, y + h / 2, z); m.castShadow = m.receiveShadow = true; grp.add(m);
        }
        const sc = window.__g.scene; sc.add(grp);
      });
    }
    if (v.board) {   // 観覧車に乗る (時計を差し替える。撮ったあとで戻す)
      await page.evaluate((b) => {
        const pr = window.__pride, fw = pr.ferris, rev = fw.cfg.rev; window.__realNow = Date.now.bind(Date);
        let now = Math.ceil(window.__realNow() / 1000 / rev) * rev; Date.now = () => now * 1000;
        const K = (d) => ({ pressed: (k) => d.includes(k) });
        window.__ride.place(fw.spot.x, fw.spot.y, fw.spot.z, 0); window.__g.player.pos.y = fw.spot.y + 0.05;
        pr.update(1 / 30, K(['KeyF']));
        for (let t = 0; t < b.sec * 30; t++) { now += 1 / 30; pr.update(1 / 30, K([])); if (pr.riding) pr.view(1 / 30); }
        if (b.view === 'in') pr.update(1 / 30, K(['KeyQ']));
        const c = window.__g.cam; c.yaw = fw.cfg.yaw + (b.view === 'in' ? Math.PI : 0) + b.yawAdd; c.pitch = b.view === 'in' ? 0.05 : 0.2;
        pr.view(1 / 30);
      }, v.board);
    }
    if (v.show) {   // ショーの時計を差し替える (その時刻のまま止める)
      await page.evaluate((sh) => {
        const S = window.__pride.park.show, cfg = window.__pride.park.cfg?.show; if (!cfg) return;   // ショーの無い版 (修正前) は時計を替えない
        const F = cfg.fireworks, RISE = 1.8;
        let phase = 100;   // ショーの無い時刻 (パレード 20 秒〜のあと、花火の前)
        if (sh.parade !== undefined) phase = cfg.parade.start + sh.parade / cfg.parade.speed;
        else if (sh.castle !== undefined) phase = window.__pride.park.cfg.castle.show.start + sh.castle;
        else if (sh.fw !== undefined) {
          if (typeof sh.fw === 'number') phase = F.start + sh.fw;
          else if (sh.fw.startsWith('burst:')) phase = F.start + S.plan[+sh.fw.slice(6)].t + RISE + 1.0;
          else if (sh.fw === 'finale') { let best = 0, bt = 0; for (let t = F.duration * 0.74; t < F.duration; t += 0.2) { let n = 0; for (const b of S.plan) if (t >= b.t + RISE && t < b.t + RISE + 3.5) n++; if (n > best) { best = n; bt = t; } } phase = F.start + bt; }
          else if (sh.fw === 'end') phase = F.start + F.duration - 8 + RISE + 1.6;
        }
        window.__showClock = () => 600 * 1000 + phase;
      }, v.show);
    } else await page.evaluate(() => { window.__showClock = () => 600 * 1000 + 100; });
    await frames(v.settle || 3); await page.waitForTimeout(2000);
    if (v.map) { await page.evaluate((m) => { const b = window.__bigmap; b.show(window.__g.player.pos.x, window.__g.player.pos.z); b.scale = m.zoom; }, v.map); await frames(3); }
    await page.screenshot({ path: path.join(out, v.name + '.png'), timeout: 300000 });
    if (v.board) await page.evaluate(() => { window.__pride.cancel(); Date.now = window.__realNow; });
    if (v.map) await page.evaluate(() => window.__bigmap.hide());
    console.log('shot', v.name, 'ground', gy.toFixed(2));
  }
  await browser.close();
  server.close();
})();
