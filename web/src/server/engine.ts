// The Rust Clinician, compiled to wasm and imported as a module by the Pages Functions bundler.
import wasm from "../wasm/clinician.wasm";
import { Clinician } from "../lib/clinician";

let instance: Promise<Clinician> | null = null;
export const clinician = () => (instance ??= Clinician.load(wasm as unknown as WebAssembly.Module));
