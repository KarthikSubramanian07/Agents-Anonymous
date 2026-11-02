import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Clinician } from "../src/lib/clinician";
import { renderForm, renderTranscript, esc } from "../src/lib/render";

const wasm = await readFile(resolve(import.meta.dir, "../src/wasm/clinician.wasm"));
const c = await Clinician.load(wasm);

describe("clinician wasm", () => {
  test("diagnoses a plain-text transcript", () => {
    const r = c.diagnose("User: fix it\nAssistant: I apologize! Sorry, my mistake. All tests pass now ✅");
    expect(r.findings.map((f) => f.id)).toContain("apology");
    expect(r.prescription.note).toStartWith("A note from your sponsor");
  });
  test("accepts message arrays", () => {
    const r = c.diagnose([{ role: "user", content: "hi" }, { role: "assistant", content: "Hello! How can I help?" }]);
    expect(r.score).toBe(100);
  });
  test("redacts secrets before sharing", () => {
    const r = c.redact("key sk-ant-api03-abcdefghijklmnopqrstuvwxyz mail a@b.co");
    expect(r.text).not.toContain("sk-ant");
    expect(r.text).not.toContain("a@b.co");
  });
});

describe("render", () => {
  test("escapes hostile transcript content", () => {
    const r = c.diagnose(`User: <img src=x onerror=alert(1)>\nAssistant: Sorry! So sorry! <script>alert(1)</script>`);
    const html = renderForm(r) + renderTranscript(r);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
  });
  test("esc", () => expect(esc(`<a href="x">'&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;"));
});
