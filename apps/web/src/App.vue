<template>
  <div class="app">
    <div class="pointer-events-none fixed inset-x-3 top-3 z-[60] flex flex-col items-end gap-3 sm:right-6 sm:top-6" role="region" aria-label="Notifikasi">
      <div v-for="t in toasts" :key="t.id" class="pointer-events-auto flex min-w-[min(100%,280px)] items-start gap-3 rounded-2xl border border-border bg-panel px-4 py-3 text-text shadow-soft-lg toast-in" :class="{ 'border-l-4 border-l-danger': t.type === 'error', 'border-l-4 border-l-success': t.type === 'success', 'border-l-4 border-l-accent': t.type === 'info' }">
        <p class="text-sm leading-relaxed">{{ t.message }}</p>
        <button class="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-lg text-lg text-text-dim hover:bg-panel-hover" @click="dismissToast(t.id)" aria-label="Tutup notifikasi">×</button>
      </div>
    </div>

    <div v-if="token" class="flex min-h-screen flex-col">
      <header class="sticky top-0 z-30 border-b border-border bg-panel/95 backdrop-blur">
        <div class="mx-auto flex h-16 max-w-[1080px] items-center justify-between gap-3 px-4 sm:px-6">
          <button class="flex min-w-0 items-center gap-3 text-left" @click="navigateTo('home')" aria-label="Ke beranda">
            <span class="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent font-display text-sm font-extrabold text-white">
              TA
              <span class="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-panel" :class="apiOk === true ? 'bg-success' : apiOk === false ? 'bg-danger' : 'bg-text-muted'" :title="apiStatusTitle"></span>
            </span>
            <span class="min-w-0">
              <span class="block truncate font-display text-base font-extrabold leading-tight tracking-tight text-text">Team Assistant</span>
              <span v-if="me" class="block truncate text-xs text-text-muted">{{ me.workspace.name }}</span>
            </span>
          </button>

          <nav class="hidden items-center gap-1 md:flex" aria-label="Navigasi utama">
            <button v-for="tab in tabs" :key="tab.id" class="min-h-10 rounded-xl px-3 text-sm font-semibold transition hover:bg-panel-hover" :class="currentTab === tab.id ? 'bg-accent/10 text-accent' : 'text-text-muted'" :aria-current="currentTab === tab.id ? 'page' : undefined" @click="navigateTo(tab.id)">{{ tab.label }}</button>
          </nav>

          <div class="flex shrink-0 items-center gap-1">
            <button class="grid h-10 w-10 place-items-center rounded-xl text-base font-bold text-text-muted transition hover:bg-panel-hover" @click="showTour = true" aria-label="Lihat panduan" title="Lihat panduan">?</button>
            <button class="min-h-10 rounded-xl px-3 text-sm font-semibold text-text-muted transition hover:bg-danger/5 hover:text-danger" @click="handleLogout">Keluar</button>
          </div>
        </div>
      </header>

      <main class="mx-auto w-full max-w-[1080px] flex-1 px-4 pb-28 pt-5 sm:px-6 sm:pt-8 md:pb-10">
        <section :key="currentTab" class="reveal" aria-live="polite">
          <SettingsView v-if="currentTab === 'settings'" :section="settingsSection" @section="settingsSection = $event" />
          <component v-else :is="currentComponent" @navigate="navigateTo" @tour="showTour = true" />
        </section>
      </main>

      <nav class="mobile-nav fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-panel/95 px-1 pt-2 backdrop-blur md:hidden" aria-label="Navigasi utama">
        <button v-for="tab in tabs" :key="tab.id" class="flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-semibold" :class="currentTab === tab.id ? 'text-accent' : 'text-text-muted'" :aria-current="currentTab === tab.id ? 'page' : undefined" @click="navigateTo(tab.id)">
          <span class="text-lg leading-none" aria-hidden="true">{{ tab.icon }}</span>
          <span>{{ tab.label }}</span>
        </button>
      </nav>

      <OnboardingTour v-if="showTour" @close="closeTour" />
    </div>

    <div v-else class="relative z-10 flex min-h-screen items-center justify-center px-4 py-8 sm:px-6">
      <AuthView :initial-error="oauthError" @login="handleLogin" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { apiHealth, authApi, consumeOAuthRedirect, getToken, type Me, onUnauthorized, showToast, addToastListener, type Toast } from "./api";
import AuthView from "./views/AuthView.vue";
import HomeView from "./views/HomeView.vue";
import EmployeesView from "./views/EmployeesView.vue";
import StandupsView from "./views/StandupsView.vue";
import ReportsView from "./views/ReportsView.vue";
import SettingsView from "./views/SettingsView.vue";
import OnboardingTour from "./views/OnboardingTour.vue";

const tabs = [
  { id: "home", label: "Beranda", icon: "⌂" },
  { id: "standups", label: "Standup", icon: "☷" },
  { id: "employees", label: "Anggota", icon: "♧" },
  { id: "reports", label: "Laporan", icon: "▤" },
  { id: "settings", label: "Pengaturan", icon: "⚙" },
];
const settingsSections = ["whatsapp", "schedules", "holidays"];
const views: Record<string, any> = { home: HomeView, employees: EmployeesView, standups: StandupsView, reports: ReportsView };
const ONBOARDED_KEY = "ta_onboarded";

const oauthError = consumeOAuthRedirect();
const token = ref(getToken() ?? "");
const me = ref<Me | null>(null);
const currentTab = ref("home");
const settingsSection = ref("whatsapp");
const apiOk = ref<boolean | null>(null);
const toasts = ref<Toast[]>([]);
const showTour = ref(!!token.value && !hasOnboarded());
const currentComponent = computed(() => views[currentTab.value]);
const apiStatusTitle = computed(() => apiOk.value === null ? "Memeriksa koneksi API" : apiOk.value ? "API terhubung" : "API tidak terhubung");

function hasOnboarded() {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === "1";
  } catch {
    return true;
  }
}
function closeTour() {
  showTour.value = false;
  try {
    localStorage.setItem(ONBOARDED_KEY, "1");
  } catch {
    // Storage unavailable; the tour simply shows again next time.
  }
}

function dismissToast(id: number) { toasts.value = toasts.value.filter((toast) => toast.id !== id); }
addToastListener((toast) => {
  toasts.value.push(toast);
  setTimeout(() => dismissToast(toast.id), 5000);
});
onUnauthorized(() => {
  token.value = "";
  currentTab.value = "home";
  showToast("Sesi berakhir. Silakan masuk kembali.", "error");
});
async function loadMe() {
  me.value = token.value ? await authApi.me().catch(() => null) : null;
}
onMounted(async () => {
  loadMe();
  apiOk.value = await apiHealth();
});
function navigateTo(tab: string) {
  if (settingsSections.includes(tab)) {
    settingsSection.value = tab;
    currentTab.value = "settings";
  } else {
    currentTab.value = tab;
  }
}
function handleLogin() {
  loadMe();
  token.value = getToken() ?? "";
  showTour.value = !hasOnboarded();
}
function handleLogout() { authApi.logout(); token.value = ""; me.value = null; currentTab.value = "home"; toasts.value = []; showTour.value = false; }
</script>
