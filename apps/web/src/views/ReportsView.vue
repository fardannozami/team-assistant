<template>
  <header class="flex items-baseline justify-between gap-3 flex-wrap mb-7">
    <div>
      <h2 class="text-[26px] font-display font-extrabold tracking-tight text-text">Laporan</h2>
      <p class="text-text-muted text-sm mt-1">
        Ringkasan standup harian dan mingguan tim.
      </p>
    </div>
  </header>

  <!-- Each tab keeps its own error so one failure doesn't hide the other's empty state. -->
  <div v-if="reportTab === 'daily' && dailyError" class="mb-5 px-4 py-3.5 rounded-xl border border-danger/30 bg-danger/5 text-danger text-[12px] font-extrabold slide-in">{{ dailyError }}</div>
  <div v-if="reportTab === 'weekly' && weeklyError" class="mb-5 px-4 py-3.5 rounded-xl border border-danger/30 bg-danger/5 text-danger text-[12px] font-extrabold slide-in">{{ weeklyError }}</div>

  <div class="mb-7 flex overflow-x-auto border-b border-border">
    <button
      v-for="t in TABS"
      :key="t.id"
      class="flex-shrink-0 h-10 flex items-center px-4 text-[12px] font-extrabold tracking-tight uppercase border-b-2 border-transparent whitespace-nowrap transition-colors duration-200 ease-in hover:text-accent hover:bg-accent/4"
      :class="{ 'text-accent border-accent bg-accent/4': reportTab === t.id }"
      @click="reportTab = t.id"
    >
      {{ t.label }}
    </button>
  </div>

  <!-- Daily report -->
  <div v-if="reportTab === 'daily'" class="rounded-2xl border border-border bg-panel p-4 shadow-soft-lg sm:p-6 reveal">
    <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-4">Laporan harian</div>
    <div class="flex items-end gap-3 mb-5 flex-wrap">
      <div class="min-w-[220px]">
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Tanggal</label>
        <input v-model="dailyDate" type="date"
          class="w-full px-4 py-3.5 rounded-xl border text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none bg-panel border-border"
        />
      </div>
      <button
        class="inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl border border-transparent text-[13px] leading-5 font-extrabold tracking-tight bg-accent text-white shadow-accent transition-all duration-200 ease-in hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
        :disabled="loadingDaily"
        @click="loadDaily"
      >
        Muat laporan
      </button>
    </div>

    <div v-if="loadingDaily && !dailyReport" class="flex flex-col items-center gap-2.5 py-24 text-center text-text-muted fade-in-fast">
      <span class="w-10 h-10 border-2 border-accent/20 border-t-accent rounded-full spin-slow" aria-hidden="true"></span> Membuat laporan…
    </div>

    <div v-if="dailyReport" class="report-body">
      <div class="mb-7 grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(170px,1fr))] sm:gap-4">
        <div class="border border-border rounded-xl bg-panel-hover p-5 transition-colors duration-200 ease-in hover:border-border-focus">
          <div class="text-[30px] font-display font-extrabold tracking-tight text-text">{{ dailyReport.total }}</div>
          <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mt-2">Anggota</div>
        </div>
        <div class="border border-border rounded-xl bg-panel-hover p-5 transition-colors duration-200 ease-in hover:border-border-focus">
          <div class="text-[30px] font-display font-extrabold tracking-tight text-success">{{ dailyReport.submittedCount }}</div>
          <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mt-2">Sudah mengisi</div>
        </div>
        <div class="border border-border rounded-xl bg-panel-hover p-5 transition-colors duration-200 ease-in hover:border-border-focus">
          <div class="text-[30px] font-display font-extrabold tracking-tight text-danger">{{ dailyReport.notSubmittedCount }}</div>
          <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mt-2">Belum mengisi</div>
        </div>
        <div class="border border-border rounded-xl bg-panel-hover p-5 transition-colors duration-200 ease-in hover:border-border-focus">
          <div class="text-[30px] font-display font-extrabold tracking-tight text-danger">{{ dailyReport.blockers.length }}</div>
          <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mt-2">Hambatan</div>
        </div>
      </div>
      <pre class="border border-border rounded-xl bg-panel-hover p-5 overflow-auto font-mono text-[13px] leading-[1.7] text-text-muted whitespace-pre-wrap"><template v-for="(part, i) in linkParts(dailyReport.text, commitLinks(dailyReport))" :key="i"><a v-if="part.url" :href="part.url" target="_blank" rel="noopener noreferrer" class="text-accent underline hover:text-accent-hover">{{ part.text }}</a><template v-else>{{ part.text }}</template></template></pre>
    </div>

    <div v-if="!loadingDaily && !dailyError && !dailyReport" class="flex flex-col items-center justify-center py-24 text-center fade-in">
      <div class="w-14 h-14 rounded-full border border-border bg-panel-hover flex items-center justify-center text-text-dim mb-4" aria-hidden="true">—</div>
      <h3 class="text-[18px] font-extrabold tracking-tight text-text mb-1">Belum ada laporan</h3>
      <p class="text-text-muted text-sm">Pilih tanggal dan muat laporan harian.</p>
    </div>
  </div>

  <!-- Weekly report -->
  <div v-if="reportTab === 'weekly'" class="rounded-2xl border border-border bg-panel p-4 shadow-soft-lg sm:p-6 reveal">
    <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-4">Laporan mingguan</div>
    <div class="flex items-center gap-3 mb-5 flex-wrap">
      <button
        class="inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-[13px] font-extrabold tracking-tight bg-accent text-white shadow-accent transition-all duration-200 ease-in hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
        :disabled="loadingWeekly"
        @click="loadWeekly"
      >
        Buat laporan mingguan
      </button>
    </div>

    <div v-if="loadingWeekly && !weeklyReport" class="flex flex-col items-center gap-2.5 py-24 text-center text-text-muted fade-in-fast">
      <span class="w-10 h-10 border-2 border-accent/20 border-t-accent rounded-full spin-slow" aria-hidden="true"></span> Membuat laporan…
    </div>

    <div v-if="weeklyReport" class="report-body">
      <div class="mb-4">
        <span class="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-border bg-panel text-[12px] font-extrabold">{{ weeklyReport.start }}</span>
        <span class="text-[11px] font-extrabold tracking-tight text-text-dim">sampai</span>
        <span class="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-border bg-panel text-[12px] font-extrabold">{{ weeklyReport.end }}</span>
      </div>

      <div class="mb-6 grid gap-2 sm:hidden">
        <article v-for="d in weeklyReport.days" :key="d.date" class="flex items-center justify-between gap-3 rounded-xl border border-border bg-panel-hover p-3 text-sm">
          <span class="font-semibold text-text">{{ d.date }}</span>
          <span class="text-text-muted">{{ d.submitted }} / {{ d.total }} mengisi</span>
        </article>
      </div>
      <div class="table-scroll mb-6 hidden rounded-xl border border-border sm:block">
        <table class="w-full border-collapse text-[13px]">
          <thead>
            <tr class="text-text-dim">
              <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Tanggal</th>
              <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Sudah mengisi</th>
              <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Jumlah anggota</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in weeklyReport.days" :key="d.date" class="hover:bg-panel-hover transition-colors duration-200 ease-in">
              <td class="px-5 py-4 border-b border-border align-middle text-text">{{ d.date }}</td>
              <td class="px-5 py-4 border-b border-border align-middle text-text">{{ d.submitted }}</td>
              <td class="px-5 py-4 border-b border-border align-middle text-text">{{ d.total }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="weeklyReport.repeatedBlockers.length">
        <div class="text-[17px] font-extrabold tracking-tight text-text mb-3">Hambatan berulang</div>
        <div class="flex flex-wrap gap-2 mb-6">
          <span
            v-for="b in weeklyReport.repeatedBlockers"
            :key="b.blocker"
            class="badge bg-warning/8 text-warning border-warning/20"
          >
            {{ b.blocker }} ({{ b.count }}x)
          </span>
        </div>
      </div>

      <pre class="border border-border rounded-xl bg-panel-hover p-5 overflow-auto font-mono text-[13px] leading-[1.7] text-text-muted whitespace-pre-wrap">{{ weeklyReport.text }}</pre>
    </div>

    <div v-if="!loadingWeekly && !weeklyError && !weeklyReport" class="flex flex-col items-center justify-center py-24 text-center fade-in">
      <div class="w-14 h-14 rounded-full border border-border bg-panel-hover flex items-center justify-center text-text-dim mb-4" aria-hidden="true">—</div>
      <h3 class="text-[18px] font-extrabold tracking-tight text-text mb-1">Belum ada laporan mingguan</h3>
      <p class="text-text-muted text-sm">Buat laporan mingguan untuk melihat progres tim.</p>
    </div>
  </div>

  <CheckinResults v-if="reportTab === 'checkout'" key="checkout" kind="checkout" />
  <CheckinResults v-if="reportTab === 'icebreaker'" key="icebreaker" kind="icebreaker" />
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import CheckinResults from "./CheckinResults.vue";
import { localIsoDate } from "../dates";
import {
  reportsApi,
  ApiError,
  type DailyReport,
  type WeeklyReport,
} from "../api";

// Each listed commit's short hash, linked to the commit on GitHub.
function commitLinks(report: DailyReport) {
  return new Map(
    report.github.flatMap((g) => g.recentCommits.filter((c) => c.hash && c.url).map((c) => [c.hash!, c.url!] as const)),
  );
}

// Report text with the commit hashes split out to render as links.
function linkParts(text: string, links: Map<string, string>) {
  return text.split(/(?<=• )([0-9a-f]{7})\b/).map((part) => ({ text: part, url: links.get(part) ?? null }));
}

const TABS = [
  { id: "daily", label: "Harian" },
  { id: "weekly", label: "Mingguan" },
  { id: "checkout", label: "Check-out" },
  { id: "icebreaker", label: "Mood" },
];

const reportTab = ref("daily");

// ---- Daily ----
const dailyDate = ref(localIsoDate());
const dailyReport = ref<DailyReport | null>(null);
const loadingDaily = ref(false);
const dailyError = ref("");

async function loadDaily() {
  loadingDaily.value = true;
  dailyError.value = "";
  try {
    dailyReport.value = await reportsApi.daily(dailyDate.value);
  } catch (err) {
    dailyError.value = err instanceof ApiError ? err.message : "Gagal memuat laporan harian.";
  } finally {
    loadingDaily.value = false;
  }
}

onMounted(() => {
  loadDaily();
});

// ---- Weekly ----
const weeklyReport = ref<WeeklyReport | null>(null);
const loadingWeekly = ref(false);
const weeklyError = ref("");

async function loadWeekly() {
  loadingWeekly.value = true;
  weeklyError.value = "";
  try {
    weeklyReport.value = await reportsApi.weekly();
  } catch (err) {
    weeklyError.value = err instanceof ApiError ? err.message : "Gagal memuat laporan mingguan.";
  } finally {
    loadingWeekly.value = false;
  }
}
</script>
