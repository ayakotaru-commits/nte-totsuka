// 街並みディテール (お試し)。スタート地点の周辺だけに適用する。
// 段階ごとに false にすれば、その段階だけ無効にできる。
// 完全に戻す: public/src/detail/ と public/assets/detail/ を削除し、main.js の「detail」と書かれた行を消す (props.json は木が使うので残す)。
export const DETAIL = {
  radius: 3000,     // スタート地点からの半径 (m)。3000 = マップ全体。小物・外構の範囲は tools/build_props.py の RADIUS
  props: true,      // 1. 電柱・電線・横断歩道・止まれ・ガードパイプ・自販機・カーブミラー
  textures: true,   // 2. 素材テクスチャ (CC0)
  shapes: true,     // 3. 建物の飾り (ベランダ・店の看板) と敷地の外構
};
