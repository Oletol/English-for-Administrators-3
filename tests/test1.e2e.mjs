// Unit 1 Progress Test on the mock Firebase: hidden until opened, timer, the recording plays twice only,
// lenient translation, automatic marking by the teacher's button, 60 points in total.
// Run: python3 -m http.server 5055 -d docs &  node tests/test1.e2e.mjs
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";

const BASE = "http://127.0.0.1:5055";
const SHOTS = process.env.SHOTS || "/tmp/shots-t1";
mkdirSync(SHOTS, { recursive: true });
const mock = readFileSync(new URL("./mock-fb.js", import.meta.url), "utf8");
const courseText = readFileSync(new URL("../content-private/course.json", import.meta.url), "utf8");
const course = JSON.parse(courseText);
const test = course.units[0].tests[0];
const WAV = process.env.WAV;   // a short silent wav stands in for the recording

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--autoplay-policy=no-user-gesture-required"],
}).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route("**/js/fb.js", (r) => r.fulfill({ contentType: "text/javascript", body: mock }));
await ctx.route("**/media/u1/test1-listening.mp3", (r) => r.fulfill({ contentType: "audio/wav", body: readFileSync(WAV) }));
const errors = [];
const page = async (url) => {
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(url + ": " + e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/favicon|fonts\.g|ERR_TUNNEL|ERR_NAME/.test(m.text())) errors.push(url + " console: " + m.text()); });
  p.on("dialog", (d) => d.accept());
  await p.goto(BASE + url);
  return p;
};
const shot = (p, n, full = false) => p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: full });
const step = (t) => console.log("•", t);
const sel = (ex, it) => `[data-ex="${ex}"][data-item="${it}"]`;
const ARROWS = /[←-⇿⟵-⟿➔➜-➿▶►›‹»«]/;

// ------------------------------------------------------------------ teacher
const t = await page("/teacher.html");
await t.evaluate(() => {
  localStorage.setItem("mock:auth", JSON.stringify({ "teacher@uni.ru": { uid: "T1", password: "secret1" } }));
  localStorage.setItem("mock:db", JSON.stringify({ "teachers/T1": { name: "O. Tolstykh" } }));
});
await t.reload();
step("Teacher imports the course");
await t.fill("#auth-form [name=email]", "teacher@uni.ru");
await t.fill("#auth-form [name=password]", "secret1");
await t.click("#auth-submit");
await t.waitForSelector("#tool-nav .sb-item");
await t.click('a[href="#tools/content"]');
await t.waitForSelector("#import-text");
await t.evaluate((c) => { document.querySelector("#import-text").value = c; }, courseText);
await t.click("[data-act=import]");
await t.waitForTimeout(1500);
const stored = await t.evaluate(() => JSON.parse(localStorage.getItem("mock:db")));
assert.ok(stored["testContent/u1--t1"], "test content stored separately");
const tc = JSON.stringify(stored["testContent/u1--t1"]);
assert.ok(!tc.includes('"answer"'), "no keys in the test content");
assert.ok(tc.includes("test1-listening.mp3"), "the audio block is kept in the test");
assert.ok(!JSON.stringify(stored["unitContent/u1"]).includes("Putting the commons on the map"), "the test is not in the book");
const tkeys = stored["answerKeys/u1"].tests?.t1?.keys;
assert.ok(tkeys, "test keys stored with the unit keys");
assert.equal(Object.values(tkeys).reduce((n, k) => n + Object.keys(k).length, 0), 60, "60 keyed questions");

step("Group");
await t.click('a[href="#tools/groups"]');
await t.waitForSelector("#g-name");
await t.fill("#g-name", "PM 3");
await t.fill("#g-code", "pm-3");
await t.click("[data-act=create-group]");
await t.waitForSelector("code:text('PM-3')");

// ------------------------------------------------------------------ student: hidden until opened
step("Student registers: no test in the sidebar");
const s = await page("/index.html");
await s.click("[data-mode=register]");
await s.fill("[name=name]", "Anna Ivanova");
await s.fill("[name=email]", "anna@uni.ru");
await s.fill("[name=password]", "pass123");
await s.fill("[name=group]", "pm-3");
await s.click("#auth-submit");
await s.waitForSelector("#unit-nav .sb-uh, .sb-uh", { timeout: 8000 });
await s.waitForTimeout(500);
assert.equal(await s.locator("#test-nav-wrap").isHidden(), true, "the test is hidden");

step("Teacher opens the test");
await t.click('a[href="#tools/tests"]');
await t.waitForSelector('[data-act="test-open"]');
await shot(t, "01-teacher-tests");
await t.click('[data-act="test-open"]');
await s.waitForSelector("#test-nav a", { timeout: 5000 });
assert.match(await s.textContent("#test-nav"), /Progress Test 1\. Land/);
await s.click("#test-nav a");
await s.waitForSelector("#start-test");
assert.match(await s.textContent("#content"), /40 minutes/);
await s.click("#start-test");
await s.waitForSelector("#ex-t1a1", { timeout: 5000 });
const timerText = (await s.textContent("#test-timer")).trim();
assert.ok(/^(39|40):\d\d$/.test(timerText), "timer: " + timerText);
const txt = await s.locator("#content").innerText();
assert.ok(!ARROWS.test(txt), "arrow symbol: " + (txt.match(ARROWS) || [])[0]);
for (const p of ["Part A. Listening", "Part B. Reading", "Part C. Vocabulary", "Part D. Grammar", "Part E. Translation"]) assert.ok(txt.includes(p), p);
assert.ok(txt.includes("Putting the commons on the map"));
assert.equal(await s.locator(".tnote, .keyhint").count(), 0, "no teacher material");
// continuous numbering: the last exercise starts at 51
assert.equal(await s.locator("#ex-t1e1 ol.items").first().getAttribute("start"), "51");
assert.equal(await s.locator("#ex-t1d2 ol.items").first().getAttribute("start"), "46");
await shot(s, "02-student-test-top");

step("The recording plays twice only, and an autosave does not reset it");
const playOnce = async () => {
  await s.evaluate(() => { const a = document.querySelector("audio[data-maxplays]"); a.currentTime = 0; return a.play(); });
  await s.waitForFunction(() => { const a = document.querySelector("audio[data-maxplays]"); return !a || a.ended; }, null, { timeout: 8000 });
};
await playOnce();
assert.equal((await s.textContent(".au-used")).trim(), "1");
// typing an answer triggers an autosave; the player must stay where it is
await s.fill(sel("t1a2", "5"), "communal");
await s.locator("#save-state", { hasText: /Saved/ }).waitFor({ timeout: 5000 });
assert.equal((await s.textContent(".au-used")).trim(), "1", "plays kept after autosave");
await playOnce();
await s.waitForSelector(".au-done");
assert.equal(await s.locator("audio[data-maxplays]").count(), 0, "player removed after two plays");
await s.reload();
await s.waitForSelector("#ex-t1a1");
assert.equal(await s.locator("audio[data-maxplays]").count(), 0, "still no player after reloading the page");
assert.ok(await s.locator(".au-done").isVisible());

step("Student answers every question; translation written in a lenient way");
const first = (a) => {
  let k = Array.isArray(a) ? a[0] : a;
  k = k.replace(/\(([^()]+)\)\s*/g, "");          // drop optional words
  k = k.replace(/([A-Za-z'-]+)(\/[A-Za-z'-]+)+/g, "$1"); // first of a/b
  return k.replace(/\s+/g, " ").trim();
};
// lenient answers for Part E: capital letters, articles, a different correct variant
const LENIENT = { "1": "The right to land", "2": "Under customary law", "3": "The cadastre hasn't been updated", "4": "the expropriation of land",
  "5": "Compensation", "6": "Complaints are being reviewed", "7": "ought to have been consulted", "8": "used to be left fallow",
  "9": "Land grabbing", "10": "is a precondition" };
for (const b of test.exercises) {
  if (b.type !== "exercise") continue;
  for (const it of b.items) {
    const loc = s.locator(sel(b.id, it.id));
    const n = await loc.count();
    if (b.kind === "mcq") { await s.check(`${sel(b.id, it.id)}[value="${it.answer}"]`); continue; }
    if (b.kind === "match") { await loc.selectOption(String(Array.isArray(it.answer) ? it.answer[0] : it.answer)); continue; }
    assert.equal(n, 1, b.id + "/" + it.id);
    await loc.fill(b.id === "t1e1" ? LENIENT[it.id] : first(it.answer));
  }
}
// two deliberately wrong answers: a wrong tense and a wrong word
await s.fill(sel("t1d1", "3"), "has granted");
await s.fill(sel("t1c2", "2"), "insecureness");
await s.locator("#save-state", { hasText: /Saved/ }).waitFor({ timeout: 5000 });
await shot(s, "03-student-test-answered", true);

step("Student submits; teacher checks and shows results");
await s.click("#submit-test");
await s.waitForSelector(".ub-sub", { timeout: 5000 });
await t.click('[data-act="test-select"]');
await t.waitForTimeout(800);
await shot(t, "04-teacher-monitor");
await t.click('[data-act="test-release"]');
await s.waitForSelector(".ub-res:has-text('Your result')", { timeout: 8000 });
const res = (await s.textContent(".ub-res")).trim();
console.log("  result bar:", res);
assert.ok(res.includes("58 / 60"), res);
// every translation answer counted as correct
const eScore = await s.textContent("#ex-t1e1 .ex-score");
assert.equal(eScore.trim(), "10 / 10");
await shot(s, "05-student-result", true);
await s.locator("#ex-t1d1").screenshot({ path: `${SHOTS}/06-grammar-marked.png` });

step("Dark theme and phone width");
await s.click(".topbar [data-theme-toggle]");
await s.setViewportSize({ width: 390, height: 844 });
await s.waitForTimeout(300);
const overflow = await s.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
assert.ok(overflow <= 1, "no horizontal scroll (" + overflow + "px)");
await shot(s, "07-mobile-dark");

assert.deepEqual(errors, [], "no page errors");
console.log("\nALL PROGRESS TEST CHECKS PASSED");
await browser.close();
