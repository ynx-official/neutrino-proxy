use crate::{
    config::{license_hint, validate, ClientConfig, Secrets},
    protocol::{Codec, Frame},
    transport,
};
use chrono::{DateTime, Utc};
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    sync::{mpsc, watch, Mutex as AsyncMutex},
    task::{JoinHandle, JoinSet},
    time::{timeout, Duration},
};
use tokio_util::{codec::Framed, sync::CancellationToken, task::TaskTracker};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: u64,
    pub time: DateTime<Utc>,
    pub level: String,
    pub source: String,
    pub message: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub config: ClientConfig,
    pub state: String,
    pub detail: String,
    pub revision: u64,
    pub logs: Vec<LogEntry>,
    pub has_license: bool,
    pub license_hint: String,
    pub connected_at: Option<DateTime<Utc>>,
    pub retry_at: Option<DateTime<Utc>>,
    pub active_config: Option<ClientConfig>,
    pub pending_config: bool,
    pub version: String,
}
impl Default for Snapshot {
    fn default() -> Self {
        Self {
            config: ClientConfig::default(),
            state: "idle".into(),
            detail: "填写连接信息，开始第一次连接".into(),
            revision: 0,
            logs: vec![],
            has_license: false,
            license_hint: "尚未设置".into(),
            connected_at: None,
            retry_at: None,
            active_config: None,
            pending_config: false,
            version: env!("CARGO_PKG_VERSION").into(),
        }
    }
}
struct Running {
    cancel: CancellationToken,
    task: JoinHandle<()>,
}
struct Inner {
    snapshot: Mutex<Snapshot>,
    events: watch::Sender<Snapshot>,
    running: AsyncMutex<Option<Running>>,
}
#[derive(Clone)]
pub struct Engine(Arc<Inner>);
impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}
impl Engine {
    pub fn new() -> Self {
        let snapshot = Snapshot::default();
        let (events, _) = watch::channel(snapshot.clone());
        Self(Arc::new(Inner {
            snapshot: Mutex::new(snapshot),
            events,
            running: AsyncMutex::new(None),
        }))
    }
    pub fn snapshot(&self) -> Snapshot {
        self.0.snapshot.lock().unwrap().clone()
    }
    pub fn subscribe(&self) -> watch::Receiver<Snapshot> {
        self.0.events.subscribe()
    }
    fn change(&self, update: impl FnOnce(&mut Snapshot)) {
        let mut state = self.0.snapshot.lock().unwrap();
        update(&mut state);
        state.revision += 1;
        self.0.events.send_replace(state.clone());
    }
    pub fn configure(&self, config: ClientConfig, secrets: &Secrets) {
        self.change(|s| {
            s.pending_config = s
                .active_config
                .as_ref()
                .is_some_and(|active| active != &config);
            s.config = config;
            s.has_license = !secrets.license.is_empty();
            s.license_hint = license_hint(&secrets.license);
            if s.state == "idle" && s.has_license && !s.config.server.is_empty() {
                s.detail = "连接配置已就绪，可随时建立连接".into();
            }
        });
    }
    pub fn log(&self, level: &str, source: &str, message: &str) {
        self.change(|s| {
            let id = s.revision + 1;
            s.logs.push(LogEntry {
                id,
                time: Utc::now(),
                level: level.into(),
                source: source.into(),
                message: message.chars().take(512).collect(),
            });
            if s.logs.len() > 500 {
                s.logs.remove(0);
            }
        });
    }
    fn status(&self, state: &str, detail: &str) {
        self.change(|s| {
            s.state = state.into();
            s.detail = detail.into();
            if state != "connected" {
                s.connected_at = None;
            }
            s.retry_at = None;
        });
    }
    pub async fn connect(&self, config: ClientConfig, secrets: Secrets) -> Result<(), String> {
        let errors = validate(&config, !secrets.license.is_empty());
        if !errors.is_empty() {
            return Err(errors.values().cloned().collect::<Vec<_>>().join("；"));
        }
        let mut running = self.0.running.lock().await;
        if let Some(previous) = running.take() {
            previous.cancel.cancel();
            let _ = previous.task.await;
        }
        self.configure(config.clone(), &secrets);
        self.status("connecting", "正在连接服务器");
        let cancel = CancellationToken::new();
        let token = cancel.clone();
        let engine = self.clone();
        let task = tokio::spawn(async move {
            engine.supervise(config, secrets, token).await;
        });
        *running = Some(Running { cancel, task });
        Ok(())
    }
    pub async fn disconnect(&self) {
        let mut running = self.0.running.lock().await;
        self.status("stopping", "正在断开连接");
        if let Some(previous) = running.take() {
            previous.cancel.cancel();
            let _ = previous.task.await;
        }
        self.change(|s| {
            s.state = "idle".into();
            s.detail = "连接已断开，可随时重新连接".into();
            s.connected_at = None;
            s.retry_at = None;
            s.active_config = None;
            s.pending_config = false;
        });
        self.log("info", "连接", "连接已断开");
    }
    async fn supervise(&self, config: ClientConfig, secrets: Secrets, cancel: CancellationToken) {
        let tls = if config.ssl {
            let c = config.clone();
            let secret = secrets.clone();
            let roots =
                tokio::task::spawn_blocking(move || transport::trust_roots(&c, &secret)).await;
            match roots {
                Ok(Ok(roots)) => Some(Arc::new(
                    rustls::ClientConfig::builder()
                        .with_root_certificates(roots)
                        .with_no_client_auth(),
                )),
                _ => {
                    self.status("error", "无法读取信任证书，请检查证书文件和证书库密码");
                    self.log("error", "SSL", "信任证书加载失败");
                    return;
                }
            }
        } else {
            None
        };
        loop {
            if cancel.is_cancelled() {
                break;
            }
            self.status("connecting", "正在连接服务器");
            let session_cancel = cancel.child_token();
            let tracker = TaskTracker::new();
            let result = tokio::select! {_ = cancel.cancelled()=>None,result=self.run_session(&config,&secrets,tls.clone(),session_cancel.clone(),tracker.clone())=>Some(result)};
            session_cancel.cancel();
            tracker.close();
            tracker.wait().await;
            let Some(result) = result else { break };
            if cancel.is_cancelled() {
                break;
            }
            let (message, retry) = match result {
                Ok(()) => ("连接已中断".to_owned(), true),
                Err((msg, auth)) => (msg, !auth || config.unlimited),
            };
            self.log("error", "连接", &message);
            if !retry {
                self.status("error", &message);
                break;
            }
            self.change(|s| {
                s.state = "reconnecting".into();
                s.detail = message;
                s.connected_at = None;
                s.retry_at =
                    Some(Utc::now() + chrono::Duration::seconds(config.reconnect_seconds as i64));
            });
            tokio::select! {_ = cancel.cancelled()=>break,_=tokio::time::sleep(Duration::from_secs(config.reconnect_seconds))=>{}}
        }
    }
    async fn run_session(
        &self,
        config: &ClientConfig,
        secrets: &Secrets,
        tls: Option<Arc<rustls::ClientConfig>>,
        cancel: CancellationToken,
        tracker: TaskTracker,
    ) -> Result<(), (String, bool)> {
        let stream = transport::open(config, tls.clone())
            .await
            .map_err(|e| (e, false))?;
        let mut wire = Framed::new(stream, Codec);
        self.status("authenticating", "正在验证 License");
        wire.send(Frame::new(
            2,
            format!("{},{}", secrets.license, config.client_id),
            vec![],
        ))
        .await
        .map_err(|_| ("发送认证请求失败".into(), false))?;
        let auth = timeout(Duration::from_secs(15), async {
            loop {
                match wire.next().await {
                    Some(Ok(frame)) if frame.kind == 2 => return Ok(frame),
                    Some(Ok(_)) => {}
                    _ => return Err(()),
                }
            }
        })
        .await
        .map_err(|_| ("License 验证超时".into(), false))?
        .map_err(|_| ("认证连接已中断".into(), false))?;
        let result: serde_json::Value =
            serde_json::from_str(&auth.info).map_err(|_| ("认证结果格式无效".into(), false))?;
        let code = result["code"].as_i64().unwrap_or(-1);
        if code != 0 {
            return Err((
                if code == 1 {
                    "License 验证失败，请检查后重试".into()
                } else {
                    "服务器拒绝连接，请检查 License 使用状态".into()
                },
                code == 1,
            ));
        }
        self.change(|s| {
            s.state = "connected".into();
            s.detail = "服务器认证通过，连接正在运行".into();
            s.connected_at = Some(Utc::now());
            s.retry_at = None;
            s.active_config = Some(config.clone());
            s.pending_config = s.config != *config;
        });
        self.log("info", "认证", "License 验证通过");
        self.log("info", "连接", "连接已建立，开始后台运行");
        let (control_tx, mut control_rx) = mpsc::channel::<Frame>(64);
        let mut workers: JoinSet<(String, Result<(), String>)> = JoinSet::new();
        let mut bindings: HashMap<String, CancellationToken> = HashMap::new();
        let udp_pool = crate::udp::Pool::new(config);
        let mut heartbeat =
            tokio::time::interval(Duration::from_secs(config.heartbeat_seconds.max(1)));
        heartbeat.tick().await;
        let mut read_deadline = Box::pin(tokio::time::sleep(Duration::from_secs(
            config.read_idle_seconds.max(1),
        )));
        loop {
            tokio::select! {
                _=cancel.cancelled()=>break,
                _=&mut read_deadline,if config.read_idle_seconds>0=>return Err(("服务器响应超时".into(),false)),
                _=heartbeat.tick(),if config.heartbeat_seconds>0=>{wire.send(Frame::new(1,"",vec![])).await.map_err(|_|("心跳发送失败".into(),false))?;},
                Some(frame)=control_rx.recv()=>{wire.send(frame).await.map_err(|_|("控制通道写入失败".into(),false))?;},
                Some(result)=workers.join_next(),if !workers.is_empty()=>{if let Ok((visitor,result))=result{bindings.remove(&visitor);if let Err(message)=result{self.log("warn","转发",&message);}}},
                frame=wire.next()=>{
                    let frame=match frame{Some(Ok(frame))=>frame,Some(Err(_))=>return Err(("隧道消息格式无效".into(),false)),None=>return Ok(())};
                    read_deadline.as_mut().reset(tokio::time::Instant::now()+Duration::from_secs(config.read_idle_seconds.max(1)));
                    match frame.kind{
                        3=>{
                            let visitor=frame.info.clone();
                            if bindings.contains_key(&visitor)||bindings.len()>=1024{let _=wire.send(Frame::new(4,visitor,vec![])).await;continue}
                            let target=String::from_utf8(frame.data).map_err(|_|("目标地址格式无效".into(),false))?;
                            let token=cancel.child_token();bindings.insert(visitor.clone(),token.clone());
                            let cfg=config.clone();let license=secrets.license.clone();let tls=tls.clone();let tx=control_tx.clone();
                            workers.spawn(tracker.track_future(async move{let result=tokio::select!{_=token.cancelled()=>Ok(()),r=tcp_transfer(&cfg,&license,&visitor,&target,tls)=>r};let _=tx.send(Frame::new(4,visitor.clone(),vec![])).await;(visitor,result)}));
                        },
                        4=>{if let Some(token)=bindings.get(&frame.info){token.cancel();}},
                        6=>{let error:serde_json::Value=serde_json::from_str(&frame.info).unwrap_or_default();if error["code"]==1{return Err(("License 验证失败，请检查后重试".into(),true))}},
                        8=>{
                            let meta:crate::udp::Metadata=match serde_json::from_str(&frame.info){Ok(meta)=>meta,Err(_)=>{self.log("warn","UDP","UDP 元数据格式无效");continue}};
                            let visitor=format!("udp:{}",meta.visitor_id);
                            if bindings.contains_key(&visitor)||bindings.len()>=1024{continue}
                            let token=cancel.child_token();bindings.insert(visitor.clone(),token.clone());
                            let cfg=config.clone();let license=secrets.license.clone();let tls=tls.clone();let pool=udp_pool.clone();let engine=self.clone();
                            workers.spawn(tracker.track_future(async move{let result=tokio::select!{_=token.cancelled()=>Ok(()),r=crate::udp::transfer(cfg,license,meta,tls,pool,engine)=>r};(visitor,result)}));
                        },
                        _=>{}
                    }
                }
            }
        }
        cancel.cancel();
        while workers.join_next().await.is_some() {}
        Ok(())
    }
}
async fn tcp_transfer(
    config: &ClientConfig,
    license: &str,
    visitor: &str,
    target: &str,
    tls: Option<Arc<rustls::ClientConfig>>,
) -> Result<(), String> {
    let local = timeout(Duration::from_secs(10), TcpStream::connect(target))
        .await
        .map_err(|_| "连接本地目标超时".to_owned())?
        .map_err(|_| "无法连接本地目标服务".to_owned())?;
    local.set_nodelay(true).ok();
    let tunnel = transport::open(config, tls).await?;
    let mut wire = Framed::new(tunnel, Codec);
    wire.send(Frame::new(3, format!("{visitor}@{license}"), vec![]))
        .await
        .map_err(|_| "绑定数据隧道失败".to_owned())?;
    let (mut local_read, mut local_write) = local.into_split();
    let (mut tunnel_write, mut tunnel_read) = wire.split();
    // Independent pumps keep a slow direction from blocking progress in the other direction.
    let upload = async {
        let mut buffer = vec![0u8; 32 * 1024];
        let mut heartbeat =
            tokio::time::interval(Duration::from_secs(config.heartbeat_seconds.max(1)));
        heartbeat.tick().await;
        loop {
            tokio::select! {
                read=local_read.read(&mut buffer)=>{let n=read.map_err(|_|"读取本地目标失败".to_owned())?;if n==0{return Ok::<(),String>(())}tunnel_write.send(Frame::new(5,visitor,buffer[..n].to_vec())).await.map_err(|_|"数据隧道写入失败".to_owned())?;},
                _=heartbeat.tick(),if config.heartbeat_seconds>0=>{tunnel_write.send(Frame::new(1,"",vec![])).await.map_err(|_|"数据隧道心跳失败".to_owned())?;}
            }
        }
    };
    let download = async {
        while let Some(frame) = tunnel_read.next().await {
            match frame {
                Ok(frame) if frame.kind == 5 => local_write
                    .write_all(&frame.data)
                    .await
                    .map_err(|_| "写入本地目标失败".to_owned())?,
                Ok(frame) if frame.kind == 4 => break,
                Ok(_) => {}
                Err(_) => return Err("数据隧道消息格式无效".into()),
            }
        }
        Ok::<(), String>(())
    };
    tokio::select! {result=upload=>result,result=download=>result}
}
