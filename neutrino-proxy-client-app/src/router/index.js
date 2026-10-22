import { createRouter, createWebHashHistory } from "vue-router";
import ConnectionView from "../views/ConnectionView.vue";
import SettingsView from "../views/SettingsView.vue";
import LogsView from "../views/LogsView.vue";
import NotFound from "../views/NotFound.vue";
export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", component: ConnectionView },
    { path: "/settings", component: SettingsView },
    { path: "/logs", component: LogsView },
    { path: "/:pathMatch(.*)*", component: NotFound },
  ],
});
