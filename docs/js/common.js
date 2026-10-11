// Общие функции: отрисовка упражнений, автопроверка, подсчёт баллов.
// Используются и студенческой, и преподавательской страницей.

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Нормализация ответа перед сравнением с ключом:
// регистр, апострофы, пробелы, знаки препинания и сокращения (don't = do not) не важны
const CONTR = [[/\bcan't\b|\bcan not\b/g, "cannot"], [/\bwon't\b/g, "will not"], [/\bshan't\b/g, "shall not"],
  [/n't\b/g, " not"], [/'m\b/g, " am"], [/'re\b/g, " are"], [/'ve\b/g, " have"], [/'ll\b/g, " will"]];
export function norm(s) {
  let t = String(s ?? "")
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”"«»]/g, " ")
    .replace(/[,!?;:]/g, " ")
    .replace(/\.+(\s|$)/g, " ");
  for (const [re, to] of CONTR) t = t.replace(re, to);
  return t.replace(/\s+/g, " ").trim();
}

// Варианты ключа: "(that)" — необязательное слово, "he/she" — любое из слов
export function expandKey(k) {
  let out = [String(k ?? "")];
  for (let guard = 0; guard < 8; guard++) {
    const next = [];
    let changed = false;
    for (const v of out) {
      const m = v.match(/\(([^()]+)\)/);
      if (m) { changed = true; next.push(v.replace(m[0], m[1]), v.replace(m[0], "")); }
      else next.push(v);
    }
    out = next;
    if (!changed) break;
  }
  const slash = /([A-Za-z'’-]+(?:\/[A-Za-z'’-]+)+)/;
  for (let guard = 0; guard < 6; guard++) {
    const next = [];
    let changed = false;
    for (const v of out) {
      const m = v.match(slash);
      if (m) { changed = true; for (const w of m[1].split("/")) next.push(v.replace(m[1], w)); }
      else next.push(v);
    }
    out = next;
    if (!changed || out.length > 400) break;
  }
  return out;
}

export const KIND_LABEL = { gap: "Gap fill", match: "Matching", mcq: "Multiple choice", open: "Open answer", estimate: "Estimate", rate: "Rating" };
// an item is scored only if it has the exercise's own kind and is not marked "graded": false
export const scoredItems = (ex) => (ex.items || []).filter((it) => (!it.kind || it.kind === ex.kind) && it.graded !== false);
// auto-checked: has keys (not "open", not marked "graded": false)
export const isAuto = (ex) => !!ex.kind && !["open", "estimate", "rate"].includes(ex.kind) && ex.graded !== false;
// marked by the teacher by hand
export const isManual = (ex) => ex.kind === "open" && ex.graded !== false;
// checked by the teacher separately, exercise by exercise ("check": "teacher")
export const isTeacherChecked = (ex) => isAuto(ex) && ex.check === "teacher";
const NOAUTO = `autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"`;

export const subId = (unitId, uid) => `${unitId}__${uid}`;

export function exercisesOf(content) {
  const out = [];
  for (const s of content?.sections || [])
    for (const b of s.blocks || [])
      if (b.type === "exercise") out.push({ ...b, sectionId: s.id, sectionTitle: s.title });
  return out;
}

export function itemMax(ex, item) {
  return isManual(ex) ? Number(item.max ?? ex.max ?? 5) : 1;
}

export function keyText(key) {
  return Array.isArray(key) ? key.join(" / ") : String(key ?? "");
}

// the answer shown to the student after checking: the first accepted variant
export const firstKey = (key) => expandKey(Array.isArray(key) ? key[0] ?? "" : key ?? "")[0].replace(/\s+/g, " ").trim();

// "lenient": articles (a, an, the) and a leading "to" / "be" / "to be" do not matter
// (used where students write out phrases found in a text)
const loosen = (t) => t.replace(/\b(a|an|the)\b/g, " ").replace(/^\s*(to\s+)?(be\s+)?/, "").replace(/\s+/g, " ").trim();
export function isCorrect(given, key, opts = {}) {
  if (given == null || norm(given) === "") return false;
  const variants = (Array.isArray(key) ? key : [key]).flatMap(expandKey);
  // "'d" can mean "had" or "would": try both
  let gs = [norm(given)];
  for (let i = 0; i < 3 && gs.some((x) => /'d\b/.test(x)); i++)
    gs = gs.flatMap((x) => (/'d\b/.test(x) ? [x.replace(/'d\b/, " had"), x.replace(/'d\b/, " would")] : [x])).map((x) => x.replace(/\s+/g, " "));
  const keysN = new Set(variants.map(norm));
  if (opts.lenient) {
    const keysL = new Set([...keysN].map(loosen));
    return gs.some((x) => keysN.has(x) || keysL.has(loosen(x)));
  }
  return gs.some((x) => keysN.has(x));
}

// Автопроверка: answers = {exId:{itemId:value}}, keys = {exId:{itemId:answer}}
export function gradeAuto(content, answers, keys) {
  const items = {};
  let score = 0, max = 0;
  for (const ex of exercisesOf(content)) {
    if (!isAuto(ex)) continue;
    items[ex.id] = {};
    for (const it of scoredItems(ex)) {
      const given = answers?.[ex.id]?.[it.id] ?? "";
      const key = keys?.[ex.id]?.[it.id];
      const ok = isCorrect(given, key, { lenient: ex.lenient });
      items[ex.id][it.id] = { given, ok, correct: firstKey(key) };
      max += 1;
      if (ok) score += 1;
    }
  }
  return { items, score, max };
}

// Check one exercise (used when the teacher checks a single exercise)
export function gradeExercise(ex, answers, keys) {
  const items = {};
  let score = 0;
  const list = scoredItems(ex);
  for (const it of list) {
    const given = answers?.[it.id] ?? "";
    const key = keys?.[it.id];
    const ok = isCorrect(given, key, { lenient: ex.lenient });
    items[it.id] = { given, ok, correct: firstKey(key) };
    if (ok) score += 1;
  }
  return { items, score, max: list.length };
}

// Итоговый документ results/{unitId__uid}
export function buildResult({ sub, content, keys, manual = {}, showCorrect = true }) {
  const auto = gradeAuto(content, sub.answers, keys);
  if (!showCorrect)
    for (const ex of Object.values(auto.items)) for (const r of Object.values(ex)) delete r.correct;
  let mScore = 0, mMax = 0, pending = 0;
  for (const ex of exercisesOf(content)) {
    if (!isManual(ex)) continue;
    for (const it of scoredItems(ex)) {
      mMax += itemMax(ex, it);
      const g = manual?.[ex.id]?.[it.id];
      if (g && g.score !== null && g.score !== "" && g.score !== undefined) mScore += Number(g.score);
      else pending += 1;
    }
  }
  return {
    uid: sub.uid, groupId: sub.groupId, unitId: sub.unitId,
    auto: auto.items, manual,
    autoScore: auto.score, autoMax: auto.max,
    manualScore: mScore, manualMax: mMax, manualPending: pending,
    score: auto.score + mScore, max: auto.max + mMax,
    showCorrect,
  };
}

// ---------------------------------------------------------------------
//  Отрисовка
//  opts: {
//    answers: {itemId: value}   — ответы студента на это упражнение
//    readOnly: bool
//    key:     {itemId: answer}  — показать ключ (преподаватель)
//    auto:    {itemId: {given, ok, correct}} — результат автопроверки
//    manual:  {itemId: {score, comment}}     — ручная оценка
//    grading: bool              — поля для выставления оценки (преподаватель)
//  }
// ---------------------------------------------------------------------
export function renderBlocks(blocks, exOpts, numPrefix = "") {
  let n = 0;
  return (blocks || []).map((b) => {
    if (b.type === "html") return `<div class="block-html">${b.html}</div>`;
    if (b.type === "teacher-note") return `<div class="tnote"><div class="tn-h"><span class="tn-ic">T</span>Teaching notes</div><div class="tn-b">${b.html}</div></div>`;
    if (b.type === "flashcards") { if (b.numbered) n += 1; return renderFlashcards(b, b.numbered ? (numPrefix ? `${numPrefix}.${n}` : String(n)) : ""); }
    if (b.type === "image") return renderImages([b], b.layout);
    if (b.type === "images") return renderImages(b.items || [], b.layout || "grid");
    if (b.type === "audio") return renderAudio(b);
    if (b.type === "video") return renderVideo(b);
    if (b.type === "speaking") return `<div class="block-spk">${speakingHTML(b, "blk-" + (b.id || hashStr(JSON.stringify(b))))}</div>`;
    if (b.type === "exercise") { n += 1; return renderExercise(b, { num: numPrefix ? `${numPrefix}.${n}` : String(n), ...exOpts(b) }); }
    return "";
  }).join("\n");
}

export function renderExercise(ex, o = {}) {
  const a = o.answers || {};
  const dis = o.readOnly ? "disabled" : "";
  let scoreLine = "";
  if (o.auto && isAuto(ex)) {
    const vals = Object.values(o.auto);
    scoreLine = `<span class="ex-score">${vals.filter((v) => v.ok).length} / ${vals.length}</span>`;
  }
  const options = ex.kind === "match" && ex.showOptionList !== false
    ? `<div class="opt-list">${ex.optionLabel ? `<span class="bank-l">${esc(ex.optionLabel)}</span>` : ""}${(ex.options || []).map((op) => `<b>${esc(op.id)}</b>&nbsp;${op.text}`).join(" &nbsp;&middot;&nbsp; ")}</div>` : "";
  const bank = ex.bank ? `<div class="opt-list"><span class="bank-l">${esc(ex.bankLabel || "Word bank")}</span>${ex.bank.map((w) => esc(w)).join(" &nbsp;&middot;&nbsp; ")}</div>` : "";
  const teacher = isTeacherPage();

  const itemHTML = (it) => {
    const kind = it.kind || ex.kind;
    const val = a[it.id] ?? "";
    const r = o.auto?.[it.id];
    const mark = r ? (r.ok ? "ok" : "bad") : "";
    const attrs = `data-ex="${esc(ex.id)}" data-item="${esc(it.id)}" ${dis}`;
    const corr = r && !r.ok && r.correct ? `<span class="corr">Correct: ${esc(showAns(ex, r.correct))}</span>` : "";
    const keyHint = o.key && o.key[it.id] !== undefined ? `<span class="keyhint">✓ ${esc(showAns(ex, keyText(o.key[it.id])))}</span>` : "";
    let body = "";
    const play = it.audio ? itemPlayButton(it.audio, ex.once) : "";
    // "because …": an extra line that is saved but not marked (odd one out with a reason)
    const reason = it.reason ? `<div class="reason"><span class="rl">${esc(it.reason === true ? "because" : it.reason)}</span><input class="gap" data-ex="${esc(ex.id)}" data-item="${esc(it.id)}_r" ${dis} value="${esc(a[it.id + "_r"] ?? "")}" ${NOAUTO}></div>` : "";

    if (kind === "gap") {
      const size = it.size || ex.size || 14;
      const input = `<input class="gap ${ex.box ? "box" : ""} ${mark}" ${attrs} value="${esc(val)}" size="${size}" ${ex.box ? `style="width:${size + 1}ch"` : ""} ${NOAUTO}>`;
      body = it.text.includes("___") ? it.text.replace("___", input) : `<span class="li-t">${it.text}</span>${input}`;
      body += corr + keyHint;
    } else if (kind === "match") {
      const opts = (it.options ? it.options.map((t, i) => ({ id: "ABCDEFGHIJ"[i], text: t })) : ex.options || []).map((op) =>
        `<option value="${esc(op.id)}" ${val === op.id ? "selected" : ""}>${ex.plain || it.options ? "" : esc(op.id) + ". "}${esc(stripTags(op.text))}</option>`).join("");
      body = `<span class="m-word">${it.text}</span> <select class="gap ${mark}" ${attrs}><option value="">choose…</option>${opts}</select>${corr}${keyHint}`;
    } else if (kind === "mcq") {
      const name = `${ex.id}__${it.id}`;
      const letters = "ABCDEFGH";
      const opts = (it.options || ex.options || []).map((t, i) => {
        const L = letters[i];
        const cls = r && val === L ? (r.ok ? "ok" : "bad") : (o.key && o.key[it.id] === L ? "right" : "");
        return `<label class="${cls}"><input type="radio" name="${esc(name)}" value="${L}" ${val === L ? "checked" : ""} ${attrs}><span class="l">${L.toLowerCase()}</span><span>${t}</span></label>`;
      }).join("");
      body = `${it.text}<div class="mcq ${ex.columns === 2 ? "cols2" : ""} ${ex.scale ? "scale" : ""}">${opts}</div>${corr}`;
    } else if (kind === "estimate") {
      // a slider (or a short list) and a "Reveal" button; the figure is part of the book, not a key
      const shown = a[it.id + "_shown"] === "1" || teacher;
      const unit = it.unit ?? ex.unit ?? "%";
      const ctrl = it.options
        ? `<select class="gap" ${attrs} ${shown && !teacher ? "disabled" : ""}><option value="">choose…</option>${it.options.map((t) => `<option ${val === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`
        : `<input type="range" min="${it.min ?? 0}" max="${it.max ?? 100}" step="${it.step ?? 1}" value="${esc(val === "" ? it.start ?? 50 : val)}" ${attrs} ${shown && !teacher ? "disabled" : ""} aria-label="your estimate"><output class="est-o">${esc(val === "" ? it.start ?? 50 : val)}${esc(unit)}</output>`;
      let diff = "";
      if (shown && val !== "" && it.val !== undefined && !it.options) {
        const d = Number(val) - Number(it.val);
        diff = `You said ${esc(val)}${esc(unit)} – ${d === 0 ? "exactly right." : `${Math.abs(d)} points too ${d > 0 ? "high" : "low"}.`}`;
      } else if (shown && val !== "" && it.options) diff = `You said: ${esc(val)}.`;
      const markBar = shown && it.val !== undefined && !it.options && val !== ""
        ? `<div class="est-mark"><i class="you" style="left:calc(${Number(val)}% - 1px)" title="your estimate"></i><i class="real" style="left:calc(${Number(it.val)}% - 1px)" title="the figure"></i></div>` : "";
      body = `<div class="est" data-val="${esc(it.val ?? "")}" data-unit="${esc(unit)}">${it.text}<div class="est-row">${ctrl}<button class="btn small" type="button" data-reveal="1" ${shown || o.readOnly ? "disabled" : ""}>${shown ? "Revealed" : "Reveal"}</button></div>${markBar}
        <div class="est-a" ${shown ? "" : "hidden"}>${it.reveal || ""}<span class="est-d">${diff}</span>${it.source ? `<span class="src">${esc(it.source)}</span>` : ""}</div></div>`;
    } else if (kind === "rate") {
      // the same claim scored on two or more scales, e.g. "law" and "fairness" from 1 to 5
      const scales = ex.scales || [];
      const sel = scales.map((sc) => {
        const id = `${it.id}_${sc.id}`, v = a[id] ?? "";
        return `<span class="rl">${esc(sc.label)}</span><select class="gap" data-ex="${esc(ex.id)}" data-item="${esc(id)}" ${dis}><option value="">–</option>${(sc.values || [1, 2, 3, 4, 5]).map((x) => `<option ${String(x) === v ? "selected" : ""}>${x}</option>`).join("")}</select>`;
      }).join(" ");
      body = `${it.label ? `<b class="lab">${esc(it.label)}</b>` : ""}${it.text}<div class="reason">${sel}</div>`;
    } else if (kind === "open") {
      const m = o.manual?.[it.id];
      const max = itemMax(ex, it);
      let grade = "";
      const scored = kind === ex.kind && ex.graded !== false && it.graded !== false;
      if (o.grading && scored) {
        grade = `<div class="grade-box">
          <label>Score <input type="number" min="0" max="${max}" step="0.5" class="g-score" data-ex="${esc(ex.id)}" data-item="${esc(it.id)}" value="${esc(m?.score ?? "")}"> / ${max}</label>
          <textarea class="g-comment" rows="2" placeholder="Comment for the student" data-ex="${esc(ex.id)}" data-item="${esc(it.id)}">${esc(m?.comment ?? "")}</textarea>
        </div>`;
      } else if (m && (m.score !== undefined || m.comment)) {
        grade = `<div class="feedback"><b>${m.score ?? "—"} / ${max}</b>${m.comment ? ` · ${esc(m.comment)}` : ""}</div>`;
      } else if (o.auto !== undefined && o.showPending && scored) {
        grade = `<div class="feedback muted">Waiting for the teacher's assessment</div>`;
      }
      const minW = it.minWords || (kind === ex.kind ? ex.minWords : 0);
      const wc = minW ? `<div class="wc"><span class="wc-n" data-wc="${esc(ex.id)}:${esc(it.id)}">${countWords(val)}</span> words <span class="muted">· at least ${minW}</span></div>` : "";
      body = `${it.text}<textarea class="open-answer" rows="${it.rows || ex.rows || 5}" ${attrs} ${NOAUTO} placeholder="${o.readOnly ? "" : "Type your answer here…"}">${esc(val)}</textarea>${wc}${o.itemExtra ? o.itemExtra(it.id) : ""}${grade}`;
    }
    body += reason;
    return `<li${play ? ' class="has-play"' : ""}${it.n ? ` value="${esc(it.n)}"` : ""}>${play}${play ? `<div class="li-body">${body}</div>` : body}</li>`;
  };
  // with a tool under the exercise (a chart, a board, a summary), the open questions that follow it
  // are printed after the tool, so the student sees the result before writing about it
  const splitOpen = ex.widget && widgetPlace(ex) === "after" && ex.kind !== "open";
  const main = splitOpen ? (ex.items || []).filter((it) => it.kind !== "open") : ex.items || [];
  const tail = splitOpen ? (ex.items || []).filter((it) => it.kind === "open") : [];
  const items = main.map(itemHTML).join("\n");
  const olClass = `items ${ex.layout === "two" ? "two" : ""} ${ex.wide ? "wide" : ""} ${ex.quotes ? "quotes" : ""} ${ex.kind === "rate" ? "labelled" : ""}`;
  let body = `<ol class="${olClass}" ${ex.start ? `start="${esc(ex.start)}"` : ""}>${items}</ol>`;
  const tailHTML = tail.length ? `<ol class="items" start="${main.length + 1}">${tail.map(itemHTML).join("")}</ol>` : "";
  if (ex.kind === "match" && ex.display === "letters") {
    // as in the printed workbook: type the letter next to each phrase, meanings listed on the right
    const left = (ex.items || []).map((it) => {
      if (it.kind && it.kind !== "match") return "";
      const val = a[it.id] ?? "";
      const r = o.auto?.[it.id];
      const mark = r ? (r.ok ? "ok" : "bad") : "";
      const corr = r && !r.ok && r.correct ? `<span class="corr">Correct: ${esc(r.correct)}</span>` : "";
      const keyHint = o.key && o.key[it.id] !== undefined ? `<span class="keyhint">✓ ${esc(keyText(o.key[it.id]))}</span>` : "";
      return `<li><span class="m-word">${it.text}</span> <input class="gap ${mark}" style="width:5ch" maxlength="2" data-ex="${esc(ex.id)}" data-item="${esc(it.id)}" ${dis} value="${esc(val)}" ${NOAUTO}>${corr}${keyHint}</li>`;
    }).join("");
    const right = (ex.options || []).map((op) => `<li>${op.text}</li>`).join("");
    const rest = (ex.items || []).filter((it) => it.kind && it.kind !== "match");
    body = `<div class="match"><ol class="m-left">${left}</ol><ol class="m-right" type="a">${right}</ol></div>`
      + (rest.length ? `<ol class="items" start="${(ex.items || []).length - rest.length + 1}">${rest.map(itemHTML).join("")}</ol>` : "");
  }
  const tag = o.tag ? `<span class="ex-tag">${o.tag}</span>` : "";
  const wTop = ex.widget && widgetPlace(ex) === "before" ? widgetHTML(ex) : "";
  const wEnd = ex.widget && widgetPlace(ex) === "after" ? widgetHTML(ex) : "";
  const timers = (ex.timers || []).map((t, i) => speakingHTML(t, `${ex.id}-${i}`)).join("");
  return `${o.before || ""}<section class="ex" id="ex-${esc(ex.id)}" data-exid="${esc(ex.id)}">
  <div class="ex-h">${o.num ? `<span class="ex-n">${esc(o.num)}</span>` : ""}<span class="ex-t">${esc(ex.title || "")}</span>${tag}${scoreLine}</div>
  ${ex.rubric ? `<p class="ex-i">${ex.rubric}</p>` : ""}
  ${ex.display === "letters" ? "" : options}${bank}
  ${ex.html ? `<div class="wg">${ex.html}</div>` : ""}
  ${wTop}${body}${ex.htmlAfter ? `<div class="wg">${ex.htmlAfter}</div>` : ""}${wEnd}${tailHTML}${timers}
</section>`;
}

// ------------------------------------------------------------------ hooks filled in by widgets.js
let widgetImpl = { html: () => "", place: () => "after" };
export function registerWidgets(impl) { widgetImpl = impl; }
const widgetHTML = (ex) => widgetImpl.html(ex);
const widgetPlace = (ex) => ex.widgetPos || widgetImpl.place(ex);
let speakingImpl = () => "";
export function registerSpeaking(fn) { speakingImpl = fn; }
const speakingHTML = (t, key) => speakingImpl(t, key);
export function hashStr(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); }

// Для matching показываем не только букву, но и текст варианта
function showAns(ex, v) {
  if (ex.kind !== "match") return v;
  const op = (ex.options || []).find((o) => o.id === v);
  return op ? (ex.plain ? stripTags(op.text) : `${v}. ${stripTags(op.text)}`) : v;
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
  ndash: "–", mdash: "—", hellip: "…", middot: "·", pound: "£", euro: "€", times: "×" };
// plain text for <option> labels and answers: no tags, entities decoded (esc() is applied afterwards)
function stripTags(s) {
  return String(s ?? "").replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&([a-z]+);/g, (m, n) => ENT[n] ?? m);
}

// Значение поля ответа из DOM-элемента
export function readInput(el) {
  if (el.type === "radio") return el.checked ? el.value : null;
  return el.value;
}

export function fmtTime(ts) {
  const d = ts?.toDate ? ts.toDate() : ts instanceof Date ? ts : null;
  if (!d) return "";
  return d.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function friendlyError(e) {
  const c = e?.code || "";
  const map = {
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/wrong-password": "Incorrect email or password.",
    "auth/user-not-found": "No account with this email.",
    "auth/email-already-in-use": "This email is already registered.",
    "auth/weak-password": "The password is too short (at least 6 characters).",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/too-many-requests": "Too many attempts. Please try again later.",
    "permission-denied": "You do not have permission to do this.",
    "unavailable": "No connection. Your changes will be saved when the connection is back.",
  };
  return map[c] || e?.message || String(e);
}

// Форма входа / регистрации / восстановления пароля (общая разметка)
export function authFormHTML({ title, eyebrow = "", allowRegister }) {
  return `
  <div class="auth-card">
    ${eyebrow ? `<div class="crs">${esc(eyebrow)}</div>` : ""}
    <h1>${esc(title)}</h1>
    <div class="auth-tabs">
      <button data-mode="login" class="on">Sign in</button>
      ${allowRegister ? `<button data-mode="register">Create account</button>` : ""}
      <button data-mode="reset">Forgot password?</button>
    </div>
    <form id="auth-form" novalidate>
      <label class="f-register">Full name<input name="name" autocomplete="name"></label>
      <label>Email<input name="email" type="email" autocomplete="email" required></label>
      <label class="f-pass">Password<input name="password" type="password" autocomplete="current-password" minlength="6"></label>
      <label class="f-register">Group code (from your teacher)<input name="group" autocomplete="off"></label>
      <button type="submit" class="btn primary" id="auth-submit">Sign in</button>
      <p class="auth-msg" id="auth-msg"></p>
    </form>
  </div>`;
}

export function wireAuthForm(root, handlers) {
  let mode = "login";
  const form = root.querySelector("#auth-form");
  const msg = root.querySelector("#auth-msg");
  const setMode = (m) => {
    mode = m;
    root.querySelectorAll(".auth-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
    root.querySelectorAll(".f-register").forEach((el) => (el.hidden = m !== "register"));
    root.querySelector(".f-pass").hidden = m === "reset";
    root.querySelector("#auth-submit").textContent = { login: "Sign in", register: "Create account", reset: "Send reset link" }[m];
    msg.textContent = "";
    msg.className = "auth-msg";
  };
  root.querySelectorAll(".auth-tabs button").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); setMode(b.dataset.mode); }));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form).entries());
    msg.className = "auth-msg";
    msg.textContent = "…";
    try {
      const text = await handlers[mode](f);
      msg.textContent = text || "";
      msg.className = "auth-msg good";
    } catch (err) {
      msg.textContent = friendlyError(err);
      msg.className = "auth-msg bad";
    }
  });
  setMode("login");
}

// ---------------------------------------------------------------------
//  Flashcards: word on the front; translation and an example on the back
// ---------------------------------------------------------------------
export function renderFlashcards(b, num = "") {
  const cards = b.cards || [];
  const data = esc(JSON.stringify(cards));
  const style = b.style === "discussion" ? "discussion" : "words";
  return `<section class="fc ${style === "discussion" ? "fc-disc" : ""}" data-cards="${data}" data-i="0" data-style="${style}">
    <div class="fc-h">${num ? `<span class="ex-n">${esc(num)}</span>` : `<span class="ic">🃏</span>`}<span class="ex-t">${esc(b.title || "Flashcards")}</span></div>
    ${b.rubric ? `<p class="ex-i">${b.rubric}</p>` : ""}
    <div class="fc-stage">${fcCard(cards[0], 0, cards.length, style)}</div>
    <div class="fc-nav">
      <button class="btn small" type="button" data-fc="prev">Previous</button>
      <span class="fc-count">1 / ${cards.length}</span>
      <button class="btn small" type="button" data-fc="next">Next</button>
      <button class="btn small" type="button" data-fc="shuffle" title="Mix the cards">Shuffle</button>
    </div>
    <div class="fc-dots">${cards.map((_, i) => `<i class="${i === 0 ? "on" : ""}"></i>`).join("")}</div>
  </section>`;
}
function fcCard(c, i, n, style) {
  if (!c) return "";
  // discussion cards: one side only, the question to talk about
  if (style === "discussion") return `<div class="fc-card fc-one" tabindex="0">
    <span class="fc-face fc-front"><span class="lbl">Card ${i + 1}</span><span class="q">${esc(c.front)}</span></span></div>`;
  return `<button type="button" class="fc-card" data-fc="flip" aria-label="Turn the card over">
    <span class="fc-inner">
      <span class="fc-face fc-front"><span class="w">${esc(c.front)}</span>${c.pos ? `<span class="pos">${esc(c.pos)}</span>` : ""}<span class="hint">Click to turn the card over</span></span>
      <span class="fc-face fc-back"><span class="w2">${esc(c.front)}</span><span class="tr">${esc(c.back)}</span>${c.def ? `<span class="def">${esc(c.def)}</span>` : ""}${c.example ? `<span class="eg">${esc(c.example)}</span>` : ""}</span>
    </span></button>`;
}
let fcWired = false;
export function wireFlashcards(root = document) {
  if (fcWired) return;
  fcWired = true;
  const go = (fc, delta, shuffle) => {
    let cards = JSON.parse(fc.dataset.cards);
    let i = Number(fc.dataset.i);
    if (shuffle) {
      for (let k = cards.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [cards[k], cards[j]] = [cards[j], cards[k]]; }
      fc.dataset.cards = JSON.stringify(cards);
      i = 0;
    } else i = (i + delta + cards.length) % cards.length;
    fc.dataset.i = i;
    fc.querySelector(".fc-stage").innerHTML = fcCard(cards[i], i, cards.length, fc.dataset.style);
    fc.querySelector(".fc-count").textContent = `${i + 1} / ${cards.length}`;
    fc.querySelectorAll(".fc-dots i").forEach((d, k) => d.classList.toggle("on", k === i));
  };
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-fc]");
    if (!b) return;
    const fc = b.closest(".fc");
    const act = b.dataset.fc;
    if (act === "flip") b.classList.toggle("flip");
    if (act === "next") go(fc, 1);
    if (act === "prev") go(fc, -1);
    if (act === "shuffle") go(fc, 0, true);
  });
  root.addEventListener("keydown", (e) => {
    const fc = e.target.closest?.(".fc");
    if (!fc) return;
    if (e.key === "ArrowRight") { e.preventDefault(); go(fc, 1); fc.querySelector(".fc-card")?.focus(); }
    if (e.key === "ArrowLeft") { e.preventDefault(); go(fc, -1); fc.querySelector(".fc-card")?.focus(); }
  });
}

// ---------------------------------------------------------------------
//  Pictures and audio. Files live on GitHub Pages in docs/media/…,
//  the unit only stores the path, e.g. "media/u1/listening-1.mp3".
// ---------------------------------------------------------------------
const mediaSrc = (src) => esc(String(src || "").replace(/^\/+/, ""));
function renderImages(items, layout) {
  const figs = items.map((it) => `<figure class="pic">
      <img src="${mediaSrc(it.src)}" alt="${esc(it.alt || it.caption || "")}" loading="lazy" draggable="false">
      ${it.caption || it.label ? `<figcaption class="cap">${it.label ? `<b>${esc(it.label)}</b>` : ""}${it.caption ? esc(it.caption) : ""}</figcaption>` : ""}
    </figure>`).join("");
  return `<div class="pics ${items.length > 1 ? (layout === "row" ? "row" : "grid") : "one"}">${figs}</div>`;
}
function renderVideo(b) {
  const m = String(b.url || "").match(/rutube\.ru\/video\/(private\/)?([0-9a-f]{32})/);
  const q = String(b.url || "").match(/[?&]p=([^&]+)/);
  const yt = String(b.url || "").match(/(?:v=|youtu\.be\/|\/embed\/)([A-Za-z0-9_-]{6,})/);
  const embed = b.embed || (m ? `https://rutube.ru/play/embed/${m[2]}${q ? "?p=" + q[1] : ""}` : yt ? `https://www.youtube-nocookie.com/embed/${yt[1]}` : "");
  return `<div class="video">${embed ? `<div class="vid-frame"><iframe src="${esc(embed)}" loading="lazy" allow="clipboard-write; autoplay; fullscreen" allowfullscreen referrerpolicy="no-referrer" title="${esc(b.title || "Video")}"></iframe></div>` : ""}
    <div class="vid-cap"><div class="vid-t">${esc(b.title || "Video")}</div>${b.note ? `<div class="vid-m">${esc(b.note)}</div>` : ""}
    <a class="vid-l" href="${esc(b.url || "")}" target="_blank" rel="noopener">Open the film in a new tab</a></div></div>`;
}
// "maxPlays": the student may play the recording this many times (tests); the teacher has no limit
// plays are counted per student and per test (student.js sets the scope), so on a shared classroom computer
// each student starts from zero
let playScope = "";
export const setPlayScope = (s) => { playScope = s || ""; };
const playsKey = (src) => "plays:" + playScope + ":" + src;
const playsOf = (src) => { try { return Number(localStorage.getItem(playsKey(src)) || 0); } catch { return 0; } };
function renderAudio(b) {
  const limit = b.maxPlays && !isTeacherPage() ? Number(b.maxPlays) : 0;
  const used = limit ? playsOf(mediaSrc(b.src)) : 0;
  const player = limit && used >= limit
    ? `<p class="au-done">You have listened to the recording ${limit === 2 ? "twice" : limit + " times"}.</p>`
    : `<audio controls preload="none" controlslist="nodownload noplaybackrate" src="${mediaSrc(b.src)}" ${limit ? `data-maxplays="${limit}"` : ""}></audio>
       ${limit ? `<div class="au-n">You can play the recording ${limit === 2 ? "twice" : limit + " times"}. Plays used: <b class="au-used">${used}</b> of ${limit}. Do not pause or rewind: each start counts.</div>` : ""}`;
  return `<div class="audio"><div class="au-ic">🎧</div><div class="au-b">
      <div class="au-t">${esc(b.title || "Listen")}</div>
      ${player}
      ${b.note ? `<div class="au-n">${esc(b.note)}</div>` : ""}
    </div></div>`;
}

export const countWords = (t) => (String(t || "").match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || []).length;

// ------------------------------------------------------------------ short recordings inside an exercise
// item.audio = "media/u1/file.mp3"; exercise.once = true: a student can play each recording only once
const isTeacherPage = () => typeof document !== "undefined" && document.body?.classList.contains("teacher");
function playedBefore(src) { try { return localStorage.getItem("played:" + src) === "1"; } catch { return false; } }
function markPlayed(src) { try { localStorage.setItem("played:" + src, "1"); } catch {} }
function itemPlayButton(src, once) {
  const s = mediaSrc(src);
  const used = once && !isTeacherPage() && playedBefore(s);
  return `<button type="button" class="iplay ${used ? "used" : ""}" data-src="${s}" ${once ? 'data-once="1"' : ""} ${used ? "disabled" : ""}
    aria-label="Play the recording" title="${used ? "You have already listened to this recording" : "Play"}"><span class="tri"></span></button>`;
}
if (typeof document !== "undefined") {
  // each time a limited recording starts from the beginning it uses one play
  document.addEventListener("play", (e) => {
    const a = e.target;
    if (!a.dataset?.maxplays) return;
    const src = a.getAttribute("src"), limit = Number(a.dataset.maxplays);
    if (a.currentTime > 1) return;            // resumed after a pause
    const n = playsOf(src);
    if (n >= limit) { a.pause(); return; }
    try { localStorage.setItem(playsKey(src), String(n + 1)); } catch {}
    const box = a.closest(".au-b")?.querySelector(".au-used");
    if (box) box.textContent = n + 1;
  }, true);
  document.addEventListener("ended", (e) => {
    const a = e.target;
    if (!a.dataset?.maxplays) return;
    if (playsOf(a.getAttribute("src")) >= Number(a.dataset.maxplays))
      a.outerHTML = `<p class="au-done">You have listened to the recording ${a.dataset.maxplays === "2" ? "twice" : a.dataset.maxplays + " times"}.</p>`;
  }, true);
}
let curAudio = null, curBtn = null;
if (typeof document !== "undefined") document.addEventListener("click", (e) => {
  const b = e.target.closest?.(".iplay");
  if (!b || b.disabled) return;
  e.preventDefault();
  const once = b.dataset.once === "1" && !isTeacherPage();
  if (curAudio && curBtn === b && !curAudio.paused) { if (!once) { curAudio.pause(); b.classList.remove("on"); } return; }
  if (curAudio) { curAudio.pause(); curBtn?.classList.remove("on"); }
  const src = b.dataset.src;
  curAudio = new Audio(src); curBtn = b;
  b.classList.add("on");
  curAudio.onended = () => { b.classList.remove("on"); if (once) { b.disabled = true; b.classList.add("used"); b.title = "You have already listened to this recording"; } };
  curAudio.onerror = () => { b.classList.remove("on"); b.classList.add("missing"); b.title = "This recording has not been added yet"; };
  curAudio.play().then(() => { if (once) markPlayed(src); }).catch(() => {});
});
