use crate::{connect_command, show_main, AppState};
use neutrino_client_core::{config::validate, Snapshot};
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Manager,
};

struct NativeTray {
    presentation: Mutex<TraySnapshot>,
    busy: AtomicBool,
}
impl NativeTray {
    fn claim_action<'a>(&self, id: &'a str) -> Option<&'a str> {
        let action = menu_action(id)?;
        (!self.busy.swap(true, Ordering::SeqCst)).then_some(action)
    }
}

struct TrayImages {
    connected: Image<'static>,
    idle: Image<'static>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TraySnapshot {
    label: &'static str,
    tone: &'static str,
    endpoint: String,
    action: &'static str,
    action_label: &'static str,
    disabled: bool,
}

impl From<&Snapshot> for TraySnapshot {
    fn from(snapshot: &Snapshot) -> Self {
        let (label, tone, action, action_label, disabled) = match snapshot.state.as_str() {
            "connected" => ("已连接", "connected", "disconnect", "断开连接", false),
            "connecting" | "authenticating" | "validating" => {
                ("正在连接", "pending", "disconnect", "取消连接", false)
            }
            "reconnecting" => ("等待重连", "pending", "disconnect", "停止重连", false),
            "stopping" => ("正在断开", "pending", "none", "正在断开", true),
            "error" => ("连接失败", "error", "connect", "连接", false),
            _ => ("未连接", "idle", "connect", "连接", false),
        };
        // A saved edit may target a different server from the current session.
        let config = if matches!(
            snapshot.state.as_str(),
            "connected" | "connecting" | "authenticating" | "reconnecting" | "stopping"
        ) {
            snapshot.active_config.as_ref().unwrap_or(&snapshot.config)
        } else {
            &snapshot.config
        };
        let host = config.server.trim();
        let endpoint = if host.is_empty() {
            String::new()
        } else if host.contains(':') && !host.starts_with('[') {
            format!("[{host}]:{}", config.port)
        } else {
            format!("{host}:{}", config.port)
        };
        Self {
            label,
            tone,
            endpoint,
            action,
            action_label,
            disabled,
        }
    }
}

fn validate_action(snapshot: &Snapshot, action: &str) -> Result<(), String> {
    let view = TraySnapshot::from(snapshot);
    if view.disabled || action != view.action {
        Err("连接状态已变化，请重试".into())
    } else {
        Ok(())
    }
}

async fn execute_action(app: &tauri::AppHandle, action: &str) -> Result<(), String> {
    let state = app.state::<AppState>();
    match action {
        "open" => show_main(app, None)?,
        "logs" => show_main(app, Some("/logs"))?,
        "connect" => {
            let snapshot = state.engine.snapshot();
            validate_action(&snapshot, action)?;
            if validate(&snapshot.config, snapshot.has_license).is_empty() {
                connect_command(&state).await?;
            } else {
                show_main(app, Some("/settings"))?;
            }
        }
        "disconnect" => {
            validate_action(&state.engine.snapshot(), action)?;
            state.engine.disconnect().await;
        }
        "quit" => {
            state.quitting.store(true, Ordering::SeqCst);
            state.engine.disconnect().await;
            app.exit(0);
            return Ok(());
        }
        _ => return Err("未知托盘操作".into()),
    }
    Ok(())
}

fn menu_action(id: &str) -> Option<&str> {
    match id.strip_prefix("tray-")? {
        action @ ("open" | "logs" | "connect" | "disconnect" | "quit") => Some(action),
        _ => None,
    }
}

fn dispatch_action(app: &tauri::AppHandle, id: &str) {
    let Some(action) = app.state::<NativeTray>().claim_action(id) else {
        return;
    };
    let app = app.clone();
    let action = action.to_owned();
    // Window creation and network cleanup must stay outside the native menu callback.
    tauri::async_runtime::spawn(async move {
        if let Err(error) = execute_action(&app, &action).await {
            app.state::<AppState>().engine.log("warn", "托盘", &error);
            let _ = show_main(&app, Some("/logs"));
        }
        app.state::<NativeTray>()
            .busy
            .store(false, Ordering::SeqCst);
    });
}

fn native_menu(app: &tauri::AppHandle, view: &TraySnapshot) -> tauri::Result<Menu<tauri::Wry>> {
    let title = MenuItem::new(app, "Neutrino Proxy", false, None::<&str>)?;
    let status = MenuItem::new(app, format!("状态：{}", view.label), false, None::<&str>)?;
    let endpoint = MenuItem::new(
        app,
        if view.endpoint.is_empty() {
            "尚未配置服务器"
        } else {
            &view.endpoint
        },
        false,
        None::<&str>,
    )?;
    let open = MenuItem::with_id(app, "tray-open", "打开主窗口", true, None::<&str>)?;
    let logs = MenuItem::with_id(app, "tray-logs", "查看日志", true, None::<&str>)?;
    // Keep the intent in the ID: an old "connect" click must never become "disconnect".
    let action = MenuItem::with_id(
        app,
        format!("tray-{}", view.action),
        view.action_label,
        !view.disabled,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "tray-quit", "退出应用", true, None::<&str>)?;
    Menu::with_items(
        app,
        &[
            &title,
            &status,
            &endpoint,
            &PredefinedMenuItem::separator(app)?,
            &open,
            &logs,
            &PredefinedMenuItem::separator(app)?,
            &action,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )
}

fn badged_icon(base: &Image<'_>, connected: bool) -> Image<'static> {
    let (width, height) = (base.width(), base.height());
    let mut pixels = base.rgba().to_vec();
    let side = width.min(height) as f64;
    let (cx, cy, radius) = (width as f64 - side * 0.17, side * 0.17, side * 0.13);
    let color = if connected {
        [52, 184, 126, 255]
    } else {
        [144, 149, 155, 255]
    };
    for y in 0..height {
        for x in 0..width {
            let d = ((x as f64 - cx).powi(2) + (y as f64 - cy).powi(2)).sqrt();
            let pixel = ((y * width + x) * 4) as usize;
            if d <= radius {
                pixels[pixel..pixel + 4].copy_from_slice(&color);
            } else if d <= radius + side * 0.025 {
                pixels[pixel..pixel + 4].copy_from_slice(&[255, 255, 255, 255]);
            }
        }
    }
    Image::new_owned(pixels, width, height)
}

pub fn install(app: &tauri::App) -> tauri::Result<()> {
    let snapshot = app.state::<AppState>().engine.snapshot();
    let presentation = TraySnapshot::from(&snapshot);
    let menu = native_menu(app.handle(), &presentation)?;
    // A compact transparent mark stays readable in the menu bar and notification area.
    let icon = Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    let images = TrayImages {
        connected: badged_icon(&icon, true),
        idle: badged_icon(&icon, false),
    };
    app.manage(NativeTray {
        presentation: Mutex::new(presentation.clone()),
        busy: AtomicBool::new(false),
    });
    TrayIconBuilder::with_id("client-tray")
        .icon(images.idle.clone())
        .tooltip(format!("Neutrino Proxy · {}", presentation.label))
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| dispatch_action(app, event.id.as_ref()))
        .build(app)?;
    app.manage(images);
    Ok(())
}

pub fn update(app: &tauri::AppHandle, snapshot: &Snapshot) {
    let view = TraySnapshot::from(snapshot);
    let state = app.state::<NativeTray>();
    let mut previous = state.presentation.lock().unwrap();
    // Durations, logs, traffic and revisions do not change the native menu.
    if *previous == view {
        return;
    }
    let connected_changed = (previous.label == "已连接") != (view.label == "已连接");
    let status_changed = previous.label != view.label;
    // Cache failed attempts too, so an OS error cannot create a log/update feedback loop.
    *previous = view.clone();
    if let Some(tray) = app.tray_by_id("client-tray") {
        if status_changed {
            let _ = tray.set_tooltip(Some(format!("Neutrino Proxy · {}", view.label)));
        }
        if connected_changed {
            let images = app.state::<TrayImages>();
            let icon = if snapshot.state == "connected" {
                &images.connected
            } else {
                &images.idle
            };
            let _ = tray.set_icon(Some(icon.clone()));
        }
        if let Err(error) = native_menu(app, &view).and_then(|menu| tray.set_menu(Some(menu))) {
            app.state::<AppState>().engine.log(
                "error",
                "托盘",
                &format!("无法更新系统菜单：{error}"),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unrelated_snapshot_updates_do_not_invalidate_the_menu() {
        let snapshot = Snapshot::default();
        let before = TraySnapshot::from(&snapshot);
        let mut after = snapshot.clone();
        after.revision += 1;
        assert_eq!(before, TraySnapshot::from(&after));
    }
    #[test]
    fn connection_actions_are_exclusive_and_stale_intents_are_rejected() {
        for (state, expected, label, disabled) in [
            ("idle", "connect", "连接", false),
            ("error", "connect", "连接", false),
            ("connected", "disconnect", "断开连接", false),
            ("validating", "disconnect", "取消连接", false),
            ("connecting", "disconnect", "取消连接", false),
            ("authenticating", "disconnect", "取消连接", false),
            ("reconnecting", "disconnect", "停止重连", false),
            ("stopping", "none", "正在断开", true),
        ] {
            let snapshot = Snapshot {
                state: state.into(),
                ..Snapshot::default()
            };
            let view = TraySnapshot::from(&snapshot);
            assert_eq!((view.action, view.disabled), (expected, disabled));
            assert_eq!(view.action_label, label);
            assert_eq!(validate_action(&snapshot, expected).is_ok(), !disabled);
            let opposite = if expected == "connect" {
                "disconnect"
            } else {
                "connect"
            };
            assert!(validate_action(&snapshot, opposite).is_err());
        }
    }
    #[test]
    fn endpoint_tracks_active_session_and_contains_no_credentials() {
        let mut snapshot = Snapshot::default();
        snapshot.config.server = "next.example.com".into();
        snapshot.license_hint = "hidden-license".into();
        let mut active = snapshot.config.clone();
        active.server = "2001:db8::1".into();
        snapshot.active_config = Some(active);
        snapshot.state = "connected".into();
        assert_eq!(TraySnapshot::from(&snapshot).endpoint, "[2001:db8::1]:9002");
        assert!(!serde_json::to_string(&TraySnapshot::from(&snapshot))
            .unwrap()
            .contains("hidden-license"));
        snapshot.state = "idle".into();
        assert_eq!(
            TraySnapshot::from(&snapshot).endpoint,
            "next.example.com:9002"
        );
    }
    #[test]
    fn native_menu_only_dispatches_known_commands_and_preserves_intent() {
        for action in ["open", "logs", "connect", "disconnect", "quit"] {
            assert_eq!(menu_action(&format!("tray-{action}")), Some(action));
        }
        for id in ["tray-none", "tray-status", "quit", "tray-arbitrary"] {
            assert_eq!(menu_action(id), None);
        }
        let connected = Snapshot {
            state: "connected".into(),
            ..Snapshot::default()
        };
        assert!(validate_action(&connected, menu_action("tray-connect").unwrap()).is_err());
    }
    #[test]
    fn native_actions_reject_repeat_clicks_until_the_previous_action_finishes() {
        let tray = NativeTray {
            presentation: Mutex::new(TraySnapshot::from(&Snapshot::default())),
            busy: AtomicBool::new(false),
        };
        assert_eq!(tray.claim_action("tray-status"), None);
        assert_eq!(tray.claim_action("tray-logs"), Some("logs"));
        assert_eq!(tray.claim_action("tray-logs"), None);
        assert_eq!(tray.claim_action("tray-connect"), None);
        tray.busy.store(false, Ordering::SeqCst);
        assert_eq!(tray.claim_action("tray-connect"), Some("connect"));
    }
}
