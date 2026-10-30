---
title: "01.03 本地调试与第一条 TCP 映射"
date: 2026-10-30
permalink: /learn/local-debugging/
article: false
status: Draft
updated: 2026-10-30
lesson: "01.03"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/ProxyServer.java"
    symbol: "Solon.start"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/ProxyClient.java"
    symbol: "setAlias"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/controller/PortMappingController.java"
    symbol: "create"
---

# 01.03 本地调试与第一条 TCP 映射

状态：Draft · 最后更新：2026-10-30
关联文档：[学习目录](/learn/)、[文章写作与源码引用规范](/learn/authoring/)

::: info 章节已规划，正文待完善
本页已确定学习问题、源码入口和实验验收点。后续将按提纲补充项目代码节选、调用链解释与实验记录。
:::

## 本篇要解决的问题

- 本地需要启动哪些进程？
- 四类端口与映射方向如何配置？

所属专题：项目导读。建议阶段：第 1 周。前置条件：按学习目录完成前序专题，已有相应经验的基础课可按需跳读。

## 项目源码入口

本篇计划阅读的源码基线为 `94cafdd1f36e1f64b316e10466a8f54912c75467`。本地路径相对仓库根目录；发布后的源码链接固定到该提交。

| 文件 | 优先定位的符号或范围 |
| --- | --- |
| [server / ProxyServer.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/ProxyServer.java) | `Solon.start` |
| [client / ProxyClient.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/ProxyClient.java) | `setAlias` |
| [server / PortMappingController.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/controller/PortMappingController.java) | `create` |

正文完善时，围绕这些入口截取必要代码，保留原始语义，标注文件、方法、提交与行号。删节、教学简化和改进建议按[引用规范](/learn/authoring/)分别标识。

## 正文提纲

1. 开发环境与测试配置。
2. 最小目标服务。
3. 启动、断点与关闭顺序。

## 动手实验与验收

**计划实验**：用虚构凭证和本地 Echo 服务完成一次请求往返。

**验收标准**：保存拓扑、启动命令和请求响应证据。

实验仅使用本地服务和虚构凭证。执行后补充环境、命令、预期、实际结果及失败证据；当前页面不代表实验已通过。

## 完善清单

- [ ] 逐段核对源码并补充带出处的关键节选。
- [ ] 解释正常路径、失败路径、并发及清理边界中与本篇有关的部分。
- [ ] 执行计划实验并记录结果。
- [ ] 增加复习问题、相关章节链接并更新状态与日期。

