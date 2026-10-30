---
title: "12.01 Java 与 Rust 的协议兼容"
date: 2026-10-30
permalink: /learn/desktop-protocol/
article: false
status: Review
updated: 2026-10-30
lesson: "12.01"
track: desktop
sourceBaseline: eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c
sourceReferences:
  - repository: desktop
    path: "crates/client-core/src/protocol.rs"
    url: "https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/crates/client-core/src/protocol.rs"
  - repository: desktop
    path: "docs/03-architecture/client-app-java-compatibility.md"
    url: "https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/docs/03-architecture/client-app-java-compatibility.md"
  - repository: desktop
    path: "crates/client-core/tests/protocol.rs"
    url: "https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/crates/client-core/tests/protocol.rs"
sourceExcerpts:
  - repository: desktop
    path: "crates/client-core/src/protocol.rs"
    commit: eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c
    startLine: 61
    endLine: 76
  - repository: desktop
    path: "crates/client-core/src/protocol.rs"
    commit: eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c
    startLine: 122
    endLine: 125
  - repository: desktop
    path: "crates/client-core/tests/protocol.rs"
    commit: eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c
    startLine: 9
    endLine: 24
---

# 12.01 Java 与 Rust 的协议兼容

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[Java 客户端状态机](/learn/client-state-machine/)

Java 主线走完后，再看 Rust 就不必从语法开始重学一遍代理。先拿同一帧字节对照：字段顺序、长度和消息方向一致，两个实现才能合作；至于对象、内存管理和错误表达，可以各用各的长处。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

Rust String.len 为什么能参与字节长度计算？两端流水号默认值不同，协议一定不兼容吗？畸形帧也要复刻 Java 的资源问题吗？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

本篇选修使用独立桌面仓库提交 `eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c`，不把桌面源码迁回 Java 仓库。本站构建只校验已核对的离线节选，不要求检出相邻桌面目录。

| 文件 | 阅读入口 |
| --- | --- |
| [protocol.rs](https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/crates/client-core/src/protocol.rs) | 独立仓库固定提交的完整上下文 |
| [client-app-java-compatibility.md](https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/docs/03-architecture/client-app-java-compatibility.md) | 独立仓库固定提交的完整上下文 |
| [protocol.rs](https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/crates/client-core/tests/protocol.rs) | 独立仓库固定提交的完整上下文 |

<span id="正文提纲"></span>

## 一起顺着代码走

### 先对照线格式，再比较语言

看这段 [protocol.rs](https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/crates/client-core/src/protocol.rs#L61-L76)（桌面仓库原文件 61～76 行，连续原样节选）：

```rust
    fn encode(&mut self, item: Frame, dst: &mut BytesMut) -> io::Result<()> {
        let len = 13usize
            .checked_add(item.info.len())
            .and_then(|n| n.checked_add(item.data.len()))
            .ok_or_else(invalid)?;
        // ProxyMessageEncoder has a signed 32-bit body length, independent of decoder limits.
        if len > i32::MAX as usize {
            return Err(invalid());
        }
        dst.reserve(len + 4);
        dst.put_u32(len as u32);
        dst.put_u8(item.kind);
        dst.put_i64(item.serial);
        dst.put_u32(item.info.len() as u32);
        dst.extend_from_slice(item.info.as_bytes());
        dst.extend_from_slice(&item.data);
```

固定 body 长度仍从 13 开始，随后写 4 字节长度、1 字节类型、8 字节序号、infoLength、info 和 data。与 [Java Encoder](/learn/protocol-encoder/) 的顺序一致。

Rust String 的 len 是 UTF-8 字节长度；Java String.length 是 UTF-16 代码单元数，所以 Java 代码先 getBytes 再计算。两端兼容时，需要确认 Java 使用的实际字符集。本课程 JVM 实验固定 UTF-8，不能因为 Rust 明确 UTF-8，就替 Java 原码补一个不存在的字符集参数。

Rust 使用 checked_add 和 i32 最大长度检查，是对自身实现的边界约束；正常线格式兼容，不要求把 Java 可能的整数溢出风险一起复制。

### 对象默认值不同，不一定影响字段可读性

Rust Frame::new 默认把时间戳放 serial，Java 常用构造方法未设置时是 0。两者都编码到相同的 8 字节字段，Decoder 可以理解；若上层依赖精确序号语义，还需另外约定和测试。

比较测试向量时，明确指定 serial 才能逐字节相等。不要拿各自默认构造的一帧直接比字节，再把时间戳差异误报成字节序错误。

### 兼容不是复制所有缺陷

看这段 [protocol.rs](https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/crates/client-core/src/protocol.rs#L122-L125)（桌面仓库原文件 122～125 行，连续原样节选）：

```rust
        // ProxyMessageDecoder parses the normal 4-byte header AFTER Netty's stripping.
        // Malformed combinations close the channel rather than copying Java's buffer leaks.
        if bytes.len() < 17 {
            return Err(invalid());
```

Rust 在剥离封装后检查固定长度和内部字段，返回 InvalidData。Java 的畸形 infoLength 资源观察已在 [边界实验](/learn/protocol-boundary-tests/) 保留；Rust 不需要复刻缓冲区泄漏来满足兼容。

ConfiguredCodec 的接收分帧参数与发送编码也分开：接收可按 offset/width/adjustment/strip 配置，发送仍是固定 Java 格式。修改接收参数不代表发送协议自动换了一套。

### 用独立向量避免两个实现一起错

看这段 [protocol.rs](https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/crates/client-core/tests/protocol.rs#L9-L24)（桌面仓库原文件 9～24 行，连续原样节选）：

```rust
fn auth_matches_java_wire_format() {
    let mut bytes = BytesMut::new();
    Codec
        .encode(
            Frame {
                kind: 2,
                serial: 0,
                info: "k,id".into(),
                data: vec![],
            },
            &mut bytes,
        )
        .unwrap();
    assert_eq!(
        &bytes[..],
        &[0, 0, 0, 17, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, b'k', b',', b'i', b'd']
```

这是完整测试中的手工期望字节，虚构凭证为 k,id，bodyLength=17，整帧21字节。它比单纯 Rust 编码再解码更能约束外部线格式。

桌面仓库还提交了 JavaProtocolVectors.java 与七组 JSON 向量，历史生成基线在其说明中标注为 d2b96da6，常规 Cargo 测试直接读取向量，不要求相邻 Java 检出。本课程未重新生成那份历史向量，也不把其基线改写成当前 Java 提交。

本站只保存本篇原样节选及校验快照；更换桌面源码版本时，需要重新核对完整上下文与行号，不能只改链接里的提交号。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：在独立桌面仓库运行 cargo test --locked -p neutrino-client-core --test protocol，先找 auth_matches_java_wire_format，再看中文、分片和非法长度用例。手算 k,id 的21字节帧，与 Java 的布局表逐字段比对；需要离线运行时先确保依赖已在本机缓存。

**验收范围**：协议用例验证线格式与边界，不替代 Java 服务端真实互通、TLS 或桌面宿主验证。本轮实际执行状态集中记在课程进度文档，避免把仓库中“存在测试”写成“本轮运行通过”。不需要为本站构建启动或安装桌面应用。

<span id="完善清单"></span>

## 合上代码前想一想

为什么正常协议兼容，不要求空指针、泄漏或溢出行为也完全相同？为什么对照向量时要固定 serial？下一篇 [Tokio 内核](/learn/desktop-async-core/) 把回调改写成任务的思路接起来。
