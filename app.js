// Count With Me — everything is drawn on one <canvas> so even 10,000 items stay smooth.

const MAX = 10000;
const MAX_SIZE = () => (innerWidth <= 600 ? 34 : 46);   // items never get bigger than this
const PAD = 12;                                           // space around the board edge
const MOVE_MS = 700;                                      // slide time when rearranging
const POP_MS = 300;                                       // pop-in time for each new item
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const ITEMS = [
  { label: "Puppies", one: "puppy", emoji: "🐶" },
  { label: "Circles", one: "circle", dot: true },
  { label: "Beach balls", one: "beach ball", beach: true },
  { label: "Snowflakes", one: "snowflake", emoji: "❄️" },
  { label: "Stars", one: "star", emoji: "⭐" },
  { label: "Apples", one: "apple", emoji: "🍎" },
  { label: "Butterflies", one: "butterfly", emoji: "🦋" },
  { label: "Kittens", one: "kitten", emoji: "🐱" },
  { label: "Fish", one: "fish", emoji: "🐠" },
  { label: "Hearts", one: "heart", emoji: "💖" },
];
// Group size -> [columns, rows] of each group's box
const GROUPS = { 2: [2, 1], 3: [3, 1], 4: [2, 2], 5: [5, 1], 10: [5, 2], 100: [10, 10] };
const DOT_COLORS = ["#ff7a59", "#4fa3ff", "#7bd389", "#ffcc4d", "#b48cff"];

const $ = id => document.getElementById(id);
const numEl = $("num"), statusEl = $("status"), canvas = $("board"), wrap = $("wrap");
const ctx = canvas.getContext("2d");

let item = ITEMS[0];
let mode = 0;              // 0 = scattered, otherwise the group size
let items = [];            // {slot, jx, jy, born, counted, x0, y0, x1, y1}
let frames = [];           // group boxes: {x, y, w, h, c, r}
let used = new Set();      // scatter slots in use
let gCols = 0, gRows = 0;  // scatter grid
let W = 0, H = 0, dpr = 1; // board size in CSS pixels
let S = 46, S0 = 46;       // item size now / before the current slide
let moveStart = -1e9, framesStart = -1e9, lastBorn = -1e9;
let tapped = 0;
let raf = 0;
let moving = false, lastTick = 0;

/* ---------------- Sidebar controls ---------------- */
for (const it of ITEMS) {
  const b = document.createElement("button");
  b.className = "chip";
  b.title = it.label;
  b.setAttribute("aria-label", it.label);
  b.setAttribute("aria-pressed", it === item);
  if (it.emoji) b.textContent = it.emoji;
  else {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    c.style.width = c.style.height = "30px";
    drawShape(c.getContext("2d"), it, 64, DOT_COLORS[1]);
    b.appendChild(c);
  }
  b.onclick = () => {
    item = it;
    document.querySelectorAll(".chip").forEach(c => c.setAttribute("aria-pressed", c === b));
    sprites.clear();
    updateStatus();
    kick();
    numEl.focus();
    numEl.select();
  };
  $("chips").appendChild(b);
}

const mixBtn = document.createElement("button");
mixBtn.className = "grp mix";
mixBtn.textContent = "🔀 Mix them up";
mixBtn.onclick = () => { stopMoving(); mode = 0; markMode(); reshuffle(); relayout(true); updateStatus(); };
$("groups").appendChild(mixBtn);
for (const g of Object.keys(GROUPS).map(Number)) {
  const b = document.createElement("button");
  b.className = "grp";
  b.dataset.g = g;
  b.textContent = g;
  b.setAttribute("aria-label", "Groups of " + g);
  b.onclick = () => { stopMoving(); mode = g; markMode(); relayout(true); updateStatus(); };
  $("groups").appendChild(b);
}
/* ---------------- Moving around ---------------- */
const moveBtn = $("move"), speedEl = $("speed");
moveBtn.onclick = () => (moving ? stopMoving() : startMoving());

function startMoving() {
  const now = performance.now();
  const e = ease((now - moveStart) / MOVE_MS);
  S0 = S;   // finish any size change straight away
  for (const it of items) {
    it.mx = it.x0 + (it.x1 - it.x0) * e;
    it.my = it.y0 + (it.y1 - it.y0) * e;
    giveVelocity(it);
  }
  if (mode !== 0) { mode = 0; markMode(); updateStatus(); }
  frames = [];
  moving = true;
  lastTick = now;
  moveBtn.textContent = "⏸ Stop";
  moveBtn.setAttribute("aria-pressed", "true");
  kick();
}
function stopMoving() {
  if (!moving) return;
  moving = false;
  // Everything stays where it stopped; the next rearrange slides from here.
  for (const it of items) {
    if (it.mx === undefined) continue;
    it.x0 = it.x1 = it.mx;
    it.y0 = it.y1 = it.my;
    it.mx = it.my = undefined;
  }
  moveStart = -1e9;
  moveBtn.textContent = "▶ Move";
  moveBtn.setAttribute("aria-pressed", "false");
  kick();
}
function giveVelocity(it) {
  const a = Math.random() * Math.PI * 2, f = 0.6 + Math.random() * 0.8;
  it.vx = Math.cos(a) * f;
  it.vy = Math.sin(a) * f;
}
// Move every item a little and bounce it off the board edges.
function step(dt) {
  const v = speedEl.value * 25 * dt / 1000;   // pixels this frame
  const maxX = W - PAD - S, maxY = H - PAD - S;
  for (const it of items) {
    if (it.mx === undefined) { it.mx = it.x1; it.my = it.y1; giveVelocity(it); }
    it.mx += it.vx * v;
    it.my += it.vy * v;
    if (it.mx < PAD) { it.mx = PAD; it.vx = Math.abs(it.vx); }
    else if (it.mx > maxX) { it.mx = maxX; it.vx = -Math.abs(it.vx); }
    if (it.my < PAD) { it.my = PAD; it.vy = Math.abs(it.vy); }
    else if (it.my > maxY) { it.my = maxY; it.vy = -Math.abs(it.vy); }
  }
}

function markMode() {
  document.querySelectorAll(".grp").forEach(b =>
    b.setAttribute("aria-pressed", b === mixBtn ? mode === 0 : +b.dataset.g === mode));
}

function getN() {
  const n = parseInt(numEl.value, 10);
  return isNaN(n) || n < 0 ? 0 : Math.min(n, MAX);
}
$("minus").onclick = () => { numEl.value = Math.max(0, getN() - 1); setCount(getN()); say(getN()); };
$("plus").onclick = () => { numEl.value = Math.min(MAX, getN() + 1); setCount(getN()); say(getN()); };

let typeTimer;
numEl.addEventListener("input", () => {
  if (numEl.value !== "" && getN() !== +numEl.value) numEl.value = getN();
  if (mode !== 0) { mode = 0; markMode(); }   // a newly typed number starts scattered
  setCount(getN());
  clearTimeout(typeTimer);
  typeTimer = setTimeout(() => countAloud(getN()), 700);
});
numEl.addEventListener("keydown", e => { if (e.key === "Enter") numEl.blur(); });
$("speak").onchange = () => { if (!$("speak").checked) stopSpeaking(); };

// Tap an item to mark it as counted.
canvas.addEventListener("click", e => {
  const r = canvas.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const slack = Math.max(0, (14 - S) / 2);   // easier to hit tiny items
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    const ix = moving ? it.mx : it.x1, iy = moving ? it.my : it.y1;
    if (ix === undefined) continue;
    if (x >= ix - slack && x <= ix + S + slack && y >= iy - slack && y <= iy + S + slack) {
      it.counted = !it.counted;
      tapped += it.counted ? 1 : -1;
      updateStatus();
      kick();
      return;
    }
  }
});

new ResizeObserver(() => { if (resizeCanvas()) relayout(false); }).observe(wrap);

/* ---------------- Sizing ---------------- */
function resizeCanvas() {
  const w = wrap.clientWidth, h = wrap.clientHeight, d = devicePixelRatio || 1;
  if (w === W && h === H && d === dpr) return false;
  W = w; H = h; dpr = d;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  sprites.clear();
  return true;
}

// Scattered items get extra room so it looks scattered rather than packed.
const spread = n => 1.35 + 0.85 * Math.exp(-n / 300);
const groupDims = s => ({ pad: Math.max(1, s * 0.13), gap: Math.max(2, s * 0.3), bw: Math.max(1, s * 0.05) });

function fitScatter(n, top) {
  const need = Math.ceil(n * spread(n));
  for (let s = top; s > 2; s -= 0.25) {
    const cell = s * 1.3;
    if (Math.floor((W - 2 * PAD) / cell) * Math.floor((H - 2 * PAD) / cell) >= need) return s;
  }
  return 2;
}
function fitGroups(n, g, top) {
  const [c, r] = GROUPS[g], nf = Math.ceil(n / g);
  for (let s = top; s > 2; s -= 0.25) {
    const { pad, gap, bw } = groupDims(s);
    const fw = c * s + 2 * (pad + bw), fh = r * s + 2 * (pad + bw);
    const perRow = Math.floor((W - 2 * PAD + gap) / (fw + gap));
    if (perRow < 1) continue;
    if (Math.ceil(nf / perRow) * (fh + gap) - gap <= H - 2 * PAD) return s;
  }
  return 2;
}
// Full size until the items would no longer fit on screen; only then shrink.
function chooseSize(n) {
  let s = fitScatter(n, MAX_SIZE());
  if (mode) s = Math.min(s, fitGroups(n, mode, s));
  return s;
}

/* ---------------- Scatter grid ---------------- */
function setGrid(s) {
  const cell = s * 1.3;
  const cols = Math.max(1, Math.floor((W - 2 * PAD) / cell));
  const rows = Math.max(1, Math.floor((H - 2 * PAD) / cell));
  if (cols === gCols && rows === gRows) return;
  const oc = gCols, or = gRows;
  gCols = cols; gRows = rows;
  // Move each item to the matching spot in the new grid, so the picture keeps its shape.
  used.clear();
  for (const it of items) {
    if (!oc) { it.slot = takeSlot(); continue; }
    const r = Math.min(rows - 1, Math.floor((Math.floor(it.slot / oc) + 0.5) * rows / or));
    const c = Math.min(cols - 1, Math.floor(((it.slot % oc) + 0.5) * cols / oc));
    const want = r * cols + c;
    if (!used.has(want)) { used.add(want); it.slot = want; } else it.slot = takeSlot();
  }
}
function takeSlot() {
  const total = gCols * gRows;
  for (let t = 0; t < 50; t++) {
    const s = Math.floor(Math.random() * total);
    if (!used.has(s)) { used.add(s); return s; }
  }
  for (let s = 0; s < total; s++) if (!used.has(s)) { used.add(s); return s; }
  return 0;
}
function reshuffle() {
  used.clear();
  for (const it of items) { it.slot = takeSlot(); it.jx = Math.random(); it.jy = Math.random(); }
}

/* ---------------- Count changes ---------------- */
function setCount(n) {
  resizeCanvas();
  const now = performance.now();
  while (items.length > n) {
    const it = items.pop();
    used.delete(it.slot);
    if (it.counted) tapped--;
  }
  const add = n - items.length;
  // New items pop in one after another, all within about a second.
  const step = reduceMotion ? 0 : Math.min(60, 900 / Math.max(1, add));
  const s = chooseSize(n);
  setGrid(s);
  for (let k = 0; k < add; k++) {
    const it = { slot: takeSlot(), jx: Math.random(), jy: Math.random(), born: now + k * step, counted: false, isNew: true };
    items.push(it);
  }
  lastBorn = now + add * step;
  relayout(true);
  updateStatus();
}

/* ---------------- Layout ---------------- */
const ease = t => (t <= 0 ? 0 : t >= 1 ? 1 : t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function relayout(animate) {
  if (!W || !H) return;
  const now = performance.now();
  const e = ease((now - moveStart) / MOVE_MS);
  const curS = S0 + (S - S0) * e;
  const newS = chooseSize(items.length);
  setGrid(newS);

  // Remember where everything is right now, so it can slide from there.
  for (const it of items) {
    if (it.x1 === undefined) continue;
    it.x0 = it.x0 + (it.x1 - it.x0) * e;
    it.y0 = it.y0 + (it.y1 - it.y0) * e;
  }

  frames = [];
  if (mode === 0) {
    const cell = newS * 1.3;
    const offX = PAD + (W - 2 * PAD - gCols * cell) / 2;
    const offY = PAD + (H - 2 * PAD - gRows * cell) / 2;
    for (const it of items) {
      it.x1 = offX + (it.slot % gCols) * cell + it.jx * (cell - newS);
      it.y1 = offY + Math.floor(it.slot / gCols) * cell + it.jy * (cell - newS);
    }
  } else {
    const [c, r] = GROUPS[mode];
    const { pad, gap, bw } = groupDims(newS);
    const fw = c * newS + 2 * (pad + bw), fh = r * newS + 2 * (pad + bw);
    const perRow = Math.max(1, Math.floor((W - 2 * PAD + gap) / (fw + gap)));
    const rowW = perRow * (fw + gap) - gap;
    const offX = PAD + Math.max(0, (W - 2 * PAD - rowW) / 2);
    const nf = Math.ceil(items.length / mode);
    for (let k = 0; k < nf; k++) {
      frames.push({ x: offX + (k % perRow) * (fw + gap), y: PAD + Math.floor(k / perRow) * (fh + gap), w: fw, h: fh, c, r, pad, bw });
    }
    items.forEach((it, i) => {
      const f = frames[Math.floor(i / mode)], j = i % mode;
      it.x1 = f.x + bw + pad + (j % c) * newS;
      it.y1 = f.y + bw + pad + Math.floor(j / c) * newS;
    });
  }

  const slide = animate && !reduceMotion;
  for (const it of items) {
    if (it.isNew || !slide) { it.x0 = it.x1; it.y0 = it.y1; it.isNew = false; }
  }
  S0 = slide ? curS : newS;
  S = newS;
  moveStart = now;
  framesStart = slide ? now : -1e9;
  if (moving) { frames = []; S0 = S; }
  kick();
}

/* ---------------- Drawing ---------------- */
const sprites = new Map();
function sprite(color) {
  const px = Math.max(1, Math.round(S * dpr));
  const key = color + px;
  let c = sprites.get(key);
  if (!c) {
    c = document.createElement("canvas");
    c.width = c.height = px;
    drawShape(c.getContext("2d"), item, px, color);
    sprites.set(key, c);
  }
  return c;
}
function drawShape(g, it, px, color) {
  const m = px / 2;
  if (it.emoji) {
    g.font = `${px * 0.82}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(it.emoji, m, m + px * 0.05);
  } else if (it.dot) {
    g.fillStyle = color;
    g.beginPath(); g.arc(m, m, px * 0.4, 0, 7); g.fill();
  } else if (it.beach) {
    const cols = ["#ff5a5f", "#fff", "#2f9bff", "#fff", "#ffd23f", "#fff"], rad = px * 0.42;
    cols.forEach((col, i) => {
      g.fillStyle = col;
      g.beginPath(); g.moveTo(m, m);
      g.arc(m, m, rad, -Math.PI / 2 + i * Math.PI / 3, -Math.PI / 2 + (i + 1) * Math.PI / 3);
      g.closePath(); g.fill();
    });
    g.fillStyle = "#fff";
    g.beginPath(); g.arc(m, m, rad * 0.14, 0, 7); g.fill();
    g.strokeStyle = "rgba(0,0,0,.25)"; g.lineWidth = Math.max(1, px * 0.025);
    g.beginPath(); g.arc(m, m, rad, 0, 7); g.stroke();
  }
}

const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function draw(now) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const e = ease((now - moveStart) / MOVE_MS);
  const curS = S0 + (S - S0) * e;

  // Group boxes
  if (frames.length) {
    ctx.globalAlpha = Math.min(1, Math.max(0, (now - framesStart) / 400));
    const fill = css("--frame"), line = css("--frame-line");
    for (const f of frames) {
      ctx.fillStyle = fill;
      ctx.strokeStyle = line;
      ctx.lineWidth = f.bw * 2;
      ctx.beginPath();
      ctx.roundRect(f.x + f.bw, f.y + f.bw, f.w - 2 * f.bw, f.h - 2 * f.bw, Math.max(2, S * 0.2));
      ctx.fill(); ctx.stroke();
      if (S >= 6) {   // cell lines, skipped when tiny
        const ix = f.x + f.bw + f.pad, iy = f.y + f.bw + f.pad;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let k = 0; k <= f.c; k++) { ctx.moveTo(ix + k * S, iy); ctx.lineTo(ix + k * S, iy + f.r * S); }
        for (let k = 0; k <= f.r; k++) { ctx.moveTo(ix, iy + k * S); ctx.lineTo(ix + f.c * S, iy + k * S); }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  // Items
  const counted = css("--counted");
  const plain = item.dot ? null : sprite("");
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const p = reduceMotion ? 1 : (now - it.born) / POP_MS;
    if (p <= 0) continue;
    const sc = p >= 1 ? 1 : 1 + 2.7 * Math.pow(p - 1, 3) + 1.7 * Math.pow(p - 1, 2);   // pop with a little bounce
    const x = moving ? it.mx : it.x0 + (it.x1 - it.x0) * e;
    const y = moving ? it.my : it.y0 + (it.y1 - it.y0) * e;
    const z = curS * sc, off = (curS - z) / 2;
    if (it.counted) {
      ctx.fillStyle = counted;
      ctx.beginPath(); ctx.roundRect(x, y, curS, curS, curS * 0.3); ctx.fill();
    }
    const img = plain || sprite(DOT_COLORS[(mode ? Math.floor(i / mode) : i) % DOT_COLORS.length]);
    ctx.drawImage(img, x + off, y + off, z, z);
  }
}

function kick() {
  if (!raf) { lastTick = performance.now(); raf = requestAnimationFrame(tick); }
}
function tick(now) {
  if (moving) { step(Math.max(0, Math.min(50, now - lastTick))); lastTick = now; }
  draw(now);
  const busy = moving || now < moveStart + MOVE_MS || now < lastBorn + POP_MS || now < framesStart + 400;
  raf = busy ? requestAnimationFrame(tick) : 0;
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", kick);

/* ---------------- Status line ---------------- */
function plural(k, word) { return k.toLocaleString() + " " + word + (k === 1 ? "" : "s"); }
function updateStatus() {
  const n = items.length;
  if (n === 0) { statusEl.innerHTML = "Type a number to fill the board!"; return; }
  let html = `<b>${n.toLocaleString()}</b> ${n === 1 ? item.one : item.label.toLowerCase()}`;
  if (mode === 0 || mode === 10 || mode === 100) {
    if (n >= 10) {
      const th = Math.floor(n / 1000), h = Math.floor(n % 1000 / 100), t = Math.floor(n % 100 / 10), o = n % 10;
      const parts = [];
      if (th) parts.push(plural(th, "thousand"));
      if (h) parts.push(plural(h, "hundred"));
      if (t) parts.push(plural(t, "ten"));
      if (o) parts.push(plural(o, "one"));
      html += " = " + parts.join(" + ");
    }
  } else {
    const groups = Math.floor(n / mode), left = n % mode, parts = [];
    if (groups) parts.push(`${groups.toLocaleString()} group${groups === 1 ? "" : "s"} of ${mode}`);
    if (left) parts.push(`${left} more`);
    html += " = " + parts.join(" + ");
  }
  if (tapped > 0) html += ` <span class="tapped">· you've tapped ${tapped.toLocaleString()}</span>`;
  statusEl.innerHTML = html;
}

/* ---------------- Counting out loud ---------------- */
function stopSpeaking() { if ("speechSynthesis" in window) speechSynthesis.cancel(); }
function say(n) {
  if (!$("speak").checked || !("speechSynthesis" in window)) return;
  stopSpeaking();
  speechSynthesis.speak(new SpeechSynthesisUtterance(String(n)));
}
function countAloud(n) {
  if (!$("speak").checked || !("speechSynthesis" in window)) return;
  stopSpeaking();
  if (n > 30) return say(n);   // counting every number is fun up to 30
  for (let i = 1; i <= n; i++) {
    const u = new SpeechSynthesisUtterance(String(i));
    u.rate = 1.1;
    speechSynthesis.speak(u);
  }
}

markMode();
setCount(getN());
