// Teacher's Edition: unit preview with keys, unit access per group, releasing results,
// manual assessment of open answers, analytics, content import, groups and students.
import {
  auth, db, onAuthStateChanged, signInWithEmailAndPassword, sendPasswordResetEmail, signOut,
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where, orderBy,
  writeBatch, arrayUnion, arrayRemove, serverTimestamp, deleteField,
} from "./fb.js?v=20261021a";
import { COURSE_TITLE } from "./firebase-config.js?v=20261021a";
import {
  esc, renderBlocks, renderExercise, exercisesOf, isAuto, gradeAuto, buildResult, keyText, norm,
  fmtTime, friendlyError, authFormHTML, wireAuthForm, subId, KIND_LABEL, isTeacherChecked, gradeExercise, wireFlashcards, isManual,
  readInput, isCorrect, scoredItems, DONE, doneMap, PLAN_LABEL, ABSENT_FACTOR, planTag, hasItems, noStats, fmtDate, todayISO,
} from "./common.js?v=20261021a";
import { initShell, renderUnitNav, wireUnitNav } from "./shell.js?v=20261021a";
import { loadVocab, grammarCheck, vocabProfile, unitVocabulary, feedbackHTML, sleep } from "./writing.js?v=20261021a";
import "./widgets.js?v=20261021a";
import { initTheme } from "./theme.js?v=20261021a";

const $ = (s) => document.querySelector(s);
const ls = {
  get: (k, d) => { try { return localStorage.getItem("t:" + k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem("t:" + k, v); } catch {} },
};
const T = {
  user: null, groups: [], units: [], users: [], usersLoaded: false,
  gid: ls.get("gid", ""), unitId: ls.get("unit", ""),
  students: [], subs: [], results: {}, exr: {},
  unitData: {},          // unitId -> {content, keys, notes}
  selected: null,        // student uid opened in "Student work"
  includeDrafts: false,
  groupFilter: null,
  showCorrect: ls.get("showCorrect", "1") === "1",
  statsOn: ls.get("stats", "1") === "1",   // class answers shown inside the exercises
  tryVer: 0,
  tests: [], testsLoaded: false, testSel: null, attempts: [], testRes: {}, testContent: {},
  unsub: [], ctxUnsub: [],
};

const TOOLS = [
  { id: "access", icon: "🔓", title: "Access & results", sub: "Open units, release results" },
  { id: "works", icon: "📝", title: "Student work", sub: "Answers, open-answer marking" },
  { id: "journal", icon: "📅", title: "Attendance", sub: "Lessons, absences, lesson plan" },
  { id: "tests", icon: "⏱", title: "Tests", sub: "Timed tests: open, watch, check" },
  { id: "stats", icon: "📊", title: "Analytics", sub: "Difficult questions, heat map" },
  { id: "groups", icon: "👥", title: "Groups & students", sub: "Group codes, moving students" },
  { id: "content", icon: "📦", title: "Course content", sub: "Import units and keys" },
];

document.title = `Teacher's Edition · ${COURSE_TITLE}`;
document.querySelectorAll("[data-course-title]").forEach((el) => (el.textContent = COURSE_TITLE));
initShell();
initTheme();
wireFlashcards();
wireUnitNav($("#unit-nav"), () => renderNav());

function toast(t, ms = 3500) {
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = t;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}
async function guard(fn) {
  try { T.lastError = ""; return await fn(); } catch (e) { console.error(e); T.lastError = friendlyError(e); toast("Error: " + T.lastError, 6000); }
}

// ------------------------------------------------------------------ auth
$("#auth-screen").innerHTML = authFormHTML({ eyebrow: COURSE_TITLE, title: "Teacher's Edition", allowRegister: false });
wireAuthForm($("#auth-screen"), {
  async login(f) { await signInWithEmailAndPassword(auth, f.email.trim(), f.password); },
  async reset(f) { await sendPasswordResetEmail(auth, f.email.trim()); return "We have sent you a link to reset your password."; },
});
$("#logout").addEventListener("click", () => signOut(auth));
$("#logout2").addEventListener("click", (e) => { e.preventDefault(); signOut(auth); });

onAuthStateChanged(auth, async (user) => {
  T.unsub.forEach((u) => u()); T.unsub = [];
  T.ctxUnsub.forEach((u) => u()); T.ctxUnsub = []; ctxKey = "";
  T.user = user;
  $("#boot").hidden = true;
  $("#auth-screen").hidden = !!user;
  $("#app").hidden = true; $("#denied").hidden = true;
  if (!user) return;
  const t = await getDoc(doc(db, "teachers", user.uid)).catch(() => null);
  if (!t?.exists()) { $("#denied").hidden = false; return; }
  $("#app").hidden = false;
  $("#me-email").textContent = user.email;

  T.unsub.push(onSnapshot(collection(db, "groups"), (snap) => {
    T.groups = snap.docs.map((d) => ({ id: d.id, openUnits: [], releasedUnits: [], releasedEx: {}, feedbackEx: {}, tests: {}, ...d.data() }))
      .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
    if (!T.groups.find((g) => g.id === T.gid)) T.gid = T.groups[0]?.id || "";
    fillCtx(); subscribeCtx(); render();
  }));
  T.unsub.push(onSnapshot(query(collection(db, "units"), orderBy("order")), (snap) => {
    T.units = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (!T.units.find((u) => u.id === T.unitId)) T.unitId = (T.units.find((u) => u.status !== "soon") || T.units[0])?.id || "";
    fillCtx(); subscribeCtx(); render();
  }));
});

// ------------------------------------------------------------------ context: group + unit
function fillCtx() {
  $("#ctx-group").innerHTML = T.groups.map((g) => `<option value="${esc(g.id)}" ${g.id === T.gid ? "selected" : ""}>${esc(g.name || g.id)}</option>`).join("") || `<option value="">no groups yet</option>`;
  $("#ctx-unit").innerHTML = T.units.map((u, i) => `<option value="${esc(u.id)}" ${u.id === T.unitId ? "selected" : ""}>Unit ${u.order || i + 1}</option>`).join("") || `<option value="">no units yet</option>`;
}
$("#ctx-group").addEventListener("change", (e) => setGroup(e.target.value));
// one group is "current" for every page (access, student work, tests, analytics); it is remembered in this browser
function setGroup(id) {
  if (!id || !T.groups.some((g) => g.id === id)) return;
  T.gid = id; ls.set("gid", id); T.selected = null; T.groupFilter = null;
  $("#ctx-group").value = id;
  subscribeCtx();
  if (T.testSel) subscribeAttempts();
  render(true);
  toast(`Current group: ${group().name || id}`);
}
const groupBar = () => {
  const g = group();
  if (!g) return "";
  return `<div class="gbar"><span class="gbar-l">You are working with group</span>
    <select data-gpick aria-label="Current group">${T.groups.map((x) => `<option value="${esc(x.id)}" ${x.id === T.gid ? "selected" : ""}>${esc(x.name || x.id)}</option>`).join("")}</select>
    <span class="muted">Everything on this page, including tests, applies to this group only.</span></div>`;
};
$("#ctx-unit").addEventListener("change", (e) => setUnit(e.target.value));
function setUnit(id) {
  if (!id || id === T.unitId) return;
  T.unitId = id; ls.set("unit", id); T.selected = null;
  $("#ctx-unit").value = id;
  subscribeCtx(); render();
}

let ctxKey = "";
function subscribeCtx() {
  const key = T.gid + "|" + T.unitId;
  if (key === ctxKey) return;
  ctxKey = key;
  T.ctxUnsub.forEach((u) => u()); T.ctxUnsub = [];
  T.students = []; T.subs = []; T.results = {};
  if (!T.gid) return;
  // students of the group, their work and results — all in real time
  // attendance journal of the group (teacher-only document)
  T.journal = undefined;
  T.ctxUnsub.push(onSnapshot(journalRef(T.gid), (snap) => {
    T.journal = snap.exists() ? snap.data() : { lessons: {} };
    T.journal.lessons ??= {};
    render();
  }, () => { T.journal = { lessons: {}, error: true }; render(); }));
  T.ctxUnsub.push(onSnapshot(query(collection(db, "users"), where("groupId", "==", T.gid)), (snap) => {
    T.students = snap.docs.map((d) => ({ uid: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name));
    render();
  }));
  if (!T.unitId) return;
  loadUnitData(T.unitId).then(render);
  T.ctxUnsub.push(onSnapshot(query(collection(db, "submissions"), where("groupId", "==", T.gid), where("unitId", "==", T.unitId)), (snap) => {
    T.subs = snap.docs.map((d) => d.data());
    render();
  }));
  T.ctxUnsub.push(onSnapshot(query(collection(db, "exerciseResults"), where("groupId", "==", T.gid), where("unitId", "==", T.unitId)), (snap) => {
    T.exr = Object.fromEntries(snap.docs.map((d) => [d.data().uid, d.data()]));
    render();
  }));
  T.ctxUnsub.push(onSnapshot(query(collection(db, "results"), where("groupId", "==", T.gid), where("unitId", "==", T.unitId)), (snap) => {
    T.results = Object.fromEntries(snap.docs.map((d) => [d.data().uid, d.data()]));
    render();
  }));
}

async function loadUnitData(unitId, force = false) {
  if (T.unitData[unitId] && !force) return T.unitData[unitId];
  const [c, k] = await Promise.all([getDoc(doc(db, "unitContent", unitId)), getDoc(doc(db, "answerKeys", unitId))]);
  T.unitData[unitId] = {
    ver: (T.unitData[unitId]?.ver || 0) + 1,
    content: c.exists() ? c.data() : null,
    keys: k.exists() ? k.data().exercises || {} : {},
    notes: k.exists() ? k.data().notes || {} : {},
  };
  return T.unitData[unitId];
}

// ------------------------------------------------------------------ routing & sidebar
// #tools/<id>  — teaching tools;  #<unitId>/<sectionId> — unit with keys and notes
function route() {
  const [a, b] = location.hash.replace(/^#/, "").split("/");
  if (!a || a === "tools") return { tool: TOOLS.find((t) => t.id === b)?.id || "access" };
  return { unit: a, section: b || null };
}
window.addEventListener("hashchange", () => {
  const r = route();
  if (r.unit) setUnit(r.unit);
  T.selected = r.tool === "works" ? T.selected : null;
  render(true);
  window.scrollTo(0, 0);
});

const group = () => T.groups.find((g) => g.id === T.gid);
const unit = () => T.units.find((u) => u.id === T.unitId);
const unitNum = (u) => u.order || T.units.indexOf(u) + 1;

function renderNav() {
  const r = route();
  $("#tool-nav").innerHTML = TOOLS.map((t) => `<a class="sb-item ${r.tool === t.id ? "on" : ""}" href="#tools/${t.id}">
      <span class="ic">${t.icon}</span><span class="t">${t.title}<span class="s">${t.sub}</span></span></a>`).join("");
  const g = group();
  renderUnitNav($("#unit-nav"), {
    units: T.units,
    route: { unit: r.unit, section: r.section },
    empty: `No units yet. Import the course file in <a href="#tools/content">Course content</a>.`,
    state: (u) => {
      if (u.status === "soon") return { locked: false, note: "Coming soon", noteClass: "lock" };
      if (!g) return { locked: false, note: "" };
      if (g.releasedUnits.includes(u.id)) return { locked: false, note: `✓ Results released · ${esc(g.name)}`, noteClass: "good" };
      if (g.openUnits.includes(u.id)) return { locked: false, note: `Open for ${esc(g.name)}`, noteClass: "good" };
      return { locked: false, note: `Closed for ${esc(g.name)}`, noteClass: "lock" };
    },
  });
}

function render(force = false) {
  if (!T.user || $("#app").hidden) return;
  renderNav();
  const r0 = route();
  // the unit page: if only the students' answers have changed, update the class statistics in place
  // (the teacher's own answers, the flashcards and the recordings stay as they are)
  if (r0.unit && T.units.some((u) => u.id === r0.unit) && r0.unit === T.unitId) {
    const vk = unitViewKey(r0);
    if ($("#view").dataset.vk === vk) { patchStats(); return; }
  }
  // do not re-render while the teacher is typing a mark, comment or JSON
  const a = document.activeElement;
  if (!force && a && $("#view").contains(a) && a.matches(".g-score,.g-comment,textarea,input[type=text],input[type=date],input:not([type]),select")) return;
  // panels the teacher has opened (e.g. "Questions with keys") stay open when the page is refreshed
  const keepOpen = new Set([...document.querySelectorAll("#view details[data-keep][open]")].map((d) => d.dataset.keep));
  const y = window.scrollY;
  const r = route();
  if (r.unit && r.unit !== T.unitId && T.units.some((u) => u.id === r.unit)) { setUnit(r.unit); return; }
  $("#wrap").classList.toggle("wide", !!r.tool && r.tool !== "content");
  if (r.unit) {
    const sameSec = lastHash === location.hash;
    lastHash = location.hash;
    $("#view").innerHTML = viewUnit(r);
    $("#view").dataset.vk = unitViewKey(r);
    patchStats();
    if (sameSec) window.scrollTo(0, y);
    return;
  }
  $("#view").dataset.vk = "";
  const tool = TOOLS.find((t) => t.id === r.tool);
  $("#crumb").innerHTML = `<b>Teaching tools</b> &middot; ${tool.title}`;
  const views = { access: viewAccess, works: viewWorks, journal: viewJournal, tests: viewTests, stats: viewStats, content: viewContent, groups: viewGroups };
  let html = views[r.tool]();
  if (["access", "works", "journal", "tests", "stats"].includes(r.tool)) html = html.replace("</header>", "</header>" + groupBar());
  $("#view").innerHTML = html;
  $("#view").querySelectorAll("details[data-keep]").forEach((d) => { if (keepOpen.has(d.dataset.keep)) d.open = true; });
  if (location.hash === lastHash) window.scrollTo(0, y);   // same page refreshed: stay where the teacher was
  lastHash = location.hash;
}
let lastHash = null;

const pageHead = (eyebrow, title, lead = "") =>
  `<header class="page-h"><div class="pe">${eyebrow}</div><h2>${title}</h2>${lead ? `<p class="pl">${lead}</p>` : ""}</header>`;

// ================================================================== Unit with keys
function viewUnit(r) {
  const u = T.units.find((x) => x.id === r.unit);
  if (!u) return pageHead("Unit", "Unit not found");
  const n = unitNum(u);
  $("#crumb").innerHTML = `<b>Unit ${n}</b> &middot; ${esc(u.title)}`;
  const g = group();
  const bar = g && u.status !== "soon" ? accessBar(u, g) : "";
  if (u.status === "soon") return pageHead(`Unit ${n}`, esc(u.title)) + `<div class="locked-msg"><span class="big">🛠</span>This unit is still being prepared. Import its content in <a href="#tools/content">Course content</a>.</div>`;
  const d = T.unitData[u.id];
  if (!d) { loadUnitData(u.id).then(() => render(true)); return `<p class="muted">Loading…</p>`; }
  if (!d.content) return pageHead(`Unit ${n}`, esc(u.title)) + `<div class="locked-msg">This unit has no content yet.</div>`;
  const secs = d.content.sections;
  const sec = secs.find((s) => s.id === r.section) || secs[0];
  const i = secs.indexOf(sec);
  const meta = (u.sections || []).find((s) => s.id === sec.id) || {};
  $("#crumb").innerHTML = `<b>Unit ${n}</b> &middot; ${n}.${i + 1} ${esc(sec.title)}`;
  const blocks = [...sec.blocks];
  for (const note of [...(d.notes[sec.id] || [])].reverse()) blocks.splice(note.at, 0, { type: "teacher-note", html: note.html });
  const prev = secs[i - 1], next = secs[i + 1];
  const mine = tryAnswers(u.id);
  const statsShown = T.statsOn && !!g;
  return bar + statsBar(g) + pageHead(`Unit ${n} &middot; ${n}.${i + 1}`, esc(sec.title), esc(meta.subtitle || sec.subtitle || ""))
    + renderBlocks(blocks, (ex) => ({
      key: d.keys[ex.id] || {},
      // the teacher can type and choose too (nothing is saved to the database, only in this browser)
      answers: mine[ex.id] || {},
      readOnly: false,
      label: planTag(g?.plan?.[u.id]?.[ex.id]),
      tag: ex.check === "teacher" ? (isManual(ex) ? "Writing check by the teacher" : "Checked by the teacher") : "",
      top: g ? planBarHTML(u, ex, g) : "",
      itemStat: statsShown && isAuto(ex) && !noStats(ex) ? (itemId) => `<span class="st" data-st="${esc(ex.id)}:${esc(itemId)}"></span>` : null,
      before: ex.check === "teacher" && g ? (isManual(ex) ? writingBar(u, ex, g) : exerciseBar(u, ex, g)) : "",
    }), `${n}.${i + 1}`)
    + `<nav class="pager">
      ${prev ? `<a class="pg" href="#${u.id}/${prev.id}"><span class="d">Previous</span><span class="t">${n}.${i} ${esc(prev.title)}</span></a>` : ""}
      ${next ? `<a class="pg next" href="#${u.id}/${next.id}"><span class="d">Next</span><span class="t">${n}.${i + 2} ${esc(next.title)}</span></a>` : ""}
    </nav>`;
}

// ------------------------------------------------------------------ the teacher's own answers on the unit page
// kept in this browser only, so the teacher can open the lists and try the exercises in class
const tryLsKey = (unitId) => `try:${unitId}`;
function tryAnswers(unitId) {
  try { return JSON.parse(ls.get(tryLsKey(unitId), "{}")) || {}; } catch { return {}; }
}
function saveTry(el) {
  const r = route();
  if (!r.unit || !el.dataset?.item || !el.dataset.ex || el.matches(".g-score,.g-comment") || el.closest("#detail")) return;
  const v = readInput(el);
  if (v === null) return;
  const all = tryAnswers(r.unit);
  (all[el.dataset.ex] ??= {})[el.dataset.item] = v;
  ls.set(tryLsKey(r.unit), JSON.stringify(all));
}
$("#view").addEventListener("input", (e) => saveTry(e.target));
$("#view").addEventListener("change", (e) => saveTry(e.target));

function unitViewKey(r) {
  const g = group(), d = T.unitData[r.unit], u = T.units.find((x) => x.id === r.unit);
  return [r.unit, r.section || "", T.gid, T.statsOn ? 1 : 0, T.tryVer, u?.status, d ? d.ver : "none", T.students.length ? 1 : 0,
    JSON.stringify([g?.openUnits, g?.releasedUnits, g?.releasedEx?.[r.unit], g?.feedbackEx?.[r.unit], g?.plan?.[r.unit]])].join("|");
}

function statsBar(g) {
  if (!g) return "";
  return `<div class="ub stats-bar"><span>${T.statsOn
      ? `Class answers of group <b>${esc(g.name)}</b> are shown in the exercises, drafts included, and update live.`
      : `Class answers are hidden.`}</span>
    <span class="row">
      <button class="btn small" data-act="toggle-stats">${T.statsOn ? "Hide class answers" : "Show class answers"}</button>
      <button class="btn small" data-act="clear-try" title="Your own answers on this page are kept in this browser only">Clear my answers</button>
    </span></div>`;
}

// In-Class / HA and the "done" tick, for the current group: groups/{gid}.plan[unitId][exId] = {as, done, date}
function planBarHTML(u, ex, g) {
  const p = g.plan?.[u.id]?.[ex.id] || {};
  const btn = (v, t, title) => `<button type="button" class="${p.as === v ? "on" : ""} ${v}" data-act="plan-as" data-unit="${esc(u.id)}" data-ex="${esc(ex.id)}" data-as="${v}" title="${title}">${t}</button>`;
  return `<div class="ex-plan">
    <span class="seg" role="group" aria-label="Type of work">${btn("class", "In-Class", "Work done in class")}${btn("home", "HA", "Home assignment")}</span>
    <label class="cov" title="Tick when the exercise has been done with group ${esc(g.name)}"><input type="checkbox" data-plan-done data-unit="${esc(u.id)}" data-ex="${esc(ex.id)}" ${p.done ? "checked" : ""}> Done</label>
    ${p.done ? `<input type="date" class="cov-date" data-plan-date data-unit="${esc(u.id)}" data-ex="${esc(ex.id)}" value="${esc(p.date || "")}" title="The lesson when it was done">` : ""}
    <span class="ex-stats" data-exstats="${esc(ex.id)}"></span>
  </div>`;
}

// numbers of the exercises as the book prints them: {exId: "1.2.3"}
function exNumbers(u, content) {
  const out = {}, n0 = unitNum(u);
  (content?.sections || []).forEach((sec, si) => {
    let n = 0;
    for (const b of sec.blocks || []) {
      if (b.type === "flashcards" && b.numbered) n++;
      if (b.type === "exercise") out[b.id] = `${n0}.${si + 1}.${++n}`;
    }
  });
  return out;
}

// ------------------------------------------------------------------ class statistics inside the exercises
function exStats(ex, keys) {
  const items = {};
  for (const it of scoredItems(ex)) {
    const key = keys?.[it.id];
    let ok = 0, answered = 0; const wrong = {};
    for (const s of T.subs) {
      const g = s.answers?.[ex.id]?.[it.id];
      if (g == null || !String(g).trim()) continue;
      answered++;
      if (isCorrect(g, key, { lenient: ex.lenient })) ok++;
      else { const w = norm(g); wrong[w] ??= [String(g).trim(), 0]; wrong[w][1]++; }
    }
    items[it.id] = { ok, answered, wrong: Object.values(wrong).sort((a, b) => b[1] - a[1]) };
  }
  return items;
}
const pctClass = (p) => (p >= 80 ? "good" : p >= 50 ? "mid" : "low");
function patchStats() {
  const r = route();
  const d = T.unitData[r.unit];
  if (!r.unit || !d?.content) return;
  const exs = Object.fromEntries(exercisesOf(d.content).map((e) => [e.id, e]));
  const nSt = T.students.length;
  const cache = {};
  const statsOf = (ex) => (cache[ex.id] ??= exStats(ex, d.keys[ex.id]));
  document.querySelectorAll("#view [data-exstats]").forEach((el) => {
    const ex = exs[el.dataset.exstats];
    if (!ex) return;
    const doneN = T.subs.filter((s) => s.answers?.[DONE]?.[ex.id]).length;
    const answeredN = T.subs.filter((s) => Object.entries(s.answers?.[ex.id] || {}).some(([k, v]) => !k.endsWith("_shown") && String(v ?? "").trim())).length;
    let h = hasItems(ex) ? `<span class="xs-done" title="Students who clicked Done under this exercise">Done: <b>${doneN}</b> of ${nSt}</span>` : "";
    if (T.statsOn && hasItems(ex)) h += `<span class="xs-ans">answered: <b>${answeredN}</b></span>`;
    if (T.statsOn && isAuto(ex) && !noStats(ex)) {
      let ok = 0, n = 0;
      for (const st of Object.values(statsOf(ex))) { ok += st.ok; n += st.answered; }
      if (n) { const p = Math.round((100 * ok) / n); h += `<span class="st-b ${pctClass(p)}" title="${ok} of ${n} answers given so far are correct">${p}% correct</span>`; }
    }
    el.innerHTML = h;
  });
  if (!T.statsOn) return;
  document.querySelectorAll("#view [data-st]").forEach((el) => {
    const [exId, itemId] = el.dataset.st.split(":");
    const ex = exs[exId];
    if (!ex) return;
    const st = statsOf(ex)[itemId];
    if (!st) { el.innerHTML = ""; return; }
    if (!st.answered) { el.innerHTML = ""; return; }   // nobody has answered this item yet
    const p = Math.round((100 * st.ok) / st.answered);
    const tip = `${st.ok} of ${st.answered} answers are correct${nSt > st.answered ? `; ${nSt - st.answered} of ${nSt} students have not answered yet` : ""}`;
    const w = st.wrong.slice(0, 3).map(([a, c]) => `<span class="st-wa">${esc(a)}</span>${c > 1 ? ` ×${c}` : ""}`).join(", ");
    el.innerHTML = `<span class="st-b ${pctClass(p)}" title="${esc(tip)}">${st.ok}/${st.answered}</span>${w ? `<span class="st-w" title="Wrong answers">${w}${st.wrong.length > 3 ? " …" : ""}</span>` : ""}`;
  });
}

// ------------------------------------------------------------------ plan, ticks and the attendance journal
// the journal is kept in a teacher-only document (answerKeys/journal~<group>): students never receive it
const journalRef = (gid) => doc(db, "answerKeys", `journal~${gid}`);
async function ensureLesson(date) {
  if (!T.gid || !date || T.journal?.lessons?.[date]) return false;
  await setDoc(journalRef(T.gid), { groupId: T.gid, lessons: { [date]: { absent: [] } } }, { merge: true });
  return true;
}
// In-Class exercises done on a day when the student was absent count 25%: {exId: 0.25}
function factorsFor(uid, unitId, g = group()) {
  const out = {};
  for (const [exId, p] of Object.entries(g?.plan?.[unitId] || {}))
    if (p?.as === "class" && p.done && p.date && (T.journal?.lessons?.[p.date]?.absent || []).includes(uid)) out[exId] = ABSENT_FACTOR;
  return out;
}
async function setPlanAs(unitId, exId, as) {
  await guard(async () => {
    const p = group()?.plan?.[unitId]?.[exId] || {};
    await updateDoc(doc(db, "groups", T.gid), { [`plan.${unitId}.${exId}.as`]: p.as === as ? "" : as });
    if (p.as !== as && as === "class" && p.done && await ensureLesson(p.date)) toast(`The lesson of ${fmtDate(p.date)} has been added to Attendance (everyone present).`, 5000);
  });
}
async function setPlanDone(unitId, exId, done, date) {
  await guard(async () => {
    const p = group()?.plan?.[unitId]?.[exId] || {};
    const d = done ? date || p.date || todayISO() : "";
    await updateDoc(doc(db, "groups", T.gid), { [`plan.${unitId}.${exId}.done`]: !!done, [`plan.${unitId}.${exId}.date`]: d });
    if (done && p.as === "class" && await ensureLesson(d))
      toast(`The lesson of ${fmtDate(d)} has been added to Attendance (everyone present). Mark the absent students there.`, 6000);
  });
}
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.matches?.("input[data-plan-done]")) setPlanDone(t.dataset.unit, t.dataset.ex, t.checked);
  if (t.matches?.("input[data-plan-date]") && /^\d{4}-\d{2}-\d{2}$/.test(t.value)) setPlanDone(t.dataset.unit, t.dataset.ex, true, t.value);
});

function viewJournal() {
  const g = group();
  const head = pageHead("Teaching tools", "Attendance",
    `A student marked absent gets ${Math.round(ABSENT_FACTOR * 100)}% of the points for the In-Class exercises ticked as done on that day.`);
  if (!g) return head + `<div class="box">First create a group in <a href="#tools/groups">Groups &amp; students</a>.</div>`;
  if (T.journal === undefined) return head + `<p class="muted">Loading…</p>`;
  const L = T.journal.lessons || {};
  const days = Object.keys(L).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
  // exercises done on each day, in every unit
  const byDay = {};
  for (const u of T.units) for (const [exId, p] of Object.entries(g.plan?.[u.id] || {}))
    if (p?.done && p.date && p.as) (byDay[p.date] ??= []).push({ u, exId, as: p.as });
  const needData = [...new Set(Object.values(byDay).flat().map((x) => x.u.id))].filter((id) => !T.unitData[id]);
  if (needData.length) Promise.all(needData.map((id) => loadUnitData(id))).then(() => render(true));
  const exName = (u, exId) => {
    const c = T.unitData[u.id]?.content;
    const ex = c ? exercisesOf(c).find((e) => e.id === exId) : null;
    return ex ? `${exNumbers(u, c)[exId]} ${ex.title || ""}` : exId;
  };
  const isAbsent = (d, uid) => (L[d]?.absent || []).includes(uid);
  const reduced = (uid) => T.units.reduce((n, u) => n + Object.keys(factorsFor(uid, u.id, g)).length, 0);
  const nameOf = Object.fromEntries(T.students.map((s) => [s.uid, s.name]));
  const table = T.students.length
    ? `<div style="overflow-x:auto"><table class="t jt"><tr><th>Student</th>${days.map((d) => `<th class="jd"><span>${esc(fmtDate(d).slice(0, 5))}</span>
          <small class="muted">${(byDay[d] || []).filter((x) => x.as === "class").length} In-Class</small>
          <button type="button" class="jdel" data-act="j-del" data-day="${d}" title="Delete this lesson">Delete</button></th>`).join("")}
        <th>Absent</th><th title="In-Class exercises counted at ${Math.round(ABSENT_FACTOR * 100)}%">At ${Math.round(ABSENT_FACTOR * 100)}%</th></tr>
      ${T.students.map((st) => `<tr><td><b>${esc(st.name)}</b></td>${days.map((d) => `<td class="att-c"><button type="button" class="att ${isAbsent(d, st.uid) ? "a" : "p"}" data-act="j-att" data-day="${d}" data-uid="${esc(st.uid)}" title="Click to change">${isAbsent(d, st.uid) ? "absent" : "present"}</button></td>`).join("")}
        <td class="num">${days.filter((d) => isAbsent(d, st.uid)).length || ""}</td><td class="num">${reduced(st.uid) || ""}</td></tr>`).join("")}</table></div>`
    : `<div class="box">There are no students in this group yet.</div>`;
  const lessons = days.map((d) => {
    const list = byDay[d] || [];
    const abs = (L[d]?.absent || []).map((uid) => nameOf[uid]).filter(Boolean);
    return `<li><b>${esc(fmtDate(d))}</b>: ${list.length
      ? list.map((x) => `<a href="#${esc(x.u.id)}/${esc(sectionOf(x.u.id, x.exId))}">${x.as === "home" ? "HA" : "In-Class"} · Unit ${unitNum(x.u)} · ${esc(exName(x.u, x.exId))}</a>`).join("; ")
      : `<span class="muted">no exercises ticked as done on this day</span>`}${abs.length ? `<br><span class="muted">Absent: ${abs.map(esc).join(", ")}</span>` : ""}</li>`;
  }).join("");
  return head + `
    <div class="box"><div class="row">
      <label>Lesson date <input type="date" id="j-date" value="${todayISO()}"></label>
      <button class="btn primary" data-act="j-add">Add a lesson</button>
      <span class="muted">Everyone is present; click a student to mark them absent.</span></div>
      <p class="muted" style="margin:10px 0 0">A lesson is also added by itself when you tick an In-Class exercise as <b>Done</b> on the unit page. After changing attendance, check the exercise again (<b>Re-check</b>), or the whole unit in <a href="#tools/access">Access &amp; results</a>, so that the points are recalculated.</p>
      ${T.journal.error ? `<p style="color:var(--bad)">The attendance could not be loaded. Check the connection and reload the page.</p>` : ""}</div>
    ${days.length ? table : `<div class="box muted">No lessons yet.</div>`}
    ${days.length ? `<h3>What was done</h3><ul class="j-lessons">${lessons}</ul>` : ""}
    ${planTable(g)}`;
}
function sectionOf(unitId, exId) {
  const c = T.unitData[unitId]?.content;
  return c?.sections.find((s) => (s.blocks || []).some((b) => b.id === exId))?.id || "";
}
// the plan of the current unit: what is classwork, what is homework, what has been done
function planTable(g) {
  const u = unit(), d = u && T.unitData[u.id];
  if (!u || !d?.content) return "";
  const nums = exNumbers(u, d.content), plan = g.plan?.[u.id] || {};
  const rows = d.content.sections.map((sec) => (sec.blocks || []).filter((b) => b.type === "exercise").map((ex) => {
    const p = plan[ex.id] || {};
    return `<tr><td class="num">${nums[ex.id]}</td><td><a href="#${esc(u.id)}/${esc(sec.id)}">${esc(ex.title || "")}</a></td>
      <td>${p.as ? `<span class="ex-lab ${p.as}">${PLAN_LABEL[p.as]}</span>` : `<span class="muted">–</span>`}</td>
      <td>${p.done ? `✓ ${esc(fmtDate(p.date))}` : ""}</td></tr>`;
  }).join("")).join("");
  return `<h3>Lesson plan · Unit ${unitNum(u)} · group ${esc(g.name)}</h3>
    <p class="muted">Set In-Class / HA and tick Done above each exercise on the unit page.</p>
    <table class="t"><tr><th>#</th><th>Exercise</th><th>Type</th><th>Done</th></tr>${rows}</table>`;
}
async function journalAdd() {
  await guard(async () => {
    const day = $("#j-date")?.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "")) throw new Error("Choose the date of the lesson.");
    if (T.journal?.lessons?.[day]) { toast(`The lesson of ${fmtDate(day)} is already in the list.`); return; }
    await ensureLesson(day);
    toast(`Lesson of ${fmtDate(day)} added.`);
  });
}
async function journalToggle(day, uid) {
  const a = (T.journal?.lessons?.[day]?.absent || []).includes(uid);
  await guard(() => setDoc(journalRef(T.gid), { groupId: T.gid, lessons: { [day]: { absent: a ? arrayRemove(uid) : arrayUnion(uid) } } }, { merge: true }));
}
async function journalDelete(day) {
  if (!confirm(`Delete the lesson of ${fmtDate(day)}? Absences on that day will no longer reduce any points.`)) return;
  await guard(() => updateDoc(journalRef(T.gid), { [`lessons.${day}`]: deleteField() }));
}

// Exercises marked "check": "teacher" are checked one at a time, when the teacher decides
function exerciseBar(u, ex, g) {
  const done = (g.releasedEx?.[u.id] || []).includes(ex.id);
  return `<div class="ex-bar"><span>Group <b>${esc(g.name)}</b>: <span class="pill ${done ? "on" : "off"}">${done ? "checked · results shown" : "not checked yet"}</span></span>
    <span class="sp" style="flex:1"></span>
    ${done
      ? `<button class="btn small" data-act="check-ex" data-unit="${esc(u.id)}" data-ex="${esc(ex.id)}" title="Check again, e.g. for students who answered later">Re-check</button>
         <button class="btn small danger" data-act="uncheck-ex" data-unit="${esc(u.id)}" data-ex="${esc(ex.id)}">Hide results</button>`
      : `<button class="btn small good" data-act="check-ex" data-unit="${esc(u.id)}" data-ex="${esc(ex.id)}" ${g.openUnits.includes(u.id) ? "" : "disabled title=\"Open the unit for the group first\""}>Check this exercise now</button>`}
  </div>`;
}

async function checkExercise(gid, unitId, exId) {
  await guard(async () => {
    const { content, keys } = await loadUnitData(unitId, true);
    const ex = exercisesOf(content).find((e) => e.id === exId);
    if (!ex) throw new Error("Exercise not found.");
    const subs = (await getDocs(query(collection(db, "submissions"), where("groupId", "==", gid), where("unitId", "==", unitId)))).docs.map((d) => d.data());
    const answered = subs.filter((s) => Object.values(s.answers?.[exId] || {}).some((v) => String(v).trim()));
    if (!confirm(`Check “${ex.title}” for the group and show the students their results?\nStudents who have answered: ${answered.length} of ${T.students.length}.\nAfter this, students can no longer change their answers in this exercise.`)) return;
    let batch = writeBatch(db), n = 0;
    for (const s of subs) {
      const f = factorsFor(s.uid, unitId, T.groups.find((x) => x.id === gid))[exId] ?? 1;   // absent from the lesson: 25%
      const r = gradeExercise(ex, s.answers?.[exId], keys[exId], f);
      if (!T.showCorrect) for (const it of Object.values(r.items)) delete it.correct;
      batch.set(doc(db, "exerciseResults", subId(unitId, s.uid)), {
        uid: s.uid, groupId: gid, unitId,
        items: { [exId]: r.items }, scores: { [exId]: { score: r.score, max: r.max } }, factors: { [exId]: f },
        updatedAt: serverTimestamp(),
      }, { merge: true });
      if (++n % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
    }
    batch.update(doc(db, "groups", gid), { [`releasedEx.${unitId}`]: arrayUnion(exId) });
    await batch.commit();
    toast(`Exercise checked for ${subs.length} ${subs.length === 1 ? "student" : "students"}. They can see their results now.`);
  });
}

// Free writing ("kind": "open", "check": "teacher"): the check gives feedback, the text stays editable
function writingBar(u, ex, g) {
  const done = (g.feedbackEx?.[u.id] || []).includes(ex.id);
  return `<div class="ex-bar"><span>Group <b>${esc(g.name)}</b>: <span class="pill ${done ? "on" : "off"}">${done ? "feedback shown" : "not checked yet"}</span></span>
    <span class="sp" style="flex:1"></span>
    <span id="wcheck-progress" class="muted"></span>
    <button class="btn small good" data-act="check-writing" data-unit="${esc(u.id)}" data-ex="${esc(ex.id)}" ${g.openUnits.includes(u.id) ? "" : "disabled"}>${done ? "Check again" : "Check the writing now"}</button>
    ${done ? `<button class="btn small danger" data-act="hide-writing" data-unit="${esc(u.id)}" data-ex="${esc(ex.id)}">Hide feedback</button>` : ""}
  </div>`;
}

async function checkWriting(gid, unitId, exId) {
  await guard(async () => {
    const { content } = await loadUnitData(unitId, true);
    const ex = exercisesOf(content).find((e) => e.id === exId);
    const subs = (await getDocs(query(collection(db, "submissions"), where("groupId", "==", gid), where("unitId", "==", unitId)))).docs.map((d) => d.data())
      .filter((s) => Object.values(s.answers?.[exId] || {}).some((v) => String(v).trim()));
    if (!confirm(`Check the writing in “${ex.title}”?\nStudents with answers: ${subs.length}.\nThe texts are sent to LanguageTool for the grammar check (about 3 seconds per student). Students will see the feedback and can correct their texts.`)) return;
    const V = await loadVocab();
    const phrases = unitVocabulary(content);
    let n = 0, ltFailed = 0;
    for (const s of subs) {
      n++;
      const prog = document.querySelector("#wcheck-progress");
      if (prog) prog.textContent = `Checking ${n} of ${subs.length}…`;
      const texts = s.answers[exId] || {};
      let issues = {}, grammarError = false;
      try { issues = await grammarCheck(texts); } catch (e) { console.warn(e); grammarError = true; ltFailed++; }
      const fb = {};
      for (const it of ex.items || []) {
        const text = String(texts[it.id] || "");
        if (!text.trim()) continue;
        fb[it.id] = { text, issues: issues[it.id] || [], grammarError, vocab: vocabProfile(text, V, phrases), unitTotal: phrases.length };
      }
      await setDoc(doc(db, "exerciseResults", subId(unitId, s.uid)), {
        uid: s.uid, groupId: gid, unitId,
        feedback: { [exId]: fb }, feedbackAt: { [exId]: serverTimestamp() },
      }, { merge: true });
      if (n < subs.length && !grammarError) await sleep(3200);   // LanguageTool: at most 20 requests a minute
    }
    await updateDoc(doc(db, "groups", gid), { [`feedbackEx.${unitId}`]: arrayUnion(exId) });
    toast(ltFailed ? `Done. The grammar check was not available for ${ltFailed} of ${subs.length}; the vocabulary check worked.` : `Done: ${subs.length} texts checked. Students can see the feedback now.`, 7000);
  });
}

function accessBar(u, g) {
  const open = g.openUnits.includes(u.id), rel = g.releasedUnits.includes(u.id);
  return `<div class="ub"><span>Group <b>${esc(g.name)}</b>:
      <span class="pill ${open ? "on" : "off"}">${open ? "open" : "closed"}</span>
      <span class="pill ${rel ? "on" : "off"}">${rel ? "results released" : "results hidden"}</span></span>
    <span class="row">
      <button class="btn small" data-act="toggle-open" data-unit="${esc(u.id)}">${open ? "Close for the group" : "Open for the group"}</button>
      ${rel ? `<button class="btn small danger" data-act="unrelease" data-unit="${esc(u.id)}">Hide results</button>`
            : `<button class="btn small good" data-act="release" data-unit="${esc(u.id)}" ${open ? "" : "disabled"}>Check &amp; release results</button>`}
    </span></div>`;
}

// ================================================================== Access & results
function viewAccess() {
  const g = group();
  const head = pageHead("Teaching tools", "Access &amp; results",
    "Students see changes immediately, without reloading the page.");
  if (!g) return head + `<div class="box">First create a group in <a href="#tools/groups">Groups &amp; students</a>.</div>`;
  const rows = T.units.map((u) => {
    const soon = u.status === "soon";
    const open = g.openUnits.includes(u.id), rel = g.releasedUnits.includes(u.id);
    return `<tr>
      <td class="num">${unitNum(u)}</td>
      <td><a href="#${esc(u.id)}">${esc(u.title)}</a></td>
      <td>${soon ? `<span class="pill off">coming soon</span>` : `<span class="pill ${open ? "on" : "off"}">${open ? "open" : "closed"}</span>
        <button class="btn small" data-act="toggle-open" data-unit="${esc(u.id)}">${open ? "Close" : "Open"}</button>`}</td>
      <td>${soon ? "" : `<span class="pill ${rel ? "on" : "off"}">${rel ? "released" : "hidden"}</span>
        ${rel
          ? `<button class="btn small" data-act="release" data-unit="${esc(u.id)}" title="Re-check, e.g. for work submitted late">Re-check</button>
             <button class="btn small danger" data-act="unrelease" data-unit="${esc(u.id)}">Hide</button>`
          : `<button class="btn small good" data-act="release" data-unit="${esc(u.id)}" ${open ? "" : "disabled"}>Check &amp; release</button>`}`}</td>
    </tr>`;
  }).join("");
  return head + `
  <div class="box"><b>Group: ${esc(g.name)}</b> <span class="muted">(code <code>${esc(g.id)}</code>)</span><br>
  <span class="muted">“Check &amp; release” marks all <b>submitted</b> work of the group against the keys, saves the results and shows them to the students. After that students can no longer change their answers.</span>
  <label class="row" style="margin-top:10px"><input type="checkbox" id="show-correct" ${T.showCorrect ? "checked" : ""}> Show students the correct answers to their mistakes</label></div>
  <table class="t"><tr><th>#</th><th>Unit</th><th>Access for the group</th><th>Results</th></tr>${rows}</table>`;
}

document.addEventListener("change", (e) => {
  if (e.target.id === "show-correct") { T.showCorrect = e.target.checked; ls.set("showCorrect", T.showCorrect ? "1" : "0"); }
  if (e.target.id === "inc-drafts") { T.includeDrafts = e.target.checked; render(true); }
  if (e.target.id === "g-filter") { T.groupFilter = e.target.value; render(true); }
  if (e.target.matches("select[data-gpick]")) setGroup(e.target.value);
  if (e.target.matches("select[data-move]")) guard(async () => {
    await updateDoc(doc(db, "users", e.target.dataset.move), { groupId: e.target.value });
    toast("The student has been moved to another group.");
    await loadAllUsers();
  });
  if (e.target.id === "import-file") {
    const f = e.target.files[0];
    if (f) f.text().then((t) => { $("#import-text").value = t; });
  }
});

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  e.preventDefault();
  const act = b.dataset.act, u = b.dataset.unit;
  const handlers = {
    "toggle-open": () => guard(async () => {
      const open = group().openUnits.includes(u);
      await updateDoc(doc(db, "groups", T.gid), { openUnits: open ? arrayRemove(u) : arrayUnion(u) });
    }),
    "release": () => releaseUnit(T.gid, u),
    "plan-as": () => setPlanAs(u, b.dataset.ex, b.dataset.as),
    "toggle-stats": () => { T.statsOn = !T.statsOn; ls.set("stats", T.statsOn ? "1" : "0"); render(true); },
    "clear-try": () => {
      const r = route();
      if (!r.unit || !confirm("Clear everything you have typed and chosen in this unit? (This does not touch the students' answers.)")) return;
      ls.set(tryLsKey(r.unit), "{}"); T.tryVer++; render(true);
    },
    "j-add": () => journalAdd(),
    "j-att": () => journalToggle(b.dataset.day, b.dataset.uid),
    "j-del": () => journalDelete(b.dataset.day),
    "check-ex": () => checkExercise(T.gid, u, b.dataset.ex),
    "check-writing": () => checkWriting(T.gid, u, b.dataset.ex),
    "hide-writing": () => guard(async () => updateDoc(doc(db, "groups", T.gid), { [`feedbackEx.${u}`]: arrayRemove(b.dataset.ex) })),
    "uncheck-ex": () => guard(async () => {
      if (!confirm("Hide the results of this exercise from the students? They will be able to change their answers again.")) return;
      await updateDoc(doc(db, "groups", T.gid), { [`releasedEx.${u}`]: arrayRemove(b.dataset.ex) });
    }),
    "unrelease": () => guard(async () => {
      if (!confirm("Hide the results from the students? Students will again be able to edit drafts they have not submitted.")) return;
      await updateDoc(doc(db, "groups", T.gid), { releasedUnits: arrayRemove(u) });
    }),
    "select-student": () => { T.selected = b.dataset.uid; if (route().tool !== "works") location.hash = "#tools/works"; else render(true); setTimeout(() => $("#detail")?.scrollIntoView({ behavior: "smooth" }), 50); },
    "save-grades": () => saveGrades(b.dataset.uid),
    "return": () => guard(async () => {
      const note = prompt("Return this work to the student for revision.\nComment for the student (optional): what should be improved?", "");
      if (note === null) return;
      await updateDoc(doc(db, "submissions", subId(T.unitId, b.dataset.uid)), { status: "draft", returnNote: note.trim().slice(0, 1000), returnedAt: serverTimestamp() });
      toast("The work has been returned to the student.");
    }),
    "import": () => importCourse(),
    "delete-unit": () => deleteUnit(u),
    "create-group": () => createGroup(),
    "load-users": () => loadAllUsers(),
    "test-open": () => openTest(b.dataset.key),
    "test-close": () => guard(async () => {
      if (!confirm(`Close the test for group ${group()?.name || T.gid}? Students who have not finished will not be able to continue.`)) return;
      await updateDoc(doc(db, "groups", T.gid), { [`tests.${b.dataset.key}.open`]: false });
    }),
    "test-release": () => releaseTest(b.dataset.key),
    "test-unrelease": () => guard(async () => updateDoc(doc(db, "groups", T.gid), { [`tests.${b.dataset.key}.released`]: false })),
    "set-group": () => setGroup(b.dataset.gid),
    "test-select": () => { T.testSel = b.dataset.key; subscribeAttempts(); render(true); },
    "test-reset": () => guard(async () => {
      if (!confirm("Delete this student's attempt so that they can take the test again?")) return;
      const id = `${T.testSel}__${b.dataset.uid}`;
      await Promise.all([deleteDoc(doc(db, "testAttempts", id)), deleteDoc(doc(db, "testResults", id))]);
      toast("The student can start the test again.");
    }),
  };
  handlers[act]?.();
});

// Marking runs in the teacher's browser: only teachers are allowed to read the keys.
async function releaseUnit(gid, unitId) {
  await guard(async () => {
    const { content, keys } = await loadUnitData(unitId, true);
    if (!content) throw new Error("This unit has no content.");
    const subs = (await getDocs(query(collection(db, "submissions"), where("groupId", "==", gid), where("unitId", "==", unitId))))
      .docs.map((d) => d.data()).filter((s) => s.status === "submitted");
    const drafts = T.unitId === unitId ? T.subs.filter((s) => s.status === "draft").length : 0;
    if (!confirm(`Check the work and show the results to the students?\nSubmitted: ${subs.length}${drafts ? `\nNot submitted (drafts): ${drafts}. These will not be checked and can no longer be edited.` : ""}`)) return;
    const prev = Object.fromEntries((await getDocs(query(collection(db, "results"), where("groupId", "==", gid), where("unitId", "==", unitId))))
      .docs.map((d) => [d.data().uid, d.data()]));
    let batch = writeBatch(db), n = 0;
    for (const sub of subs) {
      const factors = factorsFor(sub.uid, unitId, T.groups.find((x) => x.id === gid));
      const r = buildResult({ sub, content, keys, manual: prev[sub.uid]?.manual || {}, showCorrect: T.showCorrect, factors });
      batch.set(doc(db, "results", subId(unitId, sub.uid)), { ...r, gradedAt: serverTimestamp() });
      if (++n % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
    }
    batch.update(doc(db, "groups", gid), { releasedUnits: arrayUnion(unitId) });
    await batch.commit();
    toast(`Done: ${subs.length} ${subs.length === 1 ? "piece of work" : "pieces of work"} checked. Students can see their results now.`);
  });
}

// ================================================================== Student work
function viewWorks() {
  const g = group(), u = unit();
  const head = pageHead("Teaching tools", "Student work",
    g && u ? `Unit ${unitNum(u)} · ${esc(u.title)} — group ${esc(g.name)}` : "");
  if (!g || !u) return head + `<div class="box">Choose a group and a unit at the top of the page.</div>`;
  const data = T.unitData[u.id];
  if (!data) return head + `<p class="muted">Loading…</p>`;
  if (!data.content) return head + `<div class="box">This unit has no content yet.</div>`;
  const subBy = Object.fromEntries(T.subs.map((s) => [s.uid, s]));
  const exs = exercisesOf(data.content);
  const totalItems = exs.reduce((n, ex) => n + (ex.items || []).length, 0);
  const openTotal = exs.filter((ex) => !isAuto(ex)).reduce((n, ex) => n + ex.items.length, 0);
  const need = exs.filter(hasItems);
  const rows = T.students.map((st) => {
    const s = subBy[st.uid], r = T.results[st.uid];
    const filled = s ? exs.reduce((n, ex) => n + (ex.items || []).filter((it) => String(s.answers?.[ex.id]?.[it.id] ?? "").trim()).length, 0) : 0;
    const fN = Object.keys(factorsFor(st.uid, u.id, g)).length;
    const auto = s ? gradeAuto(data.content, s.answers, data.keys, factorsFor(st.uid, u.id, g)) : null;
    const doneN = s ? need.filter((ex) => doneMap(s.answers)[ex.id] || (g.releasedEx?.[u.id] || []).includes(ex.id)).length : 0;
    const status = !s ? `<span class="pill off">not started</span>` : s.status === "submitted" ? `<span class="pill on">submitted</span>` : s.returnedAt ? `<span class="pill warn">returned</span>` : `<span class="pill warn">draft</span>`;
    const openDone = r ? openTotal - (r.manualPending ?? openTotal) : 0;
    return `<tr class="${T.selected === st.uid ? "sel" : ""}">
      <td><b>${esc(st.name)}</b><br><small class="muted">${esc(st.email)}</small></td>
      <td>${status}</td>
      <td>${s ? fmtTime(s.status === "submitted" ? s.submittedAt : s.updatedAt) : ""}</td>
      <td class="num">${filled} / ${totalItems}</td>
      <td class="num">${s ? `${doneN} / ${need.length}` : ""}</td>
      <td class="num">${auto ? `${auto.score} / ${auto.max}` : ""}${fN ? `<br><span class="pill warn" title="Absent: ${fN} In-Class ${fN === 1 ? "exercise counts" : "exercises count"} ${Math.round(ABSENT_FACTOR * 100)}%">absent · ${fN}</span>` : ""}</td>
      <td class="num">${openTotal ? `${openDone} / ${openTotal}` : "—"}</td>
      <td class="num">${r ? `<b>${r.score} / ${r.max}</b>` : ""}</td>
      <td>${s ? `<button class="btn small" data-act="select-student" data-uid="${esc(st.uid)}">Open</button>` : ""}</td>
    </tr>`;
  }).join("");
  return head + `
    <p class="muted">The table updates live while students work. “Done” counts the exercises the student has marked as done. “Auto” is a preliminary score against the keys (students do not see it until you release the results); missed classwork already counts at 25% there. “Open” shows how many open answers you have already marked.</p>
    <table class="t"><tr><th>Student</th><th>Status</th><th>Last change</th><th>Answered</th><th title="Exercises the student has marked as done">Done</th><th>Auto</th><th>Open</th><th>Total</th><th></th></tr>
    ${rows || `<tr><td colspan="9" class="muted">There are no students in this group yet.</td></tr>`}</table>
    <div id="detail">${T.selected ? studentDetail(T.selected, data) : ""}</div>`;
}

function studentDetail(uid, data) {
  const st = T.students.find((s) => s.uid === uid);
  const sub = T.subs.find((s) => s.uid === uid);
  if (!st || !sub) return "";
  const r = T.results[uid];
  const auto = gradeAuto(data.content, sub.answers, data.keys, factorsFor(uid, T.unitId));
  const u = unit(), n = unitNum(u);
  const body = data.content.sections.map((sec, i) => {
    const exs = (sec.blocks || []).filter((b) => b.type === "exercise");
    if (!exs.length) return "";
    return `<h3>${n}.${i + 1} ${esc(sec.title)}</h3>` + exs.map((ex, j) => renderExercise(ex, {
      num: `${n}.${i + 1}.${j + 1}`,
      answers: sub.answers?.[ex.id] || {},
      readOnly: true,
      auto: isAuto(ex) ? auto.items[ex.id] : undefined,
      manual: r?.manual?.[ex.id],
      grading: isManual(ex),
      itemExtra: T.exr?.[uid]?.feedback?.[ex.id] ? (itemId) => feedbackHTML(T.exr[uid].feedback[ex.id][itemId], { checkedAt: fmtTime(T.exr[uid].feedbackAt?.[ex.id]) }) : null,
    })).join("");
  }).join("");
  return `<div class="box">
    <div class="row" style="justify-content:space-between">
      <h2 style="margin:0">${esc(st.name)} <span class="muted" style="font-size:16px">· auto-checked ${auto.score}/${auto.max}</span></h2>
      <div class="row">
        ${sub.status === "submitted" && !group()?.releasedUnits.includes(T.unitId) ? `<button class="btn small" data-act="return" data-uid="${esc(uid)}">Return for revision</button>` : ""}
        <button class="btn small primary" data-act="save-grades" data-uid="${esc(uid)}">Save marks</button>
      </div>
    </div>
    <p class="muted">Green — correct; red — mistake, with the correct answer next to it. For open answers, enter a score and a comment, then click “Save marks”. If the results are already released, the student sees the mark immediately.</p>
    ${body}
    <div class="row"><button class="btn primary" data-act="save-grades" data-uid="${esc(uid)}">Save marks</button></div>
  </div>`;
}

async function saveGrades(uid) {
  await guard(async () => {
    const data = await loadUnitData(T.unitId);
    const sub = T.subs.find((s) => s.uid === uid);
    const manual = structuredClone(T.results[uid]?.manual || {});
    document.querySelectorAll("#detail .g-score").forEach((inp) => {
      const ex = inp.dataset.ex, it = inp.dataset.item;
      const com = document.querySelector(`#detail .g-comment[data-ex="${CSS.escape(ex)}"][data-item="${CSS.escape(it)}"]`);
      manual[ex] ??= {};
      manual[ex][it] = { score: inp.value === "" ? null : Number(inp.value), comment: com?.value || "" };
    });
    const showCorrect = T.results[uid]?.showCorrect ?? T.showCorrect;
    const r = buildResult({ sub, content: data.content, keys: data.keys, manual, showCorrect, factors: factorsFor(uid, T.unitId) });
    await setDoc(doc(db, "results", subId(T.unitId, uid)), { ...r, gradedAt: serverTimestamp() });
    document.activeElement?.blur();
    toast("Marks saved.");
    render(true);
  });
}

// ================================================================== Analytics
function viewStats() {
  const g = group(), u = unit();
  const head = pageHead("Teaching tools", "Analytics",
    g && u ? `Unit ${unitNum(u)} · ${esc(u.title)} — group ${esc(g.name)}` : "")
    + `<label class="row"><input type="checkbox" id="inc-drafts" ${T.includeDrafts ? "checked" : ""}> include drafts that have not been submitted</label>`;
  if (!g || !u) return head + `<div class="box">Choose a group and a unit at the top of the page.</div>`;
  const data = T.unitData[u.id];
  if (!data?.content) return head + `<p class="muted">No data.</p>`;
  const subs = T.subs.filter((s) => s.status === "submitted" || T.includeDrafts);
  const exs = exercisesOf(data.content);
  const nameOf = Object.fromEntries(T.students.map((s) => [s.uid, s.name]));
  if (!subs.length) return head + `<div class="box">No ${T.includeDrafts ? "work" : "submitted work"} yet.</div>`;

  // per question
  const items = [];
  for (const ex of exs) {
    if (!isAuto(ex)) continue;
    for (const it of ex.items) {
      const key = data.keys?.[ex.id]?.[it.id];
      let ok = 0; const wrong = {};
      for (const s of subs) {
        const given = s.answers?.[ex.id]?.[it.id] ?? "";
        if (norm(given) && (Array.isArray(key) ? key : [key]).some((k) => norm(k) === norm(given))) ok++;
        else { const w = norm(given) || "(blank)"; wrong[w] = (wrong[w] || 0) + 1; }
      }
      items.push({ ex, it, key, ok, n: subs.length, pct: Math.round((100 * ok) / subs.length), wrong: Object.entries(wrong).sort((a, b) => b[1] - a[1]) });
    }
  }
  // per student and exercise
  const perStudent = subs.map((s) => {
    const a = gradeAuto(data.content, s.answers, data.keys);
    const byEx = {};
    for (const ex of exs) if (isAuto(ex)) {
      const v = Object.values(a.items[ex.id] || {});
      byEx[ex.id] = v.length ? Math.round((100 * v.filter((x) => x.ok).length) / v.length) : null;
    }
    return { s, a, byEx, pct: a.max ? Math.round((100 * a.score) / a.max) : 0 };
  }).sort((x, y) => x.pct - y.pct);
  const avg = Math.round(perStudent.reduce((n, p) => n + p.pct, 0) / perStudent.length);
  const autoEx = exs.filter(isAuto);
  const openItems = exs.filter((ex) => !isAuto(ex)).reduce((n, ex) => n + ex.items.length, 0);
  const graded = Object.values(T.results).reduce((n, r) => n + (openItems - (r.manualPending ?? openItems)), 0);

  const wrongHTML = (w) => w.slice(0, 3).map(([ans, c]) => `“${esc(ans)}” ×${c}`).join(", ");
  const itemRow = (x) => `<tr>
      <td>${esc(x.ex.title)}<br><small class="muted">${esc(KIND_LABEL[x.ex.kind])}</small></td>
      <td>${esc(x.it.id)}. ${x.it.text.replace("___", "_____").replace(/<[^>]*>/g, "").slice(0, 90)}</td>
      <td><span class="keyhint" style="margin:0">${esc(keyText(x.key))}</span></td>
      <td class="num">${x.pct}%<div class="bar"><i style="width:${x.pct}%;background:${heat(x.pct)}"></i></div></td>
      <td class="wrong-list">${wrongHTML(x.wrong)}</td></tr>`;
  const hardest = [...items].sort((a, b) => a.pct - b.pct).slice(0, 10);

  return head + `
    <div class="cards">
      <div class="card"><b>${subs.length} / ${T.students.length}</b><span>pieces of work / students</span></div>
      <div class="card"><b>${avg}%</b><span>average auto-checked score</span></div>
      <div class="card"><b>${hardest[0] ? hardest[0].pct + "%" : "—"}</b><span>most difficult question</span></div>
      ${openItems ? `<div class="card"><b>${graded} / ${openItems * subs.length}</b><span>open answers marked</span></div>` : ""}
    </div>
    <h3>Questions students found most difficult</h3>
    <table class="t"><tr><th>Exercise</th><th>Question</th><th>Key</th><th>Correct</th><th>Most common mistakes</th></tr>${hardest.map(itemRow).join("")}</table>

    <h3>Results by student and exercise</h3>
    <div style="overflow-x:auto"><table class="t"><tr><th>Student</th><th>Total</th>${autoEx.map((ex) => `<th title="${esc(ex.title)}">${esc(ex.title.slice(0, 22))}</th>`).join("")}<th></th></tr>
    ${perStudent.map((p) => `<tr><td>${esc(nameOf[p.s.uid] || p.s.uid)}${p.s.status !== "submitted" ? ` <span class="pill warn">draft</span>` : ""}</td>
      <td class="num"><b>${p.a.score}/${p.a.max}</b> (${p.pct}%)</td>
      ${autoEx.map((ex) => `<td class="heat" style="background:${heat(p.byEx[ex.id], true)}">${p.byEx[ex.id] ?? "—"}%</td>`).join("")}
      <td><button class="btn small" data-act="select-student" data-uid="${esc(p.s.uid)}">Answers</button></td></tr>`).join("")}
    </table></div>

    <details data-keep="all-q"><summary>All questions in order (${items.length})</summary>
    <table class="t"><tr><th>Exercise</th><th>Question</th><th>Key</th><th>Correct</th><th>Wrong answers</th></tr>${items.map(itemRow).join("")}</table></details>`;
}
function heat(p, light) {
  if (p === null || p === undefined) return "transparent";
  const c = p >= 80 ? [29, 107, 69] : p >= 50 ? [192, 138, 46] : [162, 58, 42];
  return light ? `rgba(${c.join(",")},.15)` : `rgb(${c.join(",")})`;
}

// ================================================================== Course content
function viewContent() {
  const rows = T.units.map((u) => `<tr>
    <td class="num">${esc(u.order)}</td><td><code>${esc(u.id)}</code></td><td>${u.status === "soon" ? esc(u.title) : `<a href="#${esc(u.id)}">${esc(u.title)}</a>`}</td>
    <td>${u.status === "soon" ? `<span class="pill off">coming soon</span>` : `<span class="pill on">${(u.sections || []).length} sections</span>`}</td>
    <td><button class="btn small danger" data-act="delete-unit" data-unit="${esc(u.id)}">Delete</button></td></tr>`).join("");
  return pageHead("Teaching tools", "Course content", "Units are imported from a JSON file that you keep on your computer.") + `
  <div class="box">
    <h3 style="margin-top:0">Import units from JSON</h3>
    <p class="muted">Keep the course file on your computer, not in the public repository. On import, the <code>answer</code> fields are removed from the exercises and stored separately as keys, and <code>teacher-note</code> blocks become teaching notes. Students receive neither.
    Importing a unit with an existing <code>id</code> replaces it; students' answers are kept.</p>
    <div class="row"><input type="file" id="import-file" accept=".json,application/json"></div>
    <textarea class="json" id="import-text" placeholder='{"units":[{"id":"u1","order":1,"title":"…","sections":[…]}]}'></textarea>
    <div class="row"><button class="btn primary" data-act="import" id="import-btn">Import</button><span id="import-status" class="muted">${T.importStatus || ""}</span></div>
  </div>
  <table class="t"><tr><th>#</th><th>id</th><th>Unit</th><th>Status</th><th></th></tr>${rows || `<tr><td colspan="5" class="muted">The course is empty. Import a JSON file.</td></tr>`}</table>`;
}

// Strip the answers out of one exercise: returns the exercise for students and its keys
function stripExercise(b, seen, where) {
  if (!b.id || seen.has(b.id)) throw new Error(`Missing or repeated exercise id “${b.id}” (${where})`);
  seen.add(b.id);
  if (!KIND_LABEL[b.kind]) throw new Error(`Exercise ${b.id}: unknown kind “${b.kind}” (gap | match | mcq | open | estimate | rate)`);
  const keys = {};
  const items = (b.items || []).map((it) => {
    const { answer, ...rest } = it;
    if (it.id === undefined) throw new Error(`Exercise ${b.id}: an item has no id`);
    rest.id = String(it.id);
    if (!["open", "estimate", "rate"].includes(it.kind || b.kind) && b.graded !== false && it.graded !== false) {
      if (answer === undefined || answer === "") throw new Error(`Exercise ${b.id}, item ${it.id}: no answer`);
      keys[rest.id] = answer;
    }
    return rest;
  });
  return { ex: { ...b, type: "exercise", items }, keys };
}

function splitUnit(u) {
  if (!u.id || !/^[A-Za-z0-9_-]+$/.test(u.id)) throw new Error(`Invalid unit id “${u.id}” (use Latin letters, digits, - and _)`);
  if (!u.title) throw new Error(`Unit ${u.id} has no title`);
  const hasContent = Array.isArray(u.sections) && u.sections.some((s) => (s.blocks || []).length);
  const meta = {
    title: u.title, order: Number(u.order ?? 0),
    status: u.status || (hasContent ? "ready" : "soon"),
    sections: (u.sections || []).map((s) => ({ id: s.id, title: s.title, ...(s.subtitle ? { subtitle: s.subtitle } : {}) })),
  };
  // timed tests: hidden from students until the teacher opens them
  const tests = {}, testKeys = {};
  for (const t of u.tests || []) {
    if (!t.id || !/^[A-Za-z0-9_-]+$/.test(t.id) || tests[t.id]) throw new Error(`Unit ${u.id}: test with a missing or repeated id “${t.id}”`);
    if (!(Number(t.minutes) > 0)) throw new Error(`Test ${t.id}: set "minutes" (the time limit)`);
    const seenT = new Set(), keysT = {};
    // a test may also contain headings (html) and a recording (audio) between its exercises
    const exercises = (t.exercises || []).map((b) => {
      if (b.type && b.type !== "exercise") return b;
      const r = stripExercise(b, seenT, `${u.id}, test ${t.id}`); keysT[b.id] = r.keys; return r.ex;
    });
    tests[t.id] = { unitId: u.id, testId: t.id, title: t.title || "Test", minutes: Number(t.minutes), rubric: t.rubric || "", exercises };
    testKeys[t.id] = { title: t.title || "Test", minutes: Number(t.minutes), keys: keysT };
  }
  if (!hasContent) return { meta, tests, keys: Object.keys(tests).length ? { exercises: {}, notes: {}, tests: testKeys } : null };
  const keys = {}, notes = {}, seen = new Set();
  const sections = u.sections.map((s) => {
    if (!s.id || !s.title) throw new Error(`A section in unit ${u.id} has no id or title`);
    const blocks = [];
    for (const b of s.blocks || []) {
      if (b.type === "teacher-note") { (notes[s.id] ??= []).push({ at: blocks.length, html: b.html }); continue; }
      if (b.type !== "exercise") { blocks.push(b); continue; }
      const r = stripExercise(b, seen, u.id);
      keys[b.id] = r.keys;
      blocks.push(r.ex);
    }
    return { id: s.id, title: s.title, ...(s.subtitle ? { subtitle: s.subtitle } : {}), blocks };
  });
  return { meta, content: { sections }, tests, keys: { exercises: keys, notes, tests: testKeys } };
}

function setImportStatus(html) {
  T.importStatus = html;
  const el = $("#import-status");
  if (el) el.innerHTML = html;
}
async function importCourse() {
  const btn = $("#import-btn");
  if (btn) btn.disabled = true;
  setImportStatus("Importing…");
  // if the database does not confirm the import, say so instead of waiting silently
  const slow = setTimeout(() => setImportStatus("<b>Still waiting for the database…</b> Check the internet connection. If this message stays, reload the page and import again."), 20000);
  await guard(async () => {
    const raw = $("#import-text").value.trim();
    if (!raw) throw new Error("Paste JSON or choose a file.");
    let json;
    try { json = JSON.parse(raw); } catch (e) { throw new Error("The JSON has an error: " + e.message); }
    const list = json.units || [json];
    const parts = list.map(splitUnit);          // validate everything first
    const batch = writeBatch(db);
    parts.forEach((p, i) => {
      const id = list[i].id;
      batch.set(doc(db, "units", id), p.meta);
      if (p.content) batch.set(doc(db, "unitContent", id), p.content);
      if (p.keys) batch.set(doc(db, "answerKeys", id), p.keys);
      for (const [tid, t] of Object.entries(p.tests || {})) batch.set(doc(db, "testContent", `${id}--${tid}`), t);
    });
    await batch.commit();
    for (const l of list) delete T.unitData[l.id];
    T.testsLoaded = false;
    $("#import-text").value = "";
    const summary = parts.filter((p) => p.content).map((p, i) => {
      const u = list[parts.indexOf(p)];
      const nEx = p.content.sections.reduce((n, sec) => n + sec.blocks.filter((b) => b.type === "exercise" || b.numbered).length, 0);
      return `Unit ${u.order || i + 1}: ${p.content.sections.length} ${p.content.sections.length === 1 ? "section" : "sections"}, ${nEx} exercises`;
    }).join("; ");
    setImportStatus(`<b style="color:var(--ok)">✓ Imported ${parts.length} units at ${fmtTime(new Date())}.</b> ${esc(summary)}`);
    toast(`Units imported: ${parts.length}`);
    ctxKey = ""; subscribeCtx(); render(true);
  });
  clearTimeout(slow);
  if (btn) btn.disabled = false;
  if (T.importStatus === "Importing…") setImportStatus(`<b style="color:var(--bad)">The import did not work:</b> ${esc(T.lastError || "unknown error")}`);
}

async function deleteUnit(u) {
  if (!confirm(`Delete unit “${u}” together with its keys? Students' answers stay in the database.`)) return;
  await guard(async () => {
    await Promise.all(["units", "unitContent", "answerKeys"].map((c) => deleteDoc(doc(db, c, u))));
    toast("Unit deleted.");
  });
}

// ================================================================== Groups & students
function viewGroups() {
  if (!T.usersLoaded) setTimeout(loadAllUsers, 0);
  const counts = {};
  T.users.forEach((u) => (counts[u.groupId] = (counts[u.groupId] || 0) + 1));
  const filter = T.groupFilter ?? T.gid;
  const list = T.users.filter((u) => !filter || u.groupId === filter).sort((a, b) => a.name.localeCompare(b.name));
  return pageHead("Teaching tools", "Groups &amp; students", "Students enter the group code when they create an account.") + `
  <div class="box"><div class="row">
    <input id="g-name" placeholder="Group name, e.g. PA-21">
    <input id="g-code" placeholder="Code (optional)" style="width:12em">
    <button class="btn primary" data-act="create-group">Create group</button>
  </div><p class="muted" style="margin:8px 0 0">If you leave the code empty, one will be generated.</p></div>
  <table class="t"><tr><th>Code</th><th>Group</th><th>Students</th><th>Open units</th><th></th></tr>
  ${T.groups.map((g) => `<tr class="${g.id === T.gid ? "sel" : ""}"><td><code>${esc(g.id)}</code></td><td>${esc(g.name)}</td><td class="num">${T.usersLoaded ? counts[g.id] || 0 : "…"}</td><td>${g.openUnits.map((id) => { const u = T.units.find((x) => x.id === id); return u ? unitNum(u) : esc(id); }).join(", ") || "—"}</td>
      <td>${g.id === T.gid ? `<span class="pill on">current group</span>` : `<button class="btn small" data-act="set-group" data-gid="${esc(g.id)}">Work with this group</button>`}</td></tr>`).join("")
    || `<tr><td colspan="5" class="muted">No groups yet.</td></tr>`}</table>

  <h3>Students</h3>
  <div class="row">Show: <select id="g-filter"><option value="">all groups</option>${T.groups.map((g) => `<option value="${esc(g.id)}" ${filter === g.id ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select>
  <button class="btn small" data-act="load-users">Refresh</button></div>
  <table class="t"><tr><th>Name</th><th>Email</th><th>Group</th></tr>
  ${list.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td>
    <td><select data-move="${esc(u.uid)}">${T.groups.map((g) => `<option value="${esc(g.id)}" ${g.id === u.groupId ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select></td></tr>`).join("")
    || `<tr><td colspan="3" class="muted">${T.usersLoaded ? "No students" : "Loading…"}</td></tr>`}</table>`;
}

let loadingUsers = false;
async function loadAllUsers() {
  if (!T.user || loadingUsers) return;
  loadingUsers = true;
  await guard(async () => {
    const snap = await getDocs(collection(db, "users"));
    T.users = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    T.usersLoaded = true;
  });
  loadingUsers = false;
  T.usersLoaded = true;
  render(true);
}

async function createGroup() {
  await guard(async () => {
    const name = $("#g-name").value.trim();
    let code = $("#g-code").value.trim().toUpperCase();
    if (!name) throw new Error("Please enter a group name.");
    if (!code) {
      const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      code = "G-" + Array.from(crypto.getRandomValues(new Uint8Array(5)), (x) => abc[x % abc.length]).join("");
    }
    if (!/^[A-Z0-9-]{3,24}$/.test(code)) throw new Error("The code must be 3–24 characters: Latin letters, digits and hyphens.");
    if ((await getDoc(doc(db, "groups", code))).exists()) throw new Error("A group with this code already exists.");
    await setDoc(doc(db, "groups", code), { name, openUnits: [], releasedUnits: [], createdAt: serverTimestamp() });
    $("#g-name").value = ""; $("#g-code").value = "";
    document.activeElement?.blur();
    toast(`Group created. Code for students: ${code}`, 8000);
    loadAllUsers();
  });
}

// ================================================================== Timed tests
// Tests are described in course.json (unit.tests) and stored apart from the book:
// testContent/{unitId--testId} — questions; answerKeys/{unitId}.tests — keys.
async function loadTests() {
  if (T.testsLoading) return;
  T.testsLoading = true;
  const list = [];
  for (const u of T.units) {
    const k = await getDoc(doc(db, "answerKeys", u.id)).catch(() => null);
    for (const [tid, t] of Object.entries(k?.exists() ? k.data().tests || {} : {})) {
      list.push({ key: `${u.id}--${tid}`, unitId: u.id, testId: tid, title: t.title, minutes: t.minutes, keys: t.keys || {} });
    }
  }
  T.tests = list; T.testsLoaded = true; T.testsLoading = false;
  render(true);
}

let attUnsub = null, attKey = "";
function subscribeAttempts() {
  const key = `${T.gid}|${T.testSel}`;
  if (key === attKey) return;
  attKey = key; attUnsub?.(); T.attempts = []; T.testRes = {};
  if (!T.gid || !T.testSel) return;
  const u1 = onSnapshot(query(collection(db, "testAttempts"), where("groupId", "==", T.gid), where("testKey", "==", T.testSel)),
    (snap) => { T.attempts = snap.docs.map((d) => d.data({ serverTimestamps: "estimate" })); render(); });
  const u2 = onSnapshot(query(collection(db, "testResults"), where("groupId", "==", T.gid), where("testKey", "==", T.testSel)),
    (snap) => { T.testRes = Object.fromEntries(snap.docs.map((d) => [d.data().uid, d.data()])); render(); });
  attUnsub = () => { u1(); u2(); };
  if (!T.testContent?.[T.testSel]) getDoc(doc(db, "testContent", T.testSel)).then((d) => { (T.testContent ??= {})[T.testSel] = d.data(); render(); });
}
setInterval(() => { if (route().tool === "tests" && T.testSel) render(); }, 5000);

function viewTests() {
  const g = group();
  const head = pageHead("Teaching tools", "Tests", "Timed tests stay hidden from students until you open them for a group.");
  if (!g) return head + `<div class="box">First create a group in <a href="#tools/groups">Groups &amp; students</a>.</div>`;
  if (!T.testsLoaded) { loadTests(); return head + `<p class="muted">Loading…</p>`; }
  if (!T.tests.length) return head + `<div class="box">There are no tests in the course yet. Tests are added to a unit in the course file (<code>"tests"</code>) and imported in <a href="#tools/content">Course content</a>.</div>`;
  if (T.testSel) subscribeAttempts();
  const rows = T.tests.map((t) => {
    const cfg = g.tests?.[t.key];
    const u = T.units.find((x) => x.id === t.unitId);
    const status = cfg?.released ? `<span class="pill on">results shown</span>`
      : cfg?.open ? `<span class="pill warn">open now</span>`
      : cfg ? `<span class="pill off">closed</span>` : `<span class="pill off">hidden</span>`;
    return `<tr class="${T.testSel === t.key ? "sel" : ""}">
      <td><b>${esc(t.title)}</b><br><small class="muted">Unit ${u ? unitNum(u) : esc(t.unitId)}</small></td>
      <td class="num">${t.minutes} min</td>
      <td>${status}</td>
      <td class="row">
        ${cfg?.open ? `<button class="btn small" data-act="test-close" data-key="${esc(t.key)}">Close</button>`
                    : `<button class="btn small good" data-act="test-open" data-key="${esc(t.key)}">${cfg ? "Open again" : `Open for ${esc(g.name)}`}</button>`}
        ${cfg?.released ? `<button class="btn small danger" data-act="test-unrelease" data-key="${esc(t.key)}">Hide results</button>`
                        : cfg ? `<button class="btn small" data-act="test-release" data-key="${esc(t.key)}">Check &amp; show results</button>` : ""}
        <button class="btn small" data-act="test-select" data-key="${esc(t.key)}">Details</button>
      </td></tr>`;
  }).join("");
  return head + `<table class="t"><tr><th>Test</th><th>Time</th><th>Group ${esc(g.name)}</th><th></th></tr>${rows}</table>
    ${T.testSel ? testDetail(g) : ""}`;
}

function testDetail(g) {
  const t = T.tests.find((x) => x.key === T.testSel);
  const c = T.testContent?.[T.testSel];
  if (!t) return "";
  const byUid = Object.fromEntries((T.attempts || []).map((a) => [a.uid, a]));
  const now = Date.now();
  const rows = T.students.map((st) => {
    const a = byUid[st.uid], r = T.testRes?.[st.uid];
    let status = `<span class="pill off">not started</span>`, time = "";
    if (a) {
      const start = a.startedAt?.toMillis?.() || now, end = start + t.minutes * 60000;
      if (a.status === "submitted") { status = `<span class="pill on">submitted</span>`; time = fmtTime(a.updatedAt); }
      else if (now < end && g.tests?.[t.key]?.open) { status = `<span class="pill warn">in progress</span>`; time = `${Math.ceil((end - now) / 60000)} min left`; }
      else { status = `<span class="pill on">time over</span>`; time = fmtTime(a.updatedAt); }
    }
    let prelim = "";
    if (a && c) {
      let sc = 0, mx = 0;
      for (const ex of c.exercises || []) { const gr = gradeExercise(ex, a.answers?.[ex.id], t.keys[ex.id]); if (isAuto(ex)) { sc += gr.score; mx += gr.max; } }
      prelim = `${sc} / ${mx}`;
    }
    const answered = a ? Object.values(a.answers || {}).reduce((n, ex) => n + Object.values(ex).filter((v) => String(v).trim()).length, 0) : 0;
    return `<tr><td><b>${esc(st.name)}</b></td><td>${status}</td><td>${a ? fmtTime(a.startedAt) : ""}</td><td>${time}</td>
      <td class="num">${a ? answered : ""}</td><td class="num">${prelim}</td><td class="num">${r ? `<b>${r.score} / ${r.max}</b>` : ""}</td>
      <td>${a ? `<button class="btn small" data-act="test-reset" data-uid="${esc(st.uid)}">Allow a new attempt</button>` : ""}</td></tr>`;
  }).join("");
  const preview = c ? renderBlocks(c.exercises || [], (ex) => ({ key: t.keys[ex.id] || {}, readOnly: true })) : `<p class="muted">Loading…</p>`;
  return `<div class="box"><h2 style="margin-top:0">${esc(t.title)} <span class="muted" style="font-size:16px">· ${t.minutes} minutes · group ${esc(g.name)}</span></h2>
    <p class="muted">The table updates live. “Score” is preliminary; students see it only after “Check &amp; show results”.</p>
    <table class="t"><tr><th>Student</th><th>Status</th><th>Started</th><th>Time</th><th>Answered</th><th>Score</th><th>Released</th><th></th></tr>
    ${rows || `<tr><td colspan="8" class="muted">There are no students in this group yet.</td></tr>`}</table>
    <details data-keep="test-keys-${esc(t.key)}"><summary>Questions with keys</summary>${preview}</details></div>`;
}

async function openTest(key) {
  const t = T.tests.find((x) => x.key === key);
  await guard(async () => {
    if (!confirm(`Open “${t.title}” for group ${group()?.name || T.gid} now?\nEach student has ${t.minutes} minutes from the moment they click “Start the test”.`)) return;
    await updateDoc(doc(db, "groups", T.gid), {
      [`tests.${key}`]: { open: true, released: false, minutes: t.minutes, title: t.title, unitId: t.unitId, openedAt: serverTimestamp() },
    });
    T.testSel = key; subscribeAttempts();
    toast("The test is open. Students can see it in their sidebar.");
  });
}

async function releaseTest(key) {
  const t = T.tests.find((x) => x.key === key);
  await guard(async () => {
    const c = (await getDoc(doc(db, "testContent", key))).data();
    const atts = (await getDocs(query(collection(db, "testAttempts"), where("groupId", "==", T.gid), where("testKey", "==", key)))).docs.map((d) => d.data());
    if (!confirm(`Check the test and show the results to group ${group()?.name || T.gid}?\nAttempts: ${atts.length}. The test will be closed for this group.`)) return;
    let batch = writeBatch(db), n = 0;
    for (const a of atts) {
      const items = {}; let score = 0, max = 0;
      for (const ex of c.exercises || []) {
        if (!isAuto(ex)) continue;
        const gr = gradeExercise(ex, a.answers?.[ex.id], t.keys[ex.id]);
        if (!T.showCorrect) for (const it of Object.values(gr.items)) delete it.correct;
        items[ex.id] = gr.items; score += gr.score; max += gr.max;
      }
      batch.set(doc(db, "testResults", `${key}__${a.uid}`), { uid: a.uid, groupId: T.gid, testKey: key, items, score, max, gradedAt: serverTimestamp() });
      if (++n % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
    }
    batch.update(doc(db, "groups", T.gid), { [`tests.${key}.open`]: false, [`tests.${key}.released`]: true });
    await batch.commit();
    toast(`Checked: ${atts.length}. Students can see their results now.`);
  });
}
