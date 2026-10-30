---
title: "12.03 通信内核 Tauri 与 Vue 的职责边界"
date: 2026-10-30
permalink: /learn/desktop-host-ui/
article: false
status: Review
updated: 2026-10-30
lesson: "12.03"
track: desktop
sourceBaseline: eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c
sourceReferences:
  - repository: desktop
    path: "src-tauri/src/main.rs"
    url: "https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/src-tauri/src/main.rs"
  - repository: desktop
    path: "crates/client-core/src/engine.rs"
    url: "https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/crates/client-core/src/engine.rs"
  - repository: desktop
    path: "src/services/desktop.js"
    url: "https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/src/services/desktop.js"
sourceExcerpts:
  - repository: desktop
    path: "src/services/desktop.js"
    commit: eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c
    startLine: 9
    endLine: 18
  - repository: desktop
    path: "src-tauri/src/main.rs"
    commit: eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c
    startLine: 76
    endLine: 82
  - repository: desktop
    path: "src-tauri/src/main.rs"
    commit: eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c
    startLine: 303
    endLine: 312
  - repository: desktop
    path: "src-tauri/src/main.rs"
    commit: eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c
    startLine: 116
    endLine: 123
---

# 12.03 通信内核 Tauri 与 Vue 的职责边界

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[Java 客户端状态机](/learn/client-state-machine/)

桌面客户端不是把所有通信代码塞进 Vue，也不是让 Tauri 命令直接做完每个网络循环。现有项目分成通信内核、系统宿主和界面三层，连接按钮只是这条链的最前端。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

点连接后，命令怎么到 Engine，状态又怎么回来？关窗口、收起到托盘和退出应用为什么要分别设计？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

本篇选修使用独立桌面仓库提交 `eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c`，不把桌面源码迁回 Java 仓库。本站构建只校验已核对的离线节选，不要求检出相邻桌面目录。

| 文件 | 阅读入口 |
| --- | --- |
| [main.rs](https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/src-tauri/src/main.rs) | 独立仓库固定提交的完整上下文 |
| [engine.rs](https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/crates/client-core/src/engine.rs) | 独立仓库固定提交的完整上下文 |
| [desktop.js](https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/src/services/desktop.js) | 独立仓库固定提交的完整上下文 |

<span id="正文提纲"></span>

## 一起顺着代码走

### 命令与状态走两条路

看这段 [desktop.js](https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/src/services/desktop.js#L9-L18)（桌面仓库原文件 9～18 行，连续原样节选）：

```javascript
export async function call(command, args = {}) {
  if (testBridge()) return testBridge().invoke(command, args);
  if (!isTauri())
    throw new Error("请从桌面程序打开，浏览器预览不提供后台连接。");
  return invoke(command, args);
}
export async function subscribe(callback, eventName = "client-state") {
  if (testBridge()) return testBridge().subscribe(callback, eventName);
  if (!isTauri()) return () => {};
  return listen(eventName, (event) => callback(event.payload));
```

Vue 通过 call 调用 Tauri invoke，通过 subscribe 监听 client-state。浏览器预览没有原生宿主，正式路径会提示不可后台连接；开发测试桥不等于真实通信成功。

一次连接调用链是：页面动作 → call("connect") → Tauri connect_command → Engine.connect → Tokio 会话任务。命令返回说明宿主接收并处理了动作，后续连接/认证状态仍通过快照事件更新。

### 宿主组织动作，内核负责网络

看这段 [main.rs](https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/src-tauri/src/main.rs#L76-L82)（桌面仓库原文件 76～82 行，连续原样节选）：

```rust
async fn connect(state: tauri::State<'_, AppState>) -> Result<(), String> {
    connect_command(&state).await
}
#[tauri::command]
async fn disconnect(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.engine.disconnect().await;
    Ok(())
```

这里连接与断开只是薄入口。main.rs 还负责系统文件选择、设置、凭证、窗口和托盘。client-core 不需要引用 Vue 组件，Vue 也不直接建立 Rust 侧代理 socket。

保存配置与立即重连同样分开：save_config 先保存、configure，再按 request.connect 决定是否连接。Engine 快照有 active_config 与 pending_config，用于表达“已保存配置”和“当前正在使用的配置”可能不同。

### 快照向窗口和托盘分发

看这段 [main.rs](https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/src-tauri/src/main.rs#L303-L312)（桌面仓库原文件 303～312 行，连续原样节选）：

```rust
            let mut changes = engine.subscribe();
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    let snapshot = changes.borrow_and_update().clone();
                    tray::update(&handle, &snapshot);
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.emit_to("main", "client-state", snapshot);
                    }
                    if changes.changed().await.is_err() {
```

Engine 用 watch 保存最新快照，宿主更新原生托盘，主窗口存在时再 emit。窗口不在并不意味着内核任务必须消失；恢复窗口后可以重新取快照。

Vue App.vue 按 revision 比较，只接受不早于当前版本的状态，降低迟到消息覆盖新状态的风险。watch 适合最新状态观察，不是保证每个中间事件都逐项送达的审计日志；详细日志另有记录。

### 关窗口和退出，资源边界不同

看这段 [main.rs](https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/src-tauri/src/main.rs#L116-L123)（桌面仓库原文件 116～123 行，连续原样节选）：

```rust
fn close_to_tray(window: tauri::WebviewWindow) -> Result<(), String> {
    window.destroy().map_err(|e| e.to_string())
}
#[tauri::command]
async fn quit_app(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.quitting.store(true, Ordering::SeqCst);
    state.engine.disconnect().await;
    app.exit(0);
```

close_to_tray 销毁 Webview 窗口；quit_app 先标记退出、断开 Engine，再 app.exit。前者保留后台宿主与托盘的生命周期，后者结束进程。

启动自动连接也只在进程 setup 中消费一次，恢复托盘窗口不会重新触发；初始失败停止、成功认证后才延续断线重连，这是桌面仓库明确的行为选择，不能直接拿 Java 定时器策略替代。

这篇重点是职责设计，沿用现有桌面 UI，不修改主题、托盘或产品交互。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：先在独立仓库从 App.vue 的 connect 动作追到 connect_command，再到 Engine；画出命令返回与状态事件两条时间线。原生程序中分别测试关窗口、托盘恢复和退出，确认恢复不多建连接。浏览器桥只用于检查页面反馈。

**怎么验收**：连接状态来自内核事件，窗口关闭后任务行为符合现有规则，退出后资源结束。本文宿主与 Vue 调用链已核对；本轮未重新启动原生窗口/托盘，也未执行 macOS 交互，不能把协议单测替代它们。

<span id="完善清单"></span>

## 合上代码前想一想

为什么窗口不在，Engine 仍可能在运行？为什么命令成功与认证成功应该分开提示？最后看 [配置和凭证](/learn/desktop-storage/)，决定哪些内容适合进入快照。
