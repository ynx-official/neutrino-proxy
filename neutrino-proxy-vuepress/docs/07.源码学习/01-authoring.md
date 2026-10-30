---
title: "文章写作与源码引用规范"
date: 2026-10-30
permalink: /learn/authoring/
article: false
status: Review
updated: 2026-10-30
---

# 文章写作与源码引用规范

状态：Review · 最后更新：2026-10-30
关联文档：[学习目录](/learn/)、[编码器章节](/learn/protocol-encoder/)

本课程围绕项目真实代码解释问题。每篇选择足以说明一条行为的关键片段，配合上下文和实验；完整文件通过源码链接查阅。

## 一篇文章的固定结构

1. **本篇要解决的问题**：明确读者完成后能够解释或操作什么，列出前置知识。
2. **项目源码入口**：指出模块、文件、类或方法，以及必要的调用者与被调用者。
3. **正文提纲**：初稿保留提纲；逐步补入必要概念、调用链和关键代码的解释。
4. **关键代码节选**：每段通常选 10～40 行，一段只说明一个问题，紧接着解释输入、输出、约束和取舍。
5. **动手实验与验收**：给出环境、步骤、命令、预期、断言和实际结果，正文完善后在此记录运行证据。
6. **复习与延伸**：提出能验证理解的问题，链接相关章节；保留尚未完成的完善清单。

为保持目录与维护检查一致，现有四个核心标题“本篇要解决的问题、项目源码入口、正文提纲、动手实验与验收”继续保留；可在正文提纲下面展开二级以下标题和解释。

## 引用项目代码的规则

- 原样节选必须与指定提交中的源文件一致，标注仓库、相对路径、方法、提交和行号；已入库的例子也校验当前工作树，发现漂移后重新核对。
- 删去中间代码时，明确写“节选，中间有删节”，使用注释标记删节位置，并说明删掉哪些与本节无关的逻辑。
- 改名、调整控制流或缩减错误处理的代码标记“教学简化”，附原始实现链接，不能称为原样节选。
- 改进方案与当前实现分别描述。发现问题先给复现与证据，不在讲解中悄悄修正后冒充项目行为。
- 解释事件顺序、线程、状态、数据与资源所有权；不逐行翻译代码，不用注释替代源码核对。
- 不复制整个配置文件或输出真实凭证。仅选必要字段，示例使用明确虚构的值。
- Java 源码链接固定提交，后续修改章节时逐篇更新；桌面端展开前固定其独立提交，不建立相邻目录构建依赖。

## 原样节选示例

出处：`neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageEncoder.java`，`encode()` 方法，第 21～33 行。提交：`94cafdd1f36e1f64b316e10466a8f54912c75467`。本段连续截取，未删节。

[查看对应源文件与行号](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageEncoder.java#L21-L33)

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

这段代码先把 type、serial number、info length 的固定开销加入 bodyLength，再累加实际 info 字节与 data 字节。最后写入的是消息体长度，不包含长度字段本身的 4 字节。

注意 `getBytes()` 在此没有显式指定字符集，因此讲解应准确说明源码使用默认字符集；跨语言讨论需要进一步核对运行环境与测试向量，不能直接把源码改写成 UTF-8 后称为原样引用。

本例只说明长度计算。字段写入顺序、解码参数、ByteBuf 生命周期和异常路径应放回完整调用链中继续分析，详见后续[编码器章节](/learn/protocol-encoder/)与[解码器章节](/learn/protocol-decoder/)。

## 状态与验证记录

- **Draft**：提纲或正文尚未完成，实验可以仍未执行。
- **Review**：正文与源码已核对，实际执行的实验应附记录，未执行部分保留明确边界。
- **Approved**：用户审阅确认后标记；作者不自行把规划或草稿设为 Approved。

实验记录至少包含工具版本、源码提交、脱敏配置、执行命令、预期、实际结果和证据位置。构建成功不等于连接、权限、异常或恢复场景已经通过。

章节完善后更新该篇状态、日期、来源与相关链接；本目录不重复维护逐篇状态副本。新增、删除或调整课程总量时，同步修改学习目录与维护测试。站点完成检查使用 `npm run check` 和 `npm run test:e2e`，覆盖根路径及子路径。

