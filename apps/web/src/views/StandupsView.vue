<template>
  <div class="page-head">
    <div>
      <h2 class="page-title">Standups</h2>
      <p class="page-desc">Review standup sessions and answers for a date.</p>
    </div>
  </div>

  <div v-if="error" class="alert alert--error">{{ error }}</div>

  <div class="toolbar">
    <div class="field">
      <label class="field-label">Date</label>
      <input v-model="date" type="date" />
    </div>
    <button class="btn btn--primary" @click="load" :disabled="loading">
      Load standups
    </button>
  </div>

  <div v-if="loading && !standups.length" class="loading">
    <span class="spinner"></span> Loading…
  </div>

  <div v-if="!loading && !error && standups.length === 0" class="empty">
    <p class="empty-title">No standups for {{ date }}</p>
    <p>Trigger a schedule or wait for employees to respond.</p>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Employee</th>
          <th>Team</th>
          <th style="width: 14%">Status</th>
          <th>Yesterday</th>
          <th>Today</th>
          <th>Blockers</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in standups" :key="s.sessionId">
          <td>
            {{ s.employeeName }}
            <span class="mono" style="font-size: 12px">{{ s.employeePhone }}</span>
          </td>
          <td>{{ s.teamName || "—" }}</td>
          <td>
            <span
              class="badge"
              :class="statusBadge(s.status)"
            >
              {{ s.status }}
            </span>
          </td>
          <td class="answers">{{ s.answers.yesterday || "—" }}</td>
          <td class="answers">{{ s.answers.today || "—" }}</td>
          <td class="answers">{{ s.answers.blockers || "—" }}</td>
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

function statusBadge(status: string) {
  const key = String(status).toLowerCase();
  if (key === "completed") return "badge--completed";
  if (key === "pending") return "badge--pending";
  return "badge--inactive";
}
</script>
