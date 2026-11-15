// マルチプレイ (同じ街に、ほかの人が見える・戦える)。main.js からは startMultiplayer() と、返り値の update() だけを使う。
//   開いた直後は 1 人用。「みんなと遊ぶ」(O キー) を押したときだけ部屋に入り、「1 人に戻る」で抜ける。
//   サーバーの場所は config.js。空なら何もしない (null を返す)。
//   戦闘は「オン」にした人同士だけ当たる (B キー / 画面の「戦闘」)。当たったかどうか・体力はサーバーが決める。
//   URL: ?mp=ws://… サーバーを指定 / ?mp=0 無効 / ?room=名前 合言葉の部屋 (同じ名前の人だけが集まる) / ?join 開いてすぐ部屋に入る (確認用)
import { SERVER } from './config.js';
import { Net } from './net.js';
import { Remotes, Sparks } from './remote.js';

const $ = (id) => document.getElementById(id);

export function startMultiplayer({ scene, player, respawn }) {
  const Q = new URLSearchParams(location.search);
  const base = Q.has('mp') ? Q.get('mp') : (Q.has('shot') ? '' : SERVER);
  if (!base || base === '0' || !/^wss?:\/\//.test(base)) return null;
  const room = (Q.get('room') || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || null;

  const remotes = new Remotes(scene), sparks = new Sparks(scene);
  const me = { id: 0, name: '', pvp: false, hp: 100, hpMax: 100, k: 0, d: 0, downAt: 0 };
  const ui = { join: $('mp-join'), leave: $('mp-leave'), head: $('mp-head'), box: $('mp'), count: $('mp-count'), pvp: $('mp-pvp'), hp: $('mp-hp'), feed: $('mp-feed'), list: $('mp-list'), hurt: $('mp-hurt'), down: $('mp-down') };
  ui.box.hidden = false;
  if ($('help-mp')) $('help-mp').hidden = false;
  let status = 'idle', listOpen = false; // idle = 1 人用 (部屋に入っていない)
  const nowS = () => performance.now() / 1000;
  const nameOf = (id) => id === me.id ? me.name + '（あなた）' : remotes.map.get(id)?.name || '？';

  const say = (text) => {
    const el = document.createElement('div');
    el.textContent = text; ui.feed.appendChild(el);
    while (ui.feed.children.length > 4) ui.feed.firstChild.remove();
    setTimeout(() => el.classList.add('out'), 5000); setTimeout(() => el.remove(), 6000);
  };
  const draw = () => {
    const joined = status !== 'idle';
    ui.join.hidden = joined; ui.head.hidden = !joined;
    ui.feed.hidden = !joined;
    ui.count.textContent = status === 'on' ? `オンライン ${remotes.map.size + 1} 人` : status === 'full' ? '満員です（少し後に再接続）' : '接続中…';
    ui.pvp.textContent = me.pvp ? '戦闘 ON' : '戦闘 OFF';
    ui.pvp.classList.toggle('on', me.pvp);
    ui.pvp.disabled = status !== 'on';
    ui.hp.hidden = !me.pvp || status !== 'on';
    ui.hp.firstChild.style.width = Math.max(0, me.hp / me.hpMax * 100) + '%';
    ui.list.hidden = !listOpen || status !== 'on';
    if (!ui.list.hidden) {
      const rows = [{ ...me, name: me.name + '（あなた）' }, ...remotes.map.values()].sort((a, b) => b.k - a.k || a.id - b.id);
      ui.list.replaceChildren(...rows.map((r) => {
        const el = document.createElement('div');
        el.className = r.pvp ? 'pvp' : '';
        el.textContent = `${r.name}　撃破 ${r.k}`;
        return el;
      }));
    }
  };
  const setHp = (id, hp) => {
    if (id === me.id) me.hp = hp;
    else { const r = remotes.map.get(id); if (r) { r.hp = hp; remotes.style(r); } }
  };

  const net = new Net(base, room, {
    status: (s) => { if (s !== 'on' && status !== 'idle') { status = s === 'full' ? 'full' : 'connecting'; remotes.clear(); if (player.dead) { player.revive(); ui.down.hidden = true; } draw(); } },
    hi: (m) => {
      status = 'on';
      Object.assign(me, { id: m.id, name: m.name, hpMax: m.hpMax, hp: m.hpMax, pvp: false, k: 0, d: 0 });
      remotes.hpMax = m.hpMax; remotes.clear();
      for (const p of m.players) remotes.add(p, nowS());
      say(`あなたの名前: ${m.name}`);
      draw();
    },
    join: (m) => { remotes.add(m, nowS()); say(`${m.name} が来た`); draw(); },
    bye: (m) => { const r = remotes.map.get(m.id); if (r) say(`${r.name} が去った`); remotes.remove(m.id); draw(); },
    w: (m) => { const t = nowS(); for (const s of m.s) if (s[0] !== me.id) remotes.push(s[0], s.slice(1), t); },
    pvp: (m) => {
      if (m.id === me.id) { me.pvp = m.on; me.hp = m.hp; }
      else { const r = remotes.map.get(m.id); if (r) { r.pvp = m.on; r.hp = m.hp; remotes.style(r); } }
      draw();
    },
    no: () => say('戦った直後は、戦闘をオフにできません'),
    hp: (m) => { setHp(m.id, m.hp); draw(); },
    hit: (m) => {
      setHp(m.b, m.hp);
      if (m.b === me.id) {
        sparks.burst(player.pos.x, player.pos.y, player.pos.z, m.step >= 4);
        player.hurt(m.dx, m.dz, m.step);
        ui.hurt.classList.remove('on'); void ui.hurt.offsetWidth; ui.hurt.classList.add('on');
      } else {
        const r = remotes.map.get(m.b);
        if (r && r.shown) sparks.burst(r.x, r.y, r.z, m.step >= 4);
      }
      draw();
    },
    ko: (m) => {
      say(`${nameOf(m.a)} が ${nameOf(m.b)} を倒した`);
      for (const [id, key] of [[m.a, 'k'], [m.b, 'd']]) { if (id === me.id) me[key]++; else { const r = remotes.map.get(id); if (r) r[key]++; } }
      if (m.b === me.id) { player.down(); me.downAt = nowS(); ui.down.hidden = false; }
      draw();
    },
    re: (m) => {
      setHp(m.id, me.hpMax);
      if (m.id === me.id) { player.revive(); respawn(); ui.down.hidden = true; }
      draw();
    },
  });

  // 部屋に入る・抜ける
  const join = () => { if (status !== 'idle') return; status = 'connecting'; net.start(); draw(); };
  const leave = () => {
    if (status === 'idle') return;
    net.stop(); status = 'idle';
    remotes.clear();
    Object.assign(me, { id: 0, pvp: false, hp: me.hpMax, k: 0, d: 0 });
    if (player.dead) { player.revive(); respawn(); }
    ui.down.hidden = true; listOpen = false;
    ui.feed.replaceChildren();
    draw();
  };
  const toggleJoin = () => (status === 'idle' ? join() : leave());
  for (const [el, fn] of [[ui.join, join], [ui.leave, leave]]) el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
  const togglePvp = () => { if (status === 'on' && !player.dead) net.send({ t: 'pvp', on: !me.pvp }); };
  ui.pvp.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); togglePvp(); });
  ui.count.addEventListener('pointerdown', (e) => { e.stopPropagation(); listOpen = !listOpen; draw(); });
  draw();
  if (Q.has('join')) join();

  return {
    me, remotes, net, togglePvp, join, leave, get joined() { return status !== 'idle'; },
    // 毎フレーム (地図を開いている間も) 呼ぶ
    update(dt, input) {
      if (input.pressed('KeyO')) toggleJoin();
      if (status === 'idle') return;
      if (input.pressed('KeyB')) togglePvp();
      if (input.pressed('KeyL')) { listOpen = !listOpen; draw(); }
      const now = performance.now();
      net.sendState(player.netState(), now);
      remotes.update(dt, now / 1000, player.pos.x, player.pos.z);
      sparks.update(dt);
      if (player.dead) ui.down.lastChild.textContent = Math.max(0, Math.ceil(3 - (now / 1000 - me.downAt)));
    },
    // ミニマップ用: 近くに見えている人の位置
    dots() { if (status === 'idle') return null; const out = []; for (const r of remotes.map.values()) if (r.buf.length) out.push(r); return out; },
  };
}
