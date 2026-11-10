<template>
  <div class="page-head">
    <div>
      <h2 class="page-title">Reports</h2>
      <p class="page-desc">Daily and weekly standup reports, rendered as plain text.</p>
    </div>
  </div>

  <div v-if="error" class="alert alert--error">{{ error }}</div>

  <div class="sub-tabs">
    <button
      v-for="t in TABS"
      :key="t.id"
      :class="['sub-tab', { 'sub-tab--active': reportTab === t.id }]"
      @click="reportTab = t.id"
    >
      {{ t.label }}
    </button>
  </div>

  <!-- Daily report -->
  <div v-if="reportTab === 'daily'" class="card">
    <div class="card-title">Daily report</div>
    <div class="toolbar">
      <div class="field">
        <label class="field-label">Date</label>
        <input v-model="dailyDate" type="date" />
      </div>
      <button class="btn btn--primary" @click="loadDaily" :disabled="loadingDaily">
        Load report
      </button>
    </div>

    <div v-if="loadingDaily && !dailyReport" class="loading">
      <span class="spinner"></span> Generating…
    </div>

    <div v-if="dailyReport" class="report-body">
      <div class="stats">
        <div class="stat">
          <div class="stat-value">{{ dailyReport.total }}</div>
          <div class="stat-label">Employees</div>
        </div>
        <div class="stat">
          <div class="stat-value stat-value--ok">{{ dailyReport.submittedCount }}</div>
          <div class="stat-label">Submitted</div>
        </div>
        <div class="stat">
          <div class="stat-value stat-value--bad">{{ dailyReport.notSubmittedCount }}</div>
          <div class="stat-label">Not submitted</div>
        </div>
        <div class="stat">
          <div class="stat-value stat-value--bad">{{ dailyReport.blockers.length }}</div>
          <div class="stat-label">Blockers reported</div>
        </div>
      </div>
      <pre class="report-text">{{ dailyReport.text }}</pre>
    </div>

    <div v-if="!loadingDaily && !error && !dailyReport" class="empty">
      <p class="empty-title">No report yet</p>
      <p>Pick a date and load the daily report.</p>
    </div>
  </div>

  <!-- Weekly report -->
  <div v-if="reportTab === 'weekly'" class="card">
    <div class="card-title">Weekly report</div>
    <div class="toolbar">
      <button class="btn btn--primary" @click="loadWeekly" :disabled="loadingWeekly">
        Generate weekly report
      </button>
    </div>

    <div v-if="loadingWeekly && !weeklyReport" class="loading">
      <span class="spinner"></span> Generating…
    </div>

    <div v-if="weeklyReport" class="report-body">
      <div style="margin-bottom: 12px">
        <span class="badge">{{ weeklyReport.start }}</span>
        <span class="badge" style="color: var(--text-muted)">to</span>
        <span class="badge">{{ weeklyReport.end }}</span>
      </div>

      <table style="width: 100%; margin-bottom: 16px">
        <thead>
          <tr>
            <th>Date</th>
            <th>Submitted</th>
            <th>Team</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in weeklyReport.days" :key="d.date">
            <td>{{ d.date }}</td>
            <td>{{ d.submitted }}</td>
            <td>{{ d.total }}</td>
          </tr>
        </tbody>
      </table>

      <div v-if="weeklyReport.repeatedBlockers.length">
        <div class="section-title">Repeated blockers</div>
        <div style="margin-bottom: 12px">
          <span
            v-for="b in weeklyReport.repeatedBlockers"
            :key="b.blocker"
            class="badge badge--pending"
          >
            {{ b.blocker }} ({{ b.count }}x)
          </span>
        </div>
      </div>

      <pre class="report-text">{{ weeklyReport.text }}</pre>
    </div>

    <div v-if="!loadingWeekly && !error && !weeklyReport" class="empty">
      <p class="empty-title">No weekly report yet</p>
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
