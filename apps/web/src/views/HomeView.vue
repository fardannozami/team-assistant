<template>
  <div class="space-y-5">
    <section v-if="setupLoaded && !setupDone" class="rounded-3xl border border-accent/30 bg-panel p-5 shadow-soft-lg sm:p-6" aria-labelledby="setup-title">
      <div class="mb-4 flex items-start justify-between gap-3">
        <div>
          <p class="text-xs font-bold uppercase tracking-wider text-accent">Persiapan · {{ doneCount }} dari {{ setup.length }}</p>
          <h2 id="setup-title" class="font-display text-xl font-extrabold tracking-tight text-text">Siapkan tim Anda</h2>
        </div>
        <button class="min-h-10 shrink-0 rounded-xl px-3 text-sm font-semibold text-text-muted hover:bg-panel-hover" @click="emit('tour')">Lihat panduan</button>
      </div>
      <div class="mb-4 h-1.5 overflow-hidden rounded-full bg-panel-hover">
        <div class="h-full rounded-full bg-accent transition-all" :style="{ width: `${(doneCount / setup.length) * 100}%` }"></div>
      </div>
      <ol class="space-y-2">
        <li v-for="(item, i) in setup" :key="item.id">
          <button
            class="flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition"
            :class="item.done ? 'border-transparent bg-panel-hover' : item.id === nextStep?.id ? 'border-accent/40 bg-accent/5 hover:bg-accent/10' : 'border-border hover:bg-panel-hover'"
            :disabled="item.done"
            @click="emit('navigate', item.id)"
          >
            <span class="grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold" :class="item.done ? 'bg-success text-white' : 'border border-border bg-panel text-text-dim'" aria-hidden="true">{{ item.done ? "✓" : i + 1 }}</span>
            <span class="min-w-0 flex-1">
              <span class="block font-bold" :class="item.done ? 'text-text-muted line-through' : 'text-text'">{{ item.title }}</span>
              <span v-if="!item.done" class="block text-sm text-text-muted">{{ item.description }}</span>
            </span>
            <span v-if="!item.done" class="text-lg text-text-dim" aria-hidden="true">›</span>
          </button>
        </li>
      </ol>
    </section>

    <section class="rounded-3xl border border-border bg-panel p-5 shadow-soft sm:p-6">
      <p class="text-xs font-bold uppercase tracking-wider text-text-dim">Hari ini</p>
      <div v-if="error" class="mt-3 rounded-2xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger" role="alert">{{ error }}</div>
      <div v-else-if="loading" class="mt-3 flex items-center gap-3 text-sm text-text-muted">
        <span class="h-5 w-5 animate-spin rounded-full border-2 border-accent/20 border-t-accent" aria-hidden="true"></span>
        Memuat ringkasan…
      </div>
      <template v-else-if="report && report.total">
        <p class="mt-1 font-display text-2xl font-extrabold tracking-tight text-text">
          {{ report.submittedCount }} dari {{ report.total }} sudah mengisi
        </p>
        <div class="mt-3 h-2 overflow-hidden rounded-full bg-panel-hover">
          <div class="h-full rounded-full bg-success transition-all" :style="{ width: `${(report.submittedCount / report.total) * 100}%` }"></div>
        </div>
        <p class="mt-3 text-sm" :class="report.blockers.length ? 'font-semibold text-danger' : 'text-text-muted'">
          {{ report.blockers.length ? `${report.blockers.length} hambatan perlu ditinjau` : "Tidak ada hambatan dilaporkan" }}
        </p>
      </template>
      <p v-else class="mt-1 text-sm text-text-muted">Ringkasan muncul setelah anggota mulai mengisi standup.</p>
    </section>

    <div class="grid gap-3 sm:grid-cols-2">
      <button v-for="action in actions" :key="action.id" class="flex min-h-20 items-center gap-4 rounded-2xl border border-border bg-panel p-4 text-left shadow-soft transition hover:border-accent/40 hover:bg-panel-hover" @click="emit('navigate', action.id)">
        <span class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent/10 text-xl text-accent" aria-hidden="true">{{ action.icon }}</span>
        <span class="min-w-0 flex-1">
          <span class="block font-bold text-text">{{ action.title }}</span>
          <span class="mt-0.5 block text-sm text-text-muted">{{ action.description }}</span>
        </span>
        <span class="text-lg text-text-dim" aria-hidden="true">›</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ApiError, employeesApi, reportsApi, schedulesApi, whatsappApi, type DailyReport } from "../api";

const emit = defineEmits<{ (event: "navigate", tab: string): void; (event: "tour"): void }>();
const report = ref<DailyReport | null>(null);
const loading = ref(true);
const error = ref("");

const setupLoaded = ref(false);
const status = ref({ whatsapp: false, employees: false, schedules: false });
const setup = computed(() => [
  { id: "whatsapp", title: "Hubungkan WhatsApp", description: "Tautkan nomor bot agar bisa mengirim pesan", done: status.value.whatsapp },
  { id: "employees", title: "Tambah anggota tim", description: "Masukkan nama dan nomor WhatsApp anggota", done: status.value.employees },
  { id: "schedules", title: "Atur jadwal standup", description: "Tentukan jam pertanyaan dikirim setiap hari", done: status.value.schedules },
]);
const doneCount = computed(() => setup.value.filter((s) => s.done).length);
const setupDone = computed(() => doneCount.value === setup.value.length);
const nextStep = computed(() => setup.value.find((s) => !s.done));

const actions = [
  { id: "standups", title: "Tinjau standup", description: "Baca jawaban dan hambatan hari ini", icon: "☷" },
  { id: "reports", title: "Lihat laporan", description: "Rangkuman harian dan mingguan", icon: "▤" },
];

async function loadSummary() {
  loading.value = true;
  error.value = "";
  try {
    report.value = await reportsApi.daily(new Date().toISOString().slice(0, 10));
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Ringkasan gagal dimuat.";
  } finally {
    loading.value = false;
  }
}

async function loadSetup() {
  const [wa, employees, schedules] = await Promise.allSettled([whatsappApi.status(), employeesApi.list({ active: true }), schedulesApi.list()]);
  status.value = {
    whatsapp: wa.status === "fulfilled" && (wa.value.connected || wa.value.registered),
    employees: employees.status === "fulfilled" && employees.value.length > 0,
    schedules: schedules.status === "fulfilled" && schedules.value.some((s) => s.isActive),
  };
  setupLoaded.value = true;
}

onMounted(() => {
  loadSummary();
  loadSetup();
});
</script>
