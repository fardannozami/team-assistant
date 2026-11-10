<template>
  <div class="flex items-baseline justify-between mt-6 mb-3.5 gap-4 flex-wrap">
    <div>
      <h2 class="text-[24px] font-display font-extrabold tracking-tight">Schedules</h2>
      <p class="text-text-muted text-sm mt-1.5">Configure when standup prompts are sent, and trigger them manually.</p>
    </div>
    <button
      class="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-sm text-[12px] font-extrabold tracking-tight bg-accent text-white shadow-[0_0_0_4px_rgba(91,107,245,0.45)] transition-all duration-200 ease-in hover:bg-accent-hover hover:shadow-[0_0_0_10px_rgba(91,107,245,0.45)] active:shadow-[0_0_0_4px_rgba(91,107,245,0.45)] whitespace-nowrap leading-none disabled:opacity-50 disabled:cursor-not-allowed"
      @click="showCreateForm = true"
      :disabled="loading"
    >
      Create schedule
    </button>
  </div>

  <div v-if="error" class="flex items-center gap-3 px-4 py-3 rounded-sm text-sm mb-4 bg-red-300/10 text-red-300 border border-red-300/35 slide-in">{{ error }}</div>

  <div v-if="showCreateForm" class="bg-panel border border-border rounded p-6 shadow transition-all duration-200 ease-in hover:border-border-focus hover:-translate-y-[2px] hover:shadow-lg">
    <div class="text-[13px] font-extrabold tracking-wider uppercase text-text-muted mb-[18px]">Create schedule</div>
    <form @submit.prevent="handleCreate" class="flex flex-col gap-4 grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] items-end">
      <div class="mb-[18px]">
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-muted mb-2">Schedule name</label>
        <input
          v-model="form.name"
          type="text"
          placeholder="Daily standup"
          required
          @input="formError = ''"
          class="w-full px-3.5 py-[11px] rounded-sm border text-sm placeholder-text-dim transition-all duration-200 ease-in focus:ring-4 focus:-translate-y-1 bg-[#0b1020] border-border focus:ring-accent/50 focus:border-border-focus"
          :class="{ 'border-danger focus:ring-danger/40': formError, 'border-border focus:ring-accent/50': !formError }"
        />
      </div>
      <div class="mb-[18px]">
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-muted mb-2">Time of day (24-hour)</label>
        <input
          v-model="form.time"
          type="time"
          required
          @input="formError = ''"
          class="w-full px-3.5 py-[11px] rounded-sm border text-sm placeholder-text-dim transition-all duration-200 ease-in focus:ring-4 focus:-translate-y-1 bg-[#0b1020] border-border focus:ring-accent/50 focus:border-border-focus"
          :class="{ 'border-danger focus:ring-danger/40': formError, 'border-border focus:ring-accent/50': !formError }"
        />
      </div>
      <div class="mb-[18px]">
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-muted mb-2">Time zone</label>
        <input v-model="form.timezone" type="text" placeholder="Asia/Jakarta"
          class="w-full px-3.5 py-[11px] rounded-sm border text-sm placeholder-text-dim transition-all duration-200 ease-in focus:ring-4 focus:-translate-y-1 bg-[#0b1020] border-border focus:ring-accent/50 focus:border-border-focus"
        />
      </div>
      <div class="mb-[18px]">
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-muted mb-2">Reminder before standup (minutes)</label>
        <input
          v-model.number="form.reminder"
          type="number"
          min="0"
          max="1440"
          class="w-full px-3.5 py-[11px] rounded-sm border text-sm placeholder-text-dim transition-all duration-200 ease-in focus:ring-4 focus:-translate-y-1 bg-[#0b1020] border-border focus:ring-accent/50 focus:border-border-focus"
        />
      </div>
      <div class="mb-[18px]">
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-muted mb-2">Active weekdays</label>
        <div class="flex flex-wrap gap-2 mt-1.5">
          <label
            v-for="d in DAYS"
            :key="d"
            class="inline-flex items-center gap-2 px-2.5 py-[7px] rounded-[10px] border border-border bg-[#0b1020] text-text-muted text-[12px] font-extrabold tracking-tight uppercase cursor-pointer transition-all duration-200 ease-in select-none hover:border-text-muted hover:text-text hover:bg-panel-hover peer-checked:bg-accent peer-checked:text-white peer-checked:border-accent peer-checked:shadow-[0_0_0_4px_rgba(91,107,245,0.45)] peer-checked:hover:bg-accent-hover"
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
      <p v-if="formError" class="text-danger text-[11px] font-extrabold mt-2 slide-in">{{ formError }}</p>
      <div class="flex gap-2.5 items-end mt-2">
        <button
          class="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-sm text-[12px] font-extrabold tracking-tight bg-accent text-white shadow-[0_0_0_4px_rgba(91,107,245,0.45)] transition-all duration-200 ease-in hover:bg-accent-hover hover:shadow-[0_0_0_10px_rgba(91,107,245,0.45)] active:shadow-[0_0_0_4px_rgba(91,107,245,0.45)] whitespace-nowrap leading-none disabled:opacity-50 disabled:cursor-not-allowed"
          type="submit"
          :disabled="creating"
        >
          Create schedule
        </button>
        <button
          class="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-sm text-[12px] font-extrabold tracking-tight border border-border bg-panel-hover text-text transition-all duration-200 ease-in hover:border-text-muted hover:bg-panel hover:text-text whitespace-nowrap leading-none disabled:opacity-50 disabled:cursor-not-allowed"
          type="button"
          @click="showCreateForm = false"
        >
          Cancel
        </button>
      </div>
    </form>
  </div>

  <div v-if="editingId" class="bg-panel border border-border rounded p-6 shadow transition-all duration-200 ease-in hover:border-border-focus hover:-translate-y-[2px] hover:shadow-lg mt-[14px]">
    <div class="flex items-center gap-2">
      <div class="text-[13px] font-extrabold tracking-wider uppercase text-text-muted">Edit schedule</div>
      <span class="ml-1.5 font-semibold text-text-muted">{{ editingSchedule?.name }}</span>
    </div>
    <form @submit.prevent="handleSave" class="flex flex-col gap-4 grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] items-end mt-[18px]">
      <div class="mb-[18px]">
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-muted mb-2">Schedule name</label>
        <input
          v-model="edit.name"
          type="text"
          required
          @input="formError = ''"
          class="w-full px-3.5 py-[11px] rounded-sm border text-sm placeholder-text-dim transition-all duration-200 ease-in focus:ring-4 focus:-translate-y-1 bg-[#0b1020] border-border focus:ring-accent/50 focus:border-border-focus"
          :class="{ 'border-danger focus:ring-danger/40': formError, 'border-border focus:ring-accent/50': !formError }"
        />
      </div>
      <div class="mb-[18px]">
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-muted mb-2">Time of day (24-hour)</label>
        <input
          v-model="edit.time"
          type="time"
          required
          @input="formError = ''"
          class="w-full px-3.5 py-[11px] rounded-sm border text-sm placeholder-text-dim transition-all duration-200 ease-in focus:ring-4 focus:-translate-y-1 bg-[#0b1020] border-border focus:ring-accent/50 focus:border-border-focus"
          :class="{ 'border-danger focus:ring-danger/40': formError, 'border-border focus:ring-accent/50': !formError }"
        />
      </div>
      <div class="mb-[18px]">
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-muted mb-2">Time zone</label>
        <input v-model="edit.timezone" type="text"
          class="w-full px-3.5 py-[11px] rounded-sm border text-sm placeholder-text-dim transition-all duration-200 ease-in focus:ring-4 focus:-translate-y-1 bg-[#0b1020] border-border focus:ring-accent/50 focus:border-border-focus"
        />
      </div>
      <div class="mb-[18px]">
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-muted mb-2">Reminder before standup (minutes)</label>
        <input v-model.number="edit.reminder" type="number" min="0" max="1440"
          class="w-full px-3.5 py-[11px] rounded-sm border text-sm placeholder-text-dim transition-all duration-200 ease-in focus:ring-4 focus:-translate-y-1 bg-[#0b1020] border-border focus:ring-accent/50 focus:border-border-focus"
        />
      </div>
      <div class="mb-[18px]">
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-muted mb-2">Active weekdays</label>
        <div class="flex flex-wrap gap-2 mt-1.5">
          <label
            v-for="d in DAYS"
            :key="d"
            class="inline-flex items-center gap-2 px-2.5 py-[7px] rounded-[10px] border border-border bg-[#0b1020] text-text-muted text-[12px] font-extrabold tracking-tight uppercase cursor-pointer transition-all duration-200 ease-in select-none hover:border-text-muted hover:text-text hover:bg-panel-hover peer-checked:bg-accent peer-checked:text-white peer-checked:border-accent peer-checked:shadow-[0_0_0_4px_rgba(91,107,245,0.45)] peer-checked:hover:bg-accent-hover"
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
      <p v-if="formError" class="text-danger text-[11px] font-extrabold mt-2 slide-in">{{ formError }}</p>
      <div class="flex items-center gap-2.5 mb-3 cursor-pointer leading-none field--check">
        <input type="checkbox" v-model="edit.isActive" id="editIsActive" class="w-4 h-4 shrink-0 accent-accent cursor-pointer" />
        <label for="editIsActive" class="text-[11px] font-extrabold tracking-tight text-text">Schedule is active</label>
      </div>
      <div class="flex gap-2.5 items-end mt-2">
        <button
          class="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-sm text-[12px] font-extrabold tracking-tight bg-accent text-white shadow-[0_0_0_4px_rgba(91,107,245,0.45)] transition-all duration-200 ease-in hover:bg-accent-hover hover:shadow-[0_0_0_10px_rgba(91,107,245,0.45)] active:shadow-[0_0_0_4px_rgba(91,107,245,0.45)] whitespace-nowrap leading-none disabled:opacity-50 disabled:cursor-not-allowed"
          type="submit"
          :disabled="updating"
        >
          Save changes
        </button>
        <button
          class="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-sm text-[12px] font-extrabold tracking-tight border border-border bg-panel-hover text-text transition-all duration-200 ease-in hover:border-text-muted hover:bg-panel hover:text-text whitespace-nowrap leading-none disabled:opacity-50 disabled:cursor-not-allowed"
          type="button"
          @click="editingId = null"
        >
          Cancel
        </button>
      </div>
    </form>
  </div>

  <div class="overflow-x-auto border border-border rounded-sm">
    <table class="w-full border-collapse text-[13px]">
      <thead>
        <tr>
          <th class="text-left px-4 py-3 text-[11px] font-extrabold tracking-wider uppercase text-text-muted border-b border-border">Name</th>
          <th class="text-left px-4 py-3 text-[11px] font-extrabold tracking-wider uppercase text-text-muted border-b border-border">Time</th>
          <th class="text-left px-4 py-3 text-[11px] font-extrabold tracking-wider uppercase text-text-muted border-b border-border">Weekdays</th>
          <th class="text-left px-4 py-3 text-[11px] font-extrabold tracking-wider uppercase text-text-muted border-b border-border">Time zone</th>
          <th class="text-left px-4 py-3 text-[11px] font-extrabold tracking-wider uppercase text-text-muted border-b border-border">Reminder</th>
          <th class="text-left px-4 py-3 text-[11px] font-extrabold tracking-wider uppercase text-text-muted border-b border-border w-[12%]">Status</th>
          <th class="text-left px-4 py-3 text-[11px] font-extrabold tracking-wider uppercase text-text-muted border-b border-border w-[24%]">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in schedules" :key="s.id">
          <td class="px-4 py-3.5 border-b border-border align-middle text-text hover:bg-panel-hover">{{ s.name }}</td>
          <td class="px-4 py-3.5 border-b border-border align-middle text-text hover:bg-panel-hover font-mono text-[13px] text-text-dim">{{ s.timeOfDay }}</td>
          <td class="px-4 py-3.5 border-b border-border align-middle text-text hover:bg-panel-hover">{{ weekdayLabels(s.weekdays).join(", ") }}</td>
          <td class="px-4 py-3.5 border-b border-border align-middle text-text hover:bg-panel-hover">{{ s.timezone || "Asia/Jakarta" }}</td>
          <td class="px-4 py-3.5 border-b border-border align-middle text-text hover:bg-panel-hover">{{ s.reminderMinutes === null ? "—" : s.reminderMinutes + " min" }}</td>
          <td class="px-4 py-3.5 border-b border-border align-middle text-text hover:bg-panel-hover">
            <span class="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-extrabold tracking-tight uppercase border transition-all duration-200 ease-in hover:-translate-y-1" :class="s.isActive ? 'bg-success/10 text-success border border-success/30' : 'bg-text-muted/10 text-text-muted border border-border'">
              {{ s.isActive ? "Active" : "Inactive" }}
            </span>
          </td>
          <td class="px-4 py-3.5 border-b border-border align-middle text-text hover:bg-panel-hover flex gap-2">
            <button
              class="inline-flex items-center justify-center gap-2 px-2.5 py-1 rounded-sm text-[11px] font-extrabold tracking-tight border border-border bg-panel-hover text-text transition-all duration-200 ease-in hover:border-text-muted hover:bg-panel hover:text-text whitespace-nowrap leading-none disabled:opacity-50 disabled:cursor-not-allowed"
              @click="editSchedule(s)"
              :disabled="editingId !== null && editingId !== s.id"
            >
              {{ editingId === s.id ? "Editing…" : "Edit" }}
            </button>
            <button
              class="inline-flex items-center justify-center gap-2 px-2.5 py-1 rounded-sm text-[11px] font-extrabold tracking-tight border border-border bg-panel-hover text-text transition-all duration-200 ease-in hover:border-text-muted hover:bg-panel hover:text-text whitespace-nowrap leading-none disabled:opacity-50 disabled:cursor-not-allowed"
              @click="handleTrigger(s)"
              :disabled="triggeringId === s.id"
            >
              {{ triggeringId === s.id ? "…" : "Trigger" }}
            </button>
            <button
              class="inline-flex items-center justify-center gap-2 px-2.5 py-1 rounded-sm text-[11px] font-extrabold tracking-tight border border-danger/40 bg-danger/10 text-danger transition-all duration-200 ease-in hover:bg-danger/35 hover:border-danger whitespace-nowrap leading-none"
              @click="handleDelete(s)"
            >
              Delete
            </button>
          </td>
        </tr>
        <tr v-if="!schedules.length && !loading && !error">
          <td colspan="7" class="px-4 py-3.5 border-b border-border align-middle text-text text-center text-text-muted">
            No schedules yet. Create one to get started.
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div v-if="loading && !schedules.length" class="flex flex-col items-center gap-2.5 py-[52px] px-5 text-text-muted fade-in-fast">
    <span class="w-[36px] h-[36px] border-[3px] border-accent/20 border-t-accent rounded-full spin-slow"></span> Loading schedules…
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
