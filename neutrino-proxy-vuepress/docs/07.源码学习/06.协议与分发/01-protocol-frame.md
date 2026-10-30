---
title: "06.01 ProxyMessage 帧结构与消息类型"
date: 2026-10-30
permalink: /learn/protocol-frame/
article: false
status: Review
updated: 2026-10-30
lesson: "06.01"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessage.java"
    symbol: "buildAuthMessage"
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/Constants.java"
    symbol: "Constants"
sourceExcerpts:
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/Constants.java"
    startLine: 40
    endLine: 43
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessage.java"
    startLine: 107
    endLine: 120
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessage.java"
    startLine: 93
    endLine: 104
---

# 06.01 ProxyMessage 帧结构与消息类型

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

现在我们不看架构图，拿一帧字节放到桌上。你要实现一个新客户端，第一件事不是选 UI 框架，而是弄明白：对面收到这些字节，会按什么顺序解释？

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

ProxyMessage 的 Java 字段，如何对应网络上的位置？info 里放 License、visitorId 或 JSON 时，格式是谁约定的？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [core / ProxyMessage.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessage.java) | `buildAuthMessage` |
| [core / Constants.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/Constants.java) | `Constants` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 先画字节表，暂时别管类图

看这段 [Constants.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/Constants.java#L40-L43)（原文件 40～43 行，连续原样节选）：

```java
    int HEADER_SIZE = 4;
    int TYPE_SIZE = 1;
    int SERIAL_NUMBER_SIZE = 8;
    int INFO_LENGTH_SIZE = 4;
```

把编码器与这些常量放到一起，可以得到下面的布局。偏移从整帧起点算起，长度单位都是字节。

| 偏移 | 字段 | 长度 | 解释 |
| --- | --- | --- | --- |
| 0 | bodyLength | 4 | 后面所有字段总长度，不含自己 |
| 4 | type | 1 | 消息类型 |
| 5 | serialNumber | 8 | 流水号字段 |
| 13 | infoLength | 4 | info 编码后的字节数 |
| 17 | info | I | 文本控制信息 |
| 17 + I | data | D | 剩余的业务字节 |

因此 bodyLength = 13 + I + D，整帧长度 = 17 + I + D。ByteBuf 的这些 writeInt/writeLong 与对应 read 方法使用大端顺序，跨语言实现要逐字节核对。

别因为有 serialNumber 字段，就自动脑补请求响应表、严格递增序号或重放保护。下面这些构造方法并没有给它赋值；Java long 的初始值是 0。

### 同一套外壳，里面可以装不同内容

看这段 [ProxyMessage.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessage.java#L107-L120)（原文件 107～120 行，连续原样节选）：

```java
    public static ProxyMessage buildConnectMessage(String visitorId) {
        return create().setType(TYPE_CONNECT)
            .setInfo(visitorId);
    }

    public static ProxyMessage buildDisconnectMessage(String info) {
        return create().setType(TYPE_DISCONNECT)
            .setInfo(info);
    }

    public static ProxyMessage buildTransferMessage(String visitorId, byte[] data) {
        return create().setType(TYPE_TRANSFER)
            .setInfo(visitorId)
            .setData(data);
```

CONNECT 的 info 是 visitorId；TRANSFER 也是 visitorId，但另外携带 data。于是 infoLength 不是“业务数据长度”，data 也没有独立的长度字段，而是用整帧剩余长度算出来。

认证的 info 则换了一种格式：

看这段 [ProxyMessage.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessage.java#L93-L104)（原文件 93～104 行，连续原样节选）：

```java
    public static ProxyMessage buildAuthMessage(String info, String clientId) {
        return create().setType(TYPE_AUTH)
            .setInfo(info + "," + clientId);
    }

    public static ProxyMessage buildAuthResultMessage(Integer code, String msg, String licenseKey) {
        ONode data = ONode.newObject();
        data.set("code", code);
        data.set("msg", msg);
        data.set("licenseKey", licenseKey);
        return create().setType(TYPE_AUTH)
            .setInfo(data.toJson());
```

请求将输入信息与 clientId 通过逗号拼起来，响应把 code、msg、licenseKey 放进 JSON。它们外层 type 都是 AUTH，业务 Handler 要结合通信方向和字段格式解释。一个消息类型不一定只有一种 info 结构。

TCP 的 data 是任意字节，不要把它顺手转成字符串再转回来。图片、压缩包、含 0x00 的二进制都可能经过这里。

### 最小心跳也不是一个字节

心跳仅设置 type，仍会走完整帧编码。无 info、无 data 时，bodyLength 是 13，整帧 17 字节：

```text
00 00 00 0d | 01 | 00 00 00 00 00 00 00 00 | 00 00 00 00
 bodyLength   type        serialNumber          infoLength
```

这段是根据真实编码布局手工排版的教学字节图，不是项目原文件节选。基础实验已经验证空帧 17 字节和外层长度为 13，结果见[实验记录](/labs/foundations-result.json)。

帧中没有独立的协议版本号或校验字段。隧道 TLS 是另一层可选传输配置，不能把“有二进制帧”理解成“载荷自动加密”。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：先在纸上拆解上面的心跳，再构造虚构 AUTH info 为 demo,client：ASCII 11 字节，所以 bodyLength 应为 24，整帧 28 字节。用实际 Encoder 导出十六进制，核对偏移与字节数；不要放入真实 License。

**已有实测**：最小帧、中文 info、包含全部 256 种字节值的 data 已由基础实验调用实际编解码器验证。**本篇练习**：demo,client 的逐字节导出留给你执行；不要把手算结果冒充抓包结果。允许编码/解码前后 null info 变成空字符串，这个现象也已记录。

<span id="完善清单"></span>

## 合上代码前想一想

试着只用字节表解释两件事：为什么 data 不需要单独的长度？为什么 AUTH 响应不能照请求的逗号规则解析？下一篇 [编码器](/learn/protocol-encoder/) 逐行核对这个布局。
