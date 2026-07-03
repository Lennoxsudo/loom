fn main() {
    tauri_build::build();

    // Inject CBM pinned version from cbm-version.json (single source of truth).
    let version = read_cbm_version().unwrap_or_else(|| "unknown".to_string());
    println!("cargo:rustc-env=CBM_PINNED_VERSION={version}");
    println!("cargo:rerun-if-changed=cbm-version.json");
}

/// Read the "version" field from cbm-version.json without a JSON dependency.
fn read_cbm_version() -> Option<String> {
    let content = std::fs::read_to_string("cbm-version.json").ok()?;
    let key = "\"version\"";
    let start = content.find(key)? + key.len();
    let quote_start = content[start..].find('"')? + start + 1;
    let quote_end = content[quote_start..].find('"')? + quote_start;
    Some(content[quote_start..quote_end].to_string())
}
