<template>
  <div class="page-head">
    <div>
      <h2 class="page-title">Holidays</h2>
      <p class="page-desc">Calendar settings and dates that decide when standups are skipped.</p>
    </div>
  </div>

  <div v-if="error" class="alert alert--error">{{ error }}</div>

  <div class="sub-tabs">
    <button
      v-for="t in TABS"
      :key="t.id"
      :class="['sub-tab', { 'sub-tab--active': tab === t.id }]"
      @click="tab = t.id"
    >
      {{ t.label }}
    </button>
  </div>

  <!-- Settings -->
  <div v-if="tab === 'settings'" class="card">
    <div class="card-title">Calendar settings</div>
    <form @submit.prevent="saveSettings" class="form" style="max-width: 520px">
      <div class="field">
        <label class="field-label">Country</label>
        <input v-model="settings.country" type="text" />
      </div>
      <div class="field">
        <label class="field-label">Time zone</label>
        <input v-model="settings.timezone" type="text" placeholder="Asia/Jakarta" />
      </div>
      <div class="field field--check">
        <input type="checkbox" v-model="settings.skipWeekends" id="skipWeekends" />
        <label for="skipWeekends">Skip weekends</label>
      </div>
      <div class="field field--check">
        <input type="checkbox" v-model="settings.skipNationalHolidays" id="skipNational" />
        <label for="skipNational">Skip national holidays</label>
      </div>
      <div class="field field--check">
        <input type="checkbox" v-model="settings.skipJointHolidays" id="skipJoint" />
        <label for="skipJoint">Skip joint leave (cuti bersama)</label>
      </div>
      <div class="field field--actions">
        <button class="btn btn--primary" type="submit" :disabled="savingSettings">
          Save settings
        </button>
      </div>
    </form>
    <p style="color: var(--text-muted); font-size: 12px; margin-top: 10px">
      Defaults: country ID, time zone Asia/Jakarta.
    </p>
  </div>

  <!-- Holidays list + sync -->
  <div v-if="tab === 'holidays'" class="card">
    <div class="card-title">Holidays</div>
    <div class="toolbar">
      <div class="field">
        <label class="field-label">Year</label>
        <input
          v-model.number="holidayYear"
          type="number"
          min="2000"
          max="2100"
          @change="loadHolidays"
        />
      </div>
      <button class="btn btn--primary" @click="loadHolidays" :disabled="loadingHolidays">
        Load
      </button>
    </div>

    <div v-if="loadingHolidays && !holidays.length" class="loading">
      <span class="spinner"></span> Loading…
    </div>

    <div v-if="!loadingHolidays && !error && !holidays.length" class="empty">
      <p class="empty-title">No holidays</p>
      <p>Pick a year and load the calendar, or sync from the national calendar below.</p>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Name</th>
            <th style="width: 16%">Type</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="h in holidays" :key="h.date">
            <td class="mono">{{ h.date }}</td>
            <td>{{ h.name }}</td>
            <td>
              <span
                class="badge"
                :class="h.type === 'joint' ? 'badge--joint' : 'badge--national'"
              >
                {{ h.type }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card" style="margin-top: 14px">
      <div class="card-title">Sync with national calendar</div>
      <div class="toolbar">
        <div class="field">
          <label class="field-label">Year</label>
          <input
            v-model.number="syncYear"
            type="number"
            min="2000"
            max="2100"
          />
        </div>
        <button class="btn btn--primary" @click="syncHolidays" :disabled="syncing">
          Sync holidays
        </button>
        <span v-if="syncResult" class="synced">
          {{ syncResult.synced }} holiday(s) synced for {{ syncResult.year }}
        </span>
      </div>
    </div>
  </div>

  <!-- Exceptions -->
  <div v-if="tab === 'exceptions'" class="card">
    <div class="card-title">Manual exceptions</div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Reason</th>
            <th style="width: 16%">Skip</th>
            <th style="width: 18%">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in exceptions" :key="e.id">
            <td class="mono">{{ e.date }}</td>
            <td>{{ e.reason || "—" }}</td>
            <td>
              <span class="badge" :class="e.skip ? 'badge--active' : 'badge--inactive'">
                {{ e.skip ? "Yes" : "No" }}
              </span>
            </td>
            <td class="actions">
              <button
                class="btn btn--danger btn--sm"
                @click="handleDeleteException(e.id)"
              >
                Delete
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="toolbar" style="margin-top: 14px">
      <div class="field" :class="{ 'field--error': excError }">
        <label class="field-label">Date</label>
        <input v-model="excDate" type="date" @input="excError = ''" />
      </div>
      <div class="field">
        <label class="field-label">Reason</label>
        <input v-model="excReason" type="text" placeholder="Company day off" />
      </div>
      <div class="field field--check">
        <input type="checkbox" v-model="excSkip" id="excSkip" />
        <label for="excSkip">Skip standup on this date</label>
      </div>
      <p v-if="excError" class="field-error-text">{{ excError }}</p>
      <button
        class="btn btn--primary"
        @click="addException"
        :disabled="addingException"
      >
        Add exception
      </button>
    </div>
  </div>

  <!-- Check date -->
  <div v-if="tab === 'check'" class="card" style="max-width: 520px">
    <div class="card-title">Check a date</div>
    <div class="toolbar">
      <div class="field">
        <label class="field-label">Date</label>
        <input v-model="checkDate" type="date" />
      </div>
      <button class="btn btn--primary" @click="checkExcluded" :disabled="checking">
        Check
      </button>
    </div>

    <div v-if="checkResult" class="result-card">
      <span
        class="badge"
        :class="checkResult.excluded ? 'badge--active' : 'badge--inactive'"
      >
        {{ checkResult.excluded ? "Excluded from standups" : "Not excluded" }}
      </span>
      <span v-if="checkResult.reason" class="mono" style="margin-left: 10px">
        {{ checkResult.reason }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import {
  holidaysApi,
  ApiError,
  showToast,
  type CalendarSettings,
  type Holiday,
  type CalendarException,
} from "../api";

const TABS = [
  { id: "settings", label: "Settings" },
  { id: "holidays", label: "Holidays" },
  { id: "exceptions", label: "Exceptions" },
  { id: "check", label: "Check date" },
];

const tab = ref("settings");
const error = ref("");

// ---- Settings ----
const savingSettings = ref(false);
const settings = ref<CalendarSettings>({
  id: "",
  country: "ID",
  timezone: "Asia/Jakarta",
  skipWeekends: true,
  skipNationalHolidays: true,
  skipJointHolidays: true,
  config: null,
  createdAt: "",
  updatedAt: "",
});

async function loadSettings() {
  try {
    settings.value = await holidaysApi.getSettings();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load calendar settings.";
  }
}

async function saveSettings() {
  savingSettings.value = true;
  try {
    await holidaysApi.updateSettings({
      country: settings.value.country,
      timezone: settings.value.timezone,
      skipWeekends: settings.value.skipWeekends,
      skipNationalHolidays: settings.value.skipNationalHolidays,
      skipJointHolidays: settings.value.skipJointHolidays,
    });
    showToast("Calendar settings saved.", "success");
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to save settings.";
  } finally {
    savingSettings.value = false;
  }
}

// ---- Holidays list ----
const loadingHolidays = ref(false);
const holidayYear = ref(new Date().getFullYear());
const holidays = ref<Holiday[]>([]);

async function loadHolidays() {
  loadingHolidays.value = true;
  try {
    holidays.value = await holidaysApi.list(holidayYear.value);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load holidays.";
  } finally {
    loadingHolidays.value = false;
  }
}

// ---- Sync ----
const syncing = ref(false);
const syncYear = ref(new Date().getFullYear());
const syncResult = ref<{ year: number; synced: number } | null>(null);

async function syncHolidays() {
  syncing.value = true;
  try {
    const result = await holidaysApi.sync(syncYear.value);
    syncResult.value = { year: result.year, synced: result.synced };
    showToast(`Synced ${result.synced} holiday(s) for ${result.year}.`, "success");
    if (holidayYear.value === result.year) {
      await loadHolidays();
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to sync holidays.";
  } finally {
    syncing.value = false;
  }
}

// ---- Exceptions ----
const loadingExceptions = ref(false);
const exceptions = ref<CalendarException[]>([]);

async function loadExceptions() {
  loadingExceptions.value = true;
  try {
    exceptions.value = await holidaysApi.listExceptions();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load exceptions.";
  } finally {
    loadingExceptions.value = false;
  }
}

const excDate = ref("");
const excReason = ref("");
const excSkip = ref(true);
const addingException = ref(false);
const excError = ref("");

async function addException() {
  excError.value = "";
  if (!excDate.value) {
    excError.value = "Date is required.";
    return;
  }
  addingException.value = true;
  try {
    await holidaysApi.createException({
      date: excDate.value,
      reason: excReason.value || null,
      skip: excSkip.value,
    });
    showToast("Exception added.", "success");
    excDate.value = "";
    excReason.value = "";
    excSkip.value = true;
    await loadExceptions();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to add exception.";
  } finally {
    addingException.value = false;
  }
}

async function handleDeleteException(id: string) {
  if (!window.confirm("Delete this exception?")) return;
  try {
    await holidaysApi.deleteException(id);
    showToast("Exception deleted.", "success");
    await loadExceptions();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to delete exception.";
  }
}

// ---- Check date ----
const checking = ref(false);
const checkDate = ref(new Date().toISOString().slice(0, 10));
const checkResult = ref<{ excluded: boolean; reason?: string } | null>(null);

async function checkExcluded() {
  if (!checkDate.value) return;
  checking.value = true;
  try {
    checkResult.value = await holidaysApi.checkDate(checkDate.value);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to check date.";
  } finally {
    checking.value = false;
  }
}

onMounted(() => {
  loadSettings();
  if (tab.value === "holidays") loadHolidays();
  if (tab.value === "exceptions") loadExceptions();
});

watch(tab, (id) => {
  if (id === "holidays") loadHolidays();
  if (id === "exceptions") loadExceptions();
});
</script>
