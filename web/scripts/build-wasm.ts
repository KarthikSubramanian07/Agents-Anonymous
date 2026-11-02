// Build the Rust Clinician to wasm32 and copy it where the site and functions need it.
// Kept gentle on the machine: two compile jobs, low priority.
import { $ } from "bun";
import { mkdir, copyFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const out = resolve(root, "target/wasm32-unknown-unknown/release/clinician.wasm");
await $`nice -n 10 cargo build --release -p clinician --lib --target wasm32-unknown-unknown`.cwd(root).env({ ...process.env, CARGO_BUILD_JOBS: "2" });
for (const dest of ["web/src/wasm/clinician.wasm", "web/public/clinician.wasm"]) {
  await mkdir(resolve(root, dest, ".."), { recursive: true });
  await copyFile(out, resolve(root, dest));
}
await mkdir(resolve(root, "web/public/hooks"), { recursive: true });
await copyFile(resolve(root, "hooks/claude-code/aa-sponsor.sh"), resolve(root, "web/public/hooks/aa-sponsor.sh"));
console.log(`clinician.wasm ${((await stat(out)).size / 1024).toFixed(0)} KB → web/src/wasm, web/public`);
