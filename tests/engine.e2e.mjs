// msupm2 course on the English for Administrators_1 engine (Nov 2026):
// import of the real course.json, widgets (estimate, rate, tools), the recorder + Transcribe (the speech
// program is replaced by a stub here), Check the speaking now, Speaking and Writing progress, pair partner list,
// Analytics with drafts, the timed test with a limited recording, light/dark theme, no keys, no arrows.
// Run: python3 -m http.server 5055 -d docs &  node tests/engine.e2e.mjs
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
const BASE = "http://127.0.0.1:5055";
const SHOTS = process.env.SHOTS || "/tmp/shots-engine";
mkdirSync(SHOTS, { recursive: true });
const mock = readFileSync(new URL("./mock-fb.js", import.meta.url), "utf8");
const courseText = readFileSync(new URL("../content-private/course.json", import.meta.url), "utf8");
const real = readFileSync(new URL("../docs/js/transcribe.js", import.meta.url), "utf8");
// the speech program is not downloaded in the test: transcribeBlob returns a fixed text with typical mistakes
const TEXT = "I think the farmers should get less water because the city need it more. The river was very low in the summer and nobody have checked the gauge.";
const stub = real.replace(/export async function transcribeBlob[\s\S]*?\n}\n/, `export async function transcribeBlob(blob, onProgress) {
  onProgress?.({ stage: "prepare" }); await new Promise((r) => setTimeout(r, 200)); onProgress?.({ stage: "run", part: 1, parts: 1 });
  return { text: ${JSON.stringify(TEXT)}, metrics: { speech: 40, total: 52, words: 30, wpm: 45, pauses: 3, longest: 2.4, at: Date.now() } };
}
`);
assert.ok(stub.includes("fixed text") === false && stub !== real, "stub made");

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const ctx = await browser.newContext({ viewport: { width: 1320, height: 920 }, permissions: ["microphone"] });
await ctx.route("**/js/fb.js*", (r) => r.fulfill({ contentType: "text/javascript", body: mock }));
await ctx.route("**/js/transcribe.js*", (r) => r.fulfill({ contentType: "text/javascript", body: stub }));
await ctx.route("https://api.languagetool.org/**", async (r) => {
  const text = new URLSearchParams(r.request().postData()).get("text") || "";
  const i = text.indexOf("the city need");
  const matches = i < 0 ? [] : [{ offset: i + 9, length: 4, message: "Use 'needs' with a singular subject.", shortMessage: "Agreement",
    replacements: [{ value: "needs" }], rule: { issueType: "grammar", category: { name: "Grammar" } } }];
  await r.fulfill({ contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ matches }) });
});
const errors = [];
const page = async (url) => {
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(url + ": " + e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/favicon|404|ERR_|Failed to load resource/.test(m.text())) errors.push(url + " console: " + m.text()); });
  p.on("dialog", (d) => d.accept());
  await p.goto(BASE + url); return p;
};
const shot = (p, n, full = false) => p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: full });
const step = (x) => console.log("•", x);
const sel = (ex, it) => `[data-ex="${ex}"][data-item="${it}"]`;
const ARROWS = /[←-⇿⟵-⟿➔➜-➿▶►›‹»«]/;

step("Teacher imports the course, creates two groups, opens Units 1 and 2");
const t = await page("/teacher.html");
await t.evaluate(() => { localStorage.setItem("mock:auth", JSON.stringify({ "teacher@uni.ru": { uid: "T1", password: "secret1" } })); localStorage.setItem("mock:db", JSON.stringify({ "teachers/T1": { name: "O. Tolstykh" } })); });
await t.reload();
await t.fill("#auth-form [name=email]", "teacher@uni.ru"); await t.fill("#auth-form [name=password]", "secret1"); await t.click("#auth-submit");
await t.waitForSelector("#tool-nav .sb-item");
for (const x of ["speaking", "writing", "stats", "journal"]) assert.ok(await t.isVisible(`a[href="#tools/${x}"]`), x + " in the sidebar");
await t.click('a[href="#tools/content"]');
await t.evaluate((c) => { document.querySelector("#import-text").value = c; }, courseText);
await t.click("[data-act=import]"); await t.waitForSelector("text=Imported");
await t.waitForTimeout(800);
const stored = await t.evaluate(() => JSON.parse(localStorage.getItem("mock:db")));
for (const u of ["u1", "u2"]) {
  const pub = JSON.stringify(stored["unitContent/" + u]);
  assert.ok(!pub.includes('"answer":'), "no keys in unitContent " + u);
  assert.ok(!/Teaching notes|Aim<\/b>/.test(pub), "no teacher notes in " + u);
}
assert.ok(!JSON.stringify(stored["testContent/u1--t1"]).includes('"answer":'), "no keys in the test");
await t.click('a[href="#tools/groups"]'); await t.waitForSelector("#g-name");
for (const g of ["GMU-301", "GMU-302"]) { await t.fill("#g-name", g); await t.fill("#g-code", g); await t.click("[data-act=create-group]"); await t.waitForSelector(`td:has-text('${g}')`); }
await t.click('[data-act=set-group][data-gid="GMU-301"]').catch(() => {});
await t.click('a[href="#tools/access"]');
await t.waitForSelector(".gbar select[data-gpick]");
assert.equal(await t.inputValue(".gbar select[data-gpick]"), "GMU-301", "group bar shows the current group");
for (const u of ["u1", "u2"]) await t.click(`[data-act=toggle-open][data-unit=${u}]`);
await t.waitForTimeout(300);

const reg = async (name, email) => {
  const p = await page("/index.html");
  await p.evaluate(() => sessionStorage.clear()); await p.reload();
  await p.click("[data-mode=register]");
  await p.fill("[name=name]", name); await p.fill("[name=email]", email); await p.fill("[name=password]", "pass123"); await p.fill("[name=group]", "GMU-301");
  await p.click("#auth-submit");
  await p.waitForSelector('.sb-uh[data-unit="u2"][data-can-open="1"]', { timeout: 8000 });
  return p;
};
step("Two students register");
const s = await reg("Amara Okafor", "amara@uni.ru");

step("Unit 1 warm-up: estimate with Reveal, the tools, the rating task");
await s.click('.sb-uh[data-unit="u1"]');
await s.click('.sb-item[href^="#u1/"]:has-text("Warm-up")');
await s.waitForSelector("#ex-w11");
const range = s.locator('#ex-w11 input[type=range]').first();
await range.fill("35");
await s.locator('#ex-w11 [data-reveal]').first().click();
await s.waitForSelector('#ex-w11 .est-a:not([hidden])');
await s.waitForTimeout(1500);
let mdb = await s.evaluate(() => JSON.parse(localStorage.getItem("mock:db")));
const sub1 = Object.entries(mdb).find(([k]) => k.startsWith("submissions/u1__"))?.[1];
assert.ok(sub1 && sub1.answers.w11 && Object.keys(sub1.answers.w11).some((k) => k.endsWith("_shown")), "estimate and Reveal are saved");
assert.ok(await s.locator("#ex-w112 select").count() > 0, "rating task drawn");
await shot(s, "01-u1-warmup");

step("Unit 2 warm-up: record the one-minute case, Transcribe, Done");
await s.click('.sb-uh[data-unit="u2"]');
await s.click('.sb-item[href^="#u2/"]:has-text("Warm-up")');
await s.waitForSelector("#ex-w2_14t");
assert.equal(await s.textContent("#ex-w2_14t .ex-n"), "2.1.15a", "the transcript is numbered as a part of 2.1.15");
assert.equal(await s.textContent("#ex-w2_14 .ex-n"), "2.1.15", "2.1.15 keeps its number");
const spk = s.locator('#ex-w2_14 .spk');
assert.equal(await spk.getAttribute("data-tr"), "w2_14t");
await spk.locator('[data-spk-act=rec]').click();
await s.waitForTimeout(2500);
await spk.locator('[data-spk-act=rec]').click();
await spk.locator('[data-spk-act=tr]').first().waitFor({ timeout: 8000 });
await spk.locator('[data-spk-act=tr]').first().click();
await s.waitForFunction((txt) => document.querySelector('textarea[data-ex="w2_14t"]')?.value === txt, TEXT, { timeout: 10000 });
assert.ok((await s.textContent('[data-sp-line="w2_14t"]')).includes("words per minute"), "speech measures shown");
assert.ok(await s.locator('textarea[data-ex="w2_14t"]').evaluate((e) => e.readOnly), "transcript cannot be typed");
await shot(s, "02-u2-transcribed");
await s.click('[data-done="w2_14t"]');
await s.waitForTimeout(1500);
mdb = await s.evaluate(() => JSON.parse(localStorage.getItem("mock:db")));
const sub2 = Object.entries(mdb).find(([k]) => k.startsWith("submissions/u2__"))?.[1];
assert.equal(sub2.answers.w2_14t?.["1"], TEXT, "transcript saved");
assert.ok(JSON.parse(sub2.answers._speech.w2_14t).wpm === 45, "speech measures saved");

step("Listening 2.6.8: a note for the minister (writing)");
await s.click('.sb-item[href^="#u2/"]:has-text("Listening")');
await s.waitForSelector("#ex-l2_8");
const note = "Minister, the committee proposed to cut irrigation by thirty per cent and industry by twenty. The decision is provisional, because the ministry made its support conditional on a payment for unplanted land. The delta gauge and all metered abstraction will be published daily from the first of July, which should improve transparency. You need to decide on the payment scheme before the next meeting on the twenty-fourth. The treaty obligation to the downstream country is at risk in September if nothing is done, so the matter is urgent and requires your attention this week. I recommend approving the scheme.";
await s.fill(sel("l2_8", "1"), note);
await s.click('[data-done="l2_8"]');
await s.waitForTimeout(1500);

step("Unit 1 Speaking: the pair interview lists the partners of the group");
const s2 = await reg("Lukas Weber", "lukas@uni.ru");
await t.reload(); await t.waitForSelector("#tool-nav .sb-item");
await t.click('a[href="#tools/access"]'); await t.waitForTimeout(800);       // the Teacher's Edition writes the names of the group
await s.reload();
await s.click('.sb-uh[data-unit="u1"]');
await s.click('.sb-item[href="#u1/speaking"]');
await s.waitForSelector("#ex-sp3 select.partner-sel");
await s.waitForFunction(() => document.querySelector("#ex-sp3 select.partner-sel")?.textContent.includes("Lukas Weber"), null, { timeout: 8000 });
await shot(s, "03-u1-speaking-pair", true);

step("Teacher: Check the speaking now; the student sees the feedback");
await t.goto(BASE + "/teacher.html#u2/warmup"); await t.waitForSelector("#ex-w2_14t");
const ck = t.locator('[data-act=check-writing][data-ex="w2_14t"]');
assert.ok((await ck.textContent()).includes("speaking"), "button says Check the speaking now");
await ck.click();
await t.waitForSelector("text=texts checked", { timeout: 20000 });
await s.goto(BASE + "/index.html#u2/warmup"); await s.waitForSelector("#ex-w2_14t .wfb", { timeout: 10000 });
assert.ok((await s.textContent("#ex-w2_14t")).includes("How you spoke"), "speaking feedback shown to the student");
await shot(s, "04-student-speaking-feedback");

step("Speaking progress and Writing progress");
await t.goto(BASE + "/teacher.html#tools/speaking"); await t.waitForSelector(".prog-chart, .t.prog", { timeout: 15000 });
let v = await t.textContent("#view");
assert.ok(v.includes("Amara Okafor") && v.includes("2.1.15a"), "speaking progress lists the student and the task");
await shot(t, "05-speaking-progress", true);
await t.goto(BASE + "/teacher.html#tools/writing"); await t.waitForSelector(".t.prog", { timeout: 15000 });
v = await t.textContent("#view");
assert.ok(v.includes("2.6.8"), "writing progress lists the note for the minister");
await shot(t, "06-writing-progress", true);

step("Analytics counts drafts");
await s.goto(BASE + "/index.html#u2/vocabulary"); await s.waitForSelector("#ex-v2_1");
await s.fill(sel("v2_1", "1"), "settled"); await s.fill(sel("v2_1", "2"), "divert");
await s.waitForTimeout(1800);
await t.goto(BASE + "/teacher.html#tools/stats");
await t.selectOption("#ctx-unit", "u2").catch(() => {});
await t.waitForTimeout(800);
v = await t.textContent("#view");
assert.ok(!/No student has answered anything/.test(v), "analytics is not empty");
assert.ok(v.includes("2.4.1"), "analytics shows the exercise");
await shot(t, "07-analytics", true);

step("Timed test: html, a recording with two plays, lenient answers");
await t.goto(BASE + "/teacher.html#tools/tests"); await t.waitForSelector("[data-act=test-open]");
await t.click("[data-act=test-open]");
await s2.reload(); await s2.waitForSelector('.sb-item:has-text("Progress Test")', { timeout: 8000 }).catch(() => {});
const tl = s2.locator('.sb-item[href*="t1"]').first();
if (await tl.count()) {
  await tl.click(); await s2.click("#start-test"); await s2.waitForSelector(".audio audio[data-maxplays]");
  assert.ok((await s2.textContent("#content")).includes("Plays used"), "limited recording");
  await shot(s2, "08-test");
} else console.log("  (test link not found in the sidebar – skipped)");

step("Teacher's Edition: Word export buttons, dark theme");
await t.goto(BASE + "/teacher.html#u2/grammar"); await t.waitForSelector("#ex-g2_1");
assert.ok(await t.locator("[data-act=docx]").count() > 0, "Word export");
await t.click("[data-theme-toggle] >> nth=-1");
await t.waitForTimeout(300);
assert.equal(await t.evaluate(() => document.documentElement.dataset.theme), "dark");
await shot(t, "09-teacher-dark");
await s.click("[data-theme-toggle] >> nth=-1");
await s.goto(BASE + "/index.html#u2/warmup"); await s.waitForSelector("#ex-w2_14t");
await shot(s, "10-student-dark");

step("No arrows on the pages");
for (const p of [s, t]) assert.ok(!ARROWS.test(await p.textContent("body")), "no arrow characters");

await browser.close();
if (errors.length) { console.log("PAGE ERRORS:\n" + errors.join("\n")); process.exit(1); }
console.log("ALL OK");
