// マルチプレイのサーバーの場所。空のままなら、マルチプレイは働かない (1 人用のまま)。
// Cloudflare に公開したら (server/README.md)、その URL を wss:// で書く。
//   例: export const SERVER = 'wss://totsuka-mp.<アカウント名>.workers.dev';
// 試すときは URL に ?mp=ws://localhost:8787 のように付けても指定できる (?mp=0 で無効)。
export const SERVER = '';

export const PUBLIC_ROOMS = 8; // だれでも入れる部屋の数 (pub1〜)。満員なら次の部屋へ
