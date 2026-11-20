/*
 * Stickman Teacher: a stickman in front of a blackboard, drawn with the
 * vanilla HTML Canvas 2D API (no libraries).
 *
 * How it works, in short:
 *   1. STATE   - numbers on the board, chalk marks, and the stickman (position, hand, speech bubble).
 *   2. ACTIONS - every button turns into a list of small "steps" (walk, reach, trace, say, wait...)
 *                that go into a queue, so actions play one after another like a script.
 *   3. LOOP    - requestAnimationFrame calls update(dt) (advance the current step) and draw()
 *                (repaint the whole scene) about 60 times a second.
 *   4. ARM     - the drawing arm uses 2-bone inverse kinematics: we know the shoulder and where
 *                the hand must go, and the law of cosines gives us the elbow position.
 */

// ---------------------------------------------------------------------------
// Canvas setup (sharp on high-DPI screens)
// ---------------------------------------------------------------------------
const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d");
const W = 1000;
const H = 560;
const dpr = window.devicePixelRatio || 1;
canvas.width = W * dpr;
canvas.height = H * dpr;
ctx.scale(dpr, dpr);

// ---------------------------------------------------------------------------
// Scene constants
// ---------------------------------------------------------------------------
const FLOOR_Y = 530;
const BOARD = { x: 70, y: 30, w: 860, h: 340 };
const COLS = [180, 340, 500, 660, 820];
const ROWS = [130, 270];

// Stickman body proportions (in pixels)
const BODY = {
  leg: 105,      // hip to foot
  torso: 115,    // hip to neck
  headR: 24,
  upperArm: 130, // shoulder to elbow
  foreArm: 130,  // elbow to hand
};

const WALK_SPEED = 230;  // px per second
const HAND_SPEED = 750;  // px per second when reaching
const CHALK_SPEED = 420; // px per second while drawing with chalk

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  numbers: [],       // [{ value, x, y }]
  selected: 0,       // index into numbers
  marks: [],         // chalk marks drawn on the board
  queue: [],         // steps waiting to run
  step: null,        // step currently running
  man: {
    x: 520,          // x of the feet
    facing: 1,       // 1 = facing right, -1 = facing left
    walkPhase: 0,    // drives the leg / arm swing
    moving: false,
    hand: null,      // current hand position {x, y} (null until first frame)
    handTarget: null,// where the hand is heading (null = relaxed by the side)
    bubble: null,    // { text, until }
  },
  time: 0,
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const rand = (min, max) => min + Math.random() * (max - min);
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

function moveTowards(p, target, maxStep) {
  const d = dist(p, target);
  if (d <= maxStep || d === 0) return { x: target.x, y: target.y };
  return {
    x: p.x + ((target.x - p.x) / d) * maxStep,
    y: p.y + ((target.y - p.y) / d) * maxStep,
  };
}

// Joint positions derived from where the stickman stands
function hipOf(man) { return { x: man.x, y: FLOOR_Y - BODY.leg }; }
function neckOf(man) { return { x: man.x, y: FLOOR_Y - BODY.leg - BODY.torso }; }
function shoulderOf(man) { const n = neckOf(man); return { x: n.x, y: n.y + 10 }; }
function headOf(man) { const n = neckOf(man); return { x: n.x, y: n.y - BODY.headR - 2 }; }

// Where the drawing hand rests when it has nothing to do
function restHand(man) {
  const s = shoulderOf(man);
  return { x: s.x + man.facing * 20, y: s.y + 250 };
}

/*
 * 2-bone inverse kinematics.
 * Given the shoulder, the target and the two bone lengths, return the elbow
 * and the (reachable) hand position. The law of cosines gives the angle
 * between the upper arm and the shoulder->hand line.
 */
function solveArm(shoulder, target, l1, l2, bend) {
  const dx = target.x - shoulder.x;
  const dy = target.y - shoulder.y;
  const d = Math.min(Math.hypot(dx, dy), l1 + l2 - 0.001);
  const base = Math.atan2(dy, dx);
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d || 1);
  const a = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const elbow = {
    x: shoulder.x + Math.cos(base + a * bend) * l1,
    y: shoulder.y + Math.sin(base + a * bend) * l1,
  };
  const hand = {
    x: shoulder.x + Math.cos(base) * d,
    y: shoulder.y + Math.sin(base) * d,
  };
  return { elbow, hand };
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------
function makeNumbers(values) {
  state.numbers = values.map((value, i) => ({
    value,
    x: COLS[i % COLS.length],
    y: ROWS[Math.floor(i / COLS.length)],
  }));
  state.selected = 0;
  renderChips();
}

function randomValues(count) {
  const set = new Set();
  while (set.size < count) set.add(Math.floor(rand(1, 100)));
  return [...set];
}

// Where the stickman should stand to work on a number (beside it, not on top of it)
function standSpot(n) {
  const offset = 100;
  if (n.x - offset >= 90) return { x: n.x - offset, facing: 1 };
  return { x: n.x + offset, facing: -1 };
}

// ---------------------------------------------------------------------------
// Chalk marks: each mark is a list of strokes, each stroke a list of points.
// "drawn" stores how many pixels of each stroke the chalk has drawn so far,
// which is what makes the marks appear as if written live.
// ---------------------------------------------------------------------------
function jitter(p, amount = 1.5) {
  return { x: p.x + rand(-amount, amount), y: p.y + rand(-amount, amount) };
}

function line(from, to, steps = 14) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push(jitter({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, 1.2));
  }
  return pts;
}

const SHAPES = {
  circle(c) {
    const pts = [];
    const start = -2.3;
    const turns = Math.PI * 2 * 1.08; // a bit more than a full turn, like a real hand-drawn circle
    for (let i = 0; i <= 70; i++) {
      const a = start + (turns * i) / 70;
      const grow = 1 + i / 700;
      pts.push(jitter({ x: c.x + Math.cos(a) * 46 * grow, y: c.y + Math.sin(a) * 42 * grow }));
    }
    return [pts];
  },
  underline(c) {
    return [line({ x: c.x - 38, y: c.y + 40 }, { x: c.x + 38, y: c.y + 43 })];
  },
  tick(c) {
    const a = { x: c.x + 30, y: c.y - 6 };
    const b = { x: c.x + 44, y: c.y + 12 };
    const d = { x: c.x + 72, y: c.y - 34 };
    return [[...line(a, b, 6), ...line(b, d, 10).slice(1)]];
  },
  cross(c) {
    return [
      line({ x: c.x - 32, y: c.y - 32 }, { x: c.x + 32, y: c.y + 32 }),
      line({ x: c.x + 32, y: c.y - 32 }, { x: c.x - 32, y: c.y + 32 }),
    ];
  },
};

function strokeLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  return len;
}

// Point that is `along` pixels into a stroke
function pointAlong(pts, along) {
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1], pts[i]);
    if (along <= seg) {
      const t = seg ? along / seg : 0;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
    }
    along -= seg;
  }
  return pts[pts.length - 1];
}

function createMark(shape, n) {
  const strokes = SHAPES[shape](n);
  return { strokes, drawn: strokes.map(() => 0), lengths: strokes.map(strokeLength), alpha: 1 };
}

// ---------------------------------------------------------------------------
// Step builders: actions are composed from these
// ---------------------------------------------------------------------------
const steps = {
  walkTo: (x, facing) => ({ type: "walk", x, facing }),
  reach: (pt) => ({ type: "reach", pt }),
  trace: (mark, index) => ({ type: "trace", mark, index, along: 0 }),
  say: (text, seconds = 1.4) => ({ type: "say", text, seconds }),
  wait: (seconds) => ({ type: "wait", seconds }),
  rest: () => ({ type: "rest" }),
  wave: (seconds = 1.8, erase = false) => ({ type: "wave", seconds, erase, t: 0 }),
  run: (fn) => ({ type: "run", fn }),
  status: (text) => ({ type: "status", text }),
};

// Walk next to a number and get the hand near it
function goTo(n) {
  const spot = standSpot(n);
  return [steps.walkTo(spot.x, spot.facing)];
}

function pointAt(n, label) {
  const spot = standSpot(n);
  const shoulder = { x: spot.x, y: shoulderOf(state.man).y };
  // Stop the fingertip a little short of the number so it doesn't cover it
  const d = dist(n, shoulder);
  const tip = { x: n.x + ((shoulder.x - n.x) / d) * 52, y: n.y + ((shoulder.y - n.y) / d) * 52 };
  return [...goTo(n), steps.reach(tip), steps.say(label ?? `This is ${n.value}`), steps.wait(0.9)];
}

function markNumber(shape, n) {
  const mark = createMark(shape, n);
  const list = [...goTo(n), steps.run(() => state.marks.push(mark))];
  mark.strokes.forEach((stroke, i) => {
    list.push(steps.reach(stroke[0]));
    list.push(steps.trace(mark, i));
  });
  return list;
}

// ---------------------------------------------------------------------------
// Actions (what each button does)
// ---------------------------------------------------------------------------
const SHAPE_LABELS = { circle: "Circling", underline: "Underlining", tick: "Ticking", cross: "Crossing out" };

const actions = {
  point() {
    const n = current();
    return [steps.status(`Pointing at ${n.value}`), ...pointAt(n), steps.rest()];
  },
  circle: () => shapeAction("circle"),
  underline: () => shapeAction("underline"),
  tick: () => shapeAction("tick"),
  cross: () => shapeAction("cross"),

  count() {
    const list = [steps.status("Counting every number")];
    state.numbers.forEach((n, i) => {
      list.push(...pointAt(n, `${i + 1}`).slice(0, -1), steps.wait(0.25));
    });
    list.push(steps.rest(), steps.say(`That's ${state.numbers.length} numbers!`, 2));
    return list;
  },

  largest() {
    const n = state.numbers.reduce((a, b) => (b.value > a.value ? b : a));
    return [
      steps.status(`Finding the largest number: ${n.value}`),
      ...pointAt(n, `Largest is ${n.value}!`),
      ...markNumber("circle", n),
      steps.rest(),
    ];
  },

  evens() {
    const evens = state.numbers.filter((n) => n.value % 2 === 0);
    if (!evens.length) return [steps.say("No even numbers!"), steps.wait(1)];
    const list = [steps.status(`Ticking ${evens.length} even number(s)`)];
    evens.forEach((n) => list.push(...markNumber("tick", n)));
    list.push(steps.rest(), steps.say(`${evens.length} even number${evens.length > 1 ? "s" : ""}!`, 2));
    return list;
  },

  wave() {
    return [steps.status("Waving hello"), steps.walkTo(500, 1), steps.say("Hello! 👋", 2), steps.wave(), steps.rest()];
  },

  erase() {
    if (!state.marks.length) return [steps.say("The board is already clean!")];
    return [
      steps.status("Erasing the board"),
      steps.walkTo(500, 1),
      steps.wave(1.6, true),
      steps.run(() => (state.marks = [])),
      steps.rest(),
      steps.say("All clean!"),
    ];
  },

  shuffle() {
    return [
      steps.status("Writing new numbers"),
      steps.run(() => {
        state.marks = [];
        makeNumbers(randomValues(10));
      }),
      steps.say("New numbers!"),
    ];
  },
};

function shapeAction(shape) {
  const n = current();
  return [steps.status(`${SHAPE_LABELS[shape]} ${n.value}`), ...markNumber(shape, n), steps.rest()];
}

function current() {
  return state.numbers[state.selected];
}

function enqueue(list) {
  state.queue.push(...list);
}

// ---------------------------------------------------------------------------
// Update: advance the current step
// ---------------------------------------------------------------------------
function update(dt) {
  const man = state.man;
  state.time += dt;
  if (!man.hand) man.hand = restHand(man);

  if (!state.step && state.queue.length) state.step = state.queue.shift();
  const step = state.step;
  man.moving = false;
  let done = true;

  if (step) {
    switch (step.type) {
      case "walk": {
        const dx = step.x - man.x;
        if (Math.abs(dx) > 1) {
          man.facing = Math.sign(dx);
          man.x += Math.sign(dx) * Math.min(Math.abs(dx), WALK_SPEED * dt);
          man.walkPhase += dt * 9;
          man.moving = true;
          man.handTarget = null; // arms relax while walking
          done = false;
        } else {
          man.x = step.x;
          if (step.facing) man.facing = step.facing;
        }
        break;
      }
      case "reach":
        man.handTarget = step.pt;
        done = dist(man.hand, step.pt) < 1;
        break;
      case "trace": {
        // The hand follows the stroke while the chalk line grows behind it
        step.along = Math.min(step.along + CHALK_SPEED * dt, step.mark.lengths[step.index]);
        step.mark.drawn[step.index] = step.along;
        man.handTarget = pointAlong(step.mark.strokes[step.index], step.along);
        man.hand = { ...man.handTarget };
        done = step.along >= step.mark.lengths[step.index];
        break;
      }
      case "say":
        man.bubble = { text: step.text, until: state.time + step.seconds };
        break;
      case "wait":
        step.seconds -= dt;
        done = step.seconds <= 0;
        break;
      case "rest":
        man.handTarget = null;
        done = dist(man.hand, restHand(man)) < 2;
        break;
      case "wave": {
        step.t += dt;
        const s = shoulderOf(man);
        const sweep = step.erase ? 150 : 40;
        man.handTarget = {
          x: s.x + man.facing * 70 + Math.sin(step.t * (step.erase ? 9 : 14)) * sweep,
          y: s.y - (step.erase ? 150 : 135),
        };
        man.hand = moveTowards(man.hand, man.handTarget, HAND_SPEED * dt * 2);
        if (step.erase) state.marks.forEach((m) => (m.alpha = Math.max(0, 1 - step.t / step.seconds)));
        done = step.t >= step.seconds;
        break;
      }
      case "run":
        step.fn();
        break;
      case "status":
        setStatus(step.text);
        break;
    }
    if (done) state.step = null;
  }

  // Ease the hand toward its target (or back to rest)
  if (!step || (step.type !== "trace" && step.type !== "wave")) {
    const target = man.handTarget || restHand(man);
    man.hand = moveTowards(man.hand, target, HAND_SPEED * dt);
  }
  if (!man.moving) man.walkPhase *= 0.85; // settle the legs when standing

  if (man.bubble && state.time > man.bubble.until) man.bubble = null;
  if (!state.step && !state.queue.length) setStatus("Ready");
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
function drawRoom() {
  // wall
  ctx.fillStyle = "#e9e2d0";
  ctx.fillRect(0, 0, W, H);
  // floor
  ctx.fillStyle = "#b98d5f";
  ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
  ctx.fillStyle = "#a57a4d";
  for (let x = 0; x < W; x += 80) ctx.fillRect(x, FLOOR_Y, 2, H - FLOOR_Y);
}

function drawBoard() {
  const { x, y, w, h } = BOARD;
  // wooden frame
  ctx.fillStyle = "#7a4e2a";
  roundRect(x - 14, y - 14, w + 28, h + 28, 10);
  ctx.fill();
  // slate
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, "#2f4f3a");
  g.addColorStop(1, "#24402f");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  // chalk tray
  ctx.fillStyle = "#6b4323";
  ctx.fillRect(x - 6, y + h + 10, w + 12, 10);
  ctx.fillStyle = "#f2f2ea";
  ctx.fillRect(x + 60, y + h + 6, 26, 6);
  ctx.fillRect(x + 100, y + h + 6, 18, 6);
}

function drawNumbers() {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 64px 'Comic Sans MS', 'Chalkboard SE', 'Segoe Print', cursive";
  state.numbers.forEach((n, i) => {
    if (i === state.selected) {
      // soft glow behind the selected number
      const glow = ctx.createRadialGradient(n.x, n.y, 5, n.x, n.y, 60);
      glow.addColorStop(0, "rgba(255, 230, 120, 0.35)");
      glow.addColorStop(1, "rgba(255, 230, 120, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(n.x - 60, n.y - 60, 120, 120);
    }
    ctx.fillStyle = "rgba(245, 245, 235, 0.95)";
    ctx.fillText(String(n.value), n.x, n.y + 2);
  });
}

function drawMarks() {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  state.marks.forEach((mark) => {
    mark.strokes.forEach((pts, i) => {
      const drawn = mark.drawn[i];
      if (drawn <= 0) return;
      // two passes give a slightly rough "chalk" texture
      [[5, 0.85, 0], [2, 0.4, 1.5]].forEach(([width, alpha, offset]) => {
        ctx.strokeStyle = `rgba(250, 250, 240, ${alpha * mark.alpha})`;
        ctx.lineWidth = width;
        ctx.beginPath();
        let left = drawn;
        ctx.moveTo(pts[0].x + offset, pts[0].y);
        for (let k = 1; k < pts.length && left > 0; k++) {
          const seg = dist(pts[k - 1], pts[k]);
          const t = Math.min(1, left / seg);
          ctx.lineTo(
            pts[k - 1].x + (pts[k].x - pts[k - 1].x) * t + offset,
            pts[k - 1].y + (pts[k].y - pts[k - 1].y) * t
          );
          left -= seg;
        }
        ctx.stroke();
      });
    });
  });
}

function drawStickman() {
  const man = state.man;
  const hip = hipOf(man);
  const neck = neckOf(man);
  const shoulder = shoulderOf(man);
  const head = headOf(man);
  const swing = Math.sin(man.walkPhase);

  ctx.strokeStyle = "#1d1d1d";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // legs (feet swing opposite each other while walking)
  [1, -1].forEach((side) => {
    const footX = hip.x + side * swing * 26 + side * 12;
    const knee = { x: (hip.x + footX) / 2 + man.facing * 8, y: hip.y + BODY.leg / 2 };
    ctx.beginPath();
    ctx.moveTo(hip.x, hip.y);
    ctx.lineTo(knee.x, knee.y);
    ctx.lineTo(footX, FLOOR_Y);
    ctx.lineTo(footX + man.facing * 14, FLOOR_Y);
    ctx.stroke();
  });

  // body
  ctx.beginPath();
  ctx.moveTo(hip.x, hip.y);
  ctx.lineTo(neck.x, neck.y);
  ctx.stroke();

  // back arm: simple swing
  const backHand = { x: shoulder.x - man.facing * 20 - swing * 30 * man.facing, y: shoulder.y + 165 };
  const back = solveArm(shoulder, backHand, BODY.upperArm * 0.7, BODY.foreArm * 0.7, -man.facing);
  limb(shoulder, back.elbow, back.hand);

  // front (drawing) arm: inverse kinematics toward the hand position
  const arm = solveArm(shoulder, man.hand, BODY.upperArm, BODY.foreArm, man.facing);
  limb(shoulder, arm.elbow, arm.hand);

  // chalk in the hand while working on the board
  if (state.step && (state.step.type === "trace" || state.step.type === "reach")) {
    ctx.fillStyle = "#fafaf0";
    ctx.beginPath();
    ctx.arc(arm.hand.x, arm.hand.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // head
  ctx.fillStyle = "#fffdf6";
  ctx.beginPath();
  ctx.arc(head.x, head.y, BODY.headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // eye + smile (face the walking / working direction)
  ctx.fillStyle = "#1d1d1d";
  ctx.beginPath();
  ctx.arc(head.x + man.facing * 9, head.y - 5, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(head.x + man.facing * 6, head.y + 4, 9, 0.15 * Math.PI, 0.75 * Math.PI);
  ctx.stroke();
}

function limb(a, b, c) {
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.stroke();
}

function drawBubble() {
  const man = state.man;
  if (!man.bubble) return;
  const head = headOf(man);
  ctx.font = "600 22px system-ui, sans-serif";
  const textW = ctx.measureText(man.bubble.text).width;
  const w = textW + 32;
  const h = 44;
  // keep the bubble inside the canvas
  let x = head.x - man.facing * 20 - w / 2;
  x = Math.max(10, Math.min(W - w - 10, x));
  const y = head.y - BODY.headR - h - 22;

  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#1d1d1d";
  ctx.lineWidth = 2;
  roundRect(x, y, w, h, 12);
  ctx.fill();
  ctx.stroke();
  // tail
  ctx.beginPath();
  ctx.moveTo(head.x - 8, y + h - 1);
  ctx.lineTo(head.x, y + h + 16);
  ctx.lineTo(head.x + 8, y + h - 1);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(head.x - 8, y + h);
  ctx.lineTo(head.x, y + h + 16);
  ctx.lineTo(head.x + 8, y + h);
  ctx.stroke();

  ctx.fillStyle = "#1d1d1d";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(man.bubble.text, x + w / 2, y + h / 2 + 1);
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  drawRoom();
  drawBoard();
  drawNumbers();
  drawMarks();
  drawStickman();
  drawBubble();
}

// ---------------------------------------------------------------------------
// Animation loop
// ---------------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); // cap dt so a background tab doesn't jump
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
const chipsEl = document.getElementById("chips");
const statusEl = document.getElementById("status");

function setStatus(text) {
  if (statusEl.textContent !== text) statusEl.textContent = text;
}

function renderChips() {
  chipsEl.innerHTML = "";
  state.numbers.forEach((n, i) => {
    const b = document.createElement("button");
    b.className = "chip" + (i === state.selected ? " selected" : "");
    b.textContent = n.value;
    b.setAttribute("aria-pressed", i === state.selected);
    b.addEventListener("click", () => select(i));
    chipsEl.appendChild(b);
  });
}

function select(i) {
  state.selected = i;
  renderChips();
}

document.querySelectorAll("[data-action]").forEach((btn) => {
  btn.addEventListener("click", () => enqueue(actions[btn.dataset.action]()));
});

// Click a number on the board to select it
canvas.addEventListener("click", (e) => {
  const rect = canvas.getBoundingClientRect();
  const p = { x: ((e.clientX - rect.left) / rect.width) * W, y: ((e.clientY - rect.top) / rect.height) * H };
  const i = state.numbers.findIndex((n) => dist(n, p) < 50);
  if (i >= 0) select(i);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
makeNumbers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
requestAnimationFrame(frame);
