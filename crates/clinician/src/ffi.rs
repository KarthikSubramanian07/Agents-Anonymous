//! A tiny C ABI so the module needs no bindgen glue on the JS side.
//!
//! JS protocol:
//!   1. `ptr = aa_alloc(len)`; copy UTF-8 input into memory at `ptr`.
//!   2. `packed = aa_diagnose(ptr, len)` (or `aa_redact`); the input is freed.
//!   3. `out_ptr = packed >> 32`, `out_len = packed & 0xffffffff`; read UTF-8 JSON.
//!   4. `aa_free(out_ptr, out_len)`.

use std::alloc::{alloc, dealloc, Layout};

#[no_mangle]
pub extern "C" fn aa_alloc(len: usize) -> *mut u8 {
    if len == 0 {
        return std::ptr::NonNull::<u8>::dangling().as_ptr();
    }
    unsafe { alloc(Layout::from_size_align_unchecked(len, 1)) }
}

/// # Safety
/// `ptr` and `len` must come from [`aa_alloc`] or a packed return value.
#[no_mangle]
pub unsafe extern "C" fn aa_free(ptr: *mut u8, len: usize) {
    if len != 0 && !ptr.is_null() {
        dealloc(ptr, Layout::from_size_align_unchecked(len, 1));
    }
}

unsafe fn take_input(ptr: *mut u8, len: usize) -> String {
    let s = if len == 0 { String::new() } else { String::from_utf8_lossy(std::slice::from_raw_parts(ptr, len)).into_owned() };
    aa_free(ptr, len);
    s
}

fn give(out: String) -> u64 {
    let bytes = out.into_bytes().into_boxed_slice();
    let len = bytes.len();
    let ptr = Box::into_raw(bytes) as *mut u8;
    ((ptr as usize as u64) << 32) | (len as u64)
}

/// # Safety
/// See module docs.
#[no_mangle]
pub unsafe extern "C" fn aa_diagnose(ptr: *mut u8, len: usize) -> u64 {
    let input = take_input(ptr, len);
    let report = crate::diagnose_text(&input);
    give(serde_json::to_string(&report).unwrap_or_else(|_| "{}".into()))
}

/// # Safety
/// See module docs.
#[no_mangle]
pub unsafe extern "C" fn aa_redact(ptr: *mut u8, len: usize) -> u64 {
    let input = take_input(ptr, len);
    give(serde_json::to_string(&crate::redact::redact(&input)).unwrap_or_else(|_| "{}".into()))
}

#[no_mangle]
pub extern "C" fn aa_version() -> u64 {
    give(crate::VERSION.to_string())
}
