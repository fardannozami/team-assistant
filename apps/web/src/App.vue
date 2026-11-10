<template>
  <div class="app">
    <div
      class="fixed top-[26px] right-[26px] flex flex-col gap-3 z-[60] pointer-events-none"
      role="region"
      aria-label="Notifications"
    >
      <div
        v-for="t in toasts"
        :key="t.id"
        class="pointer-events-auto flex items-start gap-3 px-4 py-3.5 rounded-xl border border-border bg-panel text-text shadow-soft-lg min-w-[260px] toast-in"
        :class="{
          'border-l-3 border-danger': t.type === 'error',
          'border-l-3 border-success': t.type === 'success',
          'border-l-3 border-accent': t.type === 'info',
        }"
        @click.self="dismissToast(t.id)"
      >
        <p class="text-sm leading-relaxed">{{ t.message }}</p>
        <button
          class="ml-auto shrink-0 w-6 h-6 rounded-lg border border-border text-text-dim text-[18px] leading-none grid place-items-center transition-colors hover:bg-panel-hover hover:text-text"
          @click.stop="dismissToast(t.id)"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>

    <div v-if="token" class="relative z-1 flex flex-col h-screen">
      <nav class="fixed inset-x-0 top-0 z-20 h-20 border-b border-border bg-panel shadow-soft" aria-label="Main navigation">
        <div class="flex h-20 items-center justify-between px-6">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-accent text-white text-[17px] font-display font-extrabold grid place-items-center shadow-accent">TA</div>
            <div class="hidden sm:block font-display font-extrabold text-[18px] tracking-tight text-text">Team Assistant</div>
          </div>

          <div class="flex flex-1 min-w-0 gap-1 overflow-x-auto">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              class="flex-shrink-0 h-20 flex items-center px-4 text-[13px] font-extrabold tracking-tight uppercase text-text-dim whitespace-nowrap border-b-2 border-transparent transition-colors duration-200 ease-in hover:bg-accent/4 hover:text-accent"
              :class="{
                'text-accent border-accent bg-accent/4': currentTab === tab.id,
              }"
              :aria-current="currentTab === tab.id ? 'page' : undefined"
              @click="currentTab = tab.id"
            >
              {{ tab.label }}
            </button>
          </div>

          <div class="flex items-center gap-3 shrink-0">
            <button
              class="flex-shrink-0 inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-xl text-[12px] font-extrabold tracking-tight border border-border bg-panel-hover text-text transition-all duration-200 ease-in hover:border-text-muted hover:bg-panel-hover hover:text-text hover:-translate-y-1 active:scale-95 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none whitespace-nowrap leading-none"
              @click="refreshView"
              title="Refresh"
              aria-label="Refresh"
            >
              <span aria-hidden="true">↻</span>
            </button>
            <div
              class="inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-[11px] font-extrabold tracking-tight uppercase transition-colors duration-200 ease-in"
              :class="{
                'bg-success/8 text-success border-success/20': apiOk === true,
                'bg-danger/8 text-danger border-danger/20': apiOk === false,
                'bg-panel-hover text-text-dim border border-border': apiOk === null,
              }"
              :title="apiStatusTitle"
            >
              <span
                class="w-2 h-2 rounded-full"
                :class="{
                  'bg-success shadow-[0_0_0_3px_rgba(46,158,127,0.4)]': apiOk === true,
                  'bg-danger shadow-[0_0_0_3px_rgba(199,74,92,0.4)]': apiOk === false,
                  'bg-text-muted': apiOk === null,
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
            <span class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim px-2">{{ currentRole }}</span>
            <button
              class="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-xl text-[12px] font-extrabold tracking-tight border border-danger/20 bg-danger/6 text-danger transition-all duration-200 ease-in hover:bg-danger/10 hover:border-danger/40 hover:-translate-y-1 active:scale-95 focus:outline-none whitespace-nowrap leading-none"
              @click="handleLogout"
            >
              Sign out
            </button>
          </div>
        </div>
      </nav>

      <div class="flex-1 pt-20 pb-12 overflow-y-auto">
        <div class="max-w-[1280px] mx-auto px-6">
          <section :key="`${currentTab}-${refreshKey}`" class="flex flex-col gap-6 reveal" aria-live="polite">
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
