//! Native web search tool — lightweight SERP results for agent context.
//!
//! Primary provider: Bing HTML SERP (no API key).
//! Fallback: DuckDuckGo HTML/Lite (often bot-blocked with HTTP 202).
//! Distinct from `fetch` (full page) and `browser` (embedded WebView).

use regex::Regex;
use serde::Serialize;
use std::sync::OnceLock;

/// A single search result entry.
#[derive(Debug, Clone, Serialize)]
pub struct WebSearchItem {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

/// Response payload returned to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct WebSearchResponse {
    pub query: String,
    pub results: Vec<WebSearchItem>,
    pub count: usize,
    /// Backend that produced the results (for transparency / debugging).
    pub provider: String,
}

const DEFAULT_NUM_RESULTS: usize = 5;
const MAX_NUM_RESULTS: usize = 10;
const MAX_QUERY_LEN: usize = 500;
const SEARCH_TIMEOUT_SECS: u64 = 20;

/// Strip HTML tags and decode a few common entities.
fn strip_html(input: &str) -> String {
    static TAG_RE: OnceLock<Regex> = OnceLock::new();
    let re = TAG_RE.get_or_init(|| Regex::new(r"(?is)<[^>]+>").expect("strip_html tags"));
    let no_tags = re.replace_all(input, "");
    decode_basic_entities(&no_tags)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn decode_basic_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ")
}

fn is_internal_search_url(url: &str) -> bool {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return true;
    }
    match url.parse::<reqwest::Url>() {
        Ok(u) => {
            let host = u.host_str().unwrap_or("").to_lowercase();
            host == "duckduckgo.com"
                || host.ends_with(".duckduckgo.com")
                || host == "bing.com"
                || host.ends_with(".bing.com")
                || host == "microsoft.com"
                || host.ends_with(".microsoft.com")
                || host.contains("bingj.com")
        }
        Err(_) => true,
    }
}

/// Resolve DDG redirect links (`//duckduckgo.com/l/?uddg=...`) to the real URL.
fn resolve_result_url(raw: &str) -> String {
    let href = raw.trim();
    let absolute = if href.starts_with("//") {
        format!("https:{}", href)
    } else if href.starts_with("http://") || href.starts_with("https://") {
        href.to_string()
    } else if href.starts_with('/') {
        format!("https://www.bing.com{}", href)
    } else {
        href.to_string()
    };

    if let Ok(parsed) = absolute.parse::<reqwest::Url>() {
        // DuckDuckGo uddg=
        if let Some(uddg) = parsed
            .query_pairs()
            .find(|(k, _)| k == "uddg")
            .map(|(_, v)| v.into_owned())
        {
            if uddg.starts_with("http://") || uddg.starts_with("https://") {
                return uddg;
            }
        }
        // Bing sometimes wraps targets in u= query
        if let Some(u) = parsed
            .query_pairs()
            .find(|(k, _)| k == "u" || k == "url")
            .map(|(_, v)| v.into_owned())
        {
            if u.starts_with("http://") || u.starts_with("https://") {
                return u;
            }
        }
    }

    absolute
}

// ── Bing ──

fn bing_block_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"(?is)<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>(.*?)</li>"#)
            .expect("bing_block_re")
    })
}

fn bing_title_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"(?is)<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>"#)
            .expect("bing_title_re")
    })
}

fn bing_snippet_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"(?is)<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>(.*?)</p>"#)
            .expect("bing_snippet_re")
    })
}

/// Parse Bing HTML SERP into structured items.
pub fn parse_bing_html(html: &str, limit: usize) -> Vec<WebSearchItem> {
    let mut results: Vec<WebSearchItem> = Vec::new();
    let mut seen_urls = std::collections::HashSet::new();

    for block in bing_block_re().captures_iter(html) {
        if results.len() >= limit {
            break;
        }
        let body = &block[1];
        let Some(title_cap) = bing_title_re().captures(body) else {
            continue;
        };
        let url = resolve_result_url(&title_cap[1]);
        if is_internal_search_url(&url) {
            continue;
        }
        let title = strip_html(&title_cap[2]);
        if title.is_empty() || !seen_urls.insert(url.clone()) {
            continue;
        }
        let snippet = bing_snippet_re()
            .captures(body)
            .map(|c| strip_html(&c[1]))
            .unwrap_or_default();

        results.push(WebSearchItem {
            title,
            url,
            snippet,
        });
    }

    results
}

// ── DuckDuckGo ──

fn result_link_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r#"(?is)<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)</a>"#,
        )
        .expect("result_link_re")
    })
}

fn result_snippet_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"(?is)<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>(.*?)</a>"#)
            .expect("result_snippet_re")
    })
}

/// Parse DuckDuckGo HTML result page into structured items.
pub fn parse_ddg_html(html: &str, limit: usize) -> Vec<WebSearchItem> {
    let mut results: Vec<WebSearchItem> = Vec::new();
    let mut seen_urls = std::collections::HashSet::new();

    let link_re = result_link_re();
    let snippet_re = result_snippet_re();

    let snippets: Vec<String> = snippet_re
        .captures_iter(html)
        .map(|c| strip_html(&c[1]))
        .collect();

    for (idx, cap) in link_re.captures_iter(html).enumerate() {
        if results.len() >= limit {
            break;
        }
        let title = strip_html(&cap[2]);
        if title.is_empty() {
            continue;
        }
        let url = resolve_result_url(&cap[1]);
        if is_internal_search_url(&url) {
            continue;
        }
        if !seen_urls.insert(url.clone()) {
            continue;
        }
        let snippet = snippets.get(idx).cloned().unwrap_or_default();
        results.push(WebSearchItem {
            title,
            url,
            snippet,
        });
    }

    results
}

/// Parse DuckDuckGo Lite results as a fallback.
fn parse_ddg_lite(html: &str, limit: usize) -> Vec<WebSearchItem> {
    static LINK_RE: OnceLock<Regex> = OnceLock::new();
    let re = LINK_RE.get_or_init(|| {
        Regex::new(r#"(?is)<a[^>]+rel="nofollow"[^>]+href="(https?://[^"]+)"[^>]*>(.*?)</a>"#)
            .expect("ddg_lite link re")
    });

    let mut results = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for cap in re.captures_iter(html) {
        if results.len() >= limit {
            break;
        }
        let url = resolve_result_url(&cap[1]);
        if is_internal_search_url(&url) {
            continue;
        }
        let title = strip_html(&cap[2]);
        if title.is_empty() || !seen.insert(url.clone()) {
            continue;
        }
        results.push(WebSearchItem {
            title,
            url,
            snippet: String::new(),
        });
    }
    results
}

/// Format structured results as agent-readable text (injected into context).
pub fn format_search_output(response: &WebSearchResponse) -> String {
    if response.results.is_empty() {
        return format!(
            "搜索: \"{}\"\n结果: 0\n\n未找到相关结果（来源尝试: {}）。可改用更具体的关键词，或用 fetch 直接打开已知 URL。",
            response.query,
            if response.provider.is_empty() {
                "none"
            } else {
                &response.provider
            }
        );
    }

    let mut out = format!(
        "搜索: \"{}\"\n结果: {}（来源: {}）\n\n",
        response.query, response.count, response.provider
    );

    for (i, item) in response.results.iter().enumerate() {
        out.push_str(&format!("{}. {}\n", i + 1, item.title));
        out.push_str(&format!("   URL: {}\n", item.url));
        if !item.snippet.is_empty() {
            out.push_str(&format!("   摘要: {}\n", item.snippet));
        }
        out.push('\n');
    }

    out.push_str("提示: 需要完整页面内容时，对感兴趣的 URL 使用 fetch 工具。");
    out
}

fn build_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(SEARCH_TIMEOUT_SECS))
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        )
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))
}

async fn fetch_html(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let response = client
        .get(url)
        .header("Accept", "text/html,application/xhtml+xml")
        .header("Accept-Language", "en-US,en;q=0.9,zh-CN;q=0.8")
        .send()
        .await
        .map_err(|e| format!("搜索请求失败: {}", e))?;

    // DuckDuckGo often returns 202 for bot challenges — still try to parse body.
    let status = response.status();
    let html = response
        .text()
        .await
        .map_err(|e| format!("读取搜索响应失败: {}", e))?;

    if !(status.is_success() || status.as_u16() == 202) {
        return Err(format!("搜索服务返回 HTTP {}", status.as_u16()));
    }
    Ok(html)
}

/// Native web search command.
#[tauri::command]
pub async fn web_search(
    query: String,
    num_results: Option<u32>,
) -> Result<WebSearchResponse, String> {
    let q = query.trim();
    if q.is_empty() {
        return Err("缺少必需参数: query".to_string());
    }
    if q.len() > MAX_QUERY_LEN {
        return Err(format!("查询过长（最多 {} 字符）", MAX_QUERY_LEN));
    }

    let limit = num_results
        .map(|n| n as usize)
        .unwrap_or(DEFAULT_NUM_RESULTS)
        .clamp(1, MAX_NUM_RESULTS);

    let client = build_http_client()?;
    let mut tried: Vec<&str> = Vec::new();

    // 1) Bing first — currently the most reliable keyless HTML SERP
    tried.push("bing");
    let bing_url = format!(
        "https://www.bing.com/search?q={}&setlang=en-US",
        urlencoding_encode(q)
    );
    if let Ok(html) = fetch_html(&client, &bing_url).await {
        let results = parse_bing_html(&html, limit);
        if !results.is_empty() {
            let count = results.len();
            return Ok(WebSearchResponse {
                query: q.to_string(),
                results,
                count,
                provider: "bing".to_string(),
            });
        }
    }

    // 2) DuckDuckGo HTML
    tried.push("duckduckgo");
    let ddg_url = format!(
        "https://html.duckduckgo.com/html/?q={}",
        urlencoding_encode(q)
    );
    if let Ok(html) = fetch_html(&client, &ddg_url).await {
        let results = parse_ddg_html(&html, limit);
        if !results.is_empty() {
            let count = results.len();
            return Ok(WebSearchResponse {
                query: q.to_string(),
                results,
                count,
                provider: "duckduckgo".to_string(),
            });
        }
    }

    // 3) DuckDuckGo Lite
    tried.push("duckduckgo-lite");
    let lite_url = format!(
        "https://lite.duckduckgo.com/lite/?q={}",
        urlencoding_encode(q)
    );
    if let Ok(html) = fetch_html(&client, &lite_url).await {
        let results = parse_ddg_lite(&html, limit);
        if !results.is_empty() {
            let count = results.len();
            return Ok(WebSearchResponse {
                query: q.to_string(),
                results,
                count,
                provider: "duckduckgo-lite".to_string(),
            });
        }
    }

    // All providers returned empty — surface a clear error so the model
    // does not silently claim "environment has no network".
    Err(format!(
        "搜索未返回结果（已尝试: {}）。可能是网络受限或搜索源反爬拦截。可稍后重试，或用 fetch 直接打开已知 URL。",
        tried.join(", ")
    ))
}

/// Minimal percent-encoding for query strings (spaces → +, etc.).
fn urlencoding_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.as_bytes() {
        match *b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char);
            }
            b' ' => out.push('+'),
            _ => {
                out.push('%');
                out.push_str(&format!("{:02X}", b));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_bing_html_extracts_results() {
        let html = r#"
        <ol id="b_results">
          <li class="b_algo">
            <h2><a href="https://react.dev/blog/2024/12/05/react-19">React 19</a></h2>
            <div class="b_caption"><p class="b_lineclamp2">React 19 is now available</p></div>
          </li>
          <li class="b_algo">
            <h2><a href="https://example.com/other">Other</a></h2>
            <div class="b_caption"><p class="b_lineclamp3">Snippet two</p></div>
          </li>
        </ol>
        "#;
        let items = parse_bing_html(html, 10);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "React 19");
        assert_eq!(items[0].url, "https://react.dev/blog/2024/12/05/react-19");
        assert!(items[0].snippet.contains("React 19"));
        assert_eq!(items[1].url, "https://example.com/other");
    }

    #[test]
    fn parse_bing_html_respects_limit() {
        let html = r#"
        <li class="b_algo"><h2><a href="https://a.com">A</a></h2></li>
        <li class="b_algo"><h2><a href="https://b.com">B</a></h2></li>
        <li class="b_algo"><h2><a href="https://c.com">C</a></h2></li>
        "#;
        assert_eq!(parse_bing_html(html, 2).len(), 2);
    }

    #[test]
    fn parse_ddg_html_extracts_results() {
        let html = r#"
        <div class="result">
          <a class="result__a" href="https://example.com/rust">Rust Lang</a>
          <a class="result__snippet">The Rust programming language</a>
        </div>
        <div class="result">
          <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdoc.rust-lang.org%2Fbook%2F&rut=abc">The Book</a>
          <a class="result__snippet">Official Rust book</a>
        </div>
        "#;

        let items = parse_ddg_html(html, 10);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "Rust Lang");
        assert_eq!(items[0].url, "https://example.com/rust");
        assert!(items[0].snippet.contains("Rust programming"));
        assert_eq!(items[1].url, "https://doc.rust-lang.org/book/");
        assert_eq!(items[1].title, "The Book");
    }

    #[test]
    fn format_with_results() {
        let resp = WebSearchResponse {
            query: "rust".into(),
            results: vec![WebSearchItem {
                title: "Rust".into(),
                url: "https://www.rust-lang.org/".into(),
                snippet: "A language".into(),
            }],
            count: 1,
            provider: "bing".into(),
        };
        let text = format_search_output(&resp);
        assert!(text.contains("1. Rust"));
        assert!(text.contains("https://www.rust-lang.org/"));
        assert!(text.contains("摘要: A language"));
        assert!(text.contains("bing"));
    }

    #[test]
    fn resolve_uddg_redirect() {
        let raw = "//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpath&rut=xx";
        assert_eq!(resolve_result_url(raw), "https://example.com/path");
    }
}
