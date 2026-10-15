use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct ClientConfig {
    pub server: String,
    pub port: u16,
    pub ssl: bool,
    pub client_id: String,
    pub reconnect_seconds: u64,
    pub unlimited: bool,
    pub udp_port_range: String,
    pub read_idle_seconds: u64,
    pub heartbeat_seconds: u64,
    pub certificate_path: String,
}
impl Default for ClientConfig {
    fn default() -> Self {
        Self {
            server: String::new(),
            port: 9002,
            ssl: true,
            client_id: uuid::Uuid::new_v4().simple().to_string(),
            reconnect_seconds: 10,
            unlimited: false,
            udp_port_range: "10000-10500".into(),
            read_idle_seconds: 120,
            heartbeat_seconds: 20,
            certificate_path: String::new(),
        }
    }
}
#[derive(Clone, Default)]
pub struct Secrets {
    pub license: String,
    pub store_password: String,
}
pub fn validate(config: &ClientConfig, has_license: bool) -> BTreeMap<String, String> {
    let mut errors = BTreeMap::new();
    if config.server.trim().is_empty()
        || config.server.contains("://")
        || config
            .server
            .chars()
            .any(|c| c.is_whitespace() || c == '/' || c == '\\')
    {
        errors.insert("server".into(), "请填写域名或 IP，不包含协议和路径".into());
    }
    if config.port == 0 {
        errors.insert("port".into(), "端口应为 1–65535".into());
    }
    if !has_license {
        errors.insert("license".into(), "请填写 License".into());
    }
    if config.reconnect_seconds == 0 {
        errors.insert("reconnectSeconds".into(), "重连间隔至少为 1 秒".into());
    }
    if udp_range(&config.udp_port_range).is_none() {
        errors.insert(
            "udpPortRange".into(),
            "UDP 范围应包含至少两个有效端口".into(),
        );
    }
    errors
}
pub fn udp_range(value: &str) -> Option<(u16, u16)> {
    let (a, b) = value.split_once('-')?;
    let (a, b) = (a.parse().ok()?, b.parse().ok()?);
    if a > 0 && b > a {
        Some((a, b))
    } else {
        None
    }
}
pub fn license_hint(value: &str) -> String {
    if value.is_empty() {
        return "尚未设置".into();
    }
    if value.chars().count() <= 4 {
        return "••••".into();
    }
    let tail: String = value
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("•••• •••• •••• {tail}")
}
