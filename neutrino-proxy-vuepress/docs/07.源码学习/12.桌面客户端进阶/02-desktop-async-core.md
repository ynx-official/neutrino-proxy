---
title: "12.02 Netty 到 Tokio 的异步内核映射"
date: 2026-10-30
permalink: /learn/desktop-async-core/
article: false
status: Review
updated: 2026-10-30
lesson: "12.02"
track: desktop
sourceBaseline: eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c
sourceReferences:
  - repository: desktop
    path: "crates/client-core/src/engine.rs"
    url: "https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/crates/client-core/src/engine.rs"
  - repository: desktop
    path: "crates/client-core/src/channel.rs"
    url: "https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/crates/client-core/src/channel.rs"
sourceExcerpts:
  - repository: desktop
    path: "crates/client-core/src/channel.rs"
    commit: eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c
    startLine: 45
    endLine: 49
  - repository: desktop
    path: "crates/client-core/src/engine.rs"
    commit: eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c
    startLine: 239
    endLine: 245
  - repository: desktop
    path: "crates/client-core/src/engine.rs"
    commit: eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c
    startLine: 192
    endLine: 198
---

# 12.02 Netty 到 Tokio 的异步内核映射

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[Java 客户端状态机](/learn/client-state-machine/)

Netty 把事件送进 Handler，Tokio 常把等待写进 async 任务。表达方式变了，老问题却还在：谁暂停读取、谁拥有连接、取消发生在写了一半的时候怎么办？我们选一条写队列来比较。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

select! 取消一个等待中的 Future，为什么要保留写入偏移？如何确保会话结束后，子业务任务也真正收尾？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

本篇选修使用独立桌面仓库提交 `eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c`，不把桌面源码迁回 Java 仓库。本站构建只校验已核对的离线节选，不要求检出相邻桌面目录。

| 文件 | 阅读入口 |
| --- | --- |
| [engine.rs](https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/crates/client-core/src/engine.rs) | 独立仓库固定提交的完整上下文 |
| [channel.rs](https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/crates/client-core/src/channel.rs) | 独立仓库固定提交的完整上下文 |

<span id="正文提纲"></span>

## 一起顺着代码走

### 一边等读，一边也要继续写

tcp_transfer 的循环用 select! 同时处理隧道帧、目标读取、写队列与空闲事件，并通过 writable 条件控制上游分支是否继续读取。这对应 Java 中的 isWritable 与 AUTO_READ，只是反馈机制变成任务轮询条件。

Outbound 的 queue 保存每个消息的 bytes 和 offset：

看这段 [channel.rs](https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/crates/client-core/src/channel.rs#L45-L49)（桌面仓库原文件 45～49 行，连续原样节选）：

```rust
    /// Cancellation safe: offsets stay in the queue across select! polling.
    /// Count a whole message until flush completes, just as Netty's outbound buffer does.
    pub async fn flush_one(&mut self) -> io::Result<()> {
        let Some((bytes, offset)) = self.queue.front_mut() else {
            return Ok(());
```

write 可能只写出一部分，offset 立即留在队列里。若这次 flush Future 被 select! 另一分支取消，下次继续从 offset 写；若把进度只留在会被丢弃的临时 Future 里，就可能重复写已发送字节。

计数到整个消息 flush 完成才扣除，低于低水位再恢复 writable。它与 Netty 水位的行为方向对齐，但队列字节与 Netty 内部消息估算开销并不是严格相同的内存数值。

### 取消信号还不等于任务已退出

看这段 [engine.rs](https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/crates/client-core/src/engine.rs#L239-L245)（桌面仓库原文件 239～245 行，连续原样节选）：

```rust
            let session_cancel = cancel.child_token();
            let tracker = TaskTracker::new();
            let result = tokio::select! {_ = cancel.cancelled()=>None,result=self.run_session(&config,&secrets,tls.clone(),session_cancel.clone(),tracker.clone(), &mut connected_once)=>Some(result)};
            session_cancel.cancel();
            tracker.close();
            tracker.wait().await;
            let Some(result) = result else { break };
```

外层会话创建 child token 和 TaskTracker，run_session 结束或被取消后，通知子任务取消，关闭 tracker 并等待。这样把“我发出了停止要求”和“相关任务都退出了”分成明确步骤。

单个业务又有 visitor 对应的取消 token，控制 DISCONNECT 可以只取消相应转发。把一个业务出错直接上升为取消整个 Engine，会扩大影响范围；资源归属仍然和 Java 课里一样重要。

### 用户断开要等当前任务交还资源

看这段 [engine.rs](https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/crates/client-core/src/engine.rs#L192-L198)（桌面仓库原文件 192～198 行，连续原样节选）：

```rust
    pub async fn disconnect(&self) {
        let mut running = self.0.running.lock().await;
        self.0.startup_consumed.store(true, Ordering::Relaxed);
        self.status("stopping", "正在断开连接");
        if let Some(previous) = running.take() {
            previous.cancel.cancel();
            let _ = previous.task.await;
```

disconnect 获取 running 锁，消费启动自动连接机会，设 stopping，取消并等待旧任务，随后才整理 idle 状态。异步锁等待期间要审查是否会和持锁任务互相依赖；不能因为用了 Rust 就跳过死锁思考。

正常结束还会 finish 队列尾部，但取消 token 可以中止卡住的排空等待。这体现了两个目标的取舍：尽可能发完已排队数据，又不能让用户断开无限等待。

### 和 Java 对照时，按责任映射

| Java 入口 | Rust 阅读位置 | 同一件事 |
| --- | --- | --- |
| channelRead0 | reader.next / local_read.read | 收取输入 |
| isWritable + AUTO_READ | Outbound.writable + 分支条件 | 限制来源读取 |
| channelInactive | token、任务退出、资源释放 | 结束会话 |
| Future listener | await / select! 分支 | 处理异步完成 |

这张表用于理解，不表示两个实现的调度、错误处理和所有时序完全一样。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：在独立仓库运行 cargo test --locked -p neutrino-client-core --lib channel::tests。重点看 1 字节容量 duplex 触发部分写入，timeout 取消后再次 flush，最终仍只有 [1,2,3,4,5,6]。再手工推演用户停止发生在队列半写时的资源去向。

**验收范围**：慢写单测应同时证明字节不重复、高低水位恢复和尾部完成；它不能代替真实公网慢链路或72小时稳定性实验。本轮该测试的实际结果在课程进度中记录，完整客户端停止矩阵尚未重新执行。

<span id="完善清单"></span>

## 合上代码前想一想

为什么 write_all 看似方便，也仍需考虑取消时进度由谁保存？为什么 cancel 后还要 wait？下一篇 [宿主与界面](/learn/desktop-host-ui/) 让这些状态成为用户看得懂的反馈。
