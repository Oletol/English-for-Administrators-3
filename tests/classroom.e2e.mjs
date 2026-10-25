// Classroom features on the mock Firebase: "Done" under each exercise and submitting only when everything is done,
// the teacher's working copy (fields and lists are active), class statistics inside the exercises,
// In-Class / HA / Skip with the "done" tick, the attendance journal and 25% for missed classwork,
// and the voice recorder falling back to another format when the first one fails.
// Run: python3 -m http.server 5055 -d docs &  node tests/classroom.e2e.mjs
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";

const BASE = "http://127.0.0.1:5055";
const SHOTS = process.env.SHOTS || "/tmp/shots-classroom";
mkdirSync(SHOTS, { recursive: true });
const mock = readFileSync(new URL("./mock-fb.js", import.meta.url), "utf8");
const courseText = readFileSync(new URL("../content-private/course.json", import.meta.url), "utf8");
const course = JSON.parse(courseText);
const unit = course.units[0];
const exOf = (id) => unit.sections.flatMap((s) => s.blocks).find((b) => b.id === id);
const key1 = (id, it) => { const k = exOf(id).items.find((x) => String(x.id) === String(it)).answer; return Array.isArray(k) ? k[0] : k; };

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
}).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["microphone"] });
await ctx.route("**/js/fb.js*", (r) => r.fulfill({ contentType: "text/javascript", body: mock }));
await ctx.route("https://rutube.ru/**", (r) => r.fulfill({ contentType: "text/html", body: "<body></body>" }));
const errors = [];
const page = async (url, c = ctx) => {
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(url + ": " + e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/favicon|fonts\.g|rutube|ERR_TUNNEL|ERR_NAME|Failed to load resource/.test(m.text())) errors.push(url + " console: " + m.text()); });
  p.on("dialog", (d) => d.accept());
  await p.goto(BASE + url);
  return p;
};
const shot = (p, n, full = false) => p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: full });
const step = (t) => console.log("•", t);
const sel = (ex, it) => `[data-ex="${ex}"][data-item="${it}"]`;
const db = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("mock:db")));

async function markAllDone(p, unitId = "u1") {
  const secs = await p.evaluate((u) => [...document.querySelectorAll(`.sb-unit .sb-item[href^="#${u}/"]`)].map((a) => a.getAttribute("href")), unitId);
  for (const h of secs) {
    await p.evaluate((x) => { location.hash = x; }, h);
    await p.waitForTimeout(150);
    for (let i = 0; i < 60; i++) {
      const b = p.locator('[data-done][data-v="1"]').first();
      if (!(await b.count())) break;
      await b.click();
      await p.waitForTimeout(40);
    }
  }
  await p.waitForSelector("#submit-unit:not([disabled])");
}
const ARROWS = /[←-⇿⟵-⟿➔➜-➿]/;

// ------------------------------------------------------------------ teacher, group, two students
const t = await page("/teacher.html");
await t.evaluate(() => {
  localStorage.setItem("mock:auth", JSON.stringify({ "teacher@uni.ru": { uid: "T1", password: "secret1" } }));
  localStorage.setItem("mock:db", JSON.stringify({ "teachers/T1": { name: "O. Tolstykh" } }));
});
await t.reload();
step("Teacher imports the course, creates a group and opens Unit 1");
await t.fill("#auth-form [name=email]", "teacher@uni.ru");
await t.fill("#auth-form [name=password]", "secret1");
await t.click("#auth-submit");
await t.waitForSelector("#tool-nav .sb-item");
await t.click('a[href="#tools/content"]');
await t.evaluate((c) => { document.querySelector("#import-text").value = c; }, courseText);
await t.click("[data-act=import]");
await t.waitForFunction(() => /Imported/.test(document.querySelector("#import-status")?.textContent || ""), null, { timeout: 15000 });
await t.click('a[href="#tools/groups"]');
await t.fill("#g-name", "GMU 301_2");
await t.fill("#g-code", "gmu-301");
await t.click("[data-act=create-group]");
await t.waitForSelector("code:text('GMU-301')");
await t.click('a[href="#tools/access"]');
await t.click("[data-act=toggle-open][data-unit=u1]");
await t.waitForSelector('.pill.on:text("open")');

async function register(name, email) {
  const s = await page("/index.html");
  await s.click("[data-mode=register]");
  await s.fill("[name=name]", name);
  await s.fill("[name=email]", email);
  await s.fill("[name=password]", "pass123");
  await s.fill("[name=group]", "gmu-301");
  await s.click("#auth-submit");
  await s.waitForSelector('.sb-uh[data-unit="u1"][data-can-open="1"]', { timeout: 8000 });
  return s;
}
const anna = await register("Anna Ivanova", "anna@uni.ru");
// the second student works in a separate browser (sessionStorage keeps one signed-in user per tab anyway)
const boris = await register("Boris Petrov", "boris@uni.ru");
const uidOf = async (email) => (await t.evaluate(() => JSON.parse(localStorage.getItem("mock:auth"))))[email].uid;
const annaUid = await uidOf("anna@uni.ru"), borisUid = await uidOf("boris@uni.ru");

// ------------------------------------------------------------------ "Done" and submitting
step("Every exercise has Done; Submit stays closed until all exercises are done");
await anna.goto(`${BASE}/index.html#u1/vocabulary`);
await anna.waitForSelector("#ex-v1");
assert.equal(await anna.locator("#ex-v1 .ex-done button", { hasText: "Done" }).count(), 1);
assert.equal(await anna.locator("#submit-unit").isDisabled(), true, "submit closed");
assert.match(await anna.locator(".ub-prog").innerText(), /Done: 0 of \d+/);
await anna.fill(sel("v1", "1"), key1("v1", "1"));
await anna.fill(sel("v1", "2"), "wrongword");
await anna.fill(sel("v1", "3"), key1("v1", "3"));
await anna.locator("#ex-v1 [data-done]").click();      // blanks: the confirm() is accepted
await anna.waitForSelector("#ex-v1 .ex-done.on");
assert.equal(await anna.locator(sel("v1", "1")).isDisabled(), true, "a done exercise is closed");
assert.equal(await anna.locator(sel("v2", "1")).isDisabled(), false, "other exercises stay open");
assert.match(await anna.locator(".ub-prog").innerText(), /Done: 1 of/);
await anna.locator("#ex-v1").screenshot({ path: `${SHOTS}/01-student-done.png` });
step("Change my answers opens the exercise again");
await anna.locator('#ex-v1 [data-done][data-v="0"]').click();
await anna.waitForSelector('#ex-v1 [data-done][data-v="1"]');
assert.equal(await anna.locator(sel("v1", "1")).isDisabled(), false);
await anna.locator("#ex-v1 [data-done]").click();
await anna.waitForSelector("#ex-v1 .ex-done.on");
await anna.locator("#save-state", { hasText: /Saved|saved/ }).waitFor({ timeout: 6000 });
step("The list of exercises not done yet links to the exercise");
await anna.locator(".ub-left summary").click();
await anna.locator('.ub-left a[data-goto="g1"]').click();
await anna.waitForSelector("#ex-g1");
await anna.waitForTimeout(500);
const y = await anna.locator("#ex-g1").evaluate((el) => el.getBoundingClientRect().top);
assert.ok(y < 400 && y > -50, "scrolled to the exercise: " + y);
await shot(anna, "02-student-bar");

// ------------------------------------------------------------------ teacher's working copy and statistics
step("Teacher's Edition: fields and lists are active, keys and class answers are shown");
await t.goto(`${BASE}/teacher.html#u1/vocabulary`);
await t.waitForSelector("#ex-v1 .ex-plan");
assert.equal(await t.locator(sel("v1", "1")).isDisabled(), false, "teacher can type");
await t.waitForSelector('#ex-v1 [data-st="v1:1"] .st-b');
assert.equal(await t.locator('#ex-v1 [data-st="v1:1"] .st-b').innerText(), "1/1");
assert.equal(await t.locator('#ex-v1 [data-st="v1:2"] .st-b').innerText(), "0/1");
assert.match(await t.locator('#ex-v1 [data-st="v1:2"] .st-w').innerText(), /wrongword/);
assert.match(await t.locator('#ex-v1 [data-exstats="v1"]').innerText(), /Done: 1 of 2/);
// translation exercise: no statistics
const v6 = exOf("v6");
assert.ok(v6 && /Translat/.test(v6.title));
assert.equal(await t.locator('#ex-v6 [data-st]').count(), 0, "no statistics in translation exercises");
await t.locator("#ex-v1").screenshot({ path: `${SHOTS}/03-teacher-stats.png` });

step("Teacher's typed answer survives a live update from a student");
await t.fill(sel("v2", "1"), "my try");
await t.locator(sel("v2", "1")).evaluate((e) => e.blur());
await anna.goto(`${BASE}/index.html#u1/vocabulary`);
await anna.waitForSelector("#ex-v2");
await anna.fill(sel("v2", "1"), key1("v2", "1"));
await t.waitForFunction(() => document.querySelector('[data-st="v2:1"] .st-b')?.textContent === "1/1", null, { timeout: 8000 });
assert.equal(await t.inputValue(sel("v2", "1")), "my try");
step("Teacher can open a list and see what the students choose from");
await t.goto(`${BASE}/teacher.html#u1/warmup`);
await t.waitForSelector("#ex-w1 select");
assert.equal(await t.locator(sel("w1", "1")).isDisabled(), false);
const nOpts = await t.locator(`${sel("w1", "1")} option`).count();
assert.ok(nOpts > 5, "options in the list: " + nOpts);
await t.selectOption(sel("w1", "1"), { index: 2 });
await t.reload();
await t.waitForSelector("#ex-w1 select");
assert.notEqual(await t.inputValue(sel("w1", "1")), "", "teacher's choice is kept in the browser");
const dbNow = await db(t);
assert.ok(!Object.keys(dbNow).some((k) => k.includes("T1") && k.startsWith("submissions")), "teacher's answers are not saved to the database");
step("Hide and show the class answers");
await t.goto(`${BASE}/teacher.html#u1/vocabulary`);
await t.waitForSelector("#ex-v1 .ex-plan");
await t.click("[data-act=toggle-stats]");
await t.waitForSelector("[data-act=toggle-stats]:text('Show class answers')");
assert.equal(await t.locator("[data-st]").count(), 0);
await t.click("[data-act=toggle-stats]");
await t.waitForSelector("[data-st]");

// ------------------------------------------------------------------ In-Class / HA / Skip, ticks, attendance
step("In-Class / HA and the Done tick; the lesson appears in Attendance");
await t.click('#ex-v1 [data-act=plan-as][data-as=class]');
await t.waitForSelector('#ex-v1 .seg button.on.class');
await t.click('#ex-v2 [data-act=plan-as][data-as=home]');
await t.waitForSelector('#ex-v2 .seg button.on.home');
await t.check("#ex-v1 input[data-plan-done]");
await t.waitForSelector("#ex-v1 input[data-plan-date]");
await t.waitForFunction(() => Object.keys(JSON.parse(localStorage.getItem("mock:db"))["answerKeys/journal~GMU-301"]?.lessons || {}).length === 1);
let all0 = await db(t);
const g = all0["groups/GMU-301"];
const today = Object.keys(all0["answerKeys/journal~GMU-301"].lessons)[0];
assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
assert.deepEqual(g.plan.u1.v1, { as: "class", done: true, date: today });
assert.ok(!JSON.stringify(g).includes(annaUid), "attendance is not in the group document");
await t.locator("#ex-v1").screenshot({ path: `${SHOTS}/04-teacher-plan.png` });
step("Students see In-Class (with a tick when done) and HA");
await anna.goto(`${BASE}/index.html#u1/vocabulary`);
await anna.waitForSelector("#ex-v1 .ex-lab.class");
assert.equal(await anna.locator("#ex-v1 .ex-lab").textContent(), "✓ In-Class");
assert.equal(await anna.locator("#ex-v2 .ex-lab").textContent(), "HA");
step("Anna marks every exercise as done: Submit opens");
await markAllDone(anna);
await shot(anna, "05-student-ready");

step("Attendance: Boris is absent; his In-Class exercise counts 25%");
await boris.goto(`${BASE}/index.html#u1/vocabulary`);
await boris.waitForSelector("#ex-v1");
for (const it of ["1", "2", "3", "4"]) await boris.fill(sel("v1", it), key1("v1", it));
await boris.locator("#save-state", { hasText: /Saved|saved/ }).waitFor({ timeout: 6000 });
await t.goto(`${BASE}/teacher.html#tools/journal`);
await t.waitForSelector(".jt");
await t.click(`[data-act=j-att][data-uid="${borisUid}"]`);
await t.waitForSelector(`.att.a[data-uid="${borisUid}"]`);
assert.match(await t.locator(".j-lessons").innerText(), /Verbs that go with/);
assert.match(await t.locator(".j-lessons").innerText(), /Absent: Boris Petrov/);
await shot(t, "06-attendance", true);
step("A second lesson date, then deleting it");
await t.fill("#j-date", "2026-10-14");
await t.click("[data-act=j-add]");
await t.waitForSelector('[data-act=j-del][data-day="2026-10-14"]');
await t.click('[data-act=j-del][data-day="2026-10-14"]');
await t.waitForFunction(() => !document.querySelector('[data-act=j-del][data-day="2026-10-14"]'));

step("Checking one exercise applies 25% to the absent student");
await t.goto(`${BASE}/teacher.html#u1/vocabulary`);
await t.waitForSelector('#ex-v1 ~ .ex, [data-act="check-ex"][data-ex="v1"]');
await t.click('[data-act="check-ex"][data-ex="v1"]');
await t.waitForFunction(() => JSON.parse(localStorage.getItem("mock:db"))["groups/GMU-301"].releasedEx?.u1?.includes("v1"), null, { timeout: 8000 });
const all = await db(t);
assert.equal(all[`exerciseResults/u1__${borisUid}`].scores.v1.score, 1, "4 correct × 25% = 1");
assert.equal(all[`exerciseResults/u1__${annaUid}`].scores.v1.score, 2);
await boris.waitForSelector("#ex-v1 .ex-absent", { timeout: 8000 });
assert.match(await boris.locator("#ex-v1 .ex-absent").innerText(), /25%/);

step("Works table shows Done; releasing the unit stores the reduced score");
await anna.locator("#submit-unit").click();
await anna.waitForSelector(".ub-sub");
await t.goto(`${BASE}/teacher.html#tools/works`);
await t.waitForSelector("table.t");
assert.ok(/absent · 1/i.test(await t.locator("table.t").first().innerText()), "absent pill for Boris");
await t.goto(`${BASE}/teacher.html#tools/access`);
await t.click("[data-act=release][data-unit=u1]");
await t.waitForFunction(() => JSON.parse(localStorage.getItem("mock:db"))["groups/GMU-301"].releasedUnits?.includes("u1"));
const res = (await db(t))[`results/u1__${annaUid}`];
assert.deepEqual(res.factors, {});
await anna.waitForSelector(".ub-res");

step("No arrow symbols in the new interface");
for (const p of [t, anna, boris]) assert.ok(!ARROWS.test(await p.locator("body").innerText()), "arrow found");

// ------------------------------------------------------------------ voice recorder: a format that fails falls back
step("Recorder: if the first format fails to start, another one is used and the take appears");
const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["microphone"] });
await ctx2.route("**/js/fb.js*", (r) => r.fulfill({ contentType: "text/javascript", body: mock }));
await ctx2.addInitScript(() => {
  // simulate a browser that says it supports WebM but refuses to start with it (as some Safari versions do)
  const Orig = window.MediaRecorder;
  window.MediaRecorder = class extends Orig {
    constructor(stream, opts) { if (opts?.mimeType?.includes("webm")) throw new DOMException("not supported", "NotSupportedError"); super(stream, opts); }
  };
  window.MediaRecorder.isTypeSupported = (t) => Orig.isTypeSupported(t) || /webm/.test(t);
});
const c = await page("/index.html", ctx2);
await c.evaluate((st) => { localStorage.setItem("mock:auth", st.auth); localStorage.setItem("mock:db", st.db); }, { auth: await t.evaluate(() => localStorage.getItem("mock:auth")), db: await t.evaluate(() => localStorage.getItem("mock:db")) });
await c.reload();
await c.fill("#auth-form [name=email]", "boris@uni.ru");
await c.fill("#auth-form [name=password]", "pass123");
await c.click("#auth-submit");
await c.waitForSelector('.sb-uh[data-unit="u1"]');
await c.goto(`${BASE}/index.html#u1/speaking`);
await c.waitForSelector(".spk [data-spk-act=rec]");
const spk = c.locator(".spk").first();
await spk.locator("[data-spk-act=rec]").click();
await c.waitForSelector(".spk .btn.rec.on");
await c.waitForTimeout(1500);
await spk.locator("[data-spk-act=rec]").click();
await c.waitForSelector(".spk-take audio", { timeout: 6000 });
assert.match(await spk.locator(".spk-take a").getAttribute("download"), /\.(ogg|m4a|webm)$/);
const size = await c.evaluate(async () => (await (await fetch(document.querySelector(".spk-take a").href)).blob()).size);
assert.ok(size > 500, "recording has sound data: " + size);
await spk.screenshot({ path: `${SHOTS}/07-recorder.png` });

assert.deepEqual(errors, [], "page errors:\n" + errors.join("\n"));
await browser.close();
console.log("\nALL CLASSROOM CHECKS PASSED");
