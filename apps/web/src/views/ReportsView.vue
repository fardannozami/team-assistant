<template>
  <div class="flex items-baseline justify-between mt-6 mb-3.5 gap-4 flex-wrap">
    <div>
      <h2 class="text-[24px] font-display font-extrabold tracking-tight">Reports</h2>
      <p class="text-text-muted text-sm mt-1.5">Daily and weekly standup reports, rendered as plain text.</p>
    </div>
  </div>

  <div v-if="error" class="flex items-center gap-3 px-4 py-3 rounded-sm text-sm mb-4 bg-red-300/10 text-red-300 border border-red-300/35 slide-in">{{ error }}</div>

  <div class="flex border-b border-border mb-5">
    <button
      v-for="t in TABS"
      :key="t.id"
      class="h-10 flex items-center px-[18px] text-[13px] font-extrabold tracking-tight border-b-2 border-transparent whitespace-nowrap transition-colors duration-200 ease-in hover:text-text hover:bg-white/5"
      :class="{ 'text-accent border-accent bg-accent/6': reportTab === t.id }"
      @click="reportTab = t.id"
    >
      {{ t.label }}
    </button>
  </div>

  <!-- Daily report -->
  <div v-if="reportTab === 'daily'" class="bg-panel border border-border rounded p-6 shadow transition-all duration-200 ease-in hover:border-border-focus hover:-translate-y-[2px] hover:shadow-lg">
    <div class="text-[13px] font-extrabold tracking-wider uppercase text-text-muted mb-[18px]">Daily report</div>
    <div class="flex items-center gap-3 mb-4 flex-wrap">
      <div class="mb-[18px]">
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-muted mb-2">Date</label>
        <input v-model="dailyDate" type="date"
          class="w-full px-3.5 py-[11px] rounded-sm border text-sm placeholder-text-dim transition-all duration-200 ease-in focus:ring-4 focus:-translate-y-1 bg-[#0b1020] border-border focus:ring-accent/50 focus:border-border-focus"
        />
      </div>
      <button
        class="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-sm text-[12px] font-extrabold tracking-tight bg-accent text-white shadow-[0_0_0_4px_rgba(91,107,245,0.45)] transition-all duration-200 ease-in hover:bg-accent-hover hover:shadow-[0_0_0_10px_rgba(91,107,245,0.45)] active:shadow-[0_0_0_4px_rgba(91,107,245,0.45)] whitespace-nowrap leading-none disabled:opacity-50 disabled:cursor-not-allowed"
        @click="loadDaily"
        :disabled="loadingDaily"
      >
        Load report
      </button>
    </div>

    <div v-if="loadingDaily && !dailyReport" class="flex flex-col items-center gap-2.5 py-[52px] px-5 text-text-muted fade-in-fast">
      <span class="w-[36px] h-[36px] border-[3px] border-accent/20 border-t-accent rounded-full spin-slow"></span> Generating…
    </div>

    <div v-if="dailyReport" class="report-body">
      <div class="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3 mb-[18px]">
        <div class="bg-panel border border-border rounded-sm p-[18px] transition-colors duration-200 ease-in hover:border-border-focus">
          <div class="text-[26px] font-display font-extrabold tracking-tight">{{ dailyReport.total }}</div>
          <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-muted mt-2">Employees</div>
        </div>
        <div class="bg-panel border border-border rounded-sm p-[18px] transition-colors duration-200 ease-in hover:border-border-focus">
          <div class="text-[26px] font-display font-extrabold tracking-tight text-success">{{ dailyReport.submittedCount }}</div>
          <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-muted mt-2">Submitted</div>
        </div>
        <div class="bg-panel border border-border rounded-sm p-[18px] transition-colors duration-200 ease-in hover:border-border-focus">
          <div class="text-[26px] font-display font-extrabold tracking-tight text-danger">{{ dailyReport.notSubmittedCount }}</div>
          <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-muted mt-2">Not submitted</div>
        </div>
        <div class="bg-panel border border-border rounded-sm p-[18px] transition-colors duration-200 ease-in hover:border-border-focus">
          <div class="text-[26px] font-display font-extrabold tracking-tight text-danger">{{ dailyReport.blockers.length }}</div>
          <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-muted mt-2">Blockers reported</div>
        </div>
      </div>
      <pre class="bg-[#0b1020] border border-border rounded-sm p-[18px] overflow-auto font-mono text-[14px] leading-[1.7] text-text-muted whitespace-pre-wrap">{{ dailyReport.text }}</pre>
    </div>

    <div v-if="!loadingDaily && !error && !dailyReport" class="flex flex-col items-center justify-center py-[64px] px-5 text-text-muted fade-in">
      <p class="text-[17px] font-extrabold text-text mt-3.5 mb-1.5">No report yet</p>
      <p>Pick a date and load the daily report.</p>
    </div>
  </div>

  <!-- Weekly report -->
  <div v-if="reportTab === 'weekly'" class="bg-panel border border-border rounded p-6 shadow transition-all duration-200 ease-in hover:border-border-focus hover:-translate-y-[2px] hover:shadow-lg">
    <div class="text-[13px] font-extrabold tracking-wider uppercase text-text-muted mb-[18px]">Weekly report</div>
    <div class="flex items-center gap-3 mb-4 flex-wrap">
      <button
        class="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-sm text-[12px] font-extrabold tracking-tight bg-accent text-white shadow-[0_0_0_4px_rgba(91,107,245,0.45)] transition-all duration-200 ease-in hover:bg-accent-hover hover:shadow-[0_0_0_10px_rgba(91,107,245,0.45)] active:shadow-[0_0_0_4px_rgba(91,107,245,0.45)] whitespace-nowrap leading-none disabled:opacity-50 disabled:cursor-not-allowed"
        @click="loadWeekly"
        :disabled="loadingWeekly"
      >
        Generate weekly report
      </button>
    </div>

    <div v-if="loadingWeekly && !weeklyReport" class="flex flex-col items-center gap-2.5 py-[52px] px-5 text-text-muted fade-in-fast">
      <span class="w-[36px] h-[36px] border-[3px] border-accent/20 border-t-accent rounded-full spin-slow"></span> Generating…
    </div>

    <div v-if="weeklyReport" class="report-body">
      <div class="mb-3">
        <span class="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-extrabold tracking-tight uppercase border transition-all duration-200 ease-in hover:-translate-y-1 bg-accent/10 text-accent border border-accent/30">{{ weeklyReport.start }}</span>
        <span class="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-extrabold tracking-tight uppercase border transition-all duration-200 ease-in hover:-translate-y-1 bg-transparent text-text-muted border-transparent">to</span>
        <span class="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-extrabold tracking-tight uppercase border transition-all duration-200 ease-in hover:-translate-y-1 bg-accent/10 text-accent border border-accent/30">{{ weeklyReport.end }}</span>
      </div>

      <table class="w-full border-collapse text-[13px] mb-4">
        <thead>
          <tr>
            <th class="text-left px-4 py-3 text-[11px] font-extrabold tracking-wider uppercase text-text-muted border-b border-border">Date</th>
            <th class="text-left px-4 py-3 text-[11px] font-extrabold tracking-wider uppercase text-text-muted border-b border-border">Submitted</th>
            <th class="text-left px-4 py-3 text-[11px] font-extrabold tracking-wider uppercase text-text-muted border-b border-border">Team</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in weeklyReport.days" :key="d.date">
            <td class="px-4 py-3.5 border-b border-border align-middle text-text hover:bg-panel-hover">{{ d.date }}</td>
            <td class="px-4 py-3.5 border-b border-border align-middle text-text hover:bg-panel-hover">{{ d.submitted }}</td>
            <td class="px-4 py-3.5 border-b border-border align-middle text-text hover:bg-panel-hover">{{ d.total }}</td>
          </tr>
        </tbody>
      </table>

      <div v-if="weeklyReport.repeatedBlockers.length">
        <div class="text-[16px] font-extrabold text-text mb-3">Repeated blockers</div>
        <div class="flex flex-wrap gap-2 mb-3">
          <span
            v-for="b in weeklyReport.repeatedBlockers"
            :key="b.blocker"
            class="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-extrabold tracking-tight uppercase border transition-all duration-200 ease-in hover:-translate-y-1 bg-warning/10 text-warning border border-warning/30"
          >
            {{ b.blocker }} ({{ b.count }}x)
          </span>
        </div>
      </div>

      <pre class="bg-[#0b1020] border border-border rounded-sm p-[18px] overflow-auto font-mono text-[14px] leading-[1.7] text-text-muted whitespace-pre-wrap">{{ weeklyReport.text }}</pre>
    </div>

    <div v-if="!loadingWeekly && !error && !weeklyReport" class="flex flex-col items-center justify-center py-[64px] px-5 text-text-muted fade-in">
      <p class="text-[17px] font-extrabold text-text mt-3.5 mb-1.5">No weekly report yet</p>
      <p>Generate the weekly report to see team progress.</p>
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
