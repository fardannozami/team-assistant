<template>
  <header class="flex items-baseline justify-between gap-3 flex-wrap mb-7">
    <div>
      <h2 class="text-[26px] font-display font-extrabold tracking-tight text-text">Reports</h2>
      <p class="text-text-muted text-sm mt-1">
        Daily and weekly standup reports, rendered as plain text.
      </p>
    </div>
  </header>

  <div v-if="error" class="mb-5 px-4 py-3.5 rounded-xl border border-danger/30 bg-danger/5 text-danger text-[12px] font-extrabold slide-in">{{ error }}</div>

  <div class="border-b border-border mb-7">
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
  <div v-if="reportTab === 'daily'" class="border border-border rounded-xl shadow-soft-lg p-6 reveal">
    <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-4">Daily report</div>
    <div class="flex items-center gap-3 mb-5 flex-wrap">
      <div class="min-w-[220px]">
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Date</label>
        <input v-model="dailyDate" type="date"
          class="w-full px-4 py-3.5 rounded-xl border text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none bg-panel border-border"
        />
      </div>
      <button
        class="inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-[13px] font-extrabold tracking-tight bg-accent text-white shadow-accent transition-all duration-200 ease-in hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
        @click="loadDaily"
        :disabled="loadingDaily"
      >
        Load report
      </button>
    </div>

    <div v-if="loadingDaily && !dailyReport" class="flex flex-col items-center gap-2.5 py-24 text-center text-text-muted fade-in-fast">
      <span class="w-10 h-10 border-2 border-accent/20 border-t-accent rounded-full spin-slow" aria-hidden="true"></span> Generating…
    </div>

    <div v-if="dailyReport" class="report-body">
      <div class="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-4 mb-7">
        <div class="border border-border rounded-xl bg-panel-hover p-5 transition-colors duration-200 ease-in hover:border-border-focus">
          <div class="text-[30px] font-display font-extrabold tracking-tight text-text">{{ dailyReport.total }}</div>
          <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mt-2">Employees</div>
        </div>
        <div class="border border-border rounded-xl bg-panel-hover p-5 transition-colors duration-200 ease-in hover:border-border-focus">
          <div class="text-[30px] font-display font-extrabold tracking-tight text-success">{{ dailyReport.submittedCount }}</div>
          <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mt-2">Submitted</div>
        </div>
        <div class="border border-border rounded-xl bg-panel-hover p-5 transition-colors duration-200 ease-in hover:border-border-focus">
          <div class="text-[30px] font-display font-extrabold tracking-tight text-danger">{{ dailyReport.notSubmittedCount }}</div>
          <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mt-2">Not submitted</div>
        </div>
        <div class="border border-border rounded-xl bg-panel-hover p-5 transition-colors duration-200 ease-in hover:border-border-focus">
          <div class="text-[30px] font-display font-extrabold tracking-tight text-danger">{{ dailyReport.blockers.length }}</div>
          <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mt-2">Blockers reported</div>
        </div>
      </div>
      <pre class="border border-border rounded-xl bg-panel-hover p-5 overflow-auto font-mono text-[13px] leading-[1.7] text-text-muted whitespace-pre-wrap">{{ dailyReport.text }}</pre>
    </div>

    <div v-if="!loadingDaily && !error && !dailyReport" class="flex flex-col items-center justify-center py-24 text-center fade-in">
      <div class="w-14 h-14 rounded-full border border-border bg-panel-hover flex items-center justify-center text-text-dim mb-4" aria-hidden="true">—</div>
      <h3 class="text-[18px] font-extrabold tracking-tight text-text mb-1">No report yet</h3>
      <p class="text-text-muted text-sm">Pick a date and load the daily report.</p>
    </div>
  </div>

  <!-- Weekly report -->
  <div v-if="reportTab === 'weekly'" class="border border-border rounded-xl shadow-soft-lg p-6 reveal">
    <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-4">Weekly report</div>
    <div class="flex items-center gap-3 mb-5 flex-wrap">
      <button
        class="inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-[13px] font-extrabold tracking-tight bg-accent text-white shadow-accent transition-all duration-200 ease-in hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
        @click="loadWeekly"
        :disabled="loadingWeekly"
      >
        Generate weekly report
      </button>
    </div>

    <div v-if="loadingWeekly && !weeklyReport" class="flex flex-col items-center gap-2.5 py-24 text-center text-text-muted fade-in-fast">
      <span class="w-10 h-10 border-2 border-accent/20 border-t-accent rounded-full spin-slow" aria-hidden="true"></span> Generating…
    </div>

    <div v-if="weeklyReport" class="report-body">
      <div class="mb-4">
        <span class="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-border bg-panel text-[12px] font-extrabold">{{ weeklyReport.start }}</span>
        <span class="text-[11px] font-extrabold tracking-tight text-text-dim">to</span>
        <span class="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-border bg-panel text-[12px] font-extrabold">{{ weeklyReport.end }}</span>
      </div>

      <table class="w-full border-collapse text-[13px] mb-6">
        <thead>
          <tr class="text-text-dim">
            <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Date</th>
            <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Submitted</th>
            <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Team</th>
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

      <div v-if="weeklyReport.repeatedBlockers.length">
        <div class="text-[17px] font-extrabold tracking-tight text-text mb-3">Repeated blockers</div>
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

    <div v-if="!loadingWeekly && !error && !weeklyReport" class="flex flex-col items-center justify-center py-24 text-center fade-in">
      <div class="w-14 h-14 rounded-full border border-border bg-panel-hover flex items-center justify-center text-text-dim mb-4" aria-hidden="true">—</div>
      <h3 class="text-[18px] font-extrabold tracking-tight text-text mb-1">No weekly report yet</h3>
      <p class="text-text-muted text-sm">Generate the weekly report to see team progress.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import {
  reportsApi,
  ApiError,
  type DailyReport,
  type WeeklyReport,
} from "../api";

const TABS = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
];

const reportTab = ref("daily");
const error = ref("");

// ---- Daily ----
const dailyDate = ref(new Date().toISOString().slice(0, 10));
const dailyReport = ref<DailyReport | null>(null);
const loadingDaily = ref(false);

async function loadDaily() {
  loadingDaily.value = true;
  error.value = "";
  try {
    dailyReport.value = await reportsApi.daily(dailyDate.value);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load daily report.";
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

async function loadWeekly() {
  loadingWeekly.value = true;
  error.value = "";
  try {
    weeklyReport.value = await reportsApi.weekly();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load weekly report.";
  } finally {
    loadingWeekly.value = false;
  }
}
</script>
