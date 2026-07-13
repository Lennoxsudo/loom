use std::collections::VecDeque;
use std::fs;
use std::path::Path;

const SKIP_DIR_NAMES: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".cache",
    ".cbm",
    ".loom",
    ".aiasprrato",
    "__pycache__",
    ".venv",
    "venv",
];

/// Count files under `repo_path`, stopping once count exceeds `ceiling`.
pub fn count_repo_files(repo_path: &Path, ceiling: u64) -> u64 {
    if ceiling == 0 || !repo_path.is_dir() {
        return 0;
    }

    let mut count = 0u64;
    let mut queue = VecDeque::from([repo_path.to_path_buf()]);

    while let Some(dir) = queue.pop_front() {
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(_) => continue,
            };

            if file_type.is_dir() {
                if should_skip_dir(&path) {
                    continue;
                }
                queue.push_back(path);
                continue;
            }

            if file_type.is_file() || file_type.is_symlink() {
                count += 1;
                if count > ceiling {
                    return count;
                }
            }
        }
    }

    count
}

fn should_skip_dir(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
        return true;
    };
    SKIP_DIR_NAMES
        .iter()
        .any(|skip| name.eq_ignore_ascii_case(skip))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("loom-cbm-estimate-{label}-{nanos}"))
    }

    #[test]
    fn count_repo_files_skips_node_modules() {
        let root = unique_temp_dir("count");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src").join("a.ts"), "a").unwrap();
        fs::create_dir_all(root.join("node_modules").join("pkg")).unwrap();
        fs::write(root.join("node_modules").join("pkg").join("b.js"), "b").unwrap();

        assert_eq!(count_repo_files(&root, 10), 1);
        let _ = fs::remove_dir_all(root);
    }
}
