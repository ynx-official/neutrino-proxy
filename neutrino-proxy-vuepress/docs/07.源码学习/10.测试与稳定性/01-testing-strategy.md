---
title: "10.01 单元 集成与真实网络测试分层"
date: 2026-10-30
permalink: /learn/testing-strategy/
article: false
status: Review
updated: 2026-10-30
lesson: "10.01"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "pom.xml"
    symbol: "<modules>"
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageEncoder.java"
    symbol: "encode"
  - path: "scripts/release/smoke.py"
    symbol: "import "
sourceExcerpts:
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageEncoder.java"
    startLine: 21
    endLine: 33
  - path: "scripts/release/smoke.py"
    startLine: 125
    endLine: 135
---

# 10.01 单元 集成与真实网络测试分层

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

这一路读下来，待验证的问题越来越多。先别把它们全塞进一个“大而全”的端到端测试：有些用几个字节就能复现，有些非得启动两个进程，有些还必须碰真实数据库约束。分层是为了让失败更容易解释。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

编码通过、JAR 能启动、业务能转发，分别证明什么？当前项目已有的验证工具位于哪一层？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [pom.xml](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/pom.xml) | `<modules>` |
| [core / ProxyMessageEncoder.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageEncoder.java) | `encode` |
| [scripts / smoke.py](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/scripts/release/smoke.py) | `import ` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 小问题尽量用小装置验证

看这段 [ProxyMessageEncoder.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageEncoder.java#L21-L33)（原文件 21～33 行，连续原样节选）：

```java
        int bodyLength = TYPE_SIZE + SERIAL_NUMBER_SIZE + INFO_LENGTH_SIZE;
        byte[] infoBytes = null;
        if (msg.getInfo() != null) {
            infoBytes = msg.getInfo().getBytes();
            bodyLength += infoBytes.length;
        }

        if (msg.getData() != null) {
            bodyLength += msg.getData().length;
        }

        // write the total packet length but without length field's length.
        out.writeInt(bodyLength);
```

长度计算适合 EmbeddedChannel：输入明确对象，断言具体字节和输出数量，不启动应用。半包、连续多帧、异常字段也可在这里控制每一次输入，重复性比“碰巧抓到一个 TCP 分片”好得多。

当前课程新增的 FoundationsLab 已直接调用真实类，执行 25 项确定性检查并保留两条资源观察。它不是仓库原有 JUnit 套件，也没有替全应用建立完整测试覆盖。

### 启动烟测关心的是产物边界

已有发布工具中，客户端烟测会检查实际发出的认证帧：

看这段 [smoke.py](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/scripts/release/smoke.py#L125-L135)（原文件 125～135 行，连续原样节选）：

```python
def verify_auth_frame(frame):
    """The legacy config may generate a client ID rather than reading CLIENT_ID."""
    if len(frame) < 13 or frame[0] != 2:
        raise ValueError("Expected client authentication frame")
    info_length = struct.unpack(">I", frame[9:13])[0]
    if info_length > len(frame) - 13:
        raise ValueError("Authentication info length exceeds frame size")
    info = frame[13:13 + info_length].decode("utf-8")
    license_key, separator, client_id = info.partition(",")
    if license_key != "ci-smoke-license" or not separator or not client_id:
        raise ValueError("Unexpected authentication credentials from packaged client")
```

它验证解压后的客户端能由启动器运行，并按期望发出协议数据。服务端烟测则检查临时配置启动、管理页面及脚本资源、隧道监听。它们比“文件存在”强，但仍不等于两端完成真实业务穿透。

所以可以把现有证据摆在一起：

| 层次 | 合适的问题 | 本课程/项目入口 |
| --- | --- | --- |
| 字节与纯逻辑 | 长度、分片、Dispatcher 规则 | FoundationsLab |
| 组件与数据库 | SQL、权限分支、事务失败 | 后续集成测试草案 |
| 单产物启动 | JAR/native 能否隔离运行 | scripts/release/smoke.py |
| 两端真实网络 | 绑定、转发、断开、恢复 | project_overview.py |
| 目标平台 | ELF、系统库、运行能力 | release 平台验证 |

### 数据库测试不要换个库就宣布通过

课程本地端到端实验使用 H2 MySQL 模式，能快速隔离，不会连接真实数据库。它不能替代 MySQL 的唯一约束、事务隔离、索引计划与驱动行为验证。

权限分支可以用测试替身控制用户和记录，但重要查询条件仍需要实际数据库集成测试；更不能把 mock 设置成“总是返回属于当前用户的数据”来掩盖实现缺少归属判断。

### 测试报告要带结论范围

Maven package 成功先说明构建成功；若没有 Java 测试用例执行，就不能顺手写“后端全测试通过”。脚本退出码、检查数量、失败条目和未覆盖范围都应保留。

当前已知不可达目标未及时关闭、异常 Decoder 引用清理不足，应保留为现象与改进入口。未来修复再增加稳定回归断言，不能靠删除失败场景让报告变绿。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：为一次“目标连接失败”画三层测试：Handler 层控制 Future 失败、服务端检查是否定位并关闭访问者、两端网络观察 EOF/异常/超时。每层各写一个可观察断言和清理条件，再说明哪层最适合先定位。

**已有证据**：[基础实验](/labs/foundations-result.json)与[01.01 网络实验](/labs/project-overview-result.json)范围不同，后者仍保留一项失败。发布烟测代码本轮仅阅读，没有重新执行所有平台。验收是能选对最小装置，而不是列越多测试名字越好。

<span id="完善清单"></span>

## 合上代码前想一想

为什么一个 mock Handler 通过，不能证明 SQL 过滤正确？为什么一个产物启动成功，不能证明穿透成功？下一篇用 [故障矩阵](/learn/fault-matrix/) 把失败和恢复一并设计。
