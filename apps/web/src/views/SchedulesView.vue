<template>
  <div class="page-head">
    <div>
      <h2 class="page-title">Schedules</h2>
      <p class="page-desc">Configure when standup prompts are sent, and trigger them manually.</p>
    </div>
    <button class="btn btn--primary" @click="showCreateForm = true" :disabled="loading">
      Create schedule
    </button>
  </div>

  <div v-if="error" class="alert alert--error">{{ error }}</div>

  <div v-if="showCreateForm" class="card">
    <div class="card-title">Create schedule</div>
    <form @submit.prevent="handleCreate" class="form form--grid">
      <div class="field" :class="{ 'field--error': formError }">
        <label class="field-label">Schedule name</label>
        <input
          v-model="form.name"
          type="text"
          placeholder="Daily standup"
          required
          @input="formError = ''"
        />
      </div>
      <div class="field" :class="{ 'field--error': formError }">
        <label class="field-label">Time of day (24-hour)</label>
        <input
          v-model="form.time"
          type="time"
          required
          @input="formError = ''"
        />
      </div>
      <div class="field">
        <label class="field-label">Time zone</label>
        <input v-model="form.timezone" type="text" placeholder="Asia/Jakarta" />
      </div>
      <div class="field">
        <label class="field-label">Reminder before standup (minutes)</label>
        <input
          v-model.number="form.reminder"
          type="number"
          min="0"
          max="1440"
        />
      </div>
      <div class="field">
        <label class="field-label">Active weekdays</label>
        <div class="weekdays">
          <label
            v-for="d in DAYS"
            :key="d"
            class="chip"
          >
            <input
              type="checkbox"
              :checked="form.weekdays.includes(d)"
              @change="toggleWeekday(form.weekdays, d)"
            />
            <span class="chip-label">{{ d }}</span>
          </label>
        </div>
      </div>
      <p v-if="formError" class="field-error-text">{{ formError }}</p>
      <div class="field field--actions">
        <button class="btn btn--primary" type="submit" :disabled="creating">
          Create schedule
        </button>
        <button class="btn btn--ghost" type="button" @click="showCreateForm = false">
          Cancel
        </button>
      </div>
    </form>
  </div>

  <div v-if="editingId" class="card">
    <div class="card-title">
      Edit schedule
      <span style="margin-left: 6px; font-weight: 600; color: var(--text-muted)"
        >{{ editingSchedule?.name }}</span
      >
    </div>
    <form @submit.prevent="handleSave" class="form form--grid">
      <div class="field" :class="{ 'field--error': formError }">
        <label class="field-label">Schedule name</label>
        <input
          v-model="edit.name"
          type="text"
          required
          @input="formError = ''"
        />
      </div>
      <div class="field" :class="{ 'field--error': formError }">
        <label class="field-label">Time of day (24-hour)</label>
        <input
          v-model="edit.time"
          type="time"
          required
          @input="formError = ''"
        />
      </div>
      <div class="field">
        <label class="field-label">Time zone</label>
        <input v-model="edit.timezone" type="text" />
      </div>
      <div class="field">
        <label class="field-label">Reminder before standup (minutes)</label>
        <input v-model.number="edit.reminder" type="number" min="0" max="1440" />
      </div>
      <div class="field">
        <label class="field-label">Active weekdays</label>
        <div class="weekdays">
          <label
            v-for="d in DAYS"
            :key="d"
            class="chip"
          >
            <input
              type="checkbox"
              :checked="edit.weekdays.includes(d)"
              @change="toggleWeekday(edit.weekdays, d)"
            />
            <span class="chip-label">{{ d }}</span>
          </label>
        </div>
      </div>
      <p v-if="formError" class="field-error-text">{{ formError }}</p>
      <div class="field field--check">
        <input type="checkbox" v-model="edit.isActive" id="editIsActive" />
        <label for="editIsActive">Schedule is active</label>
      </div>
      <div class="field field--actions">
        <button class="btn btn--primary" type="submit" :disabled="updating">
          Save changes
        </button>
        <button class="btn btn--ghost" type="button" @click="editingId = null">
          Cancel
        </button>
      </div>
    </form>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Time</th>
          <th>Weekdays</th>
          <th>Time zone</th>
          <th>Reminder</th>
          <th style="width: 12%">Status</th>
          <th style="width: 24%">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in schedules" :key="s.id">
          <td>{{ s.name }}</td>
          <td class="mono">{{ s.timeOfDay }}</td>
          <td class="weekday-cell">{{ weekdayLabels(s.weekdays).join(", ") }}</td>
          <td>{{ s.timezone || "Asia/Jakarta" }}</td>
          <td>
            {{ s.reminderMinutes === null ? "—" : s.reminderMinutes + " min" }}
          </td>
          <td>
            <span
              class="badge"
              :class="s.isActive ? 'badge--active' : 'badge--inactive'"
            >
              {{ s.isActive ? "Active" : "Inactive" }}
            </span>
          </td>
          <td class="actions">
            <button
              class="btn btn--ghost btn--sm"
              @click="editSchedule(s)"
              :disabled="editingId !== null && editingId !== s.id"
            >
              {{ editingId === s.id ? "Editing…" : "Edit" }}
            </button>
            <button
              class="btn btn--ghost btn--sm"
              @click="handleTrigger(s)"
              :disabled="triggeringId === s.id"
            >
              {{ triggeringId === s.id ? "…" : "Trigger" }}
            </button>
            <button
              class="btn btn--danger btn--sm"
              @click="handleDelete(s)"
            >
              Delete
            </button>
          </td>
        </tr>
        <tr v-if="!schedules.length && !loading && !error">
          <td colspan="7" style="text-align: center; color: var(--text-muted)">
            No schedules yet. Create one to get started.
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div v-if="loading && !schedules.length" class="loading">
    <span class="spinner"></span> Loading schedules…
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
