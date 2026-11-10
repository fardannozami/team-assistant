<template>
  <div class="space-y-5">
    <section class="rounded-3xl border border-border bg-panel p-5 shadow-soft-lg sm:p-8">
      <div class="mb-5 flex items-center gap-3">
        <div class="grid h-11 w-11 place-items-center rounded-2xl bg-accent font-display text-lg font-extrabold text-white">TA</div>
        <div>
          <p class="text-xs font-bold uppercase tracking-wider text-text-dim">Asisten tim</p>
          <h1 class="font-display text-2xl font-extrabold tracking-tight text-text">Halo, admin</h1>
        </div>
      </div>
      <div v-if="error" class="rounded-2xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger" role="alert">{{ error }}</div>
      <div v-else-if="loading" class="flex items-center gap-3 rounded-2xl bg-panel-hover p-4 text-sm text-text-muted">
        <span class="h-5 w-5 animate-spin rounded-full border-2 border-accent/20 border-t-accent" aria-hidden="true"></span>
        Memuat ringkasan hari ini…
      </div>
      <div v-else-if="report" class="rounded-2xl bg-panel-hover p-4 sm:p-5">
        <p class="text-base leading-relaxed text-text sm:text-lg">
          Hari ini <strong>{{ report.submittedCount }} dari {{ report.total }}</strong> anggota sudah mengisi standup.
          <template v-if="report.blockers.length">Ada <strong>{{ report.blockers.length }} hambatan</strong> yang perlu ditinjau.</template>
          <template v-else>Belum ada hambatan yang dilaporkan.</template>
        </p>
        <div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div class="rounded-xl border border-border bg-panel p-3">
            <div class="text-2xl font-extrabold text-text">{{ report.total }}</div>
            <div class="text-xs text-text-muted">Anggota</div>
          </div>
          <div class="rounded-xl border border-border bg-panel p-3">
            <div class="text-2xl font-extrabold text-success">{{ report.submittedCount }}</div>
            <div class="text-xs text-text-muted">Sudah mengisi</div>
          </div>
          <div class="rounded-xl border border-border bg-panel p-3">
            <div class="text-2xl font-extrabold text-warning">{{ report.notSubmittedCount }}</div>
            <div class="text-xs text-text-muted">Belum mengisi</div>
          </div>
          <div class="rounded-xl border border-border bg-panel p-3">
            <div class="text-2xl font-extrabold text-danger">{{ report.blockers.length }}</div>
            <div class="text-xs text-text-muted">Hambatan</div>
          </div>
        </div>
      </div>
      <div v-else class="rounded-2xl bg-panel-hover p-4 text-sm text-text-muted">Belum ada ringkasan untuk hari ini.</div>
    </section>

    <section aria-labelledby="next-steps-title">
      <div class="mb-3 flex items-end justify-between gap-3">
        <div>
          <p class="text-xs font-bold uppercase tracking-wider text-text-dim">Langkah berikutnya</p>
          <h2 id="next-steps-title" class="font-display text-lg font-extrabold text-text">Apa yang ingin dilakukan?</h2>
        </div>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <button v-for="action in actions" :key="action.id" class="flex min-h-20 items-center gap-4 rounded-2xl border border-border bg-panel p-4 text-left shadow-soft transition hover:border-accent/40 hover:bg-panel-hover focus-visible:outline-accent" @click="emit('navigate', action.id)">
          <span class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent/8 text-xl text-accent" aria-hidden="true">{{ action.icon }}</span>
          <span class="min-w-0 flex-1">
            <span class="block font-bold text-text">{{ action.title }}</span>
            <span class="mt-0.5 block text-sm text-text-muted">{{ action.description }}</span>
          </span>
          <span class="text-lg text-text-dim" aria-hidden="true">›</span>
        </button>
      </div>
    </section>

    <section class="rounded-2xl border border-border bg-panel p-4 sm:p-5">
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-xs font-bold uppercase tracking-wider text-text-dim">Laporan</p>
          <p class="mt-1 text-sm text-text-muted">Lihat rangkuman lengkap harian dan mingguan tim.</p>
        </div>
        <button class="min-h-11 shrink-0 rounded-xl bg-accent px-4 text-sm font-bold text-white transition hover:bg-accent-hover" @click="emit('navigate', 'reports')">Buka laporan</button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ApiError, reportsApi, type DailyReport } from "../api";

const emit = defineEmits<{ (event: "navigate", tab: string): void }>();
const report = ref<DailyReport | null>(null);
const loading = ref(true);
const error = ref("");

const actions = [
  { id: "standups", title: "Tinjau standup", description: "Baca jawaban dan hambatan", icon: "☷" },
  { id: "employees", title: "Kelola anggota", description: "Tambah atau cari anggota tim", icon: "♧" },
  { id: "schedules", title: "Atur jadwal", description: "Ubah waktu pengingat standup", icon: "◷" },
  { id: "whatsapp", title: "Hubungkan WhatsApp", description: "Cek status koneksi bot", icon: "↗" },
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

onMounted(loadSummary);
</script>
