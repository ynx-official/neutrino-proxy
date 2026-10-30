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

刚打开项目，POM 里一长串依赖很容易把人劝退。先别背版本号，我们拿一个简单问题当线头：一条配置请求进来时，谁接 HTTP、谁查数据库；真正转发数据时，又是谁干活？把这几个角色认出来，依赖列表就有了落脚点。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

如果把 Netty 从依赖里拿掉，管理接口还能不能存在？反过来，只有 Netty，用户、License 和映射配置又放在哪？先按职责猜一下，再来看代码怎么分工。

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

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

| 角色 | 当前项目中的选择 | 先追哪里 |
| --- | --- | --- |
| Java 与工程 | Java 21、Maven 多模块 | 根 POM 的 properties、modules、plugins |
| 应用与管理 API | Solon | main、Controller、配置类 |
| 网络与协议 | Netty 4.1.100.Final | Bootstrap、Pipeline、编解码器 |
| 业务持久化 | MyBatis-Plus、XML Mapper | Service → Mapper → SQL |
| 数据库与连接池 | H2 / MySQL / MariaDB、HikariCP | DbConfiguration |
| 初始化与任务 | Wood、job-solon-plugin | DBInitialize、job 包 |
| 管理界面与文档 | Vue 2 管理后台、VitePress 文档站 | 两个前端目录各自的 package.json |

这里列的是当前仓库的选择。以后学习别的项目时，先沿用“职责 → 依赖 → 调用点”的查法，名字可以换。

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
- **下一步做什么？** 去 [01.03](/learn/local-debugging/)把这些角色放进一次真实的本地请求里。
