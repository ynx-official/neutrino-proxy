<script setup>
import { computed, ref, watch } from "vue";
import Icon from "../components/AppIcon.vue";
const props = defineProps({ model: Object, actions: Object });
const query = ref(""),
  level = ref("all"),
  paused = ref(false),
  frozen = ref([]);
watch(paused, (value) => {
  if (value) frozen.value = [...(props.model.logs || [])];
});
const filtered = computed(() =>
  (paused.value ? frozen.value : props.model.logs || [])
    .filter(
      (entry) =>
        (level.value === "all" || entry.level === level.value) &&
        `${entry.source} ${entry.message}`
          .toLowerCase()
          .includes(query.value.toLowerCase()),
    )
    .slice(-200),
);
const time = (value) =>
  new Date(value).toLocaleString("zh-CN", { hour12: false });
</script>
<template>
  <section class="logs-page">
    <header class="page-header">
      <div>
        <h1>日志</h1>
        <p class="page-subtitle">查看连接事件和异常，业务数据不会写入日志。</p>
      </div>
      <button class="button secondary" @click="actions.exportLogs?.()">
        导出日志
      </button>
    </header>
    <div class="log-toolbar">
      <input
        v-model="query"
        aria-label="搜索日志"
        placeholder="搜索日志"
      /><select v-model="level" aria-label="日志级别">
        <option value="all">全部级别</option>
        <option value="info">信息</option>
        <option value="warn">警告</option>
        <option value="error">错误</option></select
      ><button
        class="button secondary"
        :aria-pressed="paused"
        @click="paused = !paused"
      >
        {{ paused ? "恢复更新" : "暂停更新" }}
      </button>
    </div>
    <p v-if="paused" class="muted log-note">
      已暂停视图更新，后台仍在记录日志。
    </p>
    <div v-if="!filtered.length" class="empty-log">
      <Icon name="logs" :size="32" />
      <h3>
        {{ query || level !== "all" ? "当前筛选没有日志" : "暂时没有日志" }}
      </h3>
      <p>连接、重连和异常事件会显示在这里。</p>
      <button
        v-if="query || level !== 'all'"
        class="text-link"
        @click="
          query = '';
          level = 'all';
        "
      >
        清除筛选
      </button>
    </div>
    <ol v-else class="log-entries">
      <li v-for="entry in filtered" :key="entry.id">
        <time>{{ time(entry.time) }}</time
        ><span :class="['log-level', entry.level]">{{
          { info: "信息", warn: "警告", error: "错误" }[entry.level] ||
          entry.level
        }}</span
        ><span class="log-source">{{ entry.source }}</span
        ><span class="log-message">{{ entry.message }}</span>
      </li>
    </ol>
    <p class="muted log-note">
      显示最近 200 条记录，导出包含当前内存中的全部脱敏日志。
    </p>
  </section>
</template>
