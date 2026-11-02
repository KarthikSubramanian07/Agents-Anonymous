/**
 * Universal loader for the Rust Clinician (wasm32, plain C ABI).
 * Works in the browser, in Cloudflare Functions, and in Bun/Node at build time.
 */
export interface Evidence { turn: number; quote: string }
export interface Finding {
  id: string; code: string; name: string; severity: number;
  confidence: "possible" | "probable" | "definite";
  count: number; detail: string; step: number; counter: string; note: string; evidence: Evidence[];
}
export interface TEvent { kind: "user" | "assistant" | "call" | "result" | "system"; text: string; tool?: string; error?: boolean }
export interface Report {
  engine: string; score: number; prognosis: "clean" | "slipping" | "struggling" | "intervention"; verdict: string;
  findings: Finding[];
  vitals: { turns: number; user_turns: number; assistant_turns: number; tool_calls: number; tool_errors: number; unique_call_ratio: number; words: number };
  signals: { verified_claim: boolean; zero_apologies: boolean; pushback_survived: boolean };
  prescription: { steps: number[]; note: string };
  chips: string[];
  events: TEvent[];
}
export interface Redacted { text: string; redactions: Record<string, number> }

interface Exports {
  memory: WebAssembly.Memory;
  aa_alloc(len: number): number;
  aa_free(ptr: number, len: number): void;
  aa_diagnose(ptr: number, len: number): bigint;
  aa_redact(ptr: number, len: number): bigint;
}

export class Clinician {
  private enc = new TextEncoder();
  private dec = new TextDecoder();
  constructor(private ex: Exports) {}

  static async load(source: WebAssembly.Module | BufferSource | Response | Promise<Response>): Promise<Clinician> {
    let instance: WebAssembly.Instance;
    if (source instanceof WebAssembly.Module) {
      instance = await WebAssembly.instantiate(source, {});
    } else if (source instanceof Response || source instanceof Promise) {
      const res = await source;
      instance = WebAssembly.instantiateStreaming && res.headers.get("content-type")?.includes("wasm")
        ? (await WebAssembly.instantiateStreaming(res, {})).instance
        : (await WebAssembly.instantiate(await res.arrayBuffer(), {})).instance;
    } else {
      instance = (await WebAssembly.instantiate(source, {})).instance;
    }
    return new Clinician(instance.exports as unknown as Exports);
  }

  private call(fn: "aa_diagnose" | "aa_redact", input: string): string {
    const bytes = this.enc.encode(input);
    const ptr = this.ex.aa_alloc(bytes.length);
    new Uint8Array(this.ex.memory.buffer, ptr, bytes.length).set(bytes);
    const packed = BigInt.asUintN(64, this.ex[fn](ptr, bytes.length));
    const outPtr = Number(packed >> 32n);
    const outLen = Number(packed & 0xffffffffn);
    const out = this.dec.decode(new Uint8Array(this.ex.memory.buffer, outPtr, outLen).slice());
    this.ex.aa_free(outPtr, outLen);
    return out;
  }

  diagnose(transcript: string | object): Report {
    const input = typeof transcript === "string" ? transcript : JSON.stringify(transcript);
    return JSON.parse(this.call("aa_diagnose", input));
  }

  redact(text: string): Redacted {
    return JSON.parse(this.call("aa_redact", text));
  }
}

/** Build-time helper (Astro frontmatter): reads the wasm from disk. */
export async function clinicianAtBuild(): Promise<Clinician> {
  const { readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  // astro build runs from web/; bundling moves this module, so resolve from cwd.
  return Clinician.load(await readFile(resolve(process.cwd(), "src/wasm/clinician.wasm")));
}
