use std::fs;
use std::path::Path;

use super::path::cbm_cache_dir;

const INVOKE_LINKS_DIR: &str = "invoke-links";

#[allow(dead_code)]
pub(crate) fn directory_size(path: &Path) -> Result<u64, String> {
    if !path.exists() {
        return Ok(0);
    }
    let mut total = 0u64;
    walk_size(path, &mut total)?;
    Ok(total)
}

fn walk_size(path: &Path, total: &mut u64) -> Result<(), String> {
    let meta = fs::symlink_metadata(path).map_err(|e| format!("读取路径元数据失败: {e}"))?;
    if meta.file_type().is_symlink() {
        return Ok(());
    }
    if meta.is_file() {
        *total = total.saturating_add(meta.len());
        return Ok(());
    }
    if !meta.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(path).map_err(|e| format!("读取目录失败: {e}"))? {
        let entry = entry.map_err(|e| format!("读取目录项失败: {e}"))?;
        let child = entry.path();
        let child_meta = match fs::symlink_metadata(&child) {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        if child_meta.file_type().is_symlink() {
            continue;
        }
        walk_size(&child, total)?;
    }
    Ok(())
}

pub fn cbm_cache_total_bytes() -> Result<u64, String> {
    let cache_dir = cbm_cache_dir()?;
    if !cache_dir.exists() {
        return Ok(0);
    }

    let mut total = 0u64;
    for entry in fs::read_dir(&cache_dir).map_err(|e| format!("读取 CBM 缓存目录失败: {e}"))? {
        let entry = entry.map_err(|e| format!("读取目录项失败: {e}"))?;
        if entry.file_name() == INVOKE_LINKS_DIR {
            continue;
        }
        walk_size(&entry.path(), &mut total)?;
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn directory_size_missing_path_returns_zero() {
        assert_eq!(
            directory_size(Path::new("definitely-not-a-real-cbm-cache-dir")).unwrap(),
            0
        );
    }

    #[cfg(unix)]
    #[test]
    fn walk_size_skips_symlinks() {
        let base = std::env::temp_dir().join(format!("loom_cbm_storage_{}", uuid::Uuid::new_v4()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        let target = base.join("target.txt");
        fs::write(&target, b"ok").unwrap();
        std::os::unix::fs::symlink(&target, base.join("link.txt")).unwrap();

        let size = directory_size(&base).unwrap();
        assert_eq!(size, 2);

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn cbm_cache_total_bytes_ignores_invoke_links_dir() {
        let cache_dir = cbm_cache_dir().expect("cache dir");
        let links_dir = cache_dir.join(INVOKE_LINKS_DIR);
        fs::create_dir_all(&links_dir).expect("invoke-links dir");
        let marker = links_dir.join(format!(
            "loom_storage_test_marker_{}",
            uuid::Uuid::new_v4()
        ));

        let before = cbm_cache_total_bytes().expect("cache total before");
        fs::write(&marker, vec![0u8; 4096]).expect("marker file");
        let after = cbm_cache_total_bytes().expect("cache total after");

        let _ = fs::remove_file(marker);
        assert_eq!(
            before, after,
            "invoke-links content should not affect cache size"
        );
    }
}
