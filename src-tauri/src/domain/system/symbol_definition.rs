use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Read file content with encoding fallback.
/// Tries UTF-8 first; if the bytes are not valid UTF-8, auto-detects common
/// CJK encodings (GBK, BIG5, Shift_JIS, etc.) via encoding_rs.
fn read_file_with_fallback(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("Failed to read file: {}", e))?;
    // Fast path: valid UTF-8
    if let Ok(s) = String::from_utf8(bytes.clone()) {
        return Ok(s);
    }
    // Fallback: try common CJK encodings
    let candidates: &[&encoding_rs::Encoding] = &[
        encoding_rs::GBK,
        encoding_rs::BIG5,
        encoding_rs::SHIFT_JIS,
        encoding_rs::EUC_JP,
        encoding_rs::EUC_KR,
        encoding_rs::UTF_16LE,
        encoding_rs::UTF_16BE,
    ];
    for encoding in candidates {
        let (decoded, _, had_errors) = encoding.decode(&bytes);
        if !had_errors {
            let text = decoded.as_ref();
            let printable_ratio = text
                .chars()
                .filter(|c| !c.is_control() || *c == '\n' || *c == '\r' || *c == '\t')
                .count() as f64
                / text.chars().count().max(1) as f64;
            if printable_ratio > 0.9 {
                return Ok(text.to_string());
            }
        }
    }
    // Last resort: lossy UTF-8
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SymbolDefinitionOptions {
    pub file_path: String,
    pub symbol_name: String,
    pub line_number: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SymbolDefinitionResult {
    pub symbol_name: String,
    pub definition_file: String,
    pub definition_line: usize,
    pub definition_type: String,
    pub definition_code: String,
    pub import_source: String,
    pub resolved_path: String,
}

#[derive(Debug)]
struct ImportInfo {
    import_source: String,
    binding_kind: ImportBindingKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ImportBindingKind {
    CurrentFile,
    Named,
    Default,
    Namespace,
}

#[tauri::command]
pub fn get_symbol_definition(
    options: SymbolDefinitionOptions,
) -> Result<SymbolDefinitionResult, String> {
    let file_path = PathBuf::from(&options.file_path);

    if !file_path.exists() {
        return Err(format!("File not found: {}", options.file_path));
    }

    let import_info =
        match find_symbol_import(&file_path, &options.symbol_name, options.line_number) {
            Ok(import_info) => import_info,
            Err(import_error) => {
                if is_vue_file(&file_path) {
                    if let Some((resolved_file, definition)) =
                        find_vue_component_definition_by_convention(
                            &file_path,
                            &options.symbol_name,
                        )?
                    {
                        let mut definition_code = definition.code;
                        const MAX_DEFINITION_CODE_CHARS: usize = 20_000;
                        if definition_code.chars().count() > MAX_DEFINITION_CODE_CHARS {
                            definition_code = definition_code
                                .chars()
                                .take(MAX_DEFINITION_CODE_CHARS)
                                .collect::<String>();
                            definition_code
                                .push_str("\n... (truncated; use read_file to view the full file)");
                        }

                        return Ok(SymbolDefinitionResult {
                            symbol_name: options.symbol_name,
                            definition_file: resolved_file.to_string_lossy().to_string(),
                            definition_line: definition.line_number,
                            definition_type: definition.definition_type,
                            definition_code,
                            import_source: "(vue component convention)".to_string(),
                            resolved_path: resolved_file.to_string_lossy().to_string(),
                        });
                    }
                }

                return Err(import_error);
            }
        };

    if import_info.import_source.is_empty() {
        let definition = find_symbol_in_current_file(
            &read_file_with_fallback(&file_path)?,
            &options.symbol_name,
        )
        .ok_or_else(|| {
            format!(
                "Symbol definition not found in current file: {}",
                options.symbol_name
            )
        })?;

        let mut definition_code = definition.code;
        const MAX_DEFINITION_CODE_CHARS: usize = 20_000;
        if definition_code.chars().count() > MAX_DEFINITION_CODE_CHARS {
            definition_code = definition_code
                .chars()
                .take(MAX_DEFINITION_CODE_CHARS)
                .collect::<String>();
            definition_code.push_str("\n... (truncated; use read_file to view the full file)");
        }

        return Ok(SymbolDefinitionResult {
            symbol_name: options.symbol_name,
            definition_file: file_path.to_string_lossy().to_string(),
            definition_line: definition.line_number,
            definition_type: definition.definition_type,
            definition_code,
            import_source: "(current file)".to_string(),
            resolved_path: file_path.to_string_lossy().to_string(),
        });
    }

    let resolved_file = resolve_import_path(&file_path, &import_info.import_source)?;

    let definition = find_symbol_definition(
        &resolved_file,
        &options.symbol_name,
        matches!(import_info.binding_kind, ImportBindingKind::Default),
    )?;

    let mut definition_code = definition.code;
    const MAX_DEFINITION_CODE_CHARS: usize = 20_000;
    if definition_code.chars().count() > MAX_DEFINITION_CODE_CHARS {
        definition_code = definition_code
            .chars()
            .take(MAX_DEFINITION_CODE_CHARS)
            .collect::<String>();
        definition_code.push_str("\n... (truncated; use read_file to view the full file)");
    }

    Ok(SymbolDefinitionResult {
        symbol_name: options.symbol_name,
        definition_file: resolved_file.to_string_lossy().to_string(),
        definition_line: definition.line_number,
        definition_type: definition.definition_type,
        definition_code,
        import_source: import_info.import_source,
        resolved_path: resolved_file.to_string_lossy().to_string(),
    })
}

fn find_symbol_import(
    file_path: &Path,
    symbol_name: &str,
    line_number: Option<usize>,
) -> Result<ImportInfo, String> {
    let content = read_file_with_fallback(file_path)?;

    if let Some(_) = find_symbol_in_current_file(&content, symbol_name) {
        return Ok(ImportInfo {
            import_source: String::new(),
            binding_kind: ImportBindingKind::CurrentFile,
        });
    }

    let import_statements = parse_all_imports(&content);

    let lookup = |statements: &[ImportStatement],
                  target_line: Option<usize>|
     -> Option<ImportInfo> {
        for import_stmt in statements {
            if let Some(tl) = target_line {
                if tl < import_stmt.start_line || tl > import_stmt.end_line {
                    continue;
                }
            }

            if import_stmt.symbols.iter().any(|s| s == symbol_name) {
                return Some(ImportInfo {
                    import_source: import_stmt.source.clone(),
                    binding_kind: ImportBindingKind::Named,
                });
            }

            if import_stmt.is_default && import_stmt.default_name.as_deref() == Some(symbol_name) {
                return Some(ImportInfo {
                    import_source: import_stmt.source.clone(),
                    binding_kind: ImportBindingKind::Default,
                });
            }

            if import_stmt.namespace_name.as_deref() == Some(symbol_name) {
                return Some(ImportInfo {
                    import_source: import_stmt.source.clone(),
                    binding_kind: ImportBindingKind::Namespace,
                });
            }
        }
        None
    };

    if let Some(found) = lookup(&import_statements, line_number) {
        return Ok(found);
    }

    if let Some(found) = lookup(&import_statements, None) {
        return Ok(found);
    }

    Err(format!("Symbol not found in imports: {}", symbol_name))
}

#[derive(Debug)]
struct ImportStatement {
    start_line: usize,
    end_line: usize,
    source: String,
    symbols: Vec<String>,
    default_name: Option<String>,
    namespace_name: Option<String>,
    is_default: bool,
}

fn parse_all_imports(content: &str) -> Vec<ImportStatement> {
    let mut imports = Vec::new();
    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i].trim();

        if line.starts_with("import") {
            let mut full_import = String::from(line);
            let start_line = i + 1;
            let start_idx = i;

            while i < lines.len() - 1 && !is_import_statement_complete(&full_import) {
                i += 1;
                full_import.push(' ');
                full_import.push_str(lines[i].trim());
            }

            let end_line = i + 1;

            if let Some(import_stmt) =
                parse_single_import(&full_import, start_line, end_line, start_idx == i)
            {
                imports.push(import_stmt);
            }
        }

        i += 1;
    }

    imports
}

fn is_import_statement_complete(import_str: &str) -> bool {
    let s = import_str.trim();

    if s.contains(';') {
        return true;
    }

    if let Some(from_idx) = s.find("from") {
        let after_from = s[from_idx + 4..].trim();
        return extract_quoted_string(after_from).is_some();
    }

    if s.starts_with("import") {
        let after_import = s.trim_start_matches("import").trim();
        return extract_quoted_string(after_import).is_some();
    }

    false
}

fn parse_single_import(
    import_str: &str,
    start_line: usize,
    end_line: usize,
    is_single_line: bool,
) -> Option<ImportStatement> {
    let import_str = import_str.trim().strip_prefix("import")?.trim();

    if import_str.contains("* as") {
        let parts: Vec<&str> = import_str.split_whitespace().collect();
        let as_idx = parts.iter().position(|&p| p == "as")?;
        let namespace_name = parts.get(as_idx + 1)?.to_string();
        let from_idx = parts.iter().position(|&p| p == "from")?;
        let source_part = parts[from_idx + 1..].join(" ");
        let source = extract_quoted_string(&source_part)?;

        return Some(ImportStatement {
            start_line,
            end_line: if is_single_line { start_line } else { end_line },
            source,
            symbols: Vec::new(),
            default_name: None,
            namespace_name: Some(namespace_name),
            is_default: false,
        });
    }

    if import_str.contains('{') {
        let start = import_str.find('{')?;
        let end = import_str.find('}')?;
        let default_name = import_str[..start].trim().trim_end_matches(',').trim();
        let imports_part = &import_str[start + 1..end];

        let symbols: Vec<String> = imports_part
            .split(',')
            .filter_map(parse_named_import_binding)
            .collect();

        let from_part = &import_str[end + 1..];
        let from_idx = from_part.find("from")?;
        let source_part = &from_part[from_idx + 4..].trim();
        let source = extract_quoted_string(source_part)?;

        return Some(ImportStatement {
            start_line,
            end_line: if is_single_line { start_line } else { end_line },
            source,
            symbols,
            default_name: if default_name.is_empty() {
                None
            } else {
                Some(default_name.to_string())
            },
            namespace_name: None,
            is_default: !default_name.is_empty(),
        });
    }

    if import_str.contains("from") {
        let parts: Vec<&str> = import_str.split_whitespace().collect();
        let from_idx = parts.iter().position(|&p| p == "from")?;

        if from_idx > 0 {
            let default_name = parts[0].to_string();
            let source_part = parts[from_idx + 1..].join(" ");
            let source = extract_quoted_string(&source_part)?;

            return Some(ImportStatement {
                start_line,
                end_line: if is_single_line { start_line } else { end_line },
                source,
                symbols: Vec::new(),
                default_name: Some(default_name),
                namespace_name: None,
                is_default: true,
            });
        }
    }

    None
}

fn find_symbol_in_current_file(content: &str, symbol_name: &str) -> Option<SymbolDefinition> {
    let lines: Vec<&str> = content.lines().collect();

    for (idx, line) in lines.iter().enumerate() {
        let line_num = idx + 1;
        let trimmed = line.trim();

        if let Some(def_type) = check_definition_pattern(trimmed, symbol_name) {
            let context_lines = extract_code_context_with_braces(&lines, idx, 50);

            return Some(SymbolDefinition {
                line_number: line_num,
                definition_type: def_type,
                code: context_lines,
            });
        }
    }

    None
}

fn check_definition_pattern(line: &str, symbol_name: &str) -> Option<String> {
    let trimmed = line.trim();

    if trimmed.contains("interface") && trimmed.contains(symbol_name) {
        let pattern = format!("interface {}", symbol_name);
        if trimmed.contains(&pattern) || trimmed.contains(&format!("interface  {}", symbol_name)) {
            return Some("interface".to_string());
        }
    }

    if trimmed.contains("class") && trimmed.contains(symbol_name) {
        let pattern = format!("class {}", symbol_name);
        if trimmed.contains(&pattern) || trimmed.contains(&format!("class  {}", symbol_name)) {
            return Some("class".to_string());
        }
    }

    if trimmed.contains("type") && trimmed.contains(symbol_name) && trimmed.contains('=') {
        let pattern = format!("type {}", symbol_name);
        if trimmed.contains(&pattern) || trimmed.contains(&format!("type  {}", symbol_name)) {
            return Some("type".to_string());
        }
    }

    if trimmed.contains("const") && trimmed.contains(symbol_name) && trimmed.contains('=') {
        let pattern = format!("const {} =", symbol_name);
        let pattern2 = format!("const {}=", symbol_name);
        if trimmed.contains(&pattern) || trimmed.contains(&pattern2) {
            return Some("const".to_string());
        }
    }

    if trimmed.contains("function") && trimmed.contains(symbol_name) {
        let pattern = format!("function {}(", symbol_name);
        let pattern2 = format!("function {} (", symbol_name);
        if trimmed.contains(&pattern) || trimmed.contains(&pattern2) {
            return Some("function".to_string());
        }
    }

    if trimmed.contains("enum") && trimmed.contains(symbol_name) {
        let pattern = format!("enum {}", symbol_name);
        if trimmed.contains(&pattern) || trimmed.contains(&format!("enum  {}", symbol_name)) {
            return Some("enum".to_string());
        }
    }

    None
}

fn extract_quoted_string(s: &str) -> Option<String> {
    let trimmed = s.trim();

    if (trimmed.starts_with('"') && trimmed.contains('"'))
        || (trimmed.starts_with('\'') && trimmed.contains('\''))
    {
        let quote_char = if trimmed.starts_with('"') { '"' } else { '\'' };
        let start = trimmed.find(quote_char)? + 1;
        let end = trimmed[start..].find(quote_char)?;
        return Some(trimmed[start..start + end].to_string());
    }

    None
}

fn resolve_import_path(source_file: &Path, import_source: &str) -> Result<PathBuf, String> {
    let source_dir = source_file
        .parent()
        .ok_or_else(|| "Failed to get parent directory".to_string())?;

    let resolved_import = if import_source.starts_with("@/") || import_source.starts_with("~/") {
        resolve_path_alias(source_file, import_source)?
    } else {
        import_source.to_string()
    };

    if resolved_import.starts_with("./") || resolved_import.starts_with("../") {
        let base_path = source_dir.join(&resolved_import);

        let extensions = [
            "", ".ts", ".tsx", ".js", ".jsx", ".vue", ".d.ts", ".mts", ".cts", ".mjs", ".cjs",
        ];

        for ext in &extensions {
            let path_with_ext = if ext.is_empty() {
                base_path.clone()
            } else {
                PathBuf::from(format!("{}{}", base_path.display(), ext))
            };

            if path_with_ext.exists() && path_with_ext.is_file() {
                return Ok(path_with_ext);
            }
        }

        let index_files = [
            "index.ts",
            "index.tsx",
            "index.js",
            "index.jsx",
            "index.vue",
            "index.d.ts",
            "index.mts",
            "index.cts",
            "index.mjs",
            "index.cjs",
        ];
        for index_file in &index_files {
            let index_path = base_path.join(index_file);
            if index_path.exists() {
                return Ok(index_path);
            }
        }

        return Err(format!("Import source file not found: {}", import_source));
    }

    Err(format!(
        "Absolute imports and node_modules are not supported yet: {}",
        import_source
    ))
}

fn resolve_path_alias(source_file: &Path, import_source: &str) -> Result<String, String> {
    let mut current_dir = source_file.parent();
    let mut project_root: Option<PathBuf> = None;

    while let Some(dir) = current_dir {
        if dir.join("tsconfig.json").exists()
            || dir.join("jsconfig.json").exists()
            || dir.join("package.json").exists()
        {
            project_root = Some(dir.to_path_buf());
            break;
        }
        current_dir = dir.parent();
    }

    let project_root = project_root.ok_or_else(|| {
        "Could not find project root (tsconfig.json/jsconfig.json/package.json)".to_string()
    })?;

    if import_source.starts_with("@/") {
        let relative_path = import_source.strip_prefix("@/").unwrap();

        let base_dirs = ["src", "app", "lib", ""];

        for base_dir in &base_dirs {
            let full_path = if base_dir.is_empty() {
                project_root.join(relative_path)
            } else {
                project_root.join(base_dir).join(relative_path)
            };

            if full_path.exists()
                || full_path.with_extension("ts").exists()
                || full_path.with_extension("tsx").exists()
                || full_path.with_extension("js").exists()
                || full_path.with_extension("jsx").exists()
            {
                let source_dir = source_file.parent().unwrap();
                let rel_path = calculate_relative_path(source_dir, &full_path);
                return Ok(rel_path);
            }
        }

        let full_path = project_root.join("src").join(relative_path);
        let source_dir = source_file.parent().unwrap();
        return Ok(calculate_relative_path(source_dir, &full_path));
    }

    if import_source.starts_with("~/") {
        let relative_path = import_source.strip_prefix("~/").unwrap();
        let full_path = project_root.join("src").join(relative_path);
        let source_dir = source_file.parent().unwrap();
        return Ok(calculate_relative_path(source_dir, &full_path));
    }

    Ok(import_source.to_string())
}

fn parse_named_import_binding(import_part: &str) -> Option<String> {
    let tokens: Vec<&str> = import_part
        .trim()
        .split_whitespace()
        .filter(|token| !token.is_empty())
        .collect();

    if tokens.is_empty() {
        return None;
    }

    let tokens = if tokens.first() == Some(&"type") {
        &tokens[1..]
    } else {
        &tokens[..]
    };

    if tokens.is_empty() {
        return None;
    }

    if tokens.len() >= 3 && tokens[1] == "as" {
        return Some(tokens[2].trim_end_matches(',').to_string());
    }

    Some(tokens[0].trim_end_matches(',').to_string())
}

fn find_vue_component_definition_by_convention(
    source_file: &Path,
    symbol_name: &str,
) -> Result<Option<(PathBuf, SymbolDefinition)>, String> {
    let Some(candidate_path) = find_best_vue_component_match(source_file, symbol_name) else {
        return Ok(None);
    };

    let definition = match find_symbol_definition(&candidate_path, symbol_name, true) {
        Ok(definition) => definition,
        Err(_) => return Ok(None),
    };

    Ok(Some((candidate_path, definition)))
}

fn find_best_vue_component_match(source_file: &Path, symbol_name: &str) -> Option<PathBuf> {
    let normalized_target = normalize_symbol_lookup_name(symbol_name);
    if normalized_target.is_empty() {
        return None;
    }

    let search_root = find_symbol_search_root(source_file);
    let mut candidates = Vec::new();
    collect_vue_component_candidates(&search_root, &normalized_target, &mut candidates);

    candidates.into_iter().min_by_key(|candidate| {
        score_vue_component_candidate(source_file, candidate, &normalized_target)
    })
}

fn collect_vue_component_candidates(
    dir: &Path,
    normalized_target: &str,
    candidates: &mut Vec<PathBuf>,
) {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };

        let path = entry.path();
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();

        if path.is_dir() {
            if should_skip_symbol_search_dir(&file_name) {
                continue;
            }
            collect_vue_component_candidates(&path, normalized_target, candidates);
            continue;
        }

        if path.is_file() && is_matching_vue_component_candidate(&path, normalized_target) {
            candidates.push(path);
        }
    }
}

fn should_skip_symbol_search_dir(dir_name: &str) -> bool {
    matches!(
        dir_name,
        ".git"
            | "node_modules"
            | "dist"
            | "build"
            | "coverage"
            | "target"
            | ".next"
            | ".nuxt"
            | ".output"
            | ".cache"
            | ".turbo"
            | ".idea"
            | ".vscode"
    )
}

fn is_matching_vue_component_candidate(path: &Path, normalized_target: &str) -> bool {
    if !is_vue_file(path) {
        return false;
    }

    let Some(file_stem) = path.file_stem().and_then(|stem| stem.to_str()) else {
        return false;
    };

    if normalize_symbol_lookup_name(file_stem) == normalized_target {
        return true;
    }

    if file_stem.eq_ignore_ascii_case("index") {
        if let Some(parent_name) = path
            .parent()
            .and_then(|parent| parent.file_name())
            .and_then(|name| name.to_str())
        {
            return normalize_symbol_lookup_name(parent_name) == normalized_target;
        }
    }

    false
}

fn score_vue_component_candidate(
    source_file: &Path,
    candidate: &Path,
    normalized_target: &str,
) -> usize {
    if source_file == candidate {
        return 0;
    }

    let mut score = 0;

    let stem = candidate
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    if stem.eq_ignore_ascii_case("index") {
        score += 10;
    } else if normalize_symbol_lookup_name(stem) != normalized_target {
        score += 20;
    }

    let candidate_text = candidate.to_string_lossy();
    if !candidate_text.contains("/components/") && !candidate_text.contains("\\components\\") {
        score += 5;
    }

    let source_dir = source_file.parent().unwrap_or(source_file);
    let candidate_dir = candidate.parent().unwrap_or(candidate);
    score + calculate_component_distance(source_dir, candidate_dir)
}

fn calculate_component_distance(from: &Path, to: &Path) -> usize {
    let from_components: Vec<_> = from.components().collect();
    let to_components: Vec<_> = to.components().collect();

    let mut common_len = 0;
    for (from_component, to_component) in from_components.iter().zip(to_components.iter()) {
        if from_component == to_component {
            common_len += 1;
        } else {
            break;
        }
    }

    (from_components.len() - common_len) + (to_components.len() - common_len)
}

fn find_symbol_search_root(source_file: &Path) -> PathBuf {
    let mut current_dir = source_file.parent();

    while let Some(dir) = current_dir {
        if dir.join("tsconfig.json").exists()
            || dir.join("jsconfig.json").exists()
            || dir.join("package.json").exists()
            || dir.join(".git").exists()
        {
            return dir.to_path_buf();
        }

        current_dir = dir.parent();
    }

    source_file.parent().unwrap_or(source_file).to_path_buf()
}

fn normalize_symbol_lookup_name(value: &str) -> String {
    let leaf = value
        .rsplit(|ch| ch == '/' || ch == '\\')
        .next()
        .unwrap_or(value);
    let leaf = leaf.strip_suffix(".vue").unwrap_or(leaf);

    leaf.chars()
        .filter(|ch| ch.is_alphanumeric())
        .flat_map(|ch| ch.to_lowercase())
        .collect()
}

fn calculate_relative_path(from: &Path, to: &Path) -> String {
    let from_components: Vec<_> = from.components().collect();
    let to_components: Vec<_> = to.components().collect();

    let mut common_len = 0;
    for (a, b) in from_components.iter().zip(to_components.iter()) {
        if a == b {
            common_len += 1;
        } else {
            break;
        }
    }

    let mut result = String::new();

    let up_count = from_components.len() - common_len;
    for _ in 0..up_count {
        if !result.is_empty() {
            result.push('/');
        }
        result.push_str("..");
    }

    for component in &to_components[common_len..] {
        if !result.is_empty() {
            result.push('/');
        }
        result.push_str(&component.as_os_str().to_string_lossy());
    }

    if result.is_empty() {
        result = ".".to_string();
    }

    if !result.starts_with("..") && !result.starts_with(".") {
        result = format!("./{}", result);
    }

    result
}

#[derive(Debug)]
struct SymbolDefinition {
    line_number: usize,
    definition_type: String,
    code: String,
}

fn find_symbol_definition(
    file_path: &Path,
    symbol_name: &str,
    allow_default_export_match: bool,
) -> Result<SymbolDefinition, String> {
    let content = read_file_with_fallback(file_path)?;

    let lines: Vec<&str> = content.lines().collect();

    if allow_default_export_match {
        if let Some(definition) = find_default_export_definition(file_path, &lines) {
            return Ok(definition);
        }
    }

    for (idx, line) in lines.iter().enumerate() {
        let line_num = idx + 1;
        let trimmed = line.trim();

        if !trimmed.starts_with("export") {
            continue;
        }

        if let Some(def_type) = check_export_pattern(trimmed, symbol_name) {
            let context_lines = extract_code_context_with_braces(&lines, idx, 50);

            return Ok(SymbolDefinition {
                line_number: line_num,
                definition_type: def_type,
                code: context_lines,
            });
        }
    }

    Err(format!("Symbol definition not found: {}", symbol_name))
}

fn find_default_export_definition(file_path: &Path, lines: &[&str]) -> Option<SymbolDefinition> {
    if is_vue_file(file_path) {
        if let Some(definition) = find_vue_script_setup_definition(lines) {
            return Some(definition);
        }
    }

    for (idx, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if !trimmed.starts_with("export default") {
            continue;
        }

        let definition_type = infer_default_export_type(trimmed, file_path);
        let code = extract_code_context_with_braces(lines, idx, 80);

        return Some(SymbolDefinition {
            line_number: idx + 1,
            definition_type,
            code,
        });
    }

    None
}

fn find_vue_script_setup_definition(lines: &[&str]) -> Option<SymbolDefinition> {
    let start_idx = lines
        .iter()
        .position(|line| line.trim_start().starts_with("<script setup"))?;

    let end_idx = lines
        .iter()
        .enumerate()
        .skip(start_idx + 1)
        .find(|(_, line)| line.trim() == "</script>")
        .map(|(idx, _)| idx)
        .unwrap_or_else(|| std::cmp::min(start_idx + 79, lines.len().saturating_sub(1)));

    let mut code_lines = lines[start_idx..=end_idx].to_vec();
    if end_idx + 1 < lines.len() {
        let remaining_lines = lines.len() - 1 - end_idx;
        if remaining_lines > 0 && code_lines.len() >= 80 {
            code_lines.push("<!-- ... (component definition truncated) -->");
        }
    }

    Some(SymbolDefinition {
        line_number: start_idx + 1,
        definition_type: "component".to_string(),
        code: code_lines.join("\n"),
    })
}

fn infer_default_export_type(line: &str, file_path: &Path) -> String {
    let trimmed = line.trim();
    let is_vue = is_vue_file(file_path);

    if trimmed.starts_with("export default class") {
        return "class".to_string();
    }

    if trimmed.starts_with("export default function") {
        return "function".to_string();
    }

    if trimmed.contains("defineComponent(") || trimmed.contains("defineAsyncComponent(") {
        return "component".to_string();
    }

    if is_vue {
        return "component".to_string();
    }

    "default export".to_string()
}

fn is_vue_file(file_path: &Path) -> bool {
    file_path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("vue"))
        .unwrap_or(false)
}

fn check_export_pattern(line: &str, symbol_name: &str) -> Option<String> {
    if line.contains("interface") && line.contains(symbol_name) {
        return Some("interface".to_string());
    }

    if line.contains("class") && line.contains(symbol_name) {
        return Some("class".to_string());
    }

    if line.contains("type") && line.contains(symbol_name) {
        return Some("type".to_string());
    }

    if line.contains("const") && line.contains(symbol_name) {
        return Some("const".to_string());
    }

    if line.contains("function") && line.contains(symbol_name) {
        return Some("function".to_string());
    }

    if line.contains("enum") && line.contains(symbol_name) {
        return Some("enum".to_string());
    }

    if line.contains("default") && line.contains(symbol_name) {
        return Some("default".to_string());
    }

    None
}

fn extract_code_context_with_braces(lines: &[&str], start_idx: usize, max_lines: usize) -> String {
    let mut result = Vec::new();
    let mut brace_count = 0;
    let mut paren_count = 0;
    let mut bracket_count = 0;
    let mut in_block = false;
    let mut in_string = false;
    let mut string_char = ' ';
    let mut escape_next = false;

    for i in start_idx..std::cmp::min(start_idx + max_lines, lines.len()) {
        let line = lines[i];
        result.push(line);

        let mut chars = line.chars().peekable();
        while let Some(ch) = chars.next() {
            if escape_next {
                escape_next = false;
                continue;
            }

            if ch == '\\' && in_string {
                escape_next = true;
                continue;
            }

            if (ch == '"' || ch == '\'' || ch == '`') && !in_string {
                in_string = true;
                string_char = ch;
                continue;
            } else if in_string && ch == string_char {
                in_string = false;
                continue;
            }

            if in_string {
                continue;
            }

            if ch == '/' {
                if let Some(&next_ch) = chars.peek() {
                    if next_ch == '/' {
                        break;
                    } else if next_ch == '*' {
                        chars.next();
                        continue;
                    }
                }
            }

            match ch {
                '{' => {
                    brace_count += 1;
                    in_block = true;
                }
                '}' => {
                    brace_count -= 1;
                    if in_block && brace_count == 0 && paren_count == 0 && bracket_count == 0 {
                        return result.join("\n");
                    }
                }
                '(' => paren_count += 1,
                ')' => paren_count -= 1,
                '[' => bracket_count += 1,
                ']' => bracket_count -= 1,
                _ => {}
            }
        }

        if !in_block && line.trim().ends_with(';') {
            return result.join("\n");
        }

        if !in_block
            && brace_count == 0
            && paren_count == 0
            && (line.contains("=>") || line.trim().ends_with(','))
        {
            if i + 1 < lines.len() {
                let next_line = lines[i + 1].trim();
                if next_line.starts_with("export")
                    || next_line.starts_with("const")
                    || next_line.starts_with("let")
                    || next_line.starts_with("var")
                    || next_line.starts_with("function")
                    || next_line.starts_with("class")
                    || next_line.starts_with("interface")
                    || next_line.starts_with("type")
                    || next_line.is_empty()
                {
                    return result.join("\n");
                }
            }
        }
    }

    if result.len() >= max_lines {
        result.push("// ... (definition truncated, exceeds 50 lines)");
    }

    result.join("\n")
}

#[cfg(test)]
mod tests {
    use super::read_file_with_fallback;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_path(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("loom_{name}_{unique}.txt"))
    }

    #[test]
    fn reads_gbk_encoded_files_with_fallback() {
        let path = temp_path("gbk_symbol");
        let original = "中文符号定义";
        let (encoded, _, _) = encoding_rs::GBK.encode(original);
        fs::write(&path, encoded.as_ref()).unwrap();

        let decoded = read_file_with_fallback(&path).unwrap();
        assert_eq!(decoded, original);

        let _ = fs::remove_file(path);
    }
}
