---
title: "02.04 Maven 多模块 依赖与构建阶段"
date: 2026-10-30
permalink: /learn/maven-modules/
article: false
status: Review
updated: 2026-10-30
lesson: "02.04"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "pom.xml"
    symbol: "<modules>"
  - path: "neutrino-proxy-core/pom.xml"
    symbol: "pom"
sourceExcerpts:
  - path: "pom.xml"
    startLine: 19
    endLine: 23
  - path: "neutrino-proxy-core/pom.xml"
    startLine: 5
    endLine: 10
  - path: "pom.xml"
    startLine: 139
    endLine: 152
---

# 02.04 Maven 多模块 依赖与构建阶段

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

能在 IDE 里点运行，和能解释一个发布包怎么来的，中间还有一小段路。Maven 的命令不用全背，我们先看这个项目最常碰到的几个地方：父 POM、子模块、版本管理，以及 package 最后到底装了什么。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

只想构建服务端，为什么通常还要带上 core？如果直接进入 server 目录构建，拿到的 core 版本一定就是你刚改的源码吗？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [pom.xml](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/pom.xml) | `<modules>` |
| [core / pom.xml](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/pom.xml) | `pom` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 聚合和继承 先分清各自干什么

看这段 [pom.xml](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/pom.xml#L19-L23)（原文件 19～23 行，连续原样节选）：

```xml
    <modules>
        <module>neutrino-proxy-core</module>
        <module>neutrino-proxy-client</module>
        <module>neutrino-proxy-server</module>
    </modules>
```

modules 告诉这次 reactor 构建有哪些成员。core 是公共能力，client 和 server 通过依赖使用它。根项目的 packaging 是 pom，它负责组织工程，不等于自己会产出一个可运行的服务端。

再看子模块：

看这段 [pom.xml](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/pom.xml#L5-L10)（原文件 5～10 行，连续原样节选）：

```xml
    <parent>
        <artifactId>neutrino-proxy</artifactId>
        <groupId>org.dromara.neutrino-proxy</groupId>
        <version>${revision}</version>
        <relativePath>../pom.xml</relativePath>
    </parent>
```

parent 让子模块继承配置。relativePath 指到仓库里的父 POM；version 使用 revision 这条版本来源。聚合在描述“这次一起构建谁”，继承在描述“配置从哪儿来”，同一个根 POM 可以同时承担两种角色。

### 从版本声明追到实际依赖

根 dependencyManagement 管统一版本，子模块 dependencies 决定实际引入。构建 server 时，需要的 core 是一条真实依赖边。于是，在根目录用 `-pl neutrino-proxy-server -am`，可以选择服务端并把所需的 reactor 依赖一起带上。

这里别把 `-am` 理解成“把所有东西都构建”。它跟着选中模块的所需依赖走；管理前端和文档站也不是根 Maven modules 中的成员。Java package 成功，不能顺便替前端 dist 或文档构建签字。

### Java 版本与编译插件怎么接起来

看这段 [pom.xml](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/pom.xml#L139-L152)（原文件 139～152 行，连续原样节选）：

```xml
                <artifactId>maven-compiler-plugin</artifactId>
                <version>${maven-compiler-plugin.version}</version>
                <configuration>
                    <source>${java.version}</source>
                    <target>${java.version}</target>
                    <encoding>UTF-8</encoding>
                    <annotationProcessorPaths>
                        <path>
                            <groupId>org.projectlombok</groupId>
                            <artifactId>lombok</artifactId>
                            <version>${lombok.version}</version>
                        </path>
                    </annotationProcessorPaths>
                </configuration>
```

source 和 target 都引用 java.version，编码使用 UTF-8，注解处理器路径则把 Lombok 配进去。你在源码里看见的 getter/setter，有些来自编译期处理，因此“搜索不到手写方法”不等于最终 class 没有它。

这也提醒我们分别看几份证据：源码写了什么、有效 POM 解析成什么、构建日志执行了什么、产物包含什么。IDE 能补全代码，只说明其中一部分工作已完成。

### package 之后 再确认运行入口

这套工程还配置了 Solon 的重新打包。普通编译产物与包含运行依赖的可执行 JAR，要结合打包插件和清单看。我们在实际分发 JAR 里可以看到 BOOT-INF/classes 与 BOOT-INF/lib：前者是应用类，后者是依赖。

要验证某个类究竟从哪个 JAR 来，还可以结合运行时类加载信息继续查。本篇先不把原生构建塞进来；AOT、GraalVM 和跨平台包另在[构建交付专题](/learn/native-aot/)展开，免得第一次构建就同时背太多变量。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：从根目录构建所需模块，读一遍日志，再看一次 JAR 内容。

在仓库根目录执行：

```powershell
mvn -B -pl neutrino-proxy-server -am package
jar tf neutrino-proxy-server/target/neutrino-proxy-server.jar
```

日志里应能区分根 POM、core 与 server，找到编译、测试和打包各自的结果。当前源码基线的 Java 模块没有现成测试可执行；No tests to run 要按原意记录，别写成“Java 业务测试全通过”。

这套课程已有构建成功与真实 JAR 运行证据，见 [01.01](/learn/project-overview/)。本轮基础实验也从实际构建包中读取了类与依赖，JAR 哈希保存在[实验记录](/labs/foundations-result.json)。你自己重建时记录自己的日志与哈希，不要求复用旧报告里的时间戳。

<span id="完善清单"></span>

## 合上代码前想一想

- **父 POM 出现在构建顺序里，是否意味着它也是运行进程？** 先看 packaging 与入口。
- **为什么要留构建日志？** 依赖、插件和有没有真的运行测试，都能在这里核对。
- **下一篇接什么？** [03.01](/learn/solon-startup/)从 JAR 中的 main 接着往下走。
