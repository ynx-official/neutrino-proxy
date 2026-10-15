#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod storage;
use neutrino_client_core::{
    config::{validate, ClientConfig},
    Engine, Snapshot,
};
use serde::Deserialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

struct AppState {
    engine: Engine,
    stored: Mutex<storage::Store>,
    quitting: AtomicBool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveRequest {
    config: ClientConfig,
    license: Option<String>,
    store_password: Option<String>,
    connect: bool,
}

#[tauri::command]
fn get_snapshot(state: tauri::State<AppState>) -> Snapshot {
    state.engine.snapshot()
}
#[tauri::command]
async fn connect(state: tauri::State<'_, AppState>) -> Result<(), String> {
    connect_command(&state).await
}
#[tauri::command]
async fn disconnect(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.engine.disconnect().await;
    Ok(())
}
#[tauri::command]
async fn save_config(
    state: tauri::State<'_, AppState>,
    mut request: SaveRequest,
) -> Result<Snapshot, String> {
    let (config, secrets) = {
        let mut stored = state.stored.lock().unwrap();
        if request.config.client_id.trim().is_empty() {
            request.config.client_id = stored.config.client_id.clone();
        }
        let mut secrets = stored.secrets.clone();
        if let Some(license) = request.license {
            secrets.license = license;
        }
        if let Some(password) = request.store_password {
            secrets.store_password = password;
        }
        let errors = validate(&request.config, !secrets.license.is_empty());
        if !errors.is_empty() {
            return Err(errors.values().cloned().collect::<Vec<_>>().join("；"));
        }
        stored.save(request.config.clone(), secrets.clone())?;
        (request.config, secrets)
    };
    state.engine.configure(config.clone(), &secrets);
    state.engine.log("info", "配置", "连接配置已保存在本机");
    if request.connect {
        state.engine.connect(config, secrets).await?;
    }
    Ok(state.engine.snapshot())
}
#[tauri::command]
fn close_to_tray(window: tauri::WebviewWindow) -> Result<(), String> {
    window.destroy().map_err(|e| e.to_string())
}
#[tauri::command]
async fn quit_app(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.quitting.store(true, Ordering::SeqCst);
    state.engine.disconnect().await;
    app.exit(0);
    Ok(())
}
#[tauri::command]
async fn select_certificate(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("信任证书", &["jks", "pem", "crt", "cer", "der"])
            .blocking_pick_file()
            .map(|f| {
                f.into_path()
                    .map(|p| p.to_string_lossy().into_owned())
                    .map_err(|e| e.to_string())
            })
            .transpose()
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn import_config(app: tauri::AppHandle) -> Result<Option<storage::ImportPreview>, String> {
    use tauri_plugin_dialog::DialogExt;
    tokio::task::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("YAML 配置", &["yml", "yaml"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        storage::preview_import(&app, &path).map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn apply_import(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<Snapshot, String> {
    let (config, secrets) = storage::take_import(&app, &id)?;
    {
        let mut stored = state.stored.lock().unwrap();
        stored.save(config.clone(), secrets.clone())?;
    }
    state.engine.configure(config, &secrets);
    state
        .engine
        .log("info", "配置", "旧配置已导入，请确认后连接");
    Ok(state.engine.snapshot())
}
#[tauri::command]
async fn export_logs(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    let logs = state.engine.snapshot().logs;
    tokio::task::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_file_name("neutrino-client-logs.txt")
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        let text = logs
            .iter()
            .map(|l| format!("{} [{}] {}: {}\n", l.time, l.level, l.source, l.message))
            .collect::<String>();
        std::fs::write(path, text).map_err(|_| "无法写入日志文件".to_owned())?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn show_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let _ =
        tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
            .title("Neutrino Proxy")
            .inner_size(1040.0, 720.0)
            .min_inner_size(860.0, 620.0)
            .build();
}
fn main() {
    // The UI is transient; background networking shares a small fixed worker pool.
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .max_blocking_threads(4)
        .thread_name("neutrino-io")
        .enable_all()
        .build()
        .expect("无法创建客户端异步运行时");
    tauri::async_runtime::set(runtime.handle().clone());
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_window(app)
        }))
        .setup(|app| {
            let store = storage::Store::load(app.handle());
            let engine = Engine::new();
            engine.configure(store.config.clone(), &store.secrets);
            if let Some(error) = store.error.as_ref() {
                engine.log("error", "配置", error);
            }
            app.manage(AppState {
                engine: engine.clone(),
                stored: Mutex::new(store),
                quitting: AtomicBool::new(false),
            });
            app.manage(storage::PendingImport::default());
            let open = MenuItem::with_id(app, "open", "打开主窗口", true, None::<&str>)?;
            let connect = MenuItem::with_id(app, "connect", "连接", true, None::<&str>)?;
            let disconnect = MenuItem::with_id(app, "disconnect", "断开连接", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出应用", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &connect, &disconnect, &quit])?;
            TrayIconBuilder::with_id("client-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Neutrino Proxy · 尚未连接")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_window(app),
                    "connect" => {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let state = app.state::<AppState>();
                            let _ = connect_command(&state).await;
                        });
                    }
                    "disconnect" => {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            app.state::<AppState>().engine.disconnect().await;
                        });
                    }
                    "quit" => {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let state = app.state::<AppState>();
                            state.quitting.store(true, Ordering::SeqCst);
                            state.engine.disconnect().await;
                            app.exit(0);
                        });
                    }
                    _ => {}
                })
                .build(app)?;
            let mut changes = engine.subscribe();
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                while changes.changed().await.is_ok() {
                    let snapshot = changes.borrow_and_update().clone();
                    if let Some(tray) = handle.tray_by_id("client-tray") {
                        let label = if snapshot.state == "connected" {
                            "已连接"
                        } else {
                            "尚未连接"
                        };
                        let _ = tray.set_tooltip(Some(format!("Neutrino Proxy · {label}")));
                    }
                    if handle.get_webview_window("main").is_some() {
                        let _ = handle.emit("client-state", snapshot);
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            connect,
            disconnect,
            save_config,
            close_to_tray,
            quit_app,
            select_certificate,
            import_config,
            apply_import,
            export_logs
        ])
        .build(tauri::generate_context!())
        .expect("无法启动 Neutrino Proxy")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested {
                code: None, api, ..
            } = event
            {
                if !app.state::<AppState>().quitting.load(Ordering::SeqCst) {
                    api.prevent_exit();
                }
            }
        });
}
async fn connect_command(state: &AppState) -> Result<(), String> {
    if matches!(
        state.engine.snapshot().state.as_str(),
        "connected" | "connecting" | "authenticating" | "stopping"
    ) {
        return Ok(());
    }
    let (config, secrets) = {
        let store = state.stored.lock().unwrap();
        (store.config.clone(), store.secrets.clone())
    };
    state.engine.connect(config, secrets).await
}
