<template>
  <div class="flex items-baseline justify-between mt-6 mb-3.5 gap-4 flex-wrap">
    <div>
      <h2 class="text-[24px] font-display font-extrabold tracking-tight">Standups</h2>
      <p class="text-text-muted text-sm mt-1.5">Review standup sessions and answers for a date.</p>
    </div>
  </div>

  <div v-if="error" class="flex items-center gap-3 px-4 py-3 rounded-sm text-sm mb-4 bg-red-300/10 text-red-300 border border-red-300/35 slide-in">{{ error }}</div>

  <div class="flex items-center gap-3 mb-4 flex-wrap">
    <div class="mb-[18px]">
      <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-muted mb-2">Date</label>
      <input v-model="date" type="date"
        class="w-full px-3.5 py-[11px] rounded-sm border text-sm placeholder-text-dim transition-all duration-200 ease-in focus:ring-4 focus:-translate-y-1 bg-[#0b1020] border-border focus:ring-accent/50 focus:border-border-focus"
      />
    </div>
    <button
      class="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-sm text-[12px] font-extrabold tracking-tight bg-accent text-white shadow-[0_0_0_4px_rgba(91,107,245,0.45)] transition-all duration-200 ease-in hover:bg-accent-hover hover:shadow-[0_0_0_10px_rgba(91,107,245,0.45)] active:shadow-[0_0_0_4px_rgba(91,107,245,0.45)] whitespace-nowrap leading-none disabled:opacity-50 disabled:cursor-not-allowed"
      @click="load"
      :disabled="loading"
    >
      Load standups
    </button>
  </div>

  <div v-if="loading && !standups.length" class="flex flex-col items-center gap-2.5 py-[52px] px-5 text-text-muted fade-in-fast">
    <span class="w-[36px] h-[36px] border-[3px] border-accent/20 border-t-accent rounded-full spin-slow"></span> Loading…
  </div>

  <div v-if="!loading && !error && standups.length === 0" class="flex flex-col items-center justify-center py-[64px] px-5 text-text-muted fade-in">
    <p class="text-[17px] font-extrabold text-text mt-3.5 mb-1.5">No standups for {{ date }}</p>
    <p>Trigger a schedule or wait for employees to respond.</p>
  </div>

  <div class="overflow-x-auto border border-border rounded-sm">
    <table class="w-full border-collapse text-[13px]">
      <thead>
        <tr>
          <th class="text-left px-4 py-3 text-[11px] font-extrabold tracking-wider uppercase text-text-muted border-b border-border">Employee</th>
          <th class="text-left px-4 py-3 text-[11px] font-extrabold tracking-wider uppercase text-text-muted border-b border-border">Team</th>
          <th class="text-left px-4 py-3 text-[11px] font-extrabold tracking-wider uppercase text-text-muted border-b border-border w-[14%]">Status</th>
          <th class="text-left px-4 py-3 text-[11px] font-extrabold tracking-wider uppercase text-text-muted border-b border-border">Yesterday</th>
          <th class="text-left px-4 py-3 text-[11px] font-extrabold tracking-wider uppercase text-text-muted border-b border-border">Today</th>
          <th class="text-left px-4 py-3 text-[11px] font-extrabold tracking-wider uppercase text-text-muted border-b border-border">Blockers</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in standups" :key="s.sessionId">
          <td class="px-4 py-3.5 border-b border-border align-middle text-text hover:bg-panel-hover">
            {{ s.employeeName }}
            <span class="font-mono text-[12px] text-text-dim block">{{ s.employeePhone }}</span>
          </td>
          <td class="px-4 py-3.5 border-b border-border align-middle text-text hover:bg-panel-hover">{{ s.teamName || "—" }}</td>
          <td class="px-4 py-3.5 border-b border-border align-middle text-text hover:bg-panel-hover">
            <span class="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-extrabold tracking-tight uppercase border transition-all duration-200 ease-in hover:-translate-y-1" :class="statusBadgeUtils(s.status)">
              {{ s.status }}
            </span>
          </td>
          <td class="px-4 py-3.5 border-b border-border align-middle text-text hover:bg-panel-hover answers">{{ s.answers.yesterday || "—" }}</td>
          <td class="px-4 py-3.5 border-b border-border align-middle text-text hover:bg-panel-hover answers">{{ s.answers.today || "—" }}</td>
          <td class="px-4 py-3.5 border-b border-border align-middle text-text hover:bg-panel-hover answers">{{ s.answers.blockers || "—" }}</td>
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
  if (key === "completed") return "bg-success/10 text-success border border-success/30";
  if (key === "pending") return "bg-warning/10 text-warning border border-warning/30";
  return "bg-text-muted/10 text-text-muted border border-border";
}

</script>
