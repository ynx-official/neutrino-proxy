---
title: "01.02 技术栈与依赖地图"
date: 2026-10-30
permalink: /learn/technology-stack/
article: false
status: Review
updated: 2026-10-30
lesson: "01.02"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "pom.xml"
    symbol: "<modules>"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/db/DbConfiguration.java"
    symbol: "dataSource"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java"
    symbol: "cmdTunnelBootstrap"
sourceExcerpts:
  - path: "pom.xml"
    startLine: 7
    endLine: 12
  - path: "pom.xml"
    startLine: 41
    endLine: 43
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/db/DbConfiguration.java"
    startLine: 25
    endLine: 29
---

# 01.02 技术栈与依赖地图

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

先把技术选型讲明白：这个项目要同时处理管理配置、数据保存和长连接转发，它们的工作方式不同。读完这一篇，目标是知道每个技术为什么出现在这里，以及它解决的是哪一类问题；具体 API 和源码细节放到后面。

## 先有问题，才有技术选择

场景很具体：用户在后台配置“server 的 18080 端口，转到 client 能访问的 127.0.0.1:8080”。这些数字只是讲解示例。配置要保存，客户端要认证，访问者的数据要持续双向转发，断线以后还要回收资源。

从这个场景拆出三件事：

1. **管理配置**：提供登录、新建映射、启停等 HTTP 接口，并组织业务规则。
2. **保存业务数据**：记录用户、License、可用端口和映射，重启以后还能读取。
3. **运行网络代理**：维护多条连接，把字节送到正确目标，再把响应带回来。

一个组件不用包办这三类工作。先看分工，再看版本号和配置项。

## 当前选了什么，分别解决什么问题

下面的“作用与取舍”根据项目实现和组件能力说明；仓库中没有找到完整的历史选型决策记录，因此不把这些解释冒充作者当年的决策原话。

| 问题 | 当前技术 | 怎样解决 | 学习时还要留意什么 |
| --- | --- | --- | --- |
| 配置、组件组装和管理 HTTP 入口 | [Solon](https://solon.noear.org/api/org/noear/solon/annotation/package-summary.html) | 容器组装对象，路由把请求交给 Controller，再进入 Service | 业务规则仍由项目实现；要理解初始化先后和请求上下文 |
| 多连接、双向字节传输、自定义代理协议 | [Netty 4.1](https://netty.io/wiki/user-guide-for-4.x.html) | 用异步事件模型组织连接、读写事件及处理链；项目在它上面实现建链和转发 | 仍要处理消息边界、背压、线程占用和关闭清理，不会自动完成业务协议 |
| 表与 Java 对象的持久化访问 | [MyBatis-Plus](https://baomidou.com/introduce/) 与 XML Mapper | 减少常规数据访问样板，项目的专用查询仍通过 SQL 表达 | 存在性、权限、并发与唯一约束要单独设计 |
| 保存用户、授权、端口和映射 | H2 / MySQL / MariaDB | 关系模型表达归属和查询；[H2 支持嵌入式运行](https://h2database.com/html/quickstart.html)，方便本地开始 | 是按配置选择不同数据库；SQL 方言和数据库专属行为分别验证 |
| 数据库连接的借用、归还与数量管理 | [HikariCP](https://github.com/brettwooldridge/HikariCP) | 连接池复用 JDBC 连接，应用通过 DataSource 获取连接 | 数据库连接池与 Netty 通道池是两回事；有池也不意味着 SQL 自动异步 |
| core、server、client 的依赖与打包 | Java 21、Maven 多模块 | core 放共用协议，两端分别依赖它，构建时统一管理依赖 | 共享协议不等于共享进程；父 POM 管理版本也不等于每个模块都使用该依赖 |

Java 21 是当前工程基线，不要求先掌握虚拟线程才能读这个项目。管理界面是现有 Vue 2 工程；独立桌面端使用 Rust/Tokio、Tauri 2 和 Vue 3，留到 Java 主线之后再比较。

### 为什么先区分 Solon 和 Netty 的职责

在后台保存映射，是一次 HTTP 业务操作：接收参数、检查规则、写数据库。访问者持续传数据，则要维护连接、读取任意字节流、等待目标回话并处理断开。项目用 Solon 组织前一类工作，用 Netty 实现后一类网络工作，两者在 server 进程中合作。

这不意味着其他技术无法实现同样功能，而是先读懂**当前工程怎样分工**。本篇没有框架性能对比，也不据此断言哪个框架在所有场景更好。

### Netty 的几个名词，什么时候再学

| 先遇到的困难 | 再引入的概念 | 后续入口 |
| --- | --- | --- |
| 很多连接怎样被少量线程照看 | EventLoop / Reactor | [05.01](/learn/netty-reactor/) |
| 发起连接以后，怎样知道成功还是失败 | Future 与回调 | [05.02](/learn/netty-bootstrap/) |
| 字节进来以后，处理器按什么顺序执行 | Pipeline / Handler | [05.03](/learn/netty-pipeline/) |
| TCP 字节流怎样恢复成一条代理消息 | 长度字段与编解码 | [06.01](/learn/protocol-frame/) |
| 一个访问者应该找到哪条目标连接 | visitorId 与双向绑定 | [08.03](/learn/client-target-connection/) |

现在知道它们解决哪类问题就够了，后面每次只拆一个。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

如果把 Netty 从依赖里拿掉，管理接口还能不能存在？反过来，只有 Netty，用户、License 和映射配置又放在哪？先按职责猜一下，再来看代码怎么分工。

<span id="项目源码入口"></span>

<span id="这次先打开哪几个文件"></span>

## 再用源码确认这份技术分工

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [pom.xml](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/pom.xml) | `<modules>` |
| [server / DbConfiguration.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/db/DbConfiguration.java) | `dataSource` |
| [client / ProxyConfiguration.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java) | `cmdTunnelBootstrap` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 先认出两条工作线

打开管理后台新增映射，走的是 HTTP 请求、参数校验、业务规则和数据库。这条线里，Solon 管应用和路由，MyBatis-Plus 与 Mapper 负责数据访问，HikariCP 管数据库连接。你熟悉的 Java 业务开发经验，可以直接接上来。

访问者开始使用映射后，另一条线才忙起来：Netty 接收连接，协议编解码器识别消息，Handler 把字节送到下一跳。这条线常常长时间保持连接。把一次 HTTP 请求处理完的思路，直接搬到一整条隧道生命周期上，容易漏掉心跳、背压和清理。

两条线在一个 server 应用里交汇。管理 Service 改了映射，还要通知网络部分更新运行状态；数据库里有一行记录，并不自动等于操作系统已经监听了相应端口。

### Solon 从哪儿来的

看这段 [pom.xml](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/pom.xml#L7-L12)（原文件 7～12 行，连续原样节选）：

```xml
    <parent>
        <groupId>org.noear</groupId>
        <artifactId>solon-parent</artifactId>
        <version>2.7.6</version>
        <relativePath />
    </parent>
```

根 POM 继承了 Solon 2.7.6 的父工程。再去看服务端的 `ProxyServer.main`，能找到 `Solon.start`，Controller 上能找到 Solon 的 `@Mapping` 和 `@Controller`。这三处一起看，框架就坐实了。

有个很实用的小习惯：先看注解的 import。长得一样的 `@Inject`、`@Db`，可能来自不同包；靠名字联想熟悉框架，很容易看岔。到 [03.02](/learn/solon-injection/)我们专门拆这个细节。

### 版本写在哪儿 跟依赖用在哪儿要分开看

看这段 [pom.xml](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/pom.xml#L41-L43)（原文件 41～43 行，连续原样节选）：

```xml
                <artifactId>netty-all</artifactId>
                <version>4.1.100.Final</version>
            </dependency>
```

这段位于根 POM 的 `dependencyManagement`。它规定子模块采用这项依赖时使用哪个版本。真正把 Netty 引进来的，还要看 core 的 `dependencies`；client、server 再依赖 core。

所以，看到父 POM 管理了 MySQL 驱动，并不能推导出客户端会连接 MySQL。客户端的业务是连接隧道和目标服务，数据库配置与访问代码在 server。读依赖时，顺手画一张“谁依赖谁”的小图，比把所有包抄进笔记更有用。

这与前面的技术选型表互相印证：先从业务职责认识组件，再通过声明与调用点确认项目确实使用了它。

### H2 和 MySQL 为什么能放在同一个项目里

看这段 [DbConfiguration.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/db/DbConfiguration.java#L25-L29)（原文件 25～29 行，连续原样节选）：

```java
    @Bean(value = "db", typed = true)
    public DataSource dataSource(@Inject DbConfig dbConfig) {
        DbTypeEnum dbTypeEnum = DbTypeEnum.of(dbConfig.getType());
        if (DbTypeEnum.H2 == dbTypeEnum) {
            return newHikariDataSource(dbConfig, "org.h2.Driver");
```

入口都返回 `DataSource`，具体驱动根据配置选择。对上面的 Mapper 来说，通常先面对统一的数据源接口；到了 SQL 方言、索引和数据库特有行为，就需要按真实数据库分别验证。

H2 很适合这套课程的临时实验，因为不用碰你已有的 MySQL。但 H2 实验通过，并不能替代 MySQL 专属行为验证。把“方便开始”和“验证范围”一起记住，后面谈数据库时会省很多来回。

最后还有个容易混淆的点：POM 声明、依赖解析结果、实际运行时加载的类，是三个观察层次。构建包的 `BOOT-INF/lib` 能帮助你核对最终装进了什么；遇到版本冲突，再进一步查类来自哪个 JAR。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：给核心组件各找一个真实调用点，连成自己的技术地图。

1. 在根 POM 找到 Java 版本与 Netty 版本，再到 core POM 找到实际依赖声明。
2. 打开 `ProxyServer`、`DbConfiguration`、客户端 `ProxyConfiguration`，分别圈出应用启动、数据源创建和网络组装的位置。
3. 写四条短链路：“HTTP 入口 → 业务层”“业务层 → 数据库”“消息 → Handler”“客户端 → 目标”。每条链路至少落到两个真实类。

这是源码阅读练习：预期产物是带文件路径的职责图，不需要启动数据库。版本声明和调用位置已按本课程基线核对；本篇没有把所有依赖做成运行时冲突审计。

<span id="完善清单"></span>

## 合上代码前想一想

- **为什么只看 dependencyManagement 不够？** 它管版本，实际使用还要看各模块的 dependencies。
- **为什么客户端也能用 Solon，却没有管理数据库？** 容器和配置能力可以服务不同应用，具体业务由各模块决定。
- **下一步做什么？** 先去 [01.01](/learn/project-overview/)看架构和请求流程，再读 [04.01](/learn/database-model/)的核心业务表，理解配置后再进入本地实验。
