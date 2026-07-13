use serde::Serialize;
use std::collections::HashMap;

/// 抓取结果
#[derive(Serialize, Clone)]
pub struct FetchResult {
    /// 结果类型: "content" | "redirect" | "binary"
    #[serde(rename = "type")]
    pub result_type: String,
    /// 最终请求的 URL
    pub url: String,
    /// Markdown 内容（type=content 时）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    /// 内容字节数
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes: Option<usize>,
    /// HTTP 状态码
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<u16>,
    /// 状态码文本
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code_text: Option<String>,
    /// Content-Type
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    /// 二进制文件路径（type=binary 时）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub persisted_path: Option<String>,
    /// 重定向目标 URL（type=redirect 时）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub redirect_to: Option<String>,
    /// 重定向状态码（type=redirect 时）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub redirect_status: Option<u16>,
}

/// HTTP 状态码转文本
fn status_code_text(code: u16) -> String {
    match code {
        301 => "Moved Permanently".to_string(),
        302 => "Found".to_string(),
        307 => "Temporary Redirect".to_string(),
        308 => "Permanent Redirect".to_string(),
        _ => format!("{}", code),
    }
}

// ── 增强版 v3: 支持 method/headers/body/timeout/follow_redirects/extract_links ──

/// Extract all links from HTML content
fn extract_links_from_html(html: &str, base_url: &str) -> Vec<String> {
    let mut links = Vec::new();
    let mut seen = std::collections::HashSet::new();
    // Simple regex-based link extraction for <a href="...">
    let re = regex::Regex::new(r#"<a[^>]+href\s*=\s*["']([^"']+)["']"#).unwrap();
    for cap in re.captures_iter(html) {
        let href = cap[1].to_string();
        // Skip anchors, javascript:, mailto:
        if href.starts_with('#') || href.starts_with("javascript:") || href.starts_with("mailto:") {
            continue;
        }
        // Resolve relative URLs
        let resolved_url = if href.starts_with("http://") || href.starts_with("https://") {
            href
        } else if let Ok(base) = base_url.parse::<reqwest::Url>() {
            if let Ok(resolved) = base.join(&href) {
                resolved.to_string()
            } else {
                href
            }
        } else {
            href
        };

        if seen.insert(resolved_url.clone()) {
            links.push(resolved_url);
        }
    }
    links
}

/// Enhanced fetch with full HTTP method, custom headers, timeout, etc.
#[tauri::command]
pub async fn fetch_web_content_v3(
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    timeout: Option<u64>,
    follow_redirects: Option<bool>,
    extract_links: Option<bool>,
) -> Result<FetchResult, String> {
    const MAX_CHARS: usize = 100_000;
    const MAX_URL_LENGTH: usize = 2000;
    const MAX_HTTP_CONTENT_LENGTH: usize = 10 * 1024 * 1024; // 10MB

    let fetch_timeout = timeout.unwrap_or(60);
    let should_follow_redirects = follow_redirects.unwrap_or(true);
    let should_extract_links = extract_links.unwrap_or(false);
    let http_method = method.unwrap_or_else(|| "GET".to_string());
    let method_upper = http_method.to_uppercase();

    // ── 1. URL 验证 ──
    if url.len() > MAX_URL_LENGTH {
        return Err(format!("URL 长度超过限制 ({} 字符)", MAX_URL_LENGTH));
    }

    let mut parsed_url: reqwest::Url = url.parse().map_err(|e| format!("无效的 URL: {}", e))?;

    let scheme = parsed_url.scheme().to_lowercase();
    if scheme != "http" && scheme != "https" {
        return Err(format!("不支持的协议: {}。仅支持 http/https。", scheme));
    }

    let hostname = parsed_url
        .host_str()
        .ok_or_else(|| "URL 缺少主机名".to_string())?;
    is_safe_hostname_async(hostname).await?;

    if parsed_url.username() != "" || parsed_url.password().is_some() {
        return Err("URL 不能包含用户名或密码".to_string());
    }

    // HTTP auto-upgrade
    if parsed_url.scheme() == "http" {
        let https_url = url.replacen("http://", "https://", 1);
        parsed_url = https_url
            .parse()
            .map_err(|e| format!("HTTPS 升级后 URL 无效: {}", e))?;
    }

    // ── 2. 创建 HTTP 客户端 ──
    let redirect_policy = if should_follow_redirects {
        reqwest::redirect::Policy::custom(|attempt| {
            let next_url = attempt.url();
            let hostname = match next_url.host_str() {
                Some(h) => h,
                None => return attempt.stop(),
            };
            
            // Check if hostname is safe (synchronously)
            if let Ok(ip) = hostname.parse::<std::net::IpAddr>() {
                if !is_safe_ip(ip) {
                    return attempt.stop();
                }
            } else {
                let addr_str = format!("{}:80", hostname);
                if let Ok(mut addrs) = std::net::ToSocketAddrs::to_socket_addrs(&addr_str) {
                    let mut resolved_any = false;
                    let mut all_safe = true;
                    while let Some(addr) = addrs.next() {
                        resolved_any = true;
                        if !is_safe_ip(addr.ip()) {
                            all_safe = false;
                            break;
                        }
                    }
                    if !resolved_any || !all_safe {
                        return attempt.stop();
                    }
                } else {
                    return attempt.stop();
                }
            }
            
            if attempt.previous().len() >= 10 {
                attempt.stop()
            } else {
                attempt.follow()
            }
        })
    } else {
        reqwest::redirect::Policy::none()
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(fetch_timeout))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .redirect(redirect_policy)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    // ── 3. 构建请求 ──
    let req = match method_upper.as_str() {
        "GET" => client.get(parsed_url.as_str()),
        "POST" => client.post(parsed_url.as_str()),
        "PUT" => client.put(parsed_url.as_str()),
        "DELETE" => client.delete(parsed_url.as_str()),
        "PATCH" => client.patch(parsed_url.as_str()),
        "HEAD" => client.head(parsed_url.as_str()),
        _ => {
            return Err(format!(
                "不支持的 HTTP 方法: {}。可用: GET, POST, PUT, DELETE, PATCH, HEAD",
                http_method
            ))
        }
    };

    // Apply custom headers
    let mut req = req;
    if let Some(ref hdrs) = headers {
        for (key, value) in hdrs {
            let header_name = reqwest::header::HeaderName::from_bytes(key.as_bytes())
                .map_err(|e| format!("无效的请求头名称 '{}': {}", key, e))?;
            let header_value = reqwest::header::HeaderValue::from_str(value)
                .map_err(|e| format!("无效的请求头值 '{}': {}", value, e))?;
            req = req.header(header_name, header_value);
        }
    }

    // Apply body for POST/PUT/PATCH
    if let Some(ref b) = body {
        if method_upper == "POST" || method_upper == "PUT" || method_upper == "PATCH" {
            req = req.body(b.clone());
        }
    }

    // ── 4. 发送请求 ──
    let response = req.send().await.map_err(|e| format!("请求失败: {}", e))?;

    let status_code = response.status().as_u16();
    let status_text = status_code_text(status_code);
    let final_url = response.url().to_string();

    // ── 5. 处理重定向（当 follow_redirects=false 时） ──
    if !should_follow_redirects && (300..400).contains(&(status_code as i32)) {
        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        return Ok(FetchResult {
            result_type: "redirect".to_string(),
            url: final_url,
            content: None,
            bytes: None,
            code: Some(status_code),
            code_text: Some(status_text),
            content_type: None,
            persisted_path: None,
            redirect_to: Some(location),
            redirect_status: Some(status_code),
        });
    }

    // ── 6. 获取 Content-Type ──
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let ct_lower = content_type.to_lowercase();

    // ── 7. 处理二进制内容 ──
    if ct_lower.contains("application/pdf")
        || ct_lower.contains("application/zip")
        || ct_lower.contains("application/octet-stream")
        || ct_lower.contains("application/x-")
    {
        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("读取二进制响应失败: {}", e))?;

        if bytes.len() > MAX_HTTP_CONTENT_LENGTH {
            return Err(format!("文件过大 ({} bytes)", bytes.len()));
        }

        let cache_dir = crate::config_paths::resolve_app_data_subdir("loom")?
            .join("web_cache");
        std::fs::create_dir_all(&cache_dir).map_err(|e| format!("创建缓存目录失败: {}", e))?;

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let ext = if ct_lower.contains("pdf") {
            "pdf"
        } else if ct_lower.contains("zip") {
            "zip"
        } else {
            "bin"
        };
        let filepath = cache_dir.join(format!("fetch_{}.{}", timestamp, ext));

        std::fs::write(&filepath, &bytes).map_err(|e| format!("写入文件失败: {}", e))?;

        return Ok(FetchResult {
            result_type: "binary".to_string(),
            url: final_url,
            content: None,
            bytes: Some(bytes.len()),
            code: Some(status_code),
            code_text: Some(status_text),
            content_type: Some(content_type),
            persisted_path: Some(filepath.to_string_lossy().to_string()),
            redirect_to: None,
            redirect_status: None,
        });
    }

    // ── 8. 读取响应体（即使非 200 也尝试返回内容） ──
    let body_bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    if body_bytes.len() > MAX_HTTP_CONTENT_LENGTH {
        return Err(format!("响应过大 ({} bytes)", body_bytes.len()));
    }

    let byte_count = body_bytes.len();

    // For non-2xx responses, still try to return the body
    if !(200..300).contains(&(status_code as i32)) {
        let body_text = String::from_utf8_lossy(&body_bytes).to_string();

        // For non-HTML, just return as-is
        let display_content = if (ct_lower.contains("text/html")
            || ct_lower.contains("text/xml")
            || ct_lower.contains("application/xml"))
            && body_text.len() > 0
        {
            html2md::parse_html(&body_text)
        } else {
            body_text
        };

        let final_content = if display_content.len() > MAX_CHARS {
            let truncated: String = display_content.chars().take(MAX_CHARS).collect();
            format!("{}\n\n[内容过长，已截断至 {} 字符]", truncated, MAX_CHARS)
        } else if display_content.is_empty() {
            format!("HTTP {} {} (无响应体)", status_code, status_text)
        } else {
            display_content
        };

        return Ok(FetchResult {
            result_type: "content".to_string(),
            url: final_url,
            content: Some(final_content),
            bytes: Some(byte_count),
            code: Some(status_code),
            code_text: Some(status_text),
            content_type: if ct_lower.is_empty() {
                None
            } else {
                Some(content_type)
            },
            persisted_path: None,
            redirect_to: None,
            redirect_status: None,
        });
    }

    // ── 9. 检查内容类型 ──
    if !ct_lower.contains("text/html")
        && !ct_lower.contains("text/plain")
        && !ct_lower.contains("text/markdown")
        && !ct_lower.contains("application/json")
        && !ct_lower.contains("application/xml")
        && !ct_lower.contains("text/xml")
    {
        return Err(format!(
            "不支持的内容类型: {}。仅支持 HTML、纯文本、Markdown、JSON、XML 和 PDF。",
            content_type
        ));
    }

    let body_text = String::from_utf8_lossy(&body_bytes).to_string();

    // ── 10. 转换为 Markdown ──
    let markdown = if ct_lower.contains("text/html")
        || ct_lower.contains("text/xml")
        || ct_lower.contains("application/xml")
    {
        html2md::parse_html(&body_text)
    } else {
        body_text.clone()
    };

    // ── 11. 提取链接（如果要求） ──
    let final_content = if should_extract_links && ct_lower.contains("text/html") {
        let links = extract_links_from_html(&body_text, &final_url);
        let links_section = if links.is_empty() {
            "\n\n---\n提取的链接: (无)\n".to_string()
        } else {
            let links_text: Vec<String> = links
                .iter()
                .take(200)
                .enumerate()
                .map(|(i, l)| format!("{}. {}", i + 1, l))
                .collect();
            format!(
                "\n\n---\n提取的链接 ({} 个):\n{}\n",
                links.len().min(200),
                links_text.join("\n")
            )
        };
        let mut md = markdown;
        if md.len() > MAX_CHARS {
            let truncated: String = md.chars().take(MAX_CHARS).collect();
            md = format!("{}\n\n[内容过长，已截断至 {} 字符]", truncated, MAX_CHARS);
        }
        format!("{}{}", md, links_section)
    } else {
        if markdown.len() > MAX_CHARS {
            let truncated: String = markdown.chars().take(MAX_CHARS).collect();
            format!("{}\n\n[内容过长，已截断至 {} 字符]", truncated, MAX_CHARS)
        } else {
            markdown
        }
    };

    Ok(FetchResult {
        result_type: "content".to_string(),
        url: final_url,
        content: Some(final_content),
        bytes: Some(byte_count),
        code: Some(status_code),
        code_text: Some(status_text),
        content_type: if ct_lower.is_empty() {
            None
        } else {
            Some(content_type)
        },
        persisted_path: None,
        redirect_to: None,
        redirect_status: None,
    })
}

// ── SSRF Security Helpers ──

fn is_safe_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(ipv4) => {
            if ipv4.is_loopback() {
                return false;
            }
            if ipv4.is_private() {
                return false;
            }
            if ipv4.is_link_local() {
                return false;
            }
            if ipv4.is_unspecified() {
                return false;
            }
            if ipv4.is_broadcast() {
                return false;
            }
            let octets = ipv4.octets();
            if octets[0] == 192 && octets[1] == 0 && octets[2] == 2 {
                return false;
            }
            if octets[0] == 198 && octets[1] == 51 && octets[2] == 100 {
                return false;
            }
            if octets[0] == 203 && octets[1] == 0 && octets[2] == 113 {
                return false;
            }
            if octets[0] >= 240 {
                return false;
            }
            true
        }
        std::net::IpAddr::V6(ipv6) => {
            if ipv6.is_loopback() {
                return false;
            }
            if ipv6.is_unspecified() {
                return false;
            }
            let segments = ipv6.segments();
            let first_word = segments[0];
            if (first_word & 0xfe00) == 0xfc00 {
                return false;
            }
            if (first_word & 0xffc0) == 0xfe80 {
                return false;
            }
            let octets = ipv6.octets();
            if octets[0..10] == [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] && octets[10] == 0xff && octets[11] == 0xff {
                let ipv4 = std::net::Ipv4Addr::new(octets[12], octets[13], octets[14], octets[15]);
                return is_safe_ip(std::net::IpAddr::V4(ipv4));
            }
            true
        }
    }
}

async fn is_safe_hostname_async(hostname: &str) -> Result<(), String> {
    if let Ok(ip) = hostname.parse::<std::net::IpAddr>() {
        if is_safe_ip(ip) {
            return Ok(());
        } else {
            return Err(format!("禁止访问私有或非公网 IP: {}", hostname));
        }
    }

    let addr_str = format!("{}:80", hostname);
    match tokio::net::lookup_host(addr_str).await {
        Ok(addrs) => {
            let mut resolved_any = false;
            for addr in addrs {
                resolved_any = true;
                if !is_safe_ip(addr.ip()) {
                    return Err(format!(
                        "禁止访问私有或非公网 IP (主机名 {} 解析为 {})",
                        hostname,
                        addr.ip()
                    ));
                }
            }
            if !resolved_any {
                return Err(format!("无法解析主机名: {}", hostname));
            }
            Ok(())
        }
        Err(e) => Err(format!("主机名 '{}' 解析失败: {}", hostname, e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_safe_ip() {
        use std::net::IpAddr;

        // Loopback IPv4
        assert!(!is_safe_ip("127.0.0.1".parse::<IpAddr>().unwrap()));
        assert!(!is_safe_ip("127.255.255.255".parse::<IpAddr>().unwrap()));

        // Private IPv4
        assert!(!is_safe_ip("10.0.0.1".parse::<IpAddr>().unwrap()));
        assert!(!is_safe_ip("172.16.5.5".parse::<IpAddr>().unwrap()));
        assert!(!is_safe_ip("192.168.1.100".parse::<IpAddr>().unwrap()));

        // Link-Local IPv4
        assert!(!is_safe_ip("169.254.169.254".parse::<IpAddr>().unwrap()));

        // Broadcast/Unspecified IPv4
        assert!(!is_safe_ip("0.0.0.0".parse::<IpAddr>().unwrap()));
        assert!(!is_safe_ip("255.255.255.255".parse::<IpAddr>().unwrap()));

        // Reserved/Test IPv4
        assert!(!is_safe_ip("192.0.2.1".parse::<IpAddr>().unwrap()));
        assert!(!is_safe_ip("198.51.100.2".parse::<IpAddr>().unwrap()));
        assert!(!is_safe_ip("203.0.113.3".parse::<IpAddr>().unwrap()));
        assert!(!is_safe_ip("245.0.0.1".parse::<IpAddr>().unwrap()));

        // Public IPv4
        assert!(is_safe_ip("8.8.8.8".parse::<IpAddr>().unwrap()));
        assert!(is_safe_ip("1.1.1.1".parse::<IpAddr>().unwrap()));
        assert!(is_safe_ip("142.250.190.46".parse::<IpAddr>().unwrap()));

        // Loopback/Unspecified IPv6
        assert!(!is_safe_ip("::1".parse::<IpAddr>().unwrap()));
        assert!(!is_safe_ip("::".parse::<IpAddr>().unwrap()));

        // ULA / Link-Local IPv6
        assert!(!is_safe_ip("fc00::1".parse::<IpAddr>().unwrap()));
        assert!(!is_safe_ip("fdff::ffff".parse::<IpAddr>().unwrap()));
        assert!(!is_safe_ip("fe80::1".parse::<IpAddr>().unwrap()));

        // IPv4-mapped IPv6 loopback / private
        assert!(!is_safe_ip("::ffff:127.0.0.1".parse::<IpAddr>().unwrap()));
        assert!(!is_safe_ip("::ffff:192.168.1.1".parse::<IpAddr>().unwrap()));

        // Public IPv6
        assert!(is_safe_ip("2001:4860:4860::8888".parse::<IpAddr>().unwrap()));
    }

    #[tokio::test]
    async fn test_is_safe_hostname_async() {
        // Safe hostname
        assert!(is_safe_hostname_async("google.com").await.is_ok());

        // Unsafe hostname / IP literals
        assert!(is_safe_hostname_async("localhost").await.is_err());
        assert!(is_safe_hostname_async("127.0.0.1").await.is_err());
        assert!(is_safe_hostname_async("192.168.1.1").await.is_err());

        // DNS resolution failures / invalid domain names
        assert!(is_safe_hostname_async("invalid-hostname-that-does-not-exist.test").await.is_err());
    }
}
