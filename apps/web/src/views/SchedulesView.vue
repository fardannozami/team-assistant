<template>
  <header class="flex items-baseline justify-between gap-3 flex-wrap mb-7">
    <div>
      <h2 class="text-[26px] font-display font-extrabold tracking-tight text-text">Schedules</h2>
      <p class="text-text-muted text-sm mt-1">
        Configure when standup prompts are sent, and trigger them manually.
      </p>
    </div>
    <button
      @click="showCreateForm = true"
      :disabled="loading"
      class="inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-[13px] font-extrabold tracking-tight bg-accent text-white shadow-accent transition-all duration-200 ease-in hover:bg-accent-hover hover:shadow-[0_0_0_12px_rgba(63,68,226,0.45)] active:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
    >
      Create schedule
    </button>
  </header>

  <div v-if="error" class="mb-5 px-4 py-3.5 rounded-xl border border-danger/30 bg-danger/5 text-danger text-[12px] font-extrabold slide-in">{{ error }}</div>

  <div v-if="showCreateForm" class="border border-border rounded-xl shadow-soft-lg p-6 mb-7 reveal">
    <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-4">Create schedule</div>
    <form @submit.prevent="handleCreate" class="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4 items-end">
      <div>
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Schedule name</label>
        <input
          v-model="form.name"
          type="text"
          placeholder="Daily standup"
          required
          @input="formError = ''"
          class="w-full px-4 py-3.5 rounded-xl border text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none bg-panel border-border"
          :class="{ 'border-danger': formError, 'border-border': !formError }"
        />
      </div>
      <div>
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Time of day (24-hour)</label>
        <input
          v-model="form.time"
          type="time"
          required
          @input="formError = ''"
          class="w-full px-4 py-3.5 rounded-xl border text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none bg-panel border-border"
          :class="{ 'border-danger': formError, 'border-border': !formError }"
        />
      </div>
      <div>
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Time zone</label>
        <input v-model="form.timezone" type="text" placeholder="Asia/Jakarta"
          class="w-full px-4 py-3.5 rounded-xl border text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none bg-panel border-border"
        />
      </div>
      <div>
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Reminder before standup (minutes)</label>
        <input
          v-model.number="form.reminder"
          type="number"
          min="0"
          max="1440"
          class="w-full px-4 py-3.5 rounded-xl border text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none bg-panel border-border"
        />
      </div>
      <div>
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Active weekdays</label>
        <div class="flex flex-wrap gap-2 mt-1.5">
          <label
            v-for="d in DAYS"
            :key="d"
            class="inline-flex items-center gap-2 px-3 py-[8px] rounded-xl border text-[12px] font-extrabold tracking-tight uppercase cursor-pointer transition-all duration-200 ease-in select-none"
            :class="
              form.weekdays.includes(d)
                ? 'bg-accent text-white border-accent shadow-accent hover:bg-accent-hover'
                : 'bg-panel-hover border border-border text-text-dim hover:bg-accent/8 hover:text-accent'
            "
          >
            <input
              type="checkbox"
              :checked="form.weekdays.includes(d)"
              @change="toggleWeekday(form.weekdays, d)"
              class="peer w-4 h-4 shrink-0 accent-accent cursor-pointer"
            />
            <span class="chip-label">{{ d }}</span>
          </label>
        </div>
      </div>
      <p v-if="formError" class="col-span-full text-danger text-[11px] font-extrabold mt-1.5 slide-in">{{ formError }}</p>
      <div class="flex gap-2 items-end">
        <button
          type="submit"
          :disabled="creating"
          class="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[13px] font-extrabold tracking-tight bg-accent text-white shadow-accent transition-all duration-200 ease-in hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
        >
          Create schedule
        </button>
        <button
          type="button"
          class="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[13px] font-extrabold tracking-tight border border-border text-text transition-colors duration-200 ease-in hover:bg-panel-hover"
          @click="showCreateForm = false"
        >
          Cancel
        </button>
      </div>
    </form>
  </div>

  <div v-if="editingId" class="border border-border rounded-xl shadow-soft-lg p-6 mb-7 reveal mt-4">
    <div class="flex items-center gap-2 mb-4">
      <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim">Edit schedule</div>
      <span class="ml-1.5 font-semibold text-text-muted">{{ editingSchedule?.name }}</span>
    </div>
    <form @submit.prevent="handleSave" class="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4 items-end">
      <div>
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Schedule name</label>
        <input
          v-model="edit.name"
          type="text"
          required
          @input="formError = ''"
          class="w-full px-4 py-3.5 rounded-xl border text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none bg-panel border-border"
          :class="{ 'border-danger': formError, 'border-border': !formError }"
        />
      </div>
      <div>
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Time of day (24-hour)</label>
        <input
          v-model="edit.time"
          type="time"
          required
          @input="formError = ''"
          class="w-full px-4 py-3.5 rounded-xl border text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none bg-panel border-border"
          :class="{ 'border-danger': formError, 'border-border': !formError }"
        />
      </div>
      <div>
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Time zone</label>
        <input v-model="edit.timezone" type="text"
          class="w-full px-4 py-3.5 rounded-xl border text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none bg-panel border-border"
        />
      </div>
      <div>
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Reminder before standup (minutes)</label>
        <input v-model.number="edit.reminder" type="number" min="0" max="1440"
          class="w-full px-4 py-3.5 rounded-xl border text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none bg-panel border-border"
        />
      </div>
      <div>
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Active weekdays</label>
        <div class="flex flex-wrap gap-2 mt-1.5">
          <label
            v-for="d in DAYS"
            :key="d"
            class="inline-flex items-center gap-2 px-3 py-[8px] rounded-xl border text-[12px] font-extrabold tracking-tight uppercase cursor-pointer transition-all duration-200 ease-in select-none"
            :class="
              edit.weekdays.includes(d)
                ? 'bg-accent text-white border-accent shadow-accent hover:bg-accent-hover'
                : 'bg-panel-hover border border-border text-text-dim hover:bg-accent/8 hover:text-accent'
            "
          >
            <input
              type="checkbox"
              :checked="edit.weekdays.includes(d)"
              @change="toggleWeekday(edit.weekdays, d)"
              class="peer w-4 h-4 shrink-0 accent-accent cursor-pointer"
            />
            <span class="chip-label">{{ d }}</span>
          </label>
        </div>
      </div>
      <p v-if="formError" class="col-span-full text-danger text-[11px] font-extrabold mt-1.5 slide-in">{{ formError }}</p>
      <div class="flex items-center gap-2.5 mb-3 cursor-pointer leading-none">
        <input type="checkbox" v-model="edit.isActive" id="editIsActive" class="w-4 h-4 shrink-0 accent-accent cursor-pointer" />
        <label for="editIsActive" class="text-[11px] font-extrabold tracking-tight text-text">Schedule is active</label>
      </div>
      <div class="flex gap-2 items-end">
        <button
          type="submit"
          :disabled="updating"
          class="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[13px] font-extrabold tracking-tight bg-accent text-white shadow-accent transition-all duration-200 ease-in hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
        >
          Save changes
        </button>
        <button
          type="button"
          class="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[13px] font-extrabold tracking-tight border border-border text-text transition-colors duration-200 ease-in hover:bg-panel-hover"
          @click="editingId = null"
        >
          Cancel
        </button>
      </div>
    </form>
  </div>

  <div class="border border-border rounded-xl overflow-hidden shadow-soft mb-7">
    <table class="w-full border-collapse text-[13px]">
      <thead>
        <tr class="text-text-dim">
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Name</th>
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Time</th>
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Weekdays</th>
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Time zone</th>
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Reminder</th>
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border w-[12%]">Status</th>
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border w-[30%]">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in schedules" :key="s.id" class="hover:bg-panel-hover transition-colors duration-200 ease-in">
          <td class="px-5 py-4 border-b border-border align-middle text-text">{{ s.name }}</td>
          <td class="px-5 py-4 border-b border-border align-middle text-text font-mono text-[13px] text-text-dim">{{ s.timeOfDay }}</td>
          <td class="px-5 py-4 border-b border-border align-middle text-text">{{ weekdayLabels(s.weekdays).join(", ") }}</td>
          <td class="px-5 py-4 border-b border-border align-middle text-text">{{ s.timezone || "Asia/Jakarta" }}</td>
          <td class="px-5 py-4 border-b border-border align-middle text-text">{{ s.reminderMinutes === null ? "—" : s.reminderMinutes + " min" }}</td>
          <td class="px-5 py-4 border-b border-border align-middle text-text">
            <span class="badge" :class="s.isActive ? 'bg-success/8 text-success border-success/20' : 'bg-text-muted/10 text-text-dim border border-border'">{{ s.isActive ? "Active" : "Inactive" }}</span>
          </td>
          <td class="px-5 py-4 border-b border-border align-middle text-text flex gap-2">
            <button
              class="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-[12px] font-extrabold tracking-tight border border-border text-text transition-colors duration-200 ease-in hover:bg-panel-hover disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
              @click="editSchedule(s)"
              :disabled="editingId !== null && editingId !== s.id"
            >
              {{ editingId === s.id ? "Editing…" : "Edit" }}
            </button>
            <button
              class="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-[12px] font-extrabold tracking-tight bg-accent text-white shadow-accent transition-all duration-200 ease-in hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
              @click="handleTrigger(s)"
              :disabled="triggeringId === s.id"
            >
              {{ triggeringId === s.id ? "…" : "Trigger" }}
            </button>
            <button
              class="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-[12px] font-extrabold tracking-tight border border-danger/20 bg-danger/6 text-danger transition-all duration-200 ease-in hover:bg-danger/10 hover:border-danger/40 whitespace-nowrap"
              @click="handleDelete(s)"
            >
              Delete
            </button>
          </td>
        </tr>
        <tr v-if="!schedules.length && !loading && !error">
          <td colspan="7" class="px-5 py-4 border-b border-border align-middle text-center text-text-muted">
            No schedules yet. Create one to get started.
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div v-if="loading && !schedules.length" class="flex flex-col items-center gap-2.5 py-24 text-center text-text-muted fade-in-fast">
    <span class="w-10 h-10 border-2 border-accent/20 border-t-accent rounded-full spin-slow" aria-hidden="true"></span>
    <span class="text-sm font-extrabold tracking-tight">Loading schedules…</span>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import {
  schedulesApi,
  ApiError,
  showToast,
  type Schedule,
} from "../api";

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const schedules = ref<Schedule[]>([]);
const loading = ref(false);
const error = ref("");

const showCreateForm = ref(false);
const creating = ref(false);
const formError = ref("");
const form = ref({
  name: "",
  time: "09:00",
  weekdays: [1, 2, 3, 4, 5],
  timezone: "Asia/Jakarta",
  reminder: null as number | null,
});

const editingId = ref<string | null>(null);
const updating = ref(false);
const triggeringId = ref<string | null>(null);
const edit = ref({
  name: "",
  time: "",
  weekdays: [] as number[],
  timezone: "",
  reminder: null as number | null,
  isActive: true,
});

const editingSchedule = ref<Schedule | null>(null);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    schedules.value = await schedulesApi.list();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load schedules.";
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function toggleWeekday(arr: number[], d: number) {
  const i = arr.indexOf(d);
  if (i >= 0) {
    arr.splice(i, 1);
  } else {
    arr.push(d);
  }
}

function weekdayLabels(ws: number[]) {
  return ws.map((d) => DAYS[d] ?? "?");
}

async function handleCreate() {
  formError.value = "";
  if (
    !form.value.name.trim() ||
    !form.value.time ||
    !form.value.weekdays.length
  ) {
    formError.value = "Name, time and at least one weekday are required.";
    return;
  }
  error.value = "";
  creating.value = true;
  try {
    await schedulesApi.create({
      name: form.value.name.trim(),
      timeOfDay: form.value.time,
      weekdays: form.value.weekdays.slice(),
      timezone: form.value.timezone || "Asia/Jakarta",
      reminderMinutes: form.value.reminder,
    });
    showToast("Schedule created.", "success");
    showCreateForm.value = false;
    form.value = {
      name: "",
      time: "09:00",
      weekdays: [1, 2, 3, 4, 5],
      timezone: "Asia/Jakarta",
      reminder: null,
    };
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to create schedule.";
  } finally {
    creating.value = false;
  }
}

function editSchedule(s: Schedule) {
  editingId.value = s.id;
  editingSchedule.value = s;
  edit.value = {
    name: s.name,
    time: s.timeOfDay,
    weekdays: s.weekdays.slice(),
    timezone: s.timezone || "Asia/Jakarta",
    reminder: s.reminderMinutes ?? null,
    isActive: s.isActive,
  };
}

async function handleSave() {
  formError.value = "";
  if (
    !edit.value.name.trim() ||
    !edit.value.time ||
    !edit.value.weekdays.length
  ) {
    formError.value = "Name, time and at least one weekday are required.";
    return;
  }
  error.value = "";
  updating.value = true;
  try {
    await schedulesApi.update(editingId.value!, {
      name: edit.value.name.trim(),
      timeOfDay: edit.value.time,
      weekdays: edit.value.weekdays.slice(),
      timezone: edit.value.timezone || "Asia/Jakarta",
      reminderMinutes: edit.value.reminder,
      isActive: edit.value.isActive,
    });
    showToast("Schedule updated.", "success");
    editingId.value = null;
    editingSchedule.value = null;
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to save schedule.";
  } finally {
    updating.value = false;
  }
}

async function handleTrigger(s: Schedule) {
  triggeringId.value = s.id;
  try {
    await schedulesApi.trigger(s.id);
    showToast(`Standup triggered for "${s.name}".`, "success");
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to trigger schedule.";
  } finally {
    triggeringId.value = null;
  }
}

async function handleDelete(s: Schedule) {
  if (!window.confirm(`Delete schedule "${s.name}"?`)) return;
  try {
    await schedulesApi.delete(s.id);
    showToast("Schedule deleted.", "success");
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to delete schedule.";
  }
}
</script>
