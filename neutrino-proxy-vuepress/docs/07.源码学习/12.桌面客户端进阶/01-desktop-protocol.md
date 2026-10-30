---
title: "12.01 Java 与 Rust 的协议兼容"
date: 2026-10-30
permalink: /learn/desktop-protocol/
article: false
status: Draft
updated: 2026-10-30
lesson: "12.01"
track: desktop
sourceReferences:
  - repository: desktop
    path: "crates/client-core/src/protocol.rs"
    url: "https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/main/crates/client-core/src/protocol.rs"
  - repository: desktop
    path: "docs/03-architecture/client-app-java-compatibility.md"
    url: "https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/main/docs/03-architecture/client-app-java-compatibility.md"
---

# 12.01 Java 与 Rust 的协议兼容

状态：Draft · 最后更新：2026-10-30
关联文档：[学习目录](/learn/)、[文章写作与源码引用规范](/learn/authoring/)

::: info 章节已规划，正文待完善
本页已确定学习问题、源码入口和实验验收点。后续将按提纲补充项目代码节选、调用链解释与实验记录。
:::

## 本篇要解决的问题

- 相同帧如何在两种语言解释？
- 兼容结论如何用向量支持？

所属专题：桌面客户端进阶。建议阶段：选修另加 2 周。本篇为选修，先完成 Java 客户端主线。

## 项目源码入口

源码来自独立桌面仓库，本站构建不依赖相邻目录。以下链接跟随其 main 分支；展开正文时需先固定提交和引用行号。

| 文件 | 优先定位的符号或范围 |
| --- | --- |
| [desktop / protocol.rs](https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/main/crates/client-core/src/protocol.rs) | 独立桌面仓库，展开正文时记录对应提交 |
| [desktop / client-app-java-compatibility.md](https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/main/docs/03-architecture/client-app-java-compatibility.md) | 独立桌面仓库，展开正文时记录对应提交 |

正文完善时，围绕这些入口截取必要代码，保留原始语义，标注文件、方法、提交与行号。删节、教学简化和改进建议按[引用规范](/learn/authoring/)分别标识。

## 正文提纲

1. 字段和编码对应。
2. Java 测试向量。
3. 错误与边界语义。

## 动手实验与验收

**计划实验**：选一组虚构协议向量逐字段比对。

**验收标准**：标明版本与已经验证的兼容范围。

实验仅使用本地服务和虚构凭证。执行后补充环境、命令、预期、实际结果及失败证据；当前页面不代表实验已通过。

## 完善清单

- [ ] 逐段核对源码并补充带出处的关键节选。
- [ ] 解释正常路径、失败路径、并发及清理边界中与本篇有关的部分。
- [ ] 执行计划实验并记录结果。
- [ ] 增加复习问题、相关章节链接并更新状态与日期。

