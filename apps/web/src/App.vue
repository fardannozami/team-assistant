<template>
  <div class="app">
    <div
      class="fixed top-[22px] right-[22px] flex flex-col gap-3 z-[60] pointer-events-none"
      role="region"
      aria-label="Notifications"
    >
      <div
        v-for="t in toasts"
        :key="t.id"
        class="pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-sm border border-border bg-panel text-text shadow-lg min-w-[250px] toast-in"
        :class="{
          'border-l-4 border-danger': t.type === 'error',
          'border-l-4 border-success': t.type === 'success',
        }"
        @click.self="dismissToast(t.id)"
      >
        {{ t.message }}
        <button
          class="w-6 h-6 rounded-[6px] border border-border text-text-muted text-[18px] leading-none grid place-items-center ml-2 shrink-0 hover:bg-panel-hover hover:text-text"
          @click.stop="dismissToast(t.id)"
        >
          ×
        </button>
      </div>
    </div>

    <div v-if="token" class="relative z-1 flex flex-col h-screen">
      <nav class="fixed inset-x-0 top-0 z-20 h-16 flex items-center justify-between px-[26px] bg-bg/72 border-b border-border backdrop-blur-lg" aria-label="Main navigation">
        <div class="flex items-center gap-2.5 font-extrabold text-sm tracking-tight">
          <div class="w-8 h-8 rounded-[10px] bg-accent text-white text-[15px] grid place-items-center shadow-[0_0_0_5px_rgba(91,107,245,0.45)]">TA</div>
          <div class="hidden sm:block font-extrabold text-sm tracking-tight">Team Assistant</div>
        </div>

        <div class="flex border-b border-border ml-[34px] overflow-x-auto">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            class="h-16 flex items-center px-5 text-[12px] font-extrabold tracking-wider uppercase border-b-2 border-transparent whitespace-nowrap transition-colors duration-200 ease-in hover:text-text hover:bg-white/5"
            :class="{
              'text-accent border-accent bg-accent/7': currentTab === tab.id,
            }"
            @click="currentTab = tab.id"
          >
            {{ tab.label }}
          </button>
        </div>

        <div class="flex items-center gap-3 shrink-0">
          <button
            class="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-sm text-[12px] font-extrabold tracking-tight border border-border bg-panel-hover text-text transition-all duration-200 ease-in hover:border-text-muted hover:bg-panel hover:text-text hover:-translate-y-1 active:scale-95 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none whitespace-nowrap leading-none"
            @click="refreshView"
            title="Refresh"
            aria-label="Refresh"
          >
            <span aria-hidden="true">↻</span>
          </button>
          <div
            class="inline-flex items-center gap-2 text-[12px] font-extrabold tracking-wider uppercase text-text-muted px-2.5 py-1 rounded-full border border-border bg-panel-hover"
            :class="{
              'bg-success/10 text-success border-success/30': apiOk === true,
              'bg-danger/10 text-danger border-danger/35': apiOk === false,
            }"
            :title="apiStatusTitle"
          >
            <span
              class="w-2 h-2 rounded-full bg-text-muted shadow-[0_0_0_3px_rgba(148,163,184,0.2)]"
              :class="{
                'bg-success shadow-[0_0_0_3px_rgba(52,211,153,0.4)]': apiOk === true,
                'bg-danger shadow-[0_0_0_3px_rgba(233,90,107,0.4)]': apiOk === false,
              }"
            ></span>
            {{
              apiOk === null
                ? "Checking API…"
                : apiOk === true
                ? "API online"
                : "API offline"
            }}
          </div>
          <span class="text-[12px] font-extrabold tracking-tight text-text-muted px-2.5">{{ currentRole }}</span>
          <button
            class="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-sm text-[12px] font-extrabold tracking-tight border border-danger/40 bg-danger/10 text-danger transition-all duration-200 ease-in hover:bg-danger/35 hover:border-danger hover:-translate-y-1 active:scale-95 focus:outline-none whitespace-nowrap leading-none"
            @click="handleLogout"
          >
            Sign out
          </button>
        </div>
      </nav>

      <div class="flex-1 pt-16 pb-10 overflow-y-auto">
        <div class="max-w-[1240px] mx-auto px-[26px]">
          <section
            :key="`${currentTab}-${refreshKey}`"
            class="flex flex-col gap-4.5 reveal"
            aria-live="polite"
          >
            <component :is="currentComponent" />
          </section>
        </div>
      </div>
    </div>

    <div v-else class="flex items-center justify-center min-h-screen px-6 relative z-1">
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
