<template>
  <div class="app">
    <div class="pointer-events-none fixed inset-x-3 top-3 z-[60] flex flex-col items-end gap-3 sm:right-6 sm:top-6" role="region" aria-label="Notifikasi">
      <div v-for="t in toasts" :key="t.id" class="pointer-events-auto flex min-w-[min(100%,280px)] items-start gap-3 rounded-2xl border border-border bg-panel px-4 py-3 text-text shadow-soft-lg toast-in" :class="{ 'border-l-4 border-l-danger': t.type === 'error', 'border-l-4 border-l-success': t.type === 'success', 'border-l-4 border-l-accent': t.type === 'info' }">
        <p class="text-sm leading-relaxed">{{ t.message }}</p>
        <button class="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-lg text-lg text-text-dim hover:bg-panel-hover" @click="dismissToast(t.id)" aria-label="Tutup notifikasi">×</button>
      </div>
    </div>

    <div v-if="token" class="flex min-h-screen flex-col">
      <header class="sticky top-0 z-30 border-b border-border bg-panel/95 shadow-soft backdrop-blur">
        <div class="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-3 px-4 sm:h-[72px] sm:px-6">
          <button class="flex min-w-0 items-center gap-3 text-left" @click="navigateTo('home')" aria-label="Ke beranda">
            <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent font-display text-base font-extrabold text-white shadow-accent">TA</span>
            <span class="truncate font-display text-base font-extrabold tracking-tight text-text sm:text-lg">Team Assistant</span>
          </button>

          <nav class="hidden min-w-0 flex-1 items-center justify-center gap-1 lg:flex" aria-label="Navigasi utama">
            <button v-for="tab in tabs" :key="tab.id" class="min-h-11 rounded-xl px-3 text-sm font-semibold transition hover:bg-panel-hover" :class="currentTab === tab.id ? 'bg-accent/8 text-accent' : 'text-text-muted'" :aria-current="currentTab === tab.id ? 'page' : undefined" @click="navigateTo(tab.id)">{{ tab.label }}</button>
          </nav>

          <div class="flex shrink-0 items-center gap-2">
            <span class="hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold sm:inline-flex" :class="{ 'border-success/20 bg-success/8 text-success': apiOk === true, 'border-danger/20 bg-danger/8 text-danger': apiOk === false, 'border-border bg-panel-hover text-text-dim': apiOk === null }" :title="apiStatusTitle">
              <span class="h-2 w-2 rounded-full" :class="apiOk === true ? 'bg-success' : apiOk === false ? 'bg-danger' : 'bg-text-muted'"></span>
              {{ apiOk === null ? 'Memeriksa' : apiOk ? 'Terhubung' : 'Terputus' }}
            </span>
            <button class="grid h-10 w-10 place-items-center rounded-xl border border-border text-lg text-text-muted transition hover:bg-panel-hover" @click="refreshView" aria-label="Muat ulang" title="Muat ulang">↻</button>
            <div class="hidden items-center gap-3 border-l border-border pl-3 lg:flex">
              <span class="text-xs font-bold uppercase text-text-dim">{{ currentRole }}</span>
              <button class="min-h-10 rounded-xl border border-danger/20 px-3 text-sm font-semibold text-danger transition hover:bg-danger/5" @click="handleLogout">Keluar</button>
            </div>
            <button class="grid h-10 w-10 place-items-center rounded-xl border border-border text-xl text-text-muted transition hover:bg-panel-hover lg:hidden" :aria-expanded="mobileMenuOpen" aria-label="Menu lainnya" @click="mobileMenuOpen = !mobileMenuOpen">⋯</button>
          </div>
        </div>

        <div v-if="mobileMenuOpen" class="absolute inset-x-0 top-full z-40 border-b border-border bg-panel p-4 shadow-soft-lg lg:hidden">
          <p class="mb-2 px-2 text-xs font-bold uppercase tracking-wider text-text-dim">Menu lainnya</p>
          <div class="grid grid-cols-2 gap-2">
            <button v-for="tab in secondaryTabs" :key="tab.id" class="min-h-11 rounded-xl border border-border px-3 text-left text-sm font-semibold text-text" @click="navigateTo(tab.id)">{{ tab.label }}</button>
          </div>
          <div class="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs text-text-muted">
            <span>{{ currentRole }} · {{ apiOk === true ? 'API terhubung' : apiOk === false ? 'API terputus' : 'Memeriksa API' }}</span>
            <button class="min-h-10 rounded-xl px-3 font-bold text-danger" @click="handleLogout">Keluar</button>
          </div>
        </div>
      </header>

      <main class="mx-auto w-full max-w-[1280px] flex-1 px-4 pb-28 pt-5 sm:px-6 sm:pt-8 lg:pb-10">
        <section :key="`${currentTab}-${refreshKey}`" class="reveal" aria-live="polite">
          <component :is="currentComponent" @navigate="navigateTo" />
        </section>
      </main>

      <nav class="mobile-nav fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-panel/95 px-1 pt-2 shadow-soft-lg backdrop-blur lg:hidden" aria-label="Navigasi utama">
        <button v-for="tab in primaryTabs" :key="tab.id" class="flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-semibold" :class="currentTab === tab.id ? 'text-accent' : 'text-text-muted'" :aria-current="currentTab === tab.id ? 'page' : undefined" @click="navigateTo(tab.id)">
          <span class="text-lg leading-none" aria-hidden="true">{{ tab.icon }}</span>
          <span>{{ tab.label }}</span>
        </button>
        <button class="flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-semibold" :class="secondaryTabs.some((tab) => tab.id === currentTab) ? 'text-accent' : 'text-text-muted'" :aria-expanded="mobileMenuOpen" @click="mobileMenuOpen = !mobileMenuOpen">
          <span class="text-lg leading-none" aria-hidden="true">•••</span>
          <span>Lainnya</span>
        </button>
      </nav>
    </div>

    <div v-else class="relative z-10 flex min-h-screen items-center justify-center px-4 py-8 sm:px-6">
      <AuthView @login="handleLogin" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { apiHealth, getToken, onUnauthorized, showToast, addToastListener, type Toast } from "./api";
import AuthView from "./views/AuthView.vue";
import HomeView from "./views/HomeView.vue";
import WhatsAppView from "./views/WhatsAppView.vue";
import EmployeesView from "./views/EmployeesView.vue";
import SchedulesView from "./views/SchedulesView.vue";
import HolidaysView from "./views/HolidaysView.vue";
import StandupsView from "./views/StandupsView.vue";
import ReportsView from "./views/ReportsView.vue";

const tabs = [
  { id: "home", label: "Beranda", icon: "⌂" },
  { id: "standups", label: "Standup", icon: "☷" },
  { id: "employees", label: "Anggota", icon: "♧" },
  { id: "reports", label: "Laporan", icon: "▤" },
  { id: "whatsapp", label: "WhatsApp", icon: "↗" },
  { id: "schedules", label: "Jadwal", icon: "◷" },
  { id: "holidays", label: "Hari libur", icon: "☼" },
];
const primaryTabs = tabs.slice(0, 4);
const secondaryTabs = tabs.slice(4);
const views: Record<string, any> = { home: HomeView, whatsapp: WhatsAppView, employees: EmployeesView, schedules: SchedulesView, holidays: HolidaysView, standups: StandupsView, reports: ReportsView };

const token = ref(getToken() ?? "");
const currentTab = ref("home");
const refreshKey = ref(0);
const apiOk = ref<boolean | null>(null);
const toasts = ref<Toast[]>([]);
const mobileMenuOpen = ref(false);
const currentComponent = computed(() => views[currentTab.value]);
const currentRole = computed(() => {
  try {
    const payload = JSON.parse(atob(token.value.split(".")[1] ?? ""));
    return typeof payload.role === "string" ? payload.role : "user";
  } catch {
    return "user";
  }
});
const apiStatusTitle = computed(() => apiOk.value === null ? "Memeriksa koneksi API" : apiOk.value ? "API terhubung" : "API tidak terhubung");

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
onMounted(async () => { apiOk.value = await apiHealth(); });
function navigateTo(tab: string) { currentTab.value = tab; mobileMenuOpen.value = false; }
function handleLogin() { token.value = getToken() ?? ""; }
function handleLogout() { token.value = ""; currentTab.value = "home"; toasts.value = []; mobileMenuOpen.value = false; }
function refreshView() { refreshKey.value += 1; }
</script>
