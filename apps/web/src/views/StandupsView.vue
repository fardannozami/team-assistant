<template>
  <header class="flex items-baseline justify-between gap-3 flex-wrap mb-7">
    <div>
      <h2 class="text-[26px] font-display font-extrabold tracking-tight text-text">Standups</h2>
      <p class="text-text-muted text-sm mt-1">
        Review standup sessions and answers for a date.
      </p>
    </div>
  </header>

  <div v-if="error" class="mb-5 px-4 py-3.5 rounded-xl border border-danger/30 bg-danger/5 text-danger text-[12px] font-extrabold slide-in">{{ error }}</div>

  <div class="flex items-center gap-3 mb-5 flex-wrap">
    <div class="min-w-[220px]">
      <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Date</label>
      <input v-model="date" type="date"
        class="w-full px-4 py-3.5 rounded-xl border text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none bg-panel border-border"
      />
    </div>
    <button
      @click="load"
      :disabled="loading"
      class="inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-[13px] font-extrabold tracking-tight bg-accent text-white shadow-accent transition-all duration-200 ease-in hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
    >
      Load standups
    </button>
  </div>

  <div v-if="loading && !standups.length" class="flex flex-col items-center gap-2.5 py-24 text-center text-text-muted fade-in-fast">
    <span class="w-10 h-10 border-2 border-accent/20 border-t-accent rounded-full spin-slow" aria-hidden="true"></span>
    <span class="text-sm font-extrabold tracking-tight">Loading standups…</span>
  </div>

  <div v-if="!loading && !error && standups.length === 0" class="flex flex-col items-center justify-center py-24 text-center fade-in">
    <div class="w-14 h-14 rounded-full border border-border bg-panel-hover flex items-center justify-center text-text-dim mb-4" aria-hidden="true">—</div>
    <h3 class="text-[18px] font-extrabold tracking-tight text-text mb-1">No standups for {{ date }}</h3>
    <p class="text-text-muted text-sm">Trigger a schedule or wait for employees to respond.</p>
  </div>

  <div class="border border-border rounded-xl overflow-hidden shadow-soft">
    <table class="w-full border-collapse text-[13px]">
      <thead>
        <tr class="text-text-dim">
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Employee</th>
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Team</th>
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border w-[14%]">Status</th>
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Yesterday</th>
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Today</th>
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Blockers</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in standups" :key="s.sessionId" class="hover:bg-panel-hover transition-colors duration-200 ease-in">
          <td class="px-5 py-4 border-b border-border align-middle text-text">
            {{ s.employeeName }}
            <span class="font-mono text-[12px] text-text-dim block">{{ s.employeePhone }}</span>
          </td>
          <td class="px-5 py-4 border-b border-border align-middle text-text">{{ s.teamName || "—" }}</td>
          <td class="px-5 py-4 border-b border-border align-middle text-text">
            <span class="badge" :class="statusBadgeUtils(s.status)">{{ s.status }}</span>
          </td>
          <td class="px-5 py-4 border-b border-border align-middle text-text answers">{{ s.answers.yesterday || "—" }}</td>
          <td class="px-5 py-4 border-b border-border align-middle text-text answers">{{ s.answers.today || "—" }}</td>
          <td class="px-5 py-4 border-b border-border align-middle text-text answers">{{ s.answers.blockers || "—" }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import {
  standupsApi,
  ApiError,
  type StandupSession,
} from "../api";

const date = ref(new Date().toISOString().slice(0, 10));
const standups = ref<StandupSession[]>([]);
const loading = ref(false);
const error = ref("");

async function load() {
  if (!date.value) return;
  loading.value = true;
  error.value = "";
  try {
    const res = await standupsApi.list(date.value);
    standups.value = res.standups;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load standups.";
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(date, load);

function statusBadgeUtils(status: string) {
  const key = String(status).toLowerCase();
  if (key === "completed") return "bg-success/8 text-success border-success/20";
  if (key === "pending") return "bg-warning/8 text-warning border-warning/20";
  return "bg-text-muted/10 text-text-dim border border-border";
}

</script>
