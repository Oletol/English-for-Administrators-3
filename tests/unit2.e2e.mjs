// Unit 1 (Land) on the mock Firebase: import the real course file, open every section as a student,
// answer and check exercises, the interactive tools, the speaking timer and the voice recorder.
// Run: python3 -m http.server 5055 -d docs &  node tests/unit1.e2e.mjs
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";

const BASE = "http://127.0.0.1:5055";
const SHOTS = process.env.SHOTS || "/tmp/shots-u2";
mkdirSync(SHOTS, { recursive: true });
const mock = readFileSync(new URL("./mock-fb.js", import.meta.url), "utf8");
const courseText = readFileSync(new URL("../content-private/course.json", import.meta.url), "utf8");
const course = JSON.parse(courseText);
const unit = course.units[1];

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
}).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["microphone"] });
await ctx.route("**/js/fb.js", (r) => r.fulfill({ contentType: "text/javascript", body: mock }));
await ctx.route("https://rutube.ru/**", (r) => r.fulfill({ contentType: "text/html", body: "<body style='background:#222'></body>" }));
const errors = [];
const page = async (url) => {
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(url + ": " + e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/favicon|fonts\.g|rutube|ERR_TUNNEL|ERR_NAME/.test(m.text())) errors.push(url + " console: " + m.text()); });
  p.on("dialog", (d) => d.accept());
  await p.goto(BASE + url);
  return p;
};
const shot = (p, n, full = false) => p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: full });
const step = (t) => console.log("•", t);
const sel = (ex, it) => `[data-ex="${ex}"][data-item="${it}"]`;
const ARROWS = /[←-⇿⟵-⟿➔➜-➿▶►›‹»«]/;

// ------------------------------------------------------------------ teacher: import, group, open
const t = await page("/teacher.html");
await t.evaluate(() => {
  localStorage.setItem("mock:auth", JSON.stringify({ "teacher@uni.ru": { uid: "T1", password: "secret1" } }));
  localStorage.setItem("mock:db", JSON.stringify({ "teachers/T1": { name: "O. Tolstykh" } }));
});
await t.reload();
step("Teacher signs in and imports course.json");
await t.fill("#auth-form [name=email]", "teacher@uni.ru");
await t.fill("#auth-form [name=password]", "secret1");
await t.click("#auth-submit");
await t.waitForSelector("#tool-nav .sb-item");
await t.click('a[href="#tools/content"]');
await t.waitForSelector("#import-text");
await t.evaluate((c) => { document.querySelector("#import-text").value = c; }, courseText);
await t.click("[data-act=import]");
await t.waitForSelector("#import-status:has-text('1')", { timeout: 15000 }).catch(() => {});
const stored = await t.evaluate(() => JSON.parse(localStorage.getItem("mock:db")));
assert.ok(stored["unitContent/u2"], "unit content stored");
const studentData = JSON.stringify(stored["unitContent/u2"]);
assert.ok(!studentData.includes('"answer"'), "no keys in unitContent");
assert.ok(!/Teaching notes|Notes on the key|Aim<\/b>/.test(studentData), "no teacher notes in unitContent");
assert.ok(!studentData.includes("typical: law"), "no teacher hints in unitContent");
// keys exist for every auto exercise
const keys = stored["answerKeys/u2"].exercises;
for (const s of unit.sections) for (const b of s.blocks) if (b.type === "exercise" && ["gap", "match", "mcq"].includes(b.kind) && b.graded !== false)
  assert.ok(Object.keys(keys[b.id] || {}).length > 0, "keys for " + b.id);

step("Teacher's Edition shows keys and notes in plum");
await t.goto(`${BASE}/teacher.html#u2/warmup`);
await t.waitForSelector(".keyhint");
await shot(t, "01-teacher-warmup", true);

step("Group and access");
await t.click('a[href="#tools/groups"]');
await t.waitForSelector("#g-name");
await t.fill("#g-name", "PM 2");
await t.fill("#g-code", "pm-2");
await t.click("[data-act=create-group]");
await t.waitForSelector("code:text('PM-2')");
await t.click('a[href="#tools/access"]');
await t.click("[data-act=toggle-open][data-unit=u2]");

// ------------------------------------------------------------------ student
step("Student registers and opens the unit");
const s = await page("/index.html");
await shot(s, "02-signin");
await s.click("[data-mode=register]");
await s.fill("[name=name]", "Anna Ivanova");
await s.fill("[name=email]", "anna@uni.ru");
await s.fill("[name=password]", "pass123");
await s.fill("[name=group]", "pm-2");
await s.click("#auth-submit");
await s.waitForSelector('.sb-uh[data-unit="u2"][data-can-open="1"]', { timeout: 8000 });



step("Warm-up renders for the student: no arrows, no keys, no teacher notes");
await s.goto(`${BASE}/index.html#u2/warmup`);
await s.waitForSelector("#ex-w2_1");
await s.waitForTimeout(300);
const txt = await s.locator("#content").innerText();
assert.ok(!ARROWS.test(txt), "arrow symbol: " + (txt.match(ARROWS) || [])[0]);
assert.equal(await s.locator(".tnote, .keyhint").count(), 0);
assert.equal(await s.locator("section.ex").count(), 14);
assert.ok(!/Notes on the key|Teaching notes|Typical placing/.test(txt), "teacher text visible");
await shot(s, "10-warmup-full", true);

step("Flashcards show translation, definition and example");
await s.locator(".fc-card").first().click();
await s.waitForTimeout(600);
const back = await s.locator(".fc-back").first().innerText();
assert.match(back, /водоносный|точный|соседний|усугублять|сотрудничество|плотина|засуха|/);
assert.equal(await s.locator(".fc-back .def").count(), 1);
assert.equal(await s.locator(".fc-back .eg").count(), 1);
await s.locator(".fc").first().screenshot({ path: `${SHOTS}/11-flashcard-back.png` });

step("Estimates, water footprint, basin simulator, chart, profile");
await s.locator(sel("w2_1", "2")).fill("40");
await s.locator("#ex-w2_1 [data-reveal]").nth(1).click();
assert.match(await s.locator("#ex-w2_1 .est-d").nth(1).innerText(), /30 points too low/);
const t1 = await s.locator('[data-w="waterprint"] .fp-total').innerText();
await s.locator('[data-w="waterprint"] .fp-in[data-i="0"]').fill("0");
await s.waitForTimeout(150);
assert.notEqual(await s.locator('[data-w="waterprint"] .fp-total').innerText(), t1);
await s.locator('[data-w="basinsim"] .sim-in[data-u="city"]').fill("5");
await s.waitForTimeout(150);
assert.match(await s.locator('[data-w="basinsim"] .sim-warn').innerText(), /rationing/);
assert.match(await s.locator('[data-w="basinsim"] .sim-rest').innerText(), /5 units still to allocate/);
await s.selectOption(sel("w2_12", "A_scarce"), "3");
await s.selectOption(sel("w2_12", "A_gov"), "2");
await s.waitForTimeout(150);
assert.equal(await s.locator("#ex-w2_12 .lf-ch .dot").count(), 1);
assert.match(await s.locator("#ex-w2_12 .lf-ch").innerHTML(), /water is scarcer/);
for (let i = 1; i <= 8; i++) await s.check(`${sel("w2_10", String(i))}[value=B]`);
await s.click("#ex-w2_10 [data-prof-go]");
assert.match(await s.locator("#ex-w2_10 .prof").innerText(), /(Engineer|Regulator|Negotiator|Guardian)/);
await s.locator("#ex-w2_9").screenshot({ path: `${SHOTS}/20-waterprint.png` });
await s.locator("#ex-w2_11").screenshot({ path: `${SHOTS}/21-basin.png` });
await s.locator("#ex-w2_12").screenshot({ path: `${SHOTS}/22-chart.png` });
await s.locator("#ex-w2_10").screenshot({ path: `${SHOTS}/23-profile.png` });

step("Teacher checks the word-in-context exercise");
const k1 = keys.w2_4["1"];
await s.fill(sel("w2_4", "1"), Array.isArray(k1) ? k1[0] : k1);
await s.fill(sel("w2_4", "2"), "wrongword");
await s.check(`${sel("w2_6", "1")}[value=${keys.w2_6["1"]}]`);
await s.locator("#save-state", { hasText: /Saved|saved/ }).waitFor({ timeout: 6000 });
await t.goto(`${BASE}/teacher.html#u2/warmup`);
await t.waitForSelector('[data-act="check-ex"][data-ex="w2_4"]');
await t.click('[data-act="check-ex"][data-ex="w2_4"]');
await t.waitForSelector('[data-act="uncheck-ex"][data-ex="w2_4"]');
await t.click('[data-act="check-ex"][data-ex="w2_6"]');
await t.waitForSelector('[data-act="uncheck-ex"][data-ex="w2_6"]');
await s.waitForSelector("#ex-w2_4 .gap.ok", { timeout: 6000 });
assert.equal(await s.locator("#ex-w2_4 .gap.ok").count(), 1);
assert.equal(await s.locator(`${sel("w2_4", "2")}.bad`).count(), 1);
assert.equal(await s.locator("#ex-w2_6 label.ok").count(), 1);

step("Reading: text, eight exercises, no keys; teacher checks True/False/Not given");
await s.goto(`${BASE}/index.html#u2/reading`);
await s.waitForSelector("#ex-r2_3");
await s.waitForTimeout(300);
const rtxt = await s.locator("#content").innerText();
assert.ok(!ARROWS.test(rtxt), "arrow symbol in Reading");
assert.equal(await s.locator(".tnote, .keyhint").count(), 0);
assert.equal(await s.locator("section.ex").count(), 8);
assert.equal(await s.locator(".rtext .pnum").count(), 12);
assert.ok(!/Model answers|Mounting pressure on water supplies and climate change:/.test(rtxt), "headings or model answers visible");
await shot(s, "30-reading-full", true);
await s.selectOption(sel("r2_3", "1"), keys.r2_3["1"]);
await s.selectOption(sel("r2_3", "2"), keys.r2_3["2"] === "True" ? "False" : "True");
await s.fill(sel("r2_7", "1"), "renewable resource");
await s.locator("#save-state", { hasText: /Saved|saved/ }).waitFor({ timeout: 6000 });
await t.goto(`${BASE}/teacher.html#u2/reading`);
await t.waitForSelector('[data-act="check-ex"][data-ex="r2_3"]');
await t.click('[data-act="check-ex"][data-ex="r2_3"]');
await t.waitForSelector('[data-act="uncheck-ex"][data-ex="r2_3"]');
await t.click('[data-act="check-ex"][data-ex="r2_7"]');
await t.waitForSelector('[data-act="uncheck-ex"][data-ex="r2_7"]');
await shot(t, "31-teacher-reading", true);
await s.waitForSelector("#ex-r2_3 .gap.ok", { timeout: 6000 });
assert.equal(await s.locator(`${sel("r2_3", "1")}.ok`).count(), 1);
assert.equal(await s.locator(`${sel("r2_3", "2")}.bad`).count(), 1);
assert.equal(await s.locator(`${sel("r2_7", "1")}.ok`).count(), 1, "phrase without the article is accepted");

step("Dark theme and phone width");
await s.goto(`${BASE}/index.html#u2/warmup`);
await s.waitForSelector("#ex-w2_11");
await s.click(".topbar [data-theme-toggle]");
await s.waitForTimeout(200);
await shot(s, "50-dark-warmup");
await s.locator("#ex-w2_11").screenshot({ path: `${SHOTS}/51-dark-basin.png` });
await s.click(".topbar [data-theme-toggle]");
await s.setViewportSize({ width: 390, height: 844 });
await s.goto(`${BASE}/index.html#u2/warmup`);
await s.waitForSelector("#ex-w2_1");
const overflow = await s.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
assert.ok(overflow <= 1, "no horizontal scroll on a phone (" + overflow + "px)");
await shot(s, "60-mobile");
await s.locator(".fc").first().screenshot({ path: `${SHOTS}/61-mobile-card.png` });

assert.deepEqual(errors, [], "no page errors");
console.log("\nALL UNIT 2 WARM-UP CHECKS PASSED");
await browser.close();
