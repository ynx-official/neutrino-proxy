#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod config_import;
mod storage;
mod tray;
use neutrino_client_core::{
    config::{validate, ClientConfig},
    Engine, Snapshot,
};
use serde::Deserialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{Emitter, Manager};

#[derive(Default)]
struct Navigation(Mutex<Option<String>>);

#[tauri::command]
fn take_navigation(state: tauri::State<Navigation>) -> Option<String> {
    state.0.lock().unwrap().take()
}

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
    let app = app.clone();
    // WebView2 creation must run outside synchronous native event handlers.
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = show_main(&app, None) {
            app.state::<AppState>().engine.log("error", "窗口", &error);
        }
    });
}
fn show_main(app: &tauri::AppHandle, route: Option<&str>) -> Result<(), String> {
    if let Some(route) = route {
        *app.state::<Navigation>().0.lock().unwrap() = Some(route.into());
    }
    if let Some(window) = app.get_webview_window("main") {
        window
            .unminimize()
            .and_then(|_| window.show())
            .and_then(|_| window.set_focus())
            .map_err(|e| e.to_string())?;
        if route.is_some() {
            window
                .emit_to("main", "main-navigate", ())
                .map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .ok_or("主窗口配置缺失")?;
    tauri::WebviewWindowBuilder::from_config(app, config)
        .and_then(|builder| builder.build())
        .map_err(|e| e.to_string())?;
    // The new page consumes the pending route after installing its router guard.
    Ok(())
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
        .plugin(tauri_plugin_single_instance::init(|app, _args, _| {
            // Native UI tests can open the real popup without automating the OS taskbar.
            // This entry point is absent from release binaries.
            #[cfg(debug_assertions)]
            if _args.iter().any(|arg| arg == "--preview-tray") {
                tray::preview(app);
                return;
            }
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
            app.manage(Navigation::default());
            tray::install(app)?;
            let mut changes = engine.subscribe();
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut previous_connected = None;
                loop {
                    let snapshot = changes.borrow_and_update().clone();
                    tray::update(&handle, &snapshot, &mut previous_connected);
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.emit_to("main", "client-state", snapshot);
                    }
                    if changes.changed().await.is_err() {
                        break;
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tray::tray_snapshot,
            tray::tray_ready,
            tray::close_tray,
            tray::tray_action,
            take_navigation,
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
