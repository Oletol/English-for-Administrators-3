// Interactive parts of the book that are not marked:
//  • speaking timers with an in-browser voice recorder (nothing is uploaded anywhere);
//  • estimates that reveal a figure;
//  • the small tools of Unit 1 (agreement summary, sorting board, footprint calculator,
//    administrator profile, a hundred hectares, law and fairness chart).
// Everything is drawn from the exercise data, so the same code works in the student book
// and in the Teacher's Edition.
import { registerWidgets, registerSpeaking, esc } from "./common.js";

const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const fmtN = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const clamp = (x) => Math.max(0, Math.min(100, Math.round(x)));
const json = (v) => esc(JSON.stringify(v));

// ================================================================== widget markup
const PLACE = { footprint: "before", landsim: "before", waterprint: "before", basinsim: "before" };

function widgetHTML(ex) {
  switch (ex.widget) {
    case "estsum": return `<div class="est-sum" data-w="estsum"></div>`;
    case "likert": return `<div class="wg"><div class="wg-out" data-w="likert"></div></div>`;
    case "sortboard": return `<div class="wg"><span class="bank-l">The board</span><div class="sort-board" data-w="sortboard" data-cats="${json((ex.options || []).map((o) => [o.id, o.text]))}"></div></div>`;
    case "lawchart": return `<div class="wg"><span class="bank-l">The chart</span><div class="lf-ch" data-w="lawchart" data-chart="${json(ex.chart || {})}" data-scales="${json((ex.scales || []).map((s) => s.id))}" data-labels="${json((ex.items || []).filter((i) => i.label).map((i) => [i.id, i.label]))}"></div></div>`;
    case "profile": return `<div class="wg"><button class="btn primary" type="button" data-prof-go>Show my profile</button><div class="prof" data-w="profile" data-map="${json(ex.profile || [])}" data-types="${json(ex.profileTypes || null)}" data-opp="${json(ex.profileOpp || null)}"></div></div>`;
    case "waterprint": return waterprintHTML();
    case "basinsim": return basinHTML();
    case "footprint": return footprintHTML();
    case "landsim": return landsimHTML();
    default: return "";
  }
}
registerWidgets({ html: widgetHTML, place: (ex) => PLACE[ex.widget] || "after" });

// ================================================================== refresh on every change
let pending = false;
function refreshSoon() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; refreshAll(); });
}
// values of the calculators are kept while the page is open (they are not part of the answers)
const KEEP = new Map();
function keepKey(el) { return (el.closest("section.ex")?.dataset.exid || "") + ":" + el.dataset.w; }
function restore(el) {
  if (el.dataset.restored) return;
  el.dataset.restored = "1";
  const v = KEEP.get(keepKey(el));
  if (v) $$("input.fp-in,input.sim-in", el).forEach((inp, i) => { if (v[i] !== undefined) inp.value = v[i]; });
  if (el.dataset.w === "profile" && PROF_SHOWN.has(keepKey(el))) showProfile(el.closest("section.ex"));
}
const PROF_SHOWN = new Set();
function refreshAll() {
  $$("[data-w]").forEach((el) => {
    restore(el);
    const f = REFRESH[el.dataset.w];
    if (f) try { f(el, el.closest("section.ex") || document); } catch (e) { console.warn(e); }
  });
  $$(".spk").forEach(syncSpk);
}
const REFRESH = {
  estsum(el, sec) {
    const all = $$(".est[data-val]", sec).filter((d) => d.dataset.val !== "" && d.querySelector("input[type=range]"));
    const done = all.filter((d) => !d.querySelector(".est-a").hidden);
    if (!done.length || document.body.classList.contains("teacher")) { el.innerHTML = ""; return; }
    let tot = 0;
    done.forEach((d) => { tot += Math.abs(Number(d.querySelector("input[type=range]").value) - Number(d.dataset.val)); });
    const avg = Math.round(tot / done.length);
    el.innerHTML = `Revealed: <b>${done.length} of ${all.length}</b> · your average distance from the real figure: <b>${avg} points</b>`
      + (done.length === all.length ? (avg <= 10 ? " – a well-informed guesser." : avg <= 20 ? " – close on some, far on others: which ones, and why?" : " – the world is not quite the shape you assumed. Which assumption did most damage?") : "");
  },
  likert(el, sec) {
    const groups = $$(".mcq.scale", sec);
    let n = 0, ag = 0, dis = 0, ns = 0, strong = 0;
    groups.forEach((g) => {
      const c = g.querySelector("input:checked");
      if (!c) return;
      n++;
      const v = "ABCDE".indexOf(c.value);
      if (v > 2) ag++; else if (v < 2) dis++; else ns++;
      if (v === 0 || v === 4) strong++;
    });
    el.textContent = n ? `So far: you agree with ${ag}, disagree with ${dis}, and are not sure about ${ns} of the ${n} statements you have answered`
      + (strong ? ` – and you hold ${strong} view${strong > 1 ? "s" : ""} strongly.` : ".") : "";
  },
  sortboard(el, sec) {
    const cats = JSON.parse(el.dataset.cats || "[]");
    const cols = Object.fromEntries(cats.map(([id]) => [id, []]));
    $$("select[data-item]", sec).forEach((s) => {
      if (!s.value || !cols[s.value]) return;
      const t = s.closest("li")?.querySelector(".m-word")?.textContent || "";
      cols[s.value].push(`<span>${esc(t)}</span>`);
    });
    el.innerHTML = cats.map(([id, text]) => `<div class="sort-col"><h6>${esc(id)} · ${text}</h6>${cols[id].join("")}</div>`).join("");
  },
  lawchart(el, sec) {
    const [sx, sy] = JSON.parse(el.dataset.scales || "[]");
    const C = Object.assign({ x: "stronger in law", y: "stronger in fairness", tl: "fair but unprotected", br: "legal but unfair" }, JSON.parse(el.dataset.chart || "{}"));
    const labels = JSON.parse(el.dataset.labels || "[]");
    const W = 280, P = 34, S = (W - P - 12) / 4;
    const X = (v) => P + (v - 1) * S, Y = (v) => W - P - (v - 1) * S;
    let g = "";
    for (let i = 1; i <= 5; i++) {
      g += `<line class="gd" x1="${X(i)}" y1="${Y(1)}" x2="${X(i)}" y2="${Y(5)}"/><line class="gd" x1="${X(1)}" y1="${Y(i)}" x2="${X(5)}" y2="${Y(i)}"/>`;
      g += `<text x="${X(i)}" y="${Y(1) + 14}" text-anchor="middle">${i}</text><text x="${X(1) - 10}" y="${Y(i) + 3}" text-anchor="middle">${i}</text>`;
    }
    g += `<line class="ax" x1="${X(1)}" y1="${Y(1)}" x2="${X(5)}" y2="${Y(1)}"/><line class="ax" x1="${X(1)}" y1="${Y(1)}" x2="${X(1)}" y2="${Y(5)}"/>`;
    g += `<text x="${(X(1) + X(5)) / 2}" y="${W - 4}" text-anchor="middle">${esc(C.x)}</text>`;
    g += `<text transform="translate(10,${(Y(1) + Y(5)) / 2}) rotate(-90)" text-anchor="middle">${esc(C.y)}</text>`;
    g += `<g class="q"><text x="${X(1) + 4}" y="${Y(5) - 6}">${esc(C.tl)}</text><text x="${X(5) - 4}" y="${Y(1) - 6}" text-anchor="end">${esc(C.br)}</text></g>`;
    const seen = {};
    labels.forEach(([id, lab]) => {
      const l = sec.querySelector(`select[data-item="${id}_${sx}"]`), f = sec.querySelector(`select[data-item="${id}_${sy}"]`);
      if (!l || !f || !l.value || !f.value) return;
      const key = l.value + "-" + f.value, n = (seen[key] = (seen[key] || 0) + 1), off = (n - 1) * 9;
      const cx = X(+l.value) + off, cy = Y(+f.value) - off * 0.4;
      g += `<g class="dot"><circle cx="${cx}" cy="${cy}" r="9"/><text x="${cx}" y="${cy + 3.5}" text-anchor="middle">${esc(lab)}</text></g>`;
    });
    el.innerHTML = `<svg viewBox="0 -14 ${W} ${W + 14}" role="img" aria-label="Chart of claims: law against fairness">${g}</svg>`;
  },
  profile() {},
  footprint: fpCalc,
  waterprint: wpCalc,
  basinsim: basinCalc,
  landsim: simCalc,
};

// ================================================================== events
document.addEventListener("input", (e) => {
  const t = e.target;
  const w = t.closest?.('[data-w="footprint"],[data-w="landsim"],[data-w="waterprint"],[data-w="basinsim"]');
  if (w) KEEP.set(keepKey(w), $$("input.fp-in,input.sim-in", w).map((x) => x.value));
  if (t.matches?.(".est input[type=range]")) {
    const o = t.parentNode.querySelector(".est-o");
    if (o) o.textContent = t.value + (t.closest(".est").dataset.unit || "");
  }
  refreshSoon();
});
document.addEventListener("change", refreshSoon);
document.addEventListener("click", (e) => {
  const b = e.target.closest?.("[data-reveal]");
  if (b && !b.disabled) reveal(b);
  if (e.target.closest?.("[data-prof-go]")) {
    const sec = e.target.closest("section.ex");
    PROF_SHOWN.add(keepKey(sec.querySelector('[data-w="profile"]')));
    showProfile(sec);
  }
  if (e.target.closest?.("[data-fp]")) fpButton(e.target.closest("[data-fp]"));
  if (e.target.closest?.("[data-wp]")) wpButton(e.target.closest("[data-wp]"));
  if (e.target.closest?.("[data-basin-reset]")) basinReset(e.target.closest("section.ex"));
  if (e.target.closest?.("[data-sim-reset]")) simReset(e.target.closest("section.ex"));
  const sb = e.target.closest?.("[data-spk-act]");
  if (sb) spkAction(sb);
});
// re-draw after the page has been rendered again (but not after our own drawing)
new MutationObserver((ms) => {
  if (ms.some((m) => m.target.nodeType === 1 && !m.target.closest("[data-w],.spk,.est"))) refreshSoon();
}).observe(document.documentElement, { childList: true, subtree: true });

// a value that the student page saves (it listens to "change" events on fields with data-item)
function saveValue(near, exId, itemId, value) {
  const h = document.createElement("input");
  h.type = "hidden"; h.dataset.ex = exId; h.dataset.item = itemId; h.value = value;
  near.appendChild(h);
  h.dispatchEvent(new Event("change", { bubbles: true }));
  h.remove();
}

function reveal(b) {
  const d = b.closest(".est");
  const ctrl = d.querySelector("input[type=range],select");
  const a = d.querySelector(".est-a");
  const unit = d.dataset.unit || "";
  if (ctrl.tagName === "SELECT" && !ctrl.value) { ctrl.focus(); return; }
  const val = ctrl.value;
  let diff = "";
  if (ctrl.type === "range" && d.dataset.val !== "") {
    const dd = Number(val) - Number(d.dataset.val);
    diff = `You said ${val}${unit} – ${dd === 0 ? "exactly right." : `${Math.abs(dd)} points too ${dd > 0 ? "high" : "low"}.`}`;
    if (!d.querySelector(".est-mark")) {
      const m = document.createElement("div");
      m.className = "est-mark";
      m.innerHTML = `<i class="you" style="left:calc(${Number(val)}% - 1px)" title="your estimate"></i><i class="real" style="left:calc(${Number(d.dataset.val)}% - 1px)" title="the figure"></i>`;
      a.parentNode.insertBefore(m, a);
    }
  } else diff = `You said: ${val}.`;
  a.querySelector(".est-d").textContent = diff;
  a.hidden = false;
  b.disabled = true; b.textContent = "Revealed";
  ctrl.dispatchEvent(new Event("change", { bubbles: true }));   // keep the estimate even if the slider was not moved
  saveValue(d, ctrl.dataset.ex, ctrl.dataset.item + "_shown", "1");
  ctrl.disabled = true;
  refreshSoon();
}

// ------------------------------------------------------------------ administrator profile (Ex 1.10)
const PROF_LAND = {
  R: { n: "The Registrar", m: "“The record is the rule.”",
    s: "Predictability. You protect people from arbitrary decisions and make corruption harder, because the same rule applies to everyone who is on paper.",
    b: "The people who never got onto paper – customary holders, herders, the displaced. A perfect register of the wrong facts is still wrong." },
  M: { n: "The Mediator", m: "“A decision people accept is better than a decision that is merely correct.”",
    s: "Legitimacy. Your decisions last, because the people affected helped to make them.",
    b: "Speed and power. Negotiation takes time, and in a room where one party is far stronger, “agreement” can mean the weaker party gave in." },
  D: { n: "The Developer", m: "“Land should work.”",
    s: "Investment, jobs and revenue. You see what land could produce and you can turn a plan into a budget.",
    b: "Livelihoods that never appear in statistics – a pasture, a kitchen garden, a grave. Displacement is a cost even when it is not on the balance sheet." },
  S: { n: "The Steward", m: "“We hold the land for people who are not born yet.”",
    s: "The long view. You protect soil, water and forest, which take decades to recover and are easy to lose in a single decision.",
    b: "Present needs. A family that needs a house this winter may not be comforted by the condition of the floodplain in 2060." },
};
const OPP_LAND = { R: "M", M: "R", D: "S", S: "D" };
function showProfile(sec) {
  const box = sec.querySelector('[data-w="profile"]');
  const map = JSON.parse(box.dataset.map || "[]");
  const PROF = JSON.parse(box.dataset.types || "null") || PROF_LAND;
  const OPP = JSON.parse(box.dataset.opp || "null") || OPP_LAND;
  const K = Object.keys(PROF);
  const groups = $$(".mcq", sec);
  const sc = Object.fromEntries(K.map((k) => [k, 0]));
  let n = 0;
  groups.forEach((g, i) => {
    const c = g.querySelector("input:checked");
    if (!c || !map[i]) return;
    const k = map[i]["ABCD".indexOf(c.value)];
    if (k) { sc[k]++; n++; }
  });
  const total = map.length;
  if (n < total) { box.innerHTML = `<p class="miss">You have answered ${n} of the ${total} questions. Answer them all first.</p>`; return; }
  const keys = [...K].sort((a, b) => sc[b] - sc[a]);
  const top = keys[0], tie = sc[keys[1]] === sc[top], P = PROF[top];
  const bars = K.map((k) => `<div class="pb${sc[k] === sc[top] ? " top" : ""}"><span>${PROF[k].n.replace("The ", "")}</span><span class="tr"><i style="width:${(sc[k] / total) * 100}%"></i></span><span>${sc[k]}</span></div>`).join("");
  box.innerHTML = `<h5>${tie ? `A mixed profile: ${PROF[keys[0]].n} and ${PROF[keys[1]].n}` : P.n}</h5><p class="motto">${P.m}</p>${bars}
    <dl><dt>Your strength</dt><dd>${P.s}</dd><dt>Your blind spot</dt><dd>${P.b}</dd>
    <dt>The colleague you most need</dt><dd>${PROF[OPP[top]].n} – ${PROF[OPP[top]].m}</dd></dl>`;
}

// ------------------------------------------------------------------ footprint calculator (Ex 1.9)
// [food, one portion, kg per portion, m² of land per kg (Poore & Nemecek 2018), default portions a week]
const FOODS = [["Beef", "150 g", 0.15, 326.21, 2], ["Lamb or mutton", "150 g", 0.15, 369.81, 0], ["Pork", "150 g", 0.15, 17.36, 2],
  ["Chicken", "150 g", 0.15, 12.22, 3], ["Farmed fish", "150 g", 0.15, 8.41, 1], ["Cheese", "30 g", 0.03, 87.79, 5],
  ["Milk, kefir", "a glass, 250 ml", 0.25, 8.95, 7], ["Eggs", "two eggs", 0.12, 6.27, 3], ["Bread, pasta", "100 g", 0.1, 3.85, 10],
  ["Buckwheat, oats", "75 g", 0.075, 7.6, 3], ["Rice", "75 g", 0.075, 2.8, 2], ["Potatoes", "200 g", 0.2, 0.88, 4],
  ["Vegetables", "200 g", 0.2, 0.38, 7], ["Fruit", "one apple, 150 g", 0.15, 0.63, 7], ["Beans, peas, lentils", "100 g", 0.1, 15.57, 1],
  ["Tofu, soy milk", "100 g", 0.1, 3.52, 0], ["Nuts", "30 g", 0.03, 12.96, 1], ["Coffee", "a cup, 10 g beans", 0.01, 21.62, 10],
  ["Chocolate", "25 g", 0.025, 68.96, 2]];
function footprintHTML() {
  const rows = FOODS.map((f, i) => `<tr><td>${f[0]}</td><td>${f[1]}</td><td><input class="fp-in" type="number" min="0" max="50" step="1" value="${f[4]}" data-i="${i}" aria-label="${f[0]} portions per week"></td><td class="fp-m" data-m="${i}">0</td></tr>`).join("");
  return `<div class="wg" data-w="footprint"><div class="tw"><table class="fp-t"><thead><tr><th>Food</th><th>One portion</th><th>Portions a week</th><th>m² a year</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="fp-tot"><b class="fp-total">0</b> m² of farmland a year</div><div class="fp-cmp"></div><div class="fp-bars"></div>
    <div class="fp-btns"><button class="btn small" type="button" data-fp="veg">What if I ate no meat?</button><button class="btn small" type="button" data-fp="back">Back to my week</button></div>
    <span class="src">Figures: global average land use per kilogram of food, Poore &amp; Nemecek (2018), via Our World in Data. Averages hide huge differences: beef from a feedlot and beef from a mountain pasture use land very differently.</span></div>`;
}
function fpCalc(el) {
  const ins = $$(".fp-in", el);
  const parts = [];
  let tot = 0;
  ins.forEach((inp) => {
    const i = +inp.dataset.i, f = FOODS[i], n = Math.max(0, +inp.value || 0);
    const m = n * f[2] * f[3] * 52;
    tot += m; parts.push([f[0], m]);
    el.querySelector(`.fp-m[data-m="${i}"]`).textContent = fmtN(m);
  });
  el.querySelector(".fp-total").textContent = fmtN(tot);
  const ru = (tot * 146e6) / 1e6 / 1e6;
  const n = Math.min(400, Math.floor(tot / 100)), rest = tot / 100 - Math.floor(tot / 100);
  const sq = "<i></i>".repeat(n) + (n < 400 && rest > 0.05 ? '<i class="part"></i>' : "") + (tot / 100 > 400 ? ` <small>… and ${fmtN(tot / 100 - 400)} more</small>` : "");
  el.querySelector(".fp-cmp").innerHTML =
    `<div><span>tennis courts (261 m²)</span><b>${(tot / 261).toFixed(1)}</b></div>`
    + `<div><span>dacha plots of six sotki (600 m²)</span><b>${(tot / 600).toFixed(1)}</b></div>`
    + `<div><span>football pitches (7,140 m²)</span><b>${(tot / 7140).toFixed(2)}</b></div>`
    + `<div><span>world farmland per person (about 5,900 m²)</span><b>${Math.round((tot / 5900) * 100)}%</b></div>`
    + `<div><span>if 146 million people ate like you</span><b>${ru.toFixed(1)} million km²</b></div>`
    + `<div><span>… as a share of Russia’s whole territory (17.1 million km²)</span><b>${Math.round((ru / 17.1) * 100)}%</b></div>`
    + `<div class="fp-sq" title="each square is 100 m²">${sq}</div><span class="src">each square = 100 m²</span>`;
  parts.sort((a, b) => b[1] - a[1]);
  el.querySelector(".fp-bars").innerHTML = `<span class="bank-l">Where your land goes</span>` + parts.slice(0, 6).filter((p) => p[1] > 0)
    .map((p) => { const pc = tot ? (p[1] / tot) * 100 : 0; return `<div class="br"><span>${esc(p[0])}</span><span class="tr"><i style="width:${pc.toFixed(1)}%"></i></span><span class="pc">${Math.round(pc)}%</span></div>`; }).join("");
}
function fpButton(b) {
  const el = b.closest('[data-w="footprint"]');
  const ins = $$(".fp-in", el);
  if (b.dataset.fp === "veg") {
    if (!el._saved) el._saved = ins.map((x) => x.value);
    ins.forEach((x) => { if (+x.dataset.i <= 4) x.value = 0; });
    if (ins[14] && +ins[14].value < 3) ins[14].value = 3;
  } else if (el._saved) { ins.forEach((x, i) => (x.value = el._saved[i])); el._saved = null; }
  KEEP.set(keepKey(el), ins.map((x) => x.value));
  fpCalc(el);
}

// ------------------------------------------------------------------ a hundred hectares (Ex 1.11)
const COL = { house: "#C98B4B", logi: "#A8443A", farm: "#8FAF5E", graze: "#D2BE5A", forest: "#2F6B4F", serv: "#5A7A8C" };
const LAB = { house: "Housing", logi: "Logistics park", farm: "Smallholders", graze: "Grazing", forest: "Forest, wetland", serv: "Roads, school, clinic" };
const SIM0 = { house: 0, logi: 0, farm: 35, graze: 40, forest: 25, serv: 0 };
const SIMROWS = [["house", "Housing"], ["logi", "Logistics park (investor concession)"], ["farm", "Smallholder plots"], ["graze", "Community grazing"], ["forest", "Floodplain forest and wetland"], ["serv", "Roads, school, clinic"]];
function landsimHTML() {
  return `<div class="wg" data-w="landsim"><div class="sim"><div class="sim-left">
    ${SIMROWS.map(([u, l]) => `<div class="sim-r"><label>${l}</label><output class="sim-v">${SIM0[u]} ha</output><input type="range" class="sim-in" data-u="${u}" min="0" max="100" step="5" value="${SIM0[u]}" aria-label="${l}"></div>`).join("")}
    <div class="sim-left-f"><span class="sim-rest"></span><button class="btn small" type="button" data-sim-reset>Back to today</button></div></div>
    <div class="sim-right"><div class="sim-k"></div><div class="sim-st"></div><div class="sim-warn"></div></div></div>
    <span class="src">The model is deliberately simple and its numbers are invented for the exercise. It is a tool for arguing, not a forecast.</span></div>`;
}
function simReset(sec) {
  $$(".sim-in", sec).forEach((r) => (r.value = SIM0[r.dataset.u]));
  const el = sec.querySelector('[data-w="landsim"]');
  KEEP.delete(keepKey(el));
  simCalc(el);
}
function simCalc(el) {
  const v = {};
  $$(".sim-in", el).forEach((r) => { v[r.dataset.u] = +r.value; r.parentNode.querySelector(".sim-v").textContent = r.value + " ha"; });
  const sum = Object.values(v).reduce((a, b) => a + b, 0);
  const rest = el.querySelector(".sim-rest");
  rest.textContent = sum === 100 ? "All 100 ha allocated" : sum < 100 ? `${100 - sum} ha still to allocate` : `${sum - 100} ha too many`;
  rest.className = "sim-rest " + (sum === 100 ? "ok" : "bad");
  const homes = v.house * 30, jobs = v.logi * 25 + v.serv * 3;
  const lost = Math.round(Math.max(0, 40 - v.graze) * 1.5 + (Math.max(0, 35 - v.farm) * 45) / 35);
  const rev = v.logi * 1.2 + v.house * 0.4 + v.farm * 0.02 + v.graze * 0.01 - v.serv * 0.5;
  const flood = v.forest >= 20 ? "low" : v.forest >= 10 ? "medium" : "high";
  const cells = [];
  ["forest", "graze", "farm", "house", "serv", "logi"].forEach((k) => { for (let i = 0; i < v[k] && cells.length < 100; i++) cells.push(COL[k]); });
  while (cells.length < 100) cells.push("");
  const map = `<div class="sim-map" title="each square is one hectare">${cells.map((c) => `<i${c ? ` style="background:${c}"` : ""}></i>`).join("")}</div>`;
  const leg = `<div style="font-size:12px;color:var(--mut);margin:-2px 0 8px">${Object.keys(COL).map((k) => `<span style="white-space:nowrap;margin-right:10px"><span class="lg" style="background:${COL[k]}"></span>${LAB[k]}</span>`).join("")}</div>`;
  el.querySelector(".sim-k").innerHTML = map + leg + `<h6>The plan in numbers</h6>`
    + `<div class="kv"><span>New homes</span><b>${fmtN(homes)}</b></div>`
    + `<div class="kv"><span>New jobs</span><b>${fmtN(jobs)}</b></div>`
    + `<div class="kv"><span>Households losing the land they use</span><b>${lost}</b></div>`
    + `<div class="kv"><span>Net income for the town budget</span><b>${rev.toFixed(1)} million ₽ a year</b></div>`
    + `<div class="kv"><span>Spring flood risk</span><b>${flood}</b></div>`;
  const st = [["Herding households", clamp((v.graze / 40) * 100)], ["Smallholders", clamp((v.farm / 35) * 100)], ["The investor", clamp((v.logi / 30) * 100)],
    ["Families needing homes", clamp((v.house / 25) * 75 + (v.house > 0 ? Math.min(v.serv / 6, 1) * 25 : 0))],
    ["Environmental group", clamp((v.forest / 25) * 100 - v.logi * 0.8)], ["Finance department", clamp((rev / 35) * 100)]];
  let avg = 0, min = st[0];
  st.forEach((x) => { avg += x[1]; if (x[1] < min[1]) min = x; });
  avg = Math.round(avg / st.length);
  el.querySelector(".sim-st").innerHTML = `<h6>Who is satisfied?</h6>` + st.map((x) => {
    const c = x[1] >= 67 ? "var(--green)" : x[1] >= 34 ? "var(--ochre)" : "var(--clay)";
    return `<div class="br"><span>${x[0]}</span><span class="tr"><i style="width:${x[1]}%;background:${c}"></i></span><span class="pc">${x[1]}</span></div>`;
  }).join("") + `<p style="font-size:13.5px;margin:8px 0 0">Average satisfaction <b>${avg}</b> · worst-off group: <b>${min[0]}</b> (${min[1]})</p>`;
  const w = [];
  if (sum !== 100) w.push("The plan does not add up to 100 ha yet.");
  if (v.house > 0 && v.serv < Math.ceil(v.house * 0.25)) w.push("New homes but almost no roads, school or clinic: who will live there?");
  if (v.house > 0 && v.forest < 15) w.push("Homes on a floodplain with little forest left to hold the water.");
  if (lost > 30) w.push(`${lost} households lose land they depend on. Have you thought about compensation or relocation?`);
  el.querySelector(".sim-warn").innerHTML = w.map((x) => `<p>${x}</p>`).join("");
}

// ================================================================== speaking: timer + voice recorder
// The recording never leaves the browser: it is kept in memory as a blob, played back here and,
// if the student wants, saved to their own computer with "Download". Reloading the page clears it.
const SPK = new Map();   // key -> state (survives re-rendering of the page)
const fmtT = (s) => `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, "0")}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;
const RING = 2 * Math.PI * 14;

function speakingHTML(t, key) {
  const sec = Number(t.sec || 0), rec = t.record !== false;
  return `<div class="spk" data-spk="${esc(key)}" data-sec="${sec}" data-rec="${rec ? 1 : 0}">
    ${t.label ? `<span class="spk-lab">${esc(t.label)}</span>` : ""}
    ${sec ? `<svg class="spk-ring" viewBox="0 0 34 34" aria-hidden="true"><circle class="bgc" cx="17" cy="17" r="14"/><circle class="fgc" cx="17" cy="17" r="14" stroke-dasharray="${RING}" stroke-dashoffset="0"/></svg>
      <span class="spk-time">${fmtT(sec)}</span>` : ""}
    <div class="spk-btns">
      ${sec ? `<button class="btn small" type="button" data-spk-act="start">Start</button><button class="btn small" type="button" data-spk-act="reset">Reset</button>` : ""}
      ${rec ? `<button class="btn small rec" type="button" data-spk-act="rec"><span class="rec-dot"></span><span class="rl">Record</span></button>` : ""}
    </div>
    ${rec ? `<div class="spk-takes"></div><p class="spk-note">${sec ? "Record also starts the timer. " : ""}Your recording stays in this browser: nobody else hears it, and it disappears when you reload or close the page. Use Download to keep a copy.</p>` : ""}
  </div>`;
}
registerSpeaking(speakingHTML);

function state(el) {
  const key = el.dataset.spk;
  if (!SPK.has(key)) SPK.set(key, { sec: +el.dataset.sec, left: +el.dataset.sec, running: false, timer: null, rec: null, stream: null, takes: [], err: "" });
  return SPK.get(key);
}
const nodesOf = (key) => $$(`.spk[data-spk="${CSS.escape(key)}"]`);

function syncSpk(el) {
  const st = state(el);
  el.classList.toggle("run", st.running);
  el.classList.toggle("end", st.sec > 0 && st.left <= 0);
  const tm = el.querySelector(".spk-time");
  if (tm) tm.textContent = fmtT(st.left);
  const ring = el.querySelector(".fgc");
  if (ring) ring.setAttribute("stroke-dashoffset", String(RING * (1 - (st.sec ? st.left / st.sec : 0))));
  const sb = el.querySelector('[data-spk-act="start"]');
  if (sb) sb.textContent = st.running ? "Pause" : st.left < st.sec && st.left > 0 ? "Continue" : "Start";
  const rb = el.querySelector('[data-spk-act="rec"]');
  if (rb) { rb.classList.toggle("on", !!st.rec); rb.querySelector(".rl").textContent = st.rec ? "Stop recording" : "Record"; }
  const box = el.querySelector(".spk-takes");
  if (box) {
    const sig = st.takes.map((t) => t.url).join("|") + st.err;
    if (box.dataset.sig !== sig) {
      box.dataset.sig = sig;
      box.innerHTML = (st.err ? `<div class="spk-take" style="color:var(--bad)">${esc(st.err)}</div>` : "")
        + st.takes.map((t, i) => `<div class="spk-take"><span class="tk-n">Take ${i + 1}</span><audio controls src="${t.url}"></audio>
          <span class="muted" style="font-size:12px">${fmtT(Math.round(t.dur))}</span>
          <a href="${t.url}" download="${esc(t.name)}">Download</a></div>`).join("");
    }
  }
}
const syncKey = (key) => nodesOf(key).forEach(syncSpk);

function tick(key) {
  const st = SPK.get(key);
  st.left -= 1;
  if (st.left <= 0) {
    st.left = 0; stopTimer(st); beep();
    if (st.rec) stopRec(key);
  }
  syncKey(key);
}
function startTimer(key) {
  const st = SPK.get(key);
  if (!st.sec || st.running) return;
  if (st.left <= 0) st.left = st.sec;
  st.running = true;
  st.timer = setInterval(() => tick(key), 1000);
}
function stopTimer(st) { st.running = false; clearInterval(st.timer); st.timer = null; }

async function spkAction(b) {
  const el = b.closest(".spk"), key = el.dataset.spk, st = state(el), act = b.dataset.spkAct;
  if (act === "start") { st.running ? stopTimer(st) : startTimer(key); }
  if (act === "reset") { stopTimer(st); st.left = st.sec; if (st.rec) stopRec(key); }
  if (act === "rec") { st.rec ? stopRec(key) : await startRec(key); }
  syncKey(key);
}

function pickType() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"])
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  return "";
}
async function startRec(key) {
  const st = SPK.get(key);
  st.err = "";
  const type = pickType();
  if (type === null || !navigator.mediaDevices?.getUserMedia) { st.err = "This browser cannot record sound. Please try Chrome, Edge, Firefox or Safari."; return; }
  try {
    st.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    st.err = "The microphone is not available. Allow access to the microphone in the browser (the icon in the address bar) and try again.";
    return;
  }
  const rec = new MediaRecorder(st.stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  const t0 = Date.now();
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    const mime = rec.mimeType || type || "audio/webm";
    const blob = new Blob(chunks, { type: mime });
    const ext = /mp4/.test(mime) ? "m4a" : /ogg/.test(mime) ? "ogg" : "webm";
    const url = URL.createObjectURL(blob);
    st.takes.push({ url, dur: (Date.now() - t0) / 1000, name: `speaking-${key}-take${st.takes.length + 1}.${ext}` });
    st.stream?.getTracks().forEach((t) => t.stop());
    st.stream = null;
    syncKey(key);
  };
  rec.start(1000);
  st.rec = rec;
  if (st.sec && !st.running) startTimer(key);
}
function stopRec(key) {
  const st = SPK.get(key);
  if (!st?.rec) return;
  try { st.rec.stop(); } catch {}
  st.rec = null;
  if (st.running) stopTimer(st);
}

let actx = null;
function beep() {
  try {
    actx ??= new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = 880; g.gain.value = 0.08;
    o.connect(g); g.connect(actx.destination);
    o.start(); o.stop(actx.currentTime + 0.35);
  } catch {}
}


// ------------------------------------------------------------------ water on your plate (Unit 2)
// [food, one portion, kg (or litres) per portion, litres of water per kg, default portions a week]
// Global averages: Mekonnen & Hoekstra (2010, 2012), Water Footprint Network
const WFOODS = [["Beef", "150 g", 0.15, 15415, 2], ["Pork", "150 g", 0.15, 5988, 2], ["Chicken", "150 g", 0.15, 4325, 3],
  ["Cheese", "30 g", 0.03, 3178, 5], ["Milk, kefir", "a glass, 250 ml", 0.25, 1020, 7], ["Eggs", "two eggs", 0.12, 3265, 3],
  ["Bread", "100 g", 0.1, 1608, 10], ["Pasta (dry)", "75 g", 0.075, 1849, 3], ["Rice (dry)", "75 g", 0.075, 2497, 2],
  ["Potatoes", "200 g", 0.2, 287, 4], ["Vegetables", "200 g", 0.2, 322, 7], ["Fruit", "one apple, 150 g", 0.15, 962, 7],
  ["Beans, peas, lentils", "100 g", 0.1, 4055, 1], ["Coffee", "a cup, 7 g beans", 0.007, 18925, 10],
  ["Tea", "a cup, 3 g leaves", 0.003, 8856, 7], ["Chocolate", "25 g", 0.025, 17196, 2], ["Sugar", "two spoons, 10 g", 0.01, 1782, 14]];
function waterprintHTML() {
  const rows = WFOODS.map((f, i) => `<tr><td>${f[0]}</td><td>${f[1]}</td><td><input class="fp-in" type="number" min="0" max="60" step="1" value="${f[4]}" data-i="${i}" aria-label="${f[0]} portions per week"></td><td class="fp-m" data-m="${i}">0</td></tr>`).join("");
  return `<div class="wg" data-w="waterprint"><div class="tw"><table class="fp-t"><thead><tr><th>Food</th><th>One portion</th><th>Portions a week</th><th>litres a day</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="fp-tot"><b class="fp-total">0</b> litres of water a day hidden in your food</div><div class="fp-cmp"></div><div class="fp-bars"></div>
    <div class="fp-btns"><button class="btn small" type="button" data-wp="veg">What if I ate no meat?</button><button class="btn small" type="button" data-wp="back">Back to my week</button></div>
    <span class="src">Figures: global average water footprint per kilogram (rain water, irrigation water and the water needed to dilute pollution), Mekonnen &amp; Hoekstra (2010, 2012), Water Footprint Network. A kilogram of beef from a rain-fed pasture and one from an irrigated feedlot in a dry country put very different pressure on rivers.</span></div>`;
}
function wpCalc(el) {
  const ins = $$(".fp-in", el);
  const parts = [];
  let tot = 0;
  ins.forEach((inp) => {
    const i = +inp.dataset.i, f = WFOODS[i], n = Math.max(0, +inp.value || 0);
    const l = (n * f[2] * f[3]) / 7;
    tot += l; parts.push([f[0], l]);
    el.querySelector(`.fp-m[data-m="${i}"]`).textContent = fmtN(l);
  });
  el.querySelector(".fp-total").textContent = fmtN(tot);
  const year = tot * 365;
  const ru = (year * 146e6) / 1e12;   // km³ a year
  el.querySelector(".fp-cmp").innerHTML =
    `<div><span>bathtubs a day (about 150 litres each)</span><b>${(tot / 150).toFixed(1)}</b></div>`
    + `<div><span>times the water you drink (about 2 litres a day)</span><b>${fmtN(tot / 2)}</b></div>`
    + `<div><span>Olympic swimming pools a year (2.5 million litres)</span><b>${(year / 2.5e6).toFixed(2)}</b></div>`
    + `<div><span>if 146 million people ate like you, a year</span><b>${ru.toFixed(0)} km³</b></div>`
    + `<div><span>… compared with the Volga, which carries about 250 km³ a year to the Caspian</span><b>${Math.round((ru / 250) * 100)}%</b></div>`;
  parts.sort((a, b) => b[1] - a[1]);
  el.querySelector(".fp-bars").innerHTML = `<span class="bank-l">Where your water goes</span>` + parts.slice(0, 6).filter((p) => p[1] > 0)
    .map((p) => { const pc = tot ? (p[1] / tot) * 100 : 0; return `<div class="br"><span>${esc(p[0])}</span><span class="tr"><i style="width:${pc.toFixed(1)}%"></i></span><span class="pc">${Math.round(pc)}%</span></div>`; }).join("");
}
function wpButton(b) {
  const el = b.closest('[data-w="waterprint"]');
  const ins = $$(".fp-in", el);
  if (b.dataset.wp === "veg") {
    if (!el._saved) el._saved = ins.map((x) => x.value);
    ins.forEach((x) => { if (+x.dataset.i <= 2) x.value = 0; });
    if (ins[12] && +ins[12].value < 3) ins[12].value = 3;
  } else if (el._saved) { ins.forEach((x, i) => (x.value = el._saved[i])); el._saved = null; }
  KEEP.set(keepKey(el), ins.map((x) => x.value));
  wpCalc(el);
}

// ------------------------------------------------------------------ one river in a dry year (Unit 2)
// 100 units of water this month; in a normal year the river brings about 150.
const BCOL = { farm: "#8FAF5E", city: "#2C6B7E", mine: "#8A6A43", river: "#5FA8B8", down: "#A8743A", store: "#6E3B5E" };
const BLAB = { farm: "Irrigation", city: "City", mine: "Copper mine", river: "River and delta", down: "Downstream country", store: "Reservoir" };
const B0 = { farm: 45, city: 10, mine: 10, river: 15, down: 15, store: 5 };
const BROWS = [["farm", "Irrigation for 2,000 farms"], ["city", "Drinking water for a city of 400,000"], ["mine", "A copper mine (export earnings, 1,500 jobs)"],
  ["river", "Water left in the river for fish and the delta"], ["down", "Delivery to the downstream country"], ["store", "Water kept in the reservoir for winter electricity"]];
function basinHTML() {
  return `<div class="wg" data-w="basinsim"><div class="sim"><div class="sim-left">
    ${BROWS.map(([u, l]) => `<div class="sim-r"><label>${l}</label><output class="sim-v">${B0[u]} units</output><input type="range" class="sim-in" data-u="${u}" min="0" max="100" step="5" value="${B0[u]}" aria-label="${l}"></div>`).join("")}
    <div class="sim-left-f"><span class="sim-rest"></span><button class="btn small" type="button" data-basin-reset>Back to the usual plan</button></div></div>
    <div class="sim-right"><div class="sim-k"></div><div class="sim-st"></div><div class="sim-warn"></div></div></div>
    <span class="src">The river, the treaty and all the numbers are invented for the exercise. The model is a tool for arguing, not a forecast.</span></div>`;
}
function basinReset(sec) {
  $$(".sim-in", sec).forEach((r) => (r.value = B0[r.dataset.u]));
  const el = sec.querySelector('[data-w="basinsim"]');
  KEEP.delete(keepKey(el));
  basinCalc(el);
}
function basinCalc(el) {
  const v = {};
  $$(".sim-in", el).forEach((r) => { v[r.dataset.u] = +r.value; r.parentNode.querySelector(".sim-v").textContent = r.value + " units"; });
  const sum = Object.values(v).reduce((a, b) => a + b, 0);
  const rest = el.querySelector(".sim-rest");
  rest.textContent = sum === 100 ? "All 100 units allocated" : sum < 100 ? `${100 - sum} units still to allocate` : `${sum - 100} units more than the river carries`;
  rest.className = "sim-rest " + (sum === 100 ? "ok" : "bad");
  const harvest = Math.min(100, Math.round((v.farm / 60) * 100));
  const people = Math.round(Math.min(1, v.city / 12) * 400) * 1000;
  const jobs = Math.round(Math.min(1, v.mine / 10) * 1500);
  const health = v.river >= 20 ? "good" : v.river >= 10 ? "under stress" : "failing";
  const quota = 30, share = 20;   // the 1992 treaty fixed 30 units; a share of the flow would be 20% of 100
  const power = Math.min(100, Math.round((v.store / 15) * 100));
  const cells = [];
  ["river", "down", "farm", "city", "mine", "store"].forEach((k) => { for (let i = 0; i < v[k] && cells.length < 100; i++) cells.push(BCOL[k]); });
  while (cells.length < 100) cells.push("");
  const map = `<div class="sim-map" title="each square is one unit of water">${cells.map((c) => `<i${c ? ` style="background:${c}"` : ""}></i>`).join("")}</div>`;
  const leg = `<div style="font-size:12px;color:var(--mut);margin:-2px 0 8px">${Object.keys(BCOL).map((k) => `<span style="white-space:nowrap;margin-right:10px"><span class="lg" style="background:${BCOL[k]}"></span>${BLAB[k]}</span>`).join("")}</div>`;
  el.querySelector(".sim-k").innerHTML = map + leg + `<h6>This month in numbers</h6>`
    + `<div class="kv"><span>Harvest compared with a normal year</span><b>${harvest}%</b></div>`
    + `<div class="kv"><span>City residents with water all day</span><b>${fmtN(people)} of 400 000</b></div>`
    + `<div class="kv"><span>Jobs kept at the mine</span><b>${fmtN(jobs)}</b></div>`
    + `<div class="kv"><span>State of the river and the delta</span><b>${health}</b></div>`
    + `<div class="kv"><span>Treaty, fixed quota of 30 units</span><b>${v.down >= quota ? "met" : `short by ${quota - v.down}`}</b></div>`
    + `<div class="kv"><span>Treaty, if it were 20% of the flow</span><b>${v.down >= share ? "met" : `short by ${share - v.down}`}</b></div>`
    + `<div class="kv"><span>Winter electricity secured</span><b>${power}%</b></div>`;
  const st = [["Farmers", clamp((v.farm / 60) * 100)], ["City residents", clamp((v.city / 12) * 100)], ["The mining company", clamp((v.mine / 10) * 100)],
    ["Fishers and delta villages", clamp((v.river / 20) * 100)], ["The downstream country", clamp((v.down / quota) * 100)], ["The energy ministry", clamp((v.store / 15) * 100)]];
  let avg = 0, min = st[0];
  st.forEach((x) => { avg += x[1]; if (x[1] < min[1]) min = x; });
  avg = Math.round(avg / st.length);
  el.querySelector(".sim-st").innerHTML = `<h6>Who is satisfied?</h6>` + st.map((x) => {
    const c = x[1] >= 67 ? "var(--green)" : x[1] >= 34 ? "var(--ochre)" : "var(--clay)";
    return `<div class="br"><span>${x[0]}</span><span class="tr"><i style="width:${x[1]}%;background:${c}"></i></span><span class="pc">${x[1]}</span></div>`;
  }).join("") + `<p style="font-size:13.5px;margin:8px 0 0">Average satisfaction <b>${avg}</b> · worst-off group: <b>${min[0]}</b> (${min[1]})</p>`;
  const w = [];
  if (sum !== 100) w.push("The plan does not add up to 100 units.");
  if (v.city < 8) w.push("The city goes onto rationing: taps run for six hours a day. Who will the mayor blame?");
  if (v.river < 10) w.push("With so little water in the river, salinity and pollutants from the mine concentrate downstream.");
  if (v.down < 20) w.push("The downstream country protests that the treaty is being broken.");
  if (v.farm < 25) w.push("Farmers start pumping groundwater without permits, and the aquifer falls.");
  if (v.store > 20) w.push("Holding back this much water for winter power empties the river in summer.");
  el.querySelector(".sim-warn").innerHTML = w.map((x) => `<p>${x}</p>`).join("");
}
