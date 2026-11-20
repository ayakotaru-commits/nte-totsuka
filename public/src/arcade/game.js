// リズムゲーム (ゲームセンターのイベント) の判定と点数。画面・音・時計に依存しない (node でも動く)。
// 時刻はすべて「曲の頭からの秒」(chartT)。入力は press / release / swipe に時刻を渡す。
//
// ノーツ: tap (押す) / flick (押して上へはじく) / hold (押し続ける。end で離す)
// 判定 (ずれの大きさ ±秒): perfect 0.045 / great 0.09 / good 0.135 / bad 0.18。それより外れる (遅い) とミス。早すぎる押しは無視。
// コンボ: perfect・great・good でつながり、bad・ミス・長押しの離しすぎで 0 に戻る。
// 点: perfect 1 / great 0.8 / good 0.5 / bad 0.2 / miss 0 の平均 × 100000。S 92000〜 / A 80000〜 / B 60000〜 / C。
// 長押しは 1 つのノーツ: 押した瞬間の判定がそのノーツの判定になり、最後まで押し続けるとその判定のまま、早く離すとミス (点は 0.3 倍)。
// フリック: キーボードは押すだけでよい。画面を指で触る人 (needSwipe) は、押してから上へ FLICK_PX 以上はじく。
//   はじかずに離す・0.3 秒待つと good まで (perfect・great は good になる)。

export const WIN = { perfect: 0.045, great: 0.09, good: 0.135, bad: 0.18 };
export const WEIGHT = { perfect: 1, great: 0.8, good: 0.5, bad: 0.2, miss: 0 };
export const GRADES = ['perfect', 'great', 'good', 'bad', 'miss'];
export const FLICK_PX = 26;
const TAIL_SLACK = 0.15;      // 長押しの終わりの、これより前に離したら失敗
const SWIPE_WAIT = 0.3;       // フリックのはじきを待つ長さ
const HOLD_FAIL_W = 0.3;

export function gradeOf(ad) {
  return ad <= WIN.perfect ? 'perfect' : ad <= WIN.great ? 'great' : ad <= WIN.good ? 'good' : 'bad';
}
export function rankOf(score) { return score >= 92000 ? 'S' : score >= 80000 ? 'A' : score >= 60000 ? 'B' : 'C'; }

export class Game {
  constructor(notes, lanes = 6) {
    this.lanes = lanes;
    this.notes = notes.map((n, i) => ({
      i, t: n.t, lane: n.lane, type: n.type, end: n.type === 'hold' ? n.end : n.t, flickEnd: !!n.flickEnd,
      state: 'wait', grade: null, d: 0, head: null,
    })).sort((a, b) => a.t - b.t || a.lane - b.lane);
    this.byLane = Array.from({ length: lanes }, () => []);
    for (const n of this.notes) this.byLane[n.lane].push(n);
    this.ptr = new Array(lanes).fill(0);          // 各レーンで、まだ終わっていない先頭のノーツ
    this.holding = new Array(lanes).fill(null);   // 押し続けている長押し
    this.pend = new Array(lanes).fill(null);      // はじきを待っているフリック
    this.events = [];
    this.combo = 0; this.maxCombo = 0;
    this.counts = { perfect: 0, great: 0, good: 0, bad: 0, miss: 0 };
    this.fast = 0; this.late = 0;
    this.sum = 0; this.done = 0;
    this.stray = 0;                                // どのノーツにも当たらなかった押し
  }

  emit(e) { this.events.push(e); if (this.onEvent) this.onEvent(e); }   // onEvent: 効果音など、すぐ反応したいもの用

  get total() { return this.notes.length; }
  get score() { return Math.round(100000 * this.sum / Math.max(1, this.total)); }
  get finished() { return this.done >= this.total; }
  drain() { const e = this.events; this.events = []; return e; }

  // レーンの先頭を進める (終わったノーツを飛ばす)
  head(lane) {
    const arr = this.byLane[lane];
    while (this.ptr[lane] < arr.length && arr[this.ptr[lane]].state === 'done') this.ptr[lane]++;
    return arr[this.ptr[lane]] || null;
  }

  // 1 つのノーツの結果を確定する
  settle(n, grade, d, weight = WEIGHT[grade]) {
    n.state = 'done'; n.grade = grade; n.d = d;
    this.counts[grade]++; this.done++;
    this.sum += weight;
    if (grade !== 'perfect' && grade !== 'miss' && n.head !== 'miss') { if (d < 0) this.fast++; else this.late++; }
  }
  bump(grade) {   // コンボ
    if (grade === 'bad' || grade === 'miss') this.combo = 0; else { this.combo++; this.maxCombo = Math.max(this.maxCombo, this.combo); }
  }

  // 押した (lane, 時刻 t, needSwipe = 指で触る入力)。戻り値: 当たったノーツ (無ければ null)
  press(lane, t, needSwipe = false) {
    const n = this.head(lane);
    if (!n || n.state !== 'wait') { this.stray++; return null; }
    const d = t - n.t, ad = Math.abs(d);
    if (d < -WIN.bad) return null;                                   // 早すぎる押しは無視
    if (d > WIN.bad) return null;                                    // (遅いものは update がミスにする)
    const grade = gradeOf(ad);
    if (n.type === 'flick' && needSwipe) {                           // はじきを待つ
      n.state = 'pend'; n.pt = t; n.pd = d; n.pg = grade;
      this.pend[lane] = n;
      this.emit({ type: 'pending', lane, note: n, t });
      return n;
    }
    this.hit(n, grade, d, t);
    return n;
  }
  hit(n, grade, d, t) {
    if (n.type === 'hold') {
      n.state = 'hold'; n.head = grade; n.d = d; n.grade = grade;
      this.holding[n.lane] = n;
      this.bump(grade);
      this.emit({ type: 'hit', lane: n.lane, grade, d, note: n, t, hold: true });
      this.emit({ type: 'holdOn', lane: n.lane, note: n, t });
      return;
    }
    this.settle(n, grade, d);
    this.bump(grade);
    this.emit({ type: 'hit', lane: n.lane, grade, d, note: n, t, flick: n.type === 'flick' });
  }

  // 上へはじいた (レーン、時刻)。はじきを待っているフリックを確定する
  swipe(lane, t) {
    const n = this.pend[lane];
    if (!n) return false;
    this.pend[lane] = null;
    this.hit(n, n.pg, n.pd, n.pt);
    return true;
  }
  // はじかなかった: good まで
  giveUp(lane, t) {
    const n = this.pend[lane];
    if (!n) return;
    this.pend[lane] = null;
    const g = n.pg === 'perfect' || n.pg === 'great' ? 'good' : n.pg;
    this.hit(n, g, n.pd, n.pt);
  }

  // 離した
  release(lane, t) {
    if (this.pend[lane]) this.giveUp(lane, t);
    const n = this.holding[lane];
    if (!n) return;
    this.holding[lane] = null;
    if (t >= n.end - TAIL_SLACK) this.finishHold(n, true, t);
    else this.finishHold(n, false, t);
  }
  finishHold(n, ok, t) {
    if (ok) {
      this.settle(n, n.head, n.d);
      this.emit({ type: 'holdEnd', lane: n.lane, note: n, t, ok: true });
    } else {
      const head = n.head;
      n.head = 'miss';
      this.settle(n, 'miss', n.d, HOLD_FAIL_W * WEIGHT[head]);
      this.combo = 0;
      this.emit({ type: 'holdEnd', lane: n.lane, note: n, t, ok: false });
    }
  }

  // 時間を進める: 遅れたノーツをミスにし、長押しの終わりを迎える。held[lane] = 今そのレーンを押しているか
  update(t, held = null) {
    for (let l = 0; l < this.lanes; l++) {
      const p = this.pend[l];
      if (p && t - p.pt > SWIPE_WAIT) this.giveUp(l, t);
      // 長押しが終わりの時刻に届いた
      const h = this.holding[l];
      if (h && t >= h.end) {
        if (!held || held[l] !== false) { this.holding[l] = null; this.finishHold(h, true, t); }
        else { this.holding[l] = null; this.finishHold(h, false, t); }
      }
      // 遅れたノーツ
      for (let k = this.ptr[l]; k < this.byLane[l].length; k++) {
        const n = this.byLane[l][k];
        if (n.state === 'done') continue;
        if (n.state !== 'wait') break;                               // 長押し・はじき待ちの最中
        if (t > n.t + WIN.bad) {
          this.settle(n, 'miss', 0);
          n.head = 'miss';
          this.combo = 0;
          this.emit({ type: 'miss', lane: l, note: n, t });
        } else break;
      }
    }
  }

  summary() {
    const s = this.score, c = this.counts;
    return {
      score: s, rank: rankOf(s), counts: { ...c }, maxCombo: this.maxCombo, total: this.total,
      fast: this.fast, late: this.late,
      allPerfect: c.perfect === this.total, fullCombo: c.bad === 0 && c.miss === 0,
      accuracy: this.total ? this.sum / this.total : 0,
    };
  }
}
