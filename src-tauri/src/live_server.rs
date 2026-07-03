use axum::{
    extract::{Path as AxumPath, State},
    http::{header, HeaderValue, StatusCode},
    response::{sse::Event, sse::KeepAlive, sse::Sse, IntoResponse, Response},
    routing::get,
    Router,
};
use futures_util::StreamExt;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::{
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::mpsc;
use tokio::sync::{broadcast, oneshot};
use tokio_stream::wrappers::BroadcastStream;

#[derive(Debug, Clone, Serialize)]
pub struct LiveServerStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub root: Option<String>,
}

struct LiveServerState {
    root: PathBuf,
    port: u16,
    shutdown_tx: oneshot::Sender<()>,
    _reload_tx: broadcast::Sender<()>,
    _watcher: Option<RecommendedWatcher>,
}

pub struct LiveServerManager {
    inner: Arc<Mutex<LiveServerSlot>>,
}

enum LiveServerSlot {
    Stopped,
    Starting,
    Running(LiveServerState),
}

impl Default for LiveServerSlot {
    fn default() -> Self {
        Self::Stopped
    }
}

impl Default for LiveServerManager {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(LiveServerSlot::Stopped)),
        }
    }
}

impl LiveServerManager {
    pub fn status(&self) -> LiveServerStatus {
        let guard = self.inner.lock().unwrap();
        match &*guard {
            LiveServerSlot::Running(s) => LiveServerStatus {
                running: true,
                port: Some(s.port),
                root: Some(s.root.to_string_lossy().to_string()),
            },
            LiveServerSlot::Starting => LiveServerStatus {
                running: true,
                port: None,
                root: None,
            },
            LiveServerSlot::Stopped => LiveServerStatus {
                running: false,
                port: None,
                root: None,
            },
        }
    }

    pub async fn start(&self, root: String) -> Result<LiveServerStatus, String> {
        {
            let mut guard = self.inner.lock().unwrap();
            match &*guard {
                LiveServerSlot::Running(_) => return Ok(self.status()),
                LiveServerSlot::Starting => return Err("Live Server 正在启动".to_string()),
                LiveServerSlot::Stopped => {
                    *guard = LiveServerSlot::Starting;
                }
            }
        }

        let root_path = PathBuf::from(root);
        let root_canon = std::fs::canonicalize(&root_path).map_err(|e| {
            let mut guard = self.inner.lock().unwrap();
            *guard = LiveServerSlot::Stopped;
            format!("root 目录无法 canonicalize: {e}")
        })?;

        let meta = std::fs::metadata(&root_canon).map_err(|e| {
            let mut guard = self.inner.lock().unwrap();
            *guard = LiveServerSlot::Stopped;
            format!("root 目录不存在: {e}")
        })?;
        if !meta.is_dir() {
            let mut guard = self.inner.lock().unwrap();
            *guard = LiveServerSlot::Stopped;
            return Err("root 必须是目录".to_string());
        }

        let (reload_tx, _rx) = broadcast::channel::<()>(32);

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| {
                let mut guard = self.inner.lock().unwrap();
                *guard = LiveServerSlot::Stopped;
                format!("端口绑定失败: {e}")
            })?;
        let addr = listener.local_addr().map_err(|e| {
            let mut guard = self.inner.lock().unwrap();
            *guard = LiveServerSlot::Stopped;
            format!("获取端口失败: {e}")
        })?;

        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

        let app_state = Arc::new(AppState {
            root: root_path.clone(),
            root_canon: root_canon.clone(),
            reload_tx: reload_tx.clone(),
        });

        let app = Router::new()
            .route("/__livereload", get(sse_livereload))
            .route("/*path", get(serve_path))
            .with_state(app_state);

        tauri::async_runtime::spawn(async move {
            let _ = axum::serve(listener, app)
                .with_graceful_shutdown(async move {
                    let _ = shutdown_rx.await;
                })
                .await;
        });

        let state = LiveServerState {
            root: root_path,
            port: addr.port(),
            shutdown_tx,
            _reload_tx: reload_tx.clone(),
            _watcher: None,
        };

        {
            let mut guard = self.inner.lock().unwrap();
            *guard = LiveServerSlot::Running(state);
        }

        println!(
            "Live Server started on http://127.0.0.1:{} (root={})",
            addr.port(),
            root_canon.to_string_lossy()
        );

        // setup watcher asynchronously (avoid blocking UI)
        let inner = self.inner.clone();
        let root_for_watcher = root_canon.clone();
        let reload_tx_for_watcher = reload_tx.clone();
        tauri::async_runtime::spawn(async move {
            // watcher -> mpsc -> debounce -> broadcast
            let (fs_tx, mut fs_rx) = mpsc::unbounded_channel::<()>();

            let watcher_res = tokio::task::spawn_blocking(
                move || -> Result<RecommendedWatcher, notify::Error> {
                    let fs_tx_for_cb = fs_tx;
                    let mut watcher = notify::recommended_watcher(
                        move |res: Result<notify::Event, notify::Error>| {
                            if let Ok(ev) = res {
                                let is_change = matches!(
                                    ev.kind,
                                    notify::EventKind::Modify(_)
                                        | notify::EventKind::Create(_)
                                        | notify::EventKind::Remove(_)
                                        | notify::EventKind::Any
                                );
                                if is_change {
                                    let _ = fs_tx_for_cb.send(());
                                }
                            }
                        },
                    )?;

                    watcher.watch(&root_for_watcher, RecursiveMode::Recursive)?;
                    Ok(watcher)
                },
            )
            .await;

            let watcher = match watcher_res {
                Ok(Ok(w)) => w,
                _ => return,
            };

            // debounce loop
            let reload_tx_for_task = reload_tx_for_watcher.clone();
            tauri::async_runtime::spawn(async move {
                while fs_rx.recv().await.is_some() {
                    let quiet = tokio::time::sleep(Duration::from_millis(180));
                    tokio::pin!(quiet);
                    loop {
                        tokio::select! {
                            _ = &mut quiet => break,
                            msg = fs_rx.recv() => {
                                if msg.is_none() { return; }
                                quiet.as_mut().reset(tokio::time::Instant::now() + Duration::from_millis(180));
                            }
                        }
                    }
                    let _ = reload_tx_for_task.send(());
                }
            });

            // store watcher to keep it alive
            if let Ok(mut guard) = inner.lock() {
                if let LiveServerSlot::Running(state) = &mut *guard {
                    state._watcher = Some(watcher);
                }
            }
        });

        Ok(self.status())
    }

    pub fn stop(&self) -> Result<(), String> {
        let mut guard = self.inner.lock().unwrap();
        let next = std::mem::take(&mut *guard);
        match next {
            LiveServerSlot::Running(state) => {
                let _ = state.shutdown_tx.send(());
                println!(
                    "Live Server stopped (root={})",
                    state.root.to_string_lossy()
                );
                *guard = LiveServerSlot::Stopped;
                Ok(())
            }
            LiveServerSlot::Starting => {
                *guard = LiveServerSlot::Stopped;
                Ok(())
            }
            LiveServerSlot::Stopped => {
                *guard = LiveServerSlot::Stopped;
                Ok(())
            }
        }
    }
}

#[derive(Clone)]
struct AppState {
    root: PathBuf,
    root_canon: PathBuf,
    reload_tx: broadcast::Sender<()>,
}

async fn sse_livereload(
    State(state): State<Arc<AppState>>,
) -> Sse<impl futures_util::Stream<Item = Result<Event, std::convert::Infallible>>> {
    let rx = state.reload_tx.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|msg| async move {
        match msg {
            Ok(()) => Some(Ok(Event::default().event("reload").data("1"))),
            Err(_) => None,
        }
    });

    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keepalive"),
    )
}

async fn serve_path(
    State(state): State<Arc<AppState>>,
    AxumPath(path): AxumPath<String>,
) -> Response {
    // path is already decoded by axum.
    let mut rel = sanitize_rel_path(&path);
    if rel.is_empty() {
        rel.push("index.html".to_string());
    }

    let mut candidate = state.root.clone();
    for p in &rel {
        candidate.push(p);
    }

    // Directory -> index.html
    if let Ok(meta) = tokio::fs::metadata(&candidate).await {
        if meta.is_dir() {
            candidate.push("index.html");
        }
    }

    let canonical = match std::fs::canonicalize(&candidate) {
        Ok(p) => p,
        Err(_) => return (StatusCode::NOT_FOUND, "Not Found").into_response(),
    };

    if !path_starts_with(&canonical, &state.root_canon) {
        return (StatusCode::FORBIDDEN, "Forbidden").into_response();
    }

    let bytes = match tokio::fs::read(&canonical).await {
        Ok(b) => b,
        Err(_) => return (StatusCode::NOT_FOUND, "Not Found").into_response(),
    };

    let ext = canonical
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    let (content_type, body) = if ext == "html" || ext == "htm" {
        match String::from_utf8(bytes) {
            Ok(s) => {
                let injected = inject_livereload(&s);
                ("text/html; charset=utf-8", injected.into_bytes())
            }
            Err(e) => {
                // 非 UTF-8 的 HTML，直接返回
                ("text/html", e.into_bytes())
            }
        }
    } else {
        (content_type_for_ext(&ext), bytes)
    };

    let mut resp = Response::new(body.into());
    if let Ok(v) = HeaderValue::from_str(content_type) {
        resp.headers_mut().insert(header::CONTENT_TYPE, v);
    }
    // disable cache for dev-like behavior
    resp.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-cache, no-store, must-revalidate"),
    );
    resp
}

fn inject_livereload(html: &str) -> String {
    const SNIPPET: &str = r#"\n<script>\n(() => {\n  try {\n    const es = new EventSource('/__livereload');\n    const reload = () => { try { location.reload(); } catch {} };\n    es.addEventListener('reload', reload);\n    es.onmessage = reload;\n  } catch (e) {\n    console.warn('livereload failed', e);\n  }\n})();\n</script>\n"#;

    let lower = html.to_lowercase();
    if let Some(idx) = lower.rfind("</body>") {
        let (a, b) = html.split_at(idx);
        return format!("{a}{SNIPPET}{b}");
    }
    format!("{html}{SNIPPET}")
}

fn sanitize_rel_path(input: &str) -> Vec<String> {
    let trimmed = input.trim_start_matches('/');
    let mut out = Vec::new();
    for raw in trimmed.split('/') {
        if raw.is_empty() {
            continue;
        }
        // basic traversal protection
        if raw == "." || raw == ".." {
            continue;
        }
        if raw.contains('\\') {
            continue;
        }
        out.push(raw.to_string());
    }
    out
}

fn path_starts_with(child: &Path, parent: &Path) -> bool {
    // canonical paths
    let mut child_iter = child.components();
    for p in parent.components() {
        match child_iter.next() {
            Some(c) if components_eq(c, p) => {}
            _ => return false,
        }
    }
    true
}

fn components_eq(a: Component<'_>, b: Component<'_>) -> bool {
    match (a, b) {
        (Component::Prefix(pa), Component::Prefix(pb)) => pa.as_os_str() == pb.as_os_str(),
        (Component::RootDir, Component::RootDir) => true,
        (Component::CurDir, Component::CurDir) => true,
        (Component::ParentDir, Component::ParentDir) => true,
        (Component::Normal(na), Component::Normal(nb)) => na == nb,
        _ => false,
    }
}

fn content_type_for_ext(ext: &str) -> &'static str {
    match ext {
        "css" => "text/css; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}
