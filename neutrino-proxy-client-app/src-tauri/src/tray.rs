use crate::{connect_command, show_main, AppState};
use neutrino_client_core::{config::validate, Snapshot};
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{
    image::Image,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

const WIDTH: f64 = 288.0;
const HEIGHT: f64 = 342.0;
#[derive(Default)]
struct PopupRequest(AtomicBool);

struct TrayImages {
    connected: Image<'static>,
    idle: Image<'static>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TraySnapshot {
    revision: u64,
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
            revision: snapshot.revision,
            label,
            tone,
            endpoint,
            action,
            action_label,
            disabled,
        }
    }
}

fn ensure_tray(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "tray" {
        Ok(())
    } else {
        Err("仅可从托盘执行此操作".into())
    }
}

#[tauri::command]
pub fn tray_snapshot(
    window: WebviewWindow,
    state: tauri::State<AppState>,
) -> Result<TraySnapshot, String> {
    ensure_tray(&window)?;
    Ok(TraySnapshot::from(&state.engine.snapshot()))
}

#[tauri::command]
pub fn tray_ready(window: WebviewWindow) -> Result<(), String> {
    ensure_tray(&window)?;
    window
        .show()
        .and_then(|_| window.set_focus())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn close_tray(window: WebviewWindow) -> Result<(), String> {
    ensure_tray(&window)?;
    window.destroy().map_err(|e| e.to_string())
}

fn validate_action(snapshot: &Snapshot, action: &str) -> Result<(), String> {
    let view = TraySnapshot::from(snapshot);
    if view.disabled || action != view.action {
        Err("连接状态已变化，请重试".into())
    } else {
        Ok(())
    }
}

#[tauri::command]
pub async fn tray_action(
    app: tauri::AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, AppState>,
    action: String,
) -> Result<(), String> {
    ensure_tray(&window)?;
    match action.as_str() {
        "open" => show_main(&app, None)?,
        "logs" => show_main(&app, Some("/logs"))?,
        "connect" => {
            validate_action(&state.engine.snapshot(), &action)?;
            let snapshot = state.engine.snapshot();
            if validate(&snapshot.config, snapshot.has_license).is_empty() {
                connect_command(&state).await?;
            } else {
                show_main(&app, Some("/settings"))?;
            }
        }
        "disconnect" => {
            validate_action(&state.engine.snapshot(), &action)?;
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
    // Opening main can already have dismissed the popup via focus loss.
    let _ = window.destroy();
    Ok(())
}

// All coordinates here are physical pixels, including negative monitor origins.
fn popup_position(
    point: (f64, f64),
    work: (f64, f64, f64, f64),
    size: (f64, f64),
    gap: f64,
) -> (i32, i32) {
    let (left, top, width, height) = work;
    let (w, h) = size;
    let x = (point.0 - w + 20.0).clamp(left + gap, (left + width - w - gap).max(left + gap));
    let y = if point.1 - h - gap >= top {
        point.1 - h - gap
    } else {
        point.1 + gap
    };
    let y = y.clamp(top + gap, (top + height - h - gap).max(top + gap));
    (x.round() as i32, y.round() as i32)
}

fn open_popup(app: &tauri::AppHandle, point: PhysicalPosition<f64>) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("tray") {
        window.destroy()?;
        return Ok(());
    }
    let monitor = app
        .monitor_from_point(point.x, point.y)?
        .or(app.primary_monitor()?);
    let window = WebviewWindowBuilder::new(app, "tray", WebviewUrl::App("tray.html".into()))
        .title("Neutrino Proxy · 托盘")
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .shadow(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .build()?;
    if let Some(monitor) = monitor {
        let work = monitor.work_area();
        let scale = monitor.scale_factor();
        let (x, y) = popup_position(
            (point.x, point.y),
            (
                work.position.x as f64,
                work.position.y as f64,
                work.size.width as f64,
                work.size.height as f64,
            ),
            (WIDTH * scale, HEIGHT * scale),
            8.0 * scale,
        );
        window.set_position(PhysicalPosition::new(x, y))?;
    }
    let focused = Arc::new(AtomicBool::new(false));
    let popup = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Focused(true) => {
            focused.store(true, Ordering::SeqCst);
        }
        WindowEvent::Focused(false) if focused.swap(false, Ordering::SeqCst) => {
            // Keep native lifecycle work outside the window-event callback.
            let popup = popup.clone();
            tauri::async_runtime::spawn(async move {
                let _ = popup.destroy();
            });
        }
        _ => {}
    });
    Ok(())
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
    app.manage(PopupRequest::default());
    // A compact transparent mark stays readable in the menu bar and notification area.
    let icon = Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    let images = TrayImages {
        connected: badged_icon(&icon, true),
        idle: badged_icon(&icon, false),
    };
    TrayIconBuilder::with_id("client-tray")
        .icon(images.idle.clone())
        .tooltip("Neutrino Proxy · 未连接")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                position,
                button: MouseButton::Left | MouseButton::Right,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                request_popup(tray.app_handle(), position);
            }
        })
        .build(app)?;
    app.manage(images);
    Ok(())
}

fn request_popup(app: &tauri::AppHandle, point: PhysicalPosition<f64>) {
    if app.state::<PopupRequest>().0.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    // Tauri documents a WebView2 deadlock when builders run in sync event handlers.
    // Serialize requests and build on the existing bounded blocking pool instead.
    tauri::async_runtime::spawn_blocking(move || {
        let result = open_popup(&app, point);
        app.state::<PopupRequest>().0.store(false, Ordering::SeqCst);
        if let Err(error) = result {
            app.state::<AppState>()
                .engine
                .log("error", "托盘", &format!("无法打开托盘：{error}"));
        }
    });
}

#[cfg(debug_assertions)]
pub fn preview(app: &tauri::AppHandle) {
    if let Ok(point) = app.cursor_position() {
        request_popup(app, point);
    }
}

pub fn update(app: &tauri::AppHandle, snapshot: &Snapshot, previous_connected: &mut Option<bool>) {
    let view = TraySnapshot::from(snapshot);
    let connected = snapshot.state == "connected";
    if let Some(tray) = app.tray_by_id("client-tray") {
        let _ = tray.set_tooltip(Some(format!("Neutrino Proxy · {}", view.label)));
        if *previous_connected != Some(connected) {
            let images = app.state::<TrayImages>();
            let icon = if connected {
                &images.connected
            } else {
                &images.idle
            };
            let _ = tray.set_icon(Some(icon.clone()));
            *previous_connected = Some(connected);
        }
    }
    if let Some(window) = app.get_webview_window("tray") {
        let _ = window.emit_to("tray", "tray-state", view);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn connection_actions_are_exclusive_and_stale_intents_are_rejected() {
        for (state, expected, disabled) in [
            ("idle", "connect", false),
            ("error", "connect", false),
            ("connected", "disconnect", false),
            ("connecting", "disconnect", false),
            ("authenticating", "disconnect", false),
            ("reconnecting", "disconnect", false),
            ("stopping", "none", true),
        ] {
            let snapshot = Snapshot {
                state: state.into(),
                ..Snapshot::default()
            };
            let view = TraySnapshot::from(&snapshot);
            assert_eq!((view.action, view.disabled), (expected, disabled));
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
    fn popup_stays_in_work_area_on_bottom_top_and_negative_origin_monitors() {
        let (x, y) = popup_position(
            (1910.0, 1060.0),
            (0.0, 0.0, 1920.0, 1040.0),
            (288.0, 342.0),
            8.0,
        );
        assert!(x >= 8 && x + 288 <= 1912 && y >= 8 && y + 342 <= 1032);
        let (_, y) = popup_position(
            (1800.0, 12.0),
            (0.0, 24.0, 1920.0, 1056.0),
            (288.0, 342.0),
            8.0,
        );
        assert!(y >= 24);
        let (x, y) = popup_position(
            (-5.0, 1000.0),
            (-1920.0, 0.0, 1920.0, 1040.0),
            (576.0, 684.0),
            16.0,
        );
        assert!(x >= -1904 && x + 576 <= -16 && y >= 16 && y + 684 <= 1024);
    }
}
