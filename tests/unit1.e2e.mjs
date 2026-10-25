// Unit 1 (Land) on the mock Firebase: import the real course file, open every section as a student,
// answer and check exercises, the interactive tools, the speaking timer and the voice recorder.
// Run: python3 -m http.server 5055 -d docs &  node tests/unit1.e2e.mjs
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";

const BASE = "http://127.0.0.1:5055";
const SHOTS = process.env.SHOTS || "/tmp/shots-u1";
mkdirSync(SHOTS, { recursive: true });
const mock = readFileSync(new URL("./mock-fb.js", import.meta.url), "utf8");
const courseText = readFileSync(new URL("../content-private/course.json", import.meta.url), "utf8");
const course = JSON.parse(courseText);
const unit = course.units[0];

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
}).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["microphone"] });
await ctx.route("**/js/fb.js*", (r) => r.fulfill({ contentType: "text/javascript", body: mock }));
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
assert.ok(stored["unitContent/u1"], "unit content stored");
const studentData = JSON.stringify(stored["unitContent/u1"]);
assert.ok(!studentData.includes('"answer"'), "no keys in unitContent");
assert.ok(!/Teaching notes|Notes on the key|Aim<\/b>/.test(studentData), "no teacher notes in unitContent");
assert.ok(!studentData.includes("typical: law"), "no teacher hints in unitContent");
// keys exist for every auto exercise
const keys = stored["answerKeys/u1"].exercises;
for (const s of unit.sections) for (const b of s.blocks) if (b.type === "exercise" && ["gap", "match", "mcq"].includes(b.kind) && b.graded !== false)
  assert.ok(Object.keys(keys[b.id] || {}).length > 0, "keys for " + b.id);

step("Teacher's Edition shows keys and notes in plum");
await t.click('.sb-uh[data-unit="u1"]');
await t.click('.sb-item:has-text("Reading")');
await t.waitForSelector(".keyhint");
await shot(t, "01-teacher-reading");

step("Group and access");
await t.click('a[href="#tools/groups"]');
await t.waitForSelector("#g-name");
await t.fill("#g-name", "PM 2");
await t.fill("#g-code", "pm-2");
await t.click("[data-act=create-group]");
await t.waitForSelector("code:text('PM-2')");
await t.click('a[href="#tools/access"]');
await t.click("[data-act=toggle-open][data-unit=u1]");

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
await s.waitForSelector('.sb-uh[data-unit="u1"][data-can-open="1"]', { timeout: 8000 });
await s.click('.sb-uh[data-unit="u1"]');

step("Every section renders, no arrows, no keys, no teacher notes");
const secTitles = unit.sections.map((x) => x.title);
for (const [i, title] of secTitles.entries()) {
  await s.goto(`${BASE}/index.html#u1/${unit.sections[i].id}`);
  await s.waitForSelector(".page-h h2");
  await s.waitForTimeout(250);
  const txt = await s.locator("#content").innerText();
  assert.ok(!ARROWS.test(txt), "arrow symbol in " + title + ": " + (txt.match(ARROWS) || [])[0]);
  assert.equal(await s.locator(".tnote, .keyhint").count(), 0, "teacher-only blocks in " + title);
  const nEx = unit.sections[i].blocks.filter((b) => b.type === "exercise").length;
  assert.equal(await s.locator("section.ex").count(), nEx, "exercise count in " + title);
  await shot(s, `10-${String(i + 1).padStart(2, "0")}-${unit.sections[i].id}`, true);
}

step("Warm-up: estimate reveal is kept after reload");
await s.goto(`${BASE}/index.html#u1/warmup`);
await s.waitForSelector("#ex-w11");
await s.locator(sel("w11", "1")).fill("30");
await s.locator("#ex-w11 [data-reveal]").first().click();
await s.waitForSelector("#ex-w11 .est-a:not([hidden])");
assert.match(await s.locator("#ex-w11 .est-d").first().innerText(), /20 points too low/);
assert.match(await s.locator("#ex-w11 .est-sum").innerText(), /Revealed: 1 of 8/);
await s.locator("#save-state", { hasText: /Saved|saved/ }).waitFor({ timeout: 6000 });
await s.reload();
await s.waitForSelector("#ex-w11");
assert.equal(await s.locator("#ex-w11 .est-a:not([hidden])").count(), 1, "reveal remembered");
assert.equal(await s.locator(sel("w11", "1")).isDisabled(), true);

step("Agreement scale summary, odd one out with a reason, sorting board");
await s.check(`${sel("w12", "1")}[value=D]`);
await s.check(`${sel("w12", "2")}[value=A]`);
await s.waitForTimeout(150);
assert.match(await s.locator('#ex-w12 [data-w="likert"]').innerText(), /agree with 1, disagree with 1/);
await s.check(`${sel("w16", "1")}[value=${keys.w16["1"]}]`);
await s.fill(sel("w16", "1_r"), "it is a complaint, not a record");
await s.selectOption(sel("w18", "1"), "A");
await s.selectOption(sel("w18", "2"), "B");
await s.waitForTimeout(150);
assert.equal(await s.locator('#ex-w18 .sort-board .sort-col span').count(), 2);

step("Footprint calculator, a hundred hectares, law and fairness chart, profile");
const fp1 = await s.locator(".fp-total").innerText();
await s.locator('.fp-in[data-i="0"]').fill("0");
await s.waitForTimeout(150);
assert.notEqual(await s.locator(".fp-total").innerText(), fp1, "footprint recalculates");
await s.locator('.sim-in[data-u="house"]').fill("20");
await s.waitForTimeout(150);
assert.match(await s.locator(".sim-rest").innerText(), /20 ha too many/);
await s.selectOption(sel("w112", "A_law"), "5");
await s.selectOption(sel("w112", "A_fair"), "2");
await s.waitForTimeout(150);
assert.equal(await s.locator(".lf-ch .dot").count(), 1, "claimant A on the chart");
for (let i = 1; i <= 8; i++) await s.check(`${sel("w110", String(i))}[value=A]`);
await s.click("[data-prof-go]");
assert.match(await s.locator(".prof").innerText(), /your strength/i);
await s.locator("#ex-w19").screenshot({ path: `${SHOTS}/20-footprint.png` });
await s.locator("#ex-w111").screenshot({ path: `${SHOTS}/21-landsim.png` });
await s.locator("#ex-w112").screenshot({ path: `${SHOTS}/22-lawchart.png` });
await s.locator("#ex-w110").screenshot({ path: `${SHOTS}/23-profile.png` });

step("Tool values and the profile survive leaving the page and coming back");
await s.goto(`${BASE}/index.html#u1/reading`);
await s.waitForSelector("#ex-r1");
await s.goto(`${BASE}/index.html#u1/warmup`);
await s.waitForSelector("#ex-w19 .fp-in");
await s.waitForTimeout(200);
assert.equal(await s.inputValue('.fp-in[data-i="0"]'), "0");
assert.equal(await s.inputValue('.sim-in[data-u="house"]'), "20");
assert.match(await s.locator(".prof").innerText(), /your strength/i);

step("Speaking: timer runs, voice is recorded and played back in the browser only");
await s.goto(`${BASE}/index.html#u1/speaking`);
await s.waitForSelector(".spk");
const spk = s.locator(".spk").first();
const before = await spk.locator(".spk-time").innerText();
const reqs = [];
s.on("request", (r) => { if (r.method() !== "GET") reqs.push(r.url()); });
await spk.locator('[data-spk-act="rec"]').click();
await s.waitForTimeout(2300);
assert.notEqual(await spk.locator(".spk-time").innerText(), before, "timer started with the recording");
await spk.locator('[data-spk-act="rec"]').click();
await s.waitForSelector(".spk-take audio", { timeout: 5000 });
assert.equal(await spk.locator(".spk-take").count(), 1);
assert.match(await spk.locator(".spk-take a").getAttribute("href"), /^blob:/);
assert.equal(reqs.length, 0, "nothing uploaded: " + reqs.join(", "));
await spk.screenshot({ path: `${SHOTS}/30-speaking-recorder.png` });
await spk.locator('[data-spk-act="start"]').click();
await s.waitForTimeout(1200);
assert.equal(await spk.locator('[data-spk-act="start"]').innerText(), "Pause");
await spk.locator('[data-spk-act="reset"]').click();

step("Gap, match and multiple choice answers; the teacher checks one exercise of each kind");
await s.goto(`${BASE}/index.html#u1/reading`);
await s.waitForSelector("#ex-r1");
// r1 (mcq): first item right, second wrong
await s.check(`${sel("r1", "1")}[value=${keys.r1["1"]}]`);
await s.check(`${sel("r1", "2")}[value=${keys.r1["2"] === "A" ? "B" : "A"}]`);
// r2 (True / False / Not given)
await s.selectOption(sel("r2", "1"), keys.r2["1"]);
await s.goto(`${BASE}/index.html#u1/vocabulary`);
await s.waitForSelector("#ex-v1");
const v1 = keys.v1["1"];
await s.fill(sel("v1", "1"), Array.isArray(v1) ? v1[0] : v1);
await s.fill(sel("v1", "2"), "wrongword");
await s.locator("#save-state", { hasText: /Saved|saved/ }).waitFor({ timeout: 6000 });

await t.goto(`${BASE}/teacher.html#u1/reading`);
await t.waitForSelector('[data-act="check-ex"][data-ex="r1"]');
await t.click('[data-act="check-ex"][data-ex="r1"]');
await t.waitForSelector('[data-act="uncheck-ex"][data-ex="r1"]');
await t.click('[data-act="check-ex"][data-ex="r2"]');
await t.goto(`${BASE}/teacher.html#u1/vocabulary`);
await t.waitForSelector('[data-act="check-ex"][data-ex="v1"]');
await t.click('[data-act="check-ex"][data-ex="v1"]');
await t.waitForSelector('[data-act="uncheck-ex"][data-ex="v1"]');

await s.goto(`${BASE}/index.html#u1/reading`);
await s.waitForSelector("#ex-r1 label.ok", { timeout: 6000 });
assert.equal(await s.locator("#ex-r1 label.ok").count(), 1);
assert.equal(await s.locator("#ex-r1 label.bad").count(), 1, "the wrong choice is marked");
assert.equal(await s.locator("#ex-r2 .gap.ok").count(), 1);
await s.locator("#ex-r1").screenshot({ path: `${SHOTS}/40-r1-checked.png` });
await s.goto(`${BASE}/index.html#u1/vocabulary`);
await s.waitForSelector("#ex-v1 .gap.ok");
assert.equal(await s.locator("#ex-v1 .gap.ok").count(), 1);
assert.equal(await s.locator(`${sel("v1", "2")}.bad`).count(), 1);
assert.match(await s.locator("#ex-v1").innerText(), /Correct: /);

step("Dark theme and mobile width");
await s.click(".topbar [data-theme-toggle]");
assert.equal(await s.evaluate(() => document.documentElement.dataset.theme), "dark");
await s.goto(`${BASE}/index.html#u1/warmup`);
await s.waitForSelector("#ex-w11");
await shot(s, "50-dark-warmup");
await s.goto(`${BASE}/index.html#u1/grammar`);
await s.waitForSelector(".rule");
await shot(s, "51-dark-grammar");
await t.reload();
await t.waitForSelector(".keyhint");
await shot(t, "52-dark-teacher");
await s.click(".topbar [data-theme-toggle]");
await s.setViewportSize({ width: 390, height: 844 });
await s.goto(`${BASE}/index.html#u1/warmup`);
await s.waitForSelector("#ex-w11");
const overflow = await s.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
assert.ok(overflow <= 1, "no horizontal scroll on a phone (" + overflow + "px)");
await shot(s, "60-mobile");

assert.deepEqual(errors, [], "no page errors");
console.log("\nALL UNIT 1 CHECKS PASSED");
await browser.close();
