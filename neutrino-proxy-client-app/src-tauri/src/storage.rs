use neutrino_client_core::config::{validate, ClientConfig, Secrets};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;

const SERVICE: &str = "fun.neutrino.proxy.desktop";
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stored {
    schema_version: u32,
    config: ClientConfig,
    credential_id: String,
}
#[derive(Serialize, Deserialize)]
struct Credential {
    license: String,
    store_password: String,
}
pub struct Store {
    pub config: ClientConfig,
    pub secrets: Secrets,
    pub error: Option<String>,
    path: PathBuf,
    credential_id: String,
}
impl Store {
    pub fn load(app: &tauri::AppHandle) -> Self {
        let dir = app.path().app_config_dir().expect("应用配置目录不可用");
        let path = dir.join("config.json");
        let mut result = Self {
            config: ClientConfig::default(),
            secrets: Secrets::default(),
            error: None,
            path,
            credential_id: String::new(),
        };
        if result.path.exists() {
            match std::fs::read(&result.path)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<Stored>(&bytes).ok())
            {
                Some(stored) if stored.schema_version == 1 => {
                    result.config = stored.config;
                    result.credential_id = stored.credential_id;
                    if !result.credential_id.is_empty() {
                        match keyring::Entry::new(SERVICE, &result.credential_id)
                            .and_then(|entry| entry.get_password())
                            .ok()
                            .and_then(|secret| serde_json::from_str::<Credential>(&secret).ok())
                        {
                            Some(secret) => {
                                result.secrets = Secrets {
                                    license: secret.license,
                                    store_password: secret.store_password,
                                }
                            }
                            None => {
                                result.error =
                                    Some("无法读取系统保存的凭证，请重新填写 License".into())
                            }
                        }
                    }
                }
                _ => result.error = Some("配置文件无法读取或版本不兼容，原文件已保留".into()),
            }
        }
        result
    }
    pub fn save(&mut self, config: ClientConfig, secrets: Secrets) -> Result<(), String> {
        let id = uuid::Uuid::new_v4().to_string();
        let entry =
            keyring::Entry::new(SERVICE, &id).map_err(|_| "系统安全存储不可用".to_owned())?;
        let credential = serde_json::to_string(&Credential {
            license: secrets.license.clone(),
            store_password: secrets.store_password.clone(),
        })
        .map_err(|_| "无法保存凭证".to_owned())?;
        entry
            .set_password(&credential)
            .map_err(|_| "无法写入系统安全存储，配置尚未保存".to_owned())?;
        let saved = (|| {
            std::fs::create_dir_all(self.path.parent().unwrap())
                .map_err(|_| "无法创建配置目录".to_owned())?;
            let value = Stored {
                schema_version: 1,
                config: config.clone(),
                credential_id: id.clone(),
            };
            let bytes =
                serde_json::to_vec_pretty(&value).map_err(|_| "无法序列化配置".to_owned())?;
            let temp = self.path.with_extension("json.tmp");
            use std::io::Write;
            let mut file =
                std::fs::File::create(&temp).map_err(|_| "无法写入配置文件".to_owned())?;
            file.write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(|_| "无法完成配置写入".to_owned())?;
            std::fs::rename(&temp, &self.path).map_err(|_| "无法替换配置文件".to_owned())?;
            Ok::<_, String>(())
        })();
        if let Err(error) = saved {
            let _ = entry.delete_credential();
            return Err(error);
        }
        if !self.credential_id.is_empty() {
            if let Ok(old) = keyring::Entry::new(SERVICE, &self.credential_id) {
                let _ = old.delete_credential();
            }
        }
        self.config = config;
        self.secrets = secrets;
        self.credential_id = id;
        self.error = None;
        Ok(())
    }
}
#[derive(Default)]
pub struct PendingImport(Mutex<Option<(String, ClientConfig, Secrets)>>);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    id: String,
    pub config: ClientConfig,
    has_license: bool,
    notes: Vec<String>,
    can_apply: bool,
}
pub fn preview_import(app: &tauri::AppHandle, path: &Path) -> Result<ImportPreview, String> {
    if std::fs::metadata(path)
        .map_err(|_| "无法读取配置文件".to_owned())?
        .len()
        > 1024 * 1024
    {
        return Err("配置文件不能超过 1 MiB".into());
    }
    let bytes = std::fs::read(path).map_err(|_| "无法读取配置文件".to_owned())?;
    let yaml: serde_json::Value =
        serde_yaml::from_slice(&bytes).map_err(|_| "YAML 配置格式无效".to_owned())?;
    let t = &yaml["neutrino"]["proxy"]["tunnel"];
    let p = &yaml["neutrino"]["proxy"]["protocol"];
    let u = &yaml["neutrino"]["proxy"]["client"]["udp"];
    if t.is_null() {
        return Err("没有找到 neutrino.proxy.tunnel 配置".into());
    }
    let mut notes = vec![];
    let mut config = ClientConfig::default();
    let value = |key: &str| resolve(&t[key]);
    config.server = value("server-ip").unwrap_or_default();
    config.port = value("server-port")
        .and_then(|s| s.parse().ok())
        .unwrap_or(9002);
    config.ssl = value("ssl-enable")
        .and_then(|s| s.parse().ok())
        .unwrap_or(true);
    let secrets = Secrets {
        license: value("license-key").unwrap_or_default(),
        store_password: value("key-store-password").unwrap_or_default(),
    };
    if let Some(id) = value("client-id").filter(|s| !s.is_empty()) {
        config.client_id = id;
    }
    if let Some(cert) = value("jks-path").filter(|s| !s.starts_with("classpath:") && !s.is_empty())
    {
        config.certificate_path = if Path::new(&cert).is_absolute() {
            PathBuf::from(cert)
        } else {
            path.parent().unwrap().join(cert)
        }
        .to_string_lossy()
        .into_owned();
    }
    config.reconnect_seconds = t["reconnection"]["interval-seconds"].as_u64().unwrap_or(10);
    config.unlimited = t["reconnection"]["unlimited"].as_bool().unwrap_or(false);
    config.udp_port_range =
        resolve(&u["puppet-port-range"]).unwrap_or_else(|| "10000-10500".into());
    config.read_idle_seconds = p["read-idle-time"].as_u64().unwrap_or(120);
    config.heartbeat_seconds = p["write-idle-time"].as_u64().unwrap_or(20);
    let mut can_apply = true;
    for (key, expected) in [
        ("max-frame-length", 2097152),
        ("length-field-offset", 0),
        ("length-field-length", 4),
        ("initial-bytes-to-strip", 0),
        ("length-adjustment", 0),
    ] {
        if p[key].as_i64().is_some_and(|v| v != expected) {
            notes.push(format!("当前阶段尚未支持自定义 {key}，请保留原客户端使用"));
            can_apply = false;
        }
    }
    if p["water-mark"].as_str().is_some_and(|v| !v.is_empty())
        || p["all-idle-time-seconds"].as_i64().is_some_and(|v| v != 0)
    {
        notes.push("当前阶段尚未支持自定义水位线或全空闲超时，不能无损导入这组参数".into());
        can_apply = false;
    }
    notes.extend(
        validate(&config, !secrets.license.is_empty())
            .values()
            .cloned(),
    );
    if !notes.is_empty() {
        can_apply = false;
    }
    notes.push("导入仅在确认后写入，原 YAML 和身份文件不会修改".into());
    notes.push("Netty 线程与 Solon 日志参数不直接执行，Rust 使用独立调度与脱敏日志".into());
    let id = uuid::Uuid::new_v4().to_string();
    let preview = ImportPreview {
        id: id.clone(),
        config: config.clone(),
        has_license: !secrets.license.is_empty(),
        notes,
        can_apply,
    };
    *app.state::<PendingImport>().0.lock().unwrap() = if can_apply {
        Some((id, config, secrets))
    } else {
        None
    };
    Ok(preview)
}
pub fn take_import(app: &tauri::AppHandle, id: &str) -> Result<(ClientConfig, Secrets), String> {
    let pending = app.state::<PendingImport>();
    let mut pending = pending.0.lock().unwrap();
    if pending.as_ref().is_some_and(|(key, _, _)| key == id) {
        let (_, config, secrets) = pending.take().unwrap();
        Ok((config, secrets))
    } else {
        Err("导入预览已失效，请重新选择文件".into())
    }
}
fn resolve(value: &serde_json::Value) -> Option<String> {
    let raw = if let Some(s) = value.as_str() {
        s.to_owned()
    } else if value.is_boolean() || value.is_number() {
        value.to_string()
    } else {
        return None;
    };
    if raw.starts_with("${") && raw.ends_with('}') {
        let inside = &raw[2..raw.len() - 1];
        let (name, fallback) = inside.split_once(':').unwrap_or((inside, ""));
        std::env::var(name).ok().or_else(|| Some(fallback.into()))
    } else {
        Some(raw)
    }
}
