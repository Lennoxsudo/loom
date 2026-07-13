const AI_REQUEST_MAX_RETRIES: u32 = 5;
const AI_REQUEST_BASE_DELAY_MS: u64 = 1000;
const AI_REQUEST_MAX_DELAY_MS: u64 = 30_000;

/// Prefix used to identify quota-exhausted errors in the auto-routing fallback.
pub const QUOTA_EXHAUSTED_PREFIX: &str = "__QUOTA_EXHAUSTED__";

/// Check whether the HTTP status code and response body indicate a quota exhaustion error.
pub fn is_quota_exhausted_error(status: u16, body: &str) -> bool {
    match status {
        402 => true,
        429 => true,
        403 => {
            let lower = body.to_lowercase();
            lower.contains("quota")
                || lower.contains("insufficient_quota")
                || lower.contains("exhausted")
                || lower.contains("rate_limit")
                || lower.contains("insufficient_credits")
                || lower.contains("out of credits")
                || lower.contains("payment required")
        }
        _ => false,
    }
}

pub async fn send_ai_request_with_retry<F, Fut>(request_fn: F) -> Result<reqwest::Response, String>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<reqwest::Response, reqwest::Error>>,
{
    send_ai_request_with_retry_limit(request_fn, AI_REQUEST_MAX_RETRIES).await
}

pub async fn send_ai_request_with_retry_limit<F, Fut>(
    request_fn: F,
    max_retries: u32,
) -> Result<reqwest::Response, String>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<reqwest::Response, reqwest::Error>>,
{
    let mut attempt: u32 = 0;

    loop {
        match request_fn().await {
            Ok(response) => {
                let status = response.status();
                let status_code = status.as_u16();

                if status.is_success() {
                    return Ok(response);
                }

                // Read headers before consuming the body
                let retry_after_delay = parse_retry_after_headers(response.headers(), attempt);

                // Read the response body for error analysis
                let error_text = response.text().await.unwrap_or_default();
                let trimmed = error_text.trim().to_string();

                if status_code == 429 {
                    if attempt >= max_retries {
                        return Err(format!(
                            "{}(429) API速率限制，重试{}次后仍失败: {}",
                            QUOTA_EXHAUSTED_PREFIX,
                            max_retries,
                            trimmed
                        ));
                    }

                    log::warn!(
                        "[AI Retry] Rate limited (429), retrying after {}ms (attempt {}/{})",
                        retry_after_delay,
                        attempt + 1,
                        max_retries
                    );
                    tokio::time::sleep(std::time::Duration::from_millis(retry_after_delay)).await;
                    attempt += 1;
                    continue;
                }

                if status_code >= 500 {
                    if attempt >= max_retries {
                        return Err(format!(
                            "API服务端错误 {}，重试{}次后仍失败: {}",
                            status_code,
                            max_retries,
                            trimmed
                        ));
                    }

                    let delay_ms = compute_backoff_delay(attempt);
                    log::warn!(
                        "[AI Retry] Server error {}, retrying in {}ms (attempt {}/{})",
                        status_code,
                        delay_ms,
                        attempt + 1,
                        max_retries
                    );
                    tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                    attempt += 1;
                    continue;
                }

                // For 402/403 and other non-retryable errors, check if quota exhausted
                if is_quota_exhausted_error(status_code, &trimmed) {
                    return Err(format!(
                        "{}{}: {}",
                        QUOTA_EXHAUSTED_PREFIX,
                        status_code,
                        trimmed
                    ));
                }

                return Err(format!("API返回错误 {}: {}", status_code, trimmed));
            }
            Err(e) => {
                if attempt >= max_retries {
                    return Err(format!(
                        "请求失败（重试{}次后）: {}",
                        max_retries, e
                    ));
                }

                let is_timeout = e.is_timeout() || e.is_connect();
                let delay_ms = compute_backoff_delay(attempt);
                log::warn!(
                    "[AI Retry] {} error, retrying in {}ms (attempt {}/{}): {}",
                    if is_timeout {
                        "Timeout/connect"
                    } else {
                        "Network"
                    },
                    delay_ms,
                    attempt + 1,
                    max_retries,
                    e
                );
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                attempt += 1;
                continue;
            }
        }
    }
}

fn compute_backoff_delay(attempt: u32) -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    let base = AI_REQUEST_BASE_DELAY_MS;
    let exponential = base.saturating_mul(2u64.saturating_pow(attempt));

    let now_nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let jitter = (now_nanos as u64 % (base / 2 + 1)).min(base / 2);

    (exponential + jitter).min(AI_REQUEST_MAX_DELAY_MS)
}

/// Parse Retry-After header value as delay seconds (RFC 7231 delay-seconds or HTTP-date).
fn parse_retry_after_value(value: &str) -> Option<u64> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(secs) = trimmed.parse::<u64>() {
        return Some(secs);
    }

    use chrono::{DateTime, Utc};

    if let Ok(dt) = DateTime::parse_from_rfc2822(trimmed) {
        let target = dt.with_timezone(&Utc);
        let now = Utc::now();
        let delay_secs = target.signed_duration_since(now).num_seconds();
        return Some(delay_secs.max(0) as u64);
    }

    None
}

fn parse_retry_after_headers(headers: &reqwest::header::HeaderMap, attempt: u32) -> u64 {
    if let Some(header_val) = headers.get("retry-after") {
        if let Ok(s) = header_val.to_str() {
            if let Some(secs) = parse_retry_after_value(s) {
                let delay_ms = secs.saturating_mul(1000);
                return delay_ms.min(AI_REQUEST_MAX_DELAY_MS);
            }
        }
    }
    compute_backoff_delay(attempt)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Duration, Utc};
    use std::sync::{Arc, Mutex};

    #[test]
    fn parse_retry_after_value_accepts_delay_seconds() {
        assert_eq!(parse_retry_after_value("120"), Some(120));
        assert_eq!(parse_retry_after_value("  30 "), Some(30));
    }

    #[test]
    fn parse_retry_after_value_accepts_http_date() {
        let future = Utc::now() + Duration::seconds(45);
        let http_date = future.format("%a, %d %b %Y %H:%M:%S GMT").to_string();
        let parsed = parse_retry_after_value(&http_date).expect("http-date should parse");
        assert!((40..=50).contains(&parsed));
    }

    #[test]
    fn parse_retry_after_headers_falls_back_to_backoff_for_invalid_value() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            "retry-after",
            reqwest::header::HeaderValue::from_static("not-a-date-or-seconds"),
        );
        let delay = parse_retry_after_headers(&headers, 1);
        assert_eq!(delay, compute_backoff_delay(1));
    }

    #[test]
    fn parse_retry_after_headers_converts_seconds_to_millis() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            "retry-after",
            reqwest::header::HeaderValue::from_static("2"),
        );
        assert_eq!(parse_retry_after_headers(&headers, 0), 2_000);
    }

    #[tokio::test]
    async fn test_send_ai_request_with_retry_limit_zero() {
        let call_count = Arc::new(Mutex::new(0));
        let call_count_clone = call_count.clone();

        let result = send_ai_request_with_retry_limit(
            move || {
                let count = call_count_clone.clone();
                async move {
                    *count.lock().unwrap() += 1;
                    let err = reqwest::Client::new()
                        .get("http://invalid.url.local")
                        .send()
                        .await
                        .unwrap_err();
                    Err(err)
                }
            },
            0,
        )
        .await;

        assert!(result.is_err());
        assert_eq!(*call_count.lock().unwrap(), 1);
    }

    #[tokio::test]
    async fn test_send_ai_request_with_retry_limit_one() {
        let call_count = Arc::new(Mutex::new(0));
        let call_count_clone = call_count.clone();

        let result = send_ai_request_with_retry_limit(
            move || {
                let count = call_count_clone.clone();
                async move {
                    *count.lock().unwrap() += 1;
                    let err = reqwest::Client::new()
                        .get("http://invalid.url.local")
                        .send()
                        .await
                        .unwrap_err();
                    Err(err)
                }
            },
            1,
        )
        .await;

        assert!(result.is_err());
        // 1 initial attempt + 1 retry = 2 total calls
        assert_eq!(*call_count.lock().unwrap(), 2);
    }
}
