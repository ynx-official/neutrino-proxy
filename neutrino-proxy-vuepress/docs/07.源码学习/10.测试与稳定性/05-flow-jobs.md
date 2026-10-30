---
title: "10.05 流量计数 定时汇总与数据清理"
date: 2026-10-30
permalink: /learn/flow-jobs/
article: false
status: Review
updated: 2026-10-30
lesson: "10.05"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/FlowReportService.java"
    symbol: "addWriteByte"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/job/FlowReportForMinuteJob.java"
    symbol: "FlowReportForMinuteJob"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/job/DataCleanJob.java"
    symbol: "DataCleanJob"
sourceExcerpts:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/FlowReportService.java"
    startLine: 40
    endLine: 53
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/job/FlowReportForMinuteJob.java"
    startLine: 51
    endLine: 66
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/job/DataCleanJob.java"
    startLine: 36
    endLine: 57
---

# 10.05 流量计数 定时汇总与数据清理

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

转发一段字节时，项目先在内存计数，过一会儿才形成报表。这个设计减少了每次读写访问数据库，但也带来新问题：清零与入库之间失败怎么办，重复任务又会怎样？

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

AtomicInteger 的 getAndSet 能保证哪一步？能否保证报表恰好一次？数据清理保留天数又在哪里定义？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [server / FlowReportService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/FlowReportService.java) | `addWriteByte` |
| [server / FlowReportForMinuteJob.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/job/FlowReportForMinuteJob.java) | `FlowReportForMinuteJob` |
| [server / DataCleanJob.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/job/DataCleanJob.java) | `DataCleanJob` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 计数先发生在内存中

看这段 [FlowReportService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/FlowReportService.java#L40-L53)（原文件 40～53 行，连续原样节选）：

```java
    public void addWriteByte(Integer licenseId, Integer writeByte) {
        getWriteByte(licenseId).addAndGet(writeByte);
    }

    public void addReadByte(Integer licenseId, Integer readByte) {
        getReadByte(licenseId).addAndGet(readByte);
    }

    public Integer getAndResetWriteByte(Integer licenseId) {
        return getWriteByte(licenseId).getAndSet(0);
    }

    public Integer getAndResetReadByte(Integer licenseId) {
        return getReadByte(licenseId).getAndSet(0);
```

addAndGet 累加，getAndSet(0) 原子地取值并清零。因此并发增量不会因为一个普通“先 get 再 set”的间隙而直接被覆盖；但这个原子动作只针对单个计数器，不是数据库事务。

外层存储是 HashMap，创建计数器借助 LockUtil 做双重检查。AtomicInteger 只保证值的原子更新，不能自动让整个容器和跨 License 操作线程安全。大流量下 int 溢出的边界也需关注，不能因后续报表可能用 Long 就忽略入口计数类型。

### 分钟任务将当前计数记到上一分钟标签

任务 cron 每分钟触发，取当前时间减一分钟的 dateStr，先查询该标签已有记录，再处理 License：

看这段 [FlowReportForMinuteJob.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/job/FlowReportForMinuteJob.java#L51-L66)（原文件 51～66 行，连续原样节选）：

```java
        for (LicenseDO item : list) {
            // 避免job重复执行导致数据重复
            if (oldMap.containsKey(item.getId())) {
                continue;
            }
            Integer writeBytes = flowReportService.getAndResetWriteByte(item.getId());
            Integer readBytes = flowReportService.getAndResetReadByte(item.getId());
            FlowReportMinuteDO flowReportMinuteDO = new FlowReportMinuteDO();
            flowReportMinuteDO.setUserId(item.getUserId());
            flowReportMinuteDO.setLicenseId(item.getId());
            flowReportMinuteDO.setWriteBytes(writeBytes);
            flowReportMinuteDO.setReadBytes(readBytes);
            flowReportMinuteDO.setDate(date);
            flowReportMinuteDO.setDateStr(dateStr);
            flowReportMinuteDO.setCreateTime(now);
            flowReportMinuteMapper.insert(flowReportMinuteDO);
```

已存在的记录跳过；不存在则取走两项内存计数、清零、构造记录、insert。它表达了避免重复的意图，但不是数据库层“恰好一次”的完整证明。

如果取走后 insert 失败，内存值已经被清零；若两个任务并发都查到不存在，仍需数据库约束或其他互斥来保证不重复。这里也不能把调度延迟后的计数简单解释为严格按自然分钟分桶的所有网络字节。

小时任务再读取分钟记录汇总，先删旧小时记录再重建。失败发生在删除与重建之间时，是否有事务保护、能否安全重跑，都要追实际实现和数据库测试。

### 清理规则是一种持久化边界

看这段 [DataCleanJob.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/job/DataCleanJob.java#L36-L57)（原文件 36～57 行，连续原样节选）：

```java
    private static final Integer JOB_LOG_KEEP_DAYS = 7;
    /**
     * 用户登录日志保留天数
     */
    private static final Integer USER_LOGIN_RECORD_KEEP_DAYS = 30;
    /**
     * 客户端连接记录保留天数
     */
    private static final Integer CLIENT_CONNECT_RECORD_KEEP_DAYS = 30;

    /**
     * 流量统计分钟报表记录保留天数
     */
    private static final Integer FLOW_MINUTE_REPORT_KEEP_DAYS = 2;
    /**
     * 流量统计小时报表记录保留天数
     */
    private static final Integer FLOW_HOUR_REPORT_KEEP_DAYS = 90;
    /**
     * 流量统计天报表记录保留天数
     */
    private static final Integer FLOW_DAY_REPORT_KEEP_DAYS = 400;
```

当前默认值包括任务日志 7 天、登录/连接记录 30 天、分钟报表 2 天、小时 90 天、天报表 400 天，参数解析也允许提供 JobParams。

这属于当前实现默认值，不是本轮重新决定的数据保留政策。执行清理会真实删除记录；学习时只检查代码或使用一次性数据库，不能在现有库上点“执行”来试试看。

参数 JSON 不完整时，字段是否为空、非法天数如何处理，也要单测；不要以为默认构造分支会给所有部分输入自动补齐。

### 验收分成数值与故障两层

数值层先验证累加、取走清零、下一轮新增；故障层再验证 insert 失败、任务重入、重复触发、跨分钟延迟和重跑。表里数字正确与数据不会丢，是两个不同承诺。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：先用独立教学实例对同一虚构 License 连续 add、getAndReset、再 add，核对窗口内总和。任务测试使用 mapper 替身捕获写入，并让 insert 在取走计数后失败；数据清理仅对临时数据库的虚构旧记录检查阈值边界，绝不调用现有库。

**怎么验收**：正常总数一致，失败与重复场景明确写出当前结果及待改进点。流量任务、SQL 事务和删除阈值实验本轮尚未执行；现有正常转发计数不能证明报表无丢失或恰好一次。实际清理需独立确认环境与数据范围。

<span id="完善清单"></span>

## 合上代码前想一想

为什么 getAndSet 原子，也仍可能在入库失败时丢计数？为什么上游计数类型值得单独审视？下一组看[构建与产物](/learn/jar-build/)，把能运行的代码交到别人手上。
