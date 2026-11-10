<template>
  <div class="app">
    <div class="toasts" role="region" aria-label="Notifications">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="toast"
        :class="`toast--${t.type}`"
        @click.self="dismissToast(t.id)"
      >
        {{ t.message }}
        <button class="toast-dismiss" @click.stop="dismissToast(t.id)">×</button>
      </div>
    </div>

    <div v-if="token" class="shell">
      <nav class="top-nav" aria-label="Main navigation">
        <div class="brand">
          <div class="brand-mark">TA</div>
          <div class="brand-name">Team Assistant</div>
        </div>

        <div class="tabs">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            class="tab"
            :class="{ 'tab--active': currentTab === tab.id }"
            @click="currentTab = tab.id"
          >
            {{ tab.label }}
          </button>
        </div>

        <div class="nav-actions">
          <button
            class="btn btn--ghost btn--sm"
            @click="refreshView"
            title="Refresh"
            aria-label="Refresh"
          >
            <span aria-hidden="true">↻</span>
          </button>
          <div
            class="health"
            :class="{ 'health--online': apiOk === true, 'health--offline': apiOk === false }"
            :title="apiStatusTitle"
          >
            <span class="dot"></span>
            {{ apiOk === null ? "Checking API…" : apiOk === true ? "API online" : "API offline" }}
          </div>
          <span class="user-chip">{{ currentRole }}</span>
          <button class="btn btn--danger btn--sm" @click="handleLogout">
            Sign out
          </button>
        </div>
      </nav>

      <div class="shell-body">
        <div class="page">
          <section
            :key="`${currentTab}-${refreshKey}`"
            class="page-body reveal"
            aria-live="polite"
          >
            <component :is="currentComponent" />
          </section>
        </div>
      </div>
    </div>

    <div v-else class="login-page">
      <AuthView @login="handleLogin" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import {
  apiHealth,
  getToken,
  onUnauthorized,
  showToast,
  addToastListener,
  type Toast,
} from "./api";
import AuthView from "./views/AuthView.vue";
import WhatsAppView from "./views/WhatsAppView.vue";
import EmployeesView from "./views/EmployeesView.vue";
import SchedulesView from "./views/SchedulesView.vue";
import HolidaysView from "./views/HolidaysView.vue";
import StandupsView from "./views/StandupsView.vue";
import ReportsView from "./views/ReportsView.vue";

const tabs = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "employees", label: "Employees" },
  { id: "schedules", label: "Schedules" },
  { id: "holidays", label: "Holidays" },
  { id: "standups", label: "Standups" },
  { id: "reports", label: "Reports" },
];

const views: Record<string, any> = {
  whatsapp: WhatsAppView,
  employees: EmployeesView,
  schedules: SchedulesView,
  holidays: HolidaysView,
  standups: StandupsView,
  reports: ReportsView,
};

const token = ref(getToken() ?? "");
const currentTab = ref(tabs[0].id);
const refreshKey = ref(0);
const apiOk = ref<boolean | null>(null);
const toasts = ref<Toast[]>([]);

const currentComponent = computed(() => views[currentTab.value]);

const currentRole = computed(() => {
  try {
    const payload = JSON.parse(atob(token.value.split(".")[1] ?? ""));
    return typeof payload.role === "string" ? payload.role : "user";
  } catch {
    return "user";
  }
});

const apiStatusTitle = computed(() => {
  if (apiOk.value === null) return "Checking API connection…";
  return apiOk.value === true ? "API is online" : "API is offline";
});

function dismissToast(id: number) {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

addToastListener((t) => {
  toasts.value.push(t);
  setTimeout(() => dismissToast(t.id), 5000);
});

onUnauthorized(() => {
  token.value = "";
  currentTab.value = tabs[0].id;
  showToast("Session expired. Please sign in again.", "error");
});

onMounted(async () => {
  apiOk.value = await apiHealth();
});

function handleLogin() {
  token.value = getToken() ?? "";
}

function handleLogout() {
  token.value = "";
  currentTab.value = tabs[0].id;
  toasts.value = [];
}

function refreshView() {
  refreshKey.value += 1;
}
</script>

<style scoped>
.toast-dismiss {
  line-height: 1;
}
</style>
