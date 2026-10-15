<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import Icon from "./components/AppIcon.vue";
import BrandMark from "./components/BrandMark.vue";
import { call, subscribe } from "./services/desktop";

const model = ref(null), busy = ref(false), error = ref("");
let unlisten;
function apply(value) {
  if (value && (!model.value || value.revision >= model.value.revision)) model.value = value;
}
async function activate(action) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try { await call("tray_action", { action }); }
  catch (e) { error.value = String(e.message || e); }
  finally { busy.value = false; }
}
function close() { call("close_tray").catch(() => {}); }
function onKeydown(event) {
  if (event.key === "Escape") { event.preventDefault(); close(); }
}
onMounted(async () => {
  window.addEventListener("keydown", onKeydown);
  try {
    unlisten = await subscribe(apply, "tray-state");
    apply(await call("tray_snapshot"));
    await call("tray_ready");
  } catch (e) { error.value = String(e.message || e); }
});
onUnmounted(() => { unlisten?.(); window.removeEventListener("keydown", onKeydown); });
</script>

<template>
  <section class="tray-panel" aria-label="Neutrino Proxy 托盘" @contextmenu.prevent>
    <header class="tray-header">
      <div class="tray-brand">
        <BrandMark />
        <strong>Neutrino Proxy</strong>
      </div>
      <div class="tray-status" role="status"><i :class="['status-dot', model?.tone]"/><span>{{ model?.label || '正在读取状态' }}</span></div>
      <p v-if="error" class="tray-endpoint tray-error" role="alert" :title="error">{{ error }}</p>
      <p v-else class="tray-endpoint" :title="model?.endpoint">{{ model?.endpoint || '尚未配置服务器' }}</p>
    </header>
    <div class="tray-group">
      <button data-action="open" :disabled="busy" @click="activate('open')"><Icon name="window" :size="19"/><span>打开主窗口</span></button>
      <button data-action="logs" :disabled="busy" @click="activate('logs')"><Icon name="logs" :size="19"/><span>查看日志</span></button>
    </div>
    <div class="tray-group">
      <button data-connection-action :disabled="!model || model.disabled || busy" @click="activate(model.action)"><Icon :name="model?.action === 'connect' ? 'link' : 'power'" :size="19"/><span>{{ model?.actionLabel || '连接' }}</span></button>
    </div>
    <div class="tray-group">
      <button data-action="quit" :disabled="busy" @click="activate('quit')"><Icon name="exit" :size="19"/><span>退出应用</span></button>
    </div>
  </section>
</template>
