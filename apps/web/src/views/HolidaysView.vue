<template>
  <header class="flex items-baseline justify-between gap-3 flex-wrap mb-7">
    <div>
      <h2 class="text-[26px] font-display font-extrabold tracking-tight text-text">Holidays</h2>
      <p class="text-text-muted text-sm mt-1">
        Calendar settings and dates that decide when standups are skipped.
      </p>
    </div>
  </header>

  <div v-if="error" class="mb-5 px-4 py-3.5 rounded-xl border border-danger/30 bg-danger/5 text-danger text-[12px] font-extrabold slide-in">{{ error }}</div>

  <div class="border-b border-border mb-7">
    <button
      v-for="t in TABS"
      :key="t.id"
      class="flex-shrink-0 h-10 flex items-center px-4 text-[12px] font-extrabold tracking-tight uppercase border-b-2 border-transparent whitespace-nowrap transition-colors duration-200 ease-in hover:text-accent hover:bg-accent/4"
      :class="{ 'text-accent border-accent bg-accent/4': tab === t.id }"
      @click="tab = t.id"
    >
      {{ t.label }}
    </button>
  </div>

  <!-- Settings -->
  <div v-if="tab === 'settings'" class="border border-border rounded-xl shadow-soft-lg p-6 max-w-[560px] reveal">
    <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-4">Calendar settings</div>
    <form @submit.prevent="saveSettings" class="flex flex-col gap-5">
      <div>
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Country</label>
        <input v-model="settings.country" type="text"
          class="w-full px-4 py-3.5 rounded-xl border text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none bg-panel border-border"
        />
      </div>
      <div>
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Time zone</label>
        <input v-model="settings.timezone" type="text" placeholder="Asia/Jakarta"
          class="w-full px-4 py-3.5 rounded-xl border text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none bg-panel border-border"
        />
      </div>
      <div class="flex items-center gap-2.5 mb-3 cursor-pointer leading-none">
        <input type="checkbox" v-model="settings.skipWeekends" id="skipWeekends" class="w-4 h-4 shrink-0 accent-accent cursor-pointer" />
        <label for="skipWeekends" class="text-[11px] font-extrabold tracking-tight text-text">Skip weekends</label>
      </div>
      <div class="flex items-center gap-2.5 mb-3 cursor-pointer leading-none">
        <input type="checkbox" v-model="settings.skipNationalHolidays" id="skipNational" class="w-4 h-4 shrink-0 accent-accent cursor-pointer" />
        <label for="skipNational" class="text-[11px] font-extrabold tracking-tight text-text">Skip national holidays</label>
      </div>
      <div class="flex items-center gap-2.5 mb-3 cursor-pointer leading-none">
        <input type="checkbox" v-model="settings.skipJointHolidays" id="skipJoint" class="w-4 h-4 shrink-0 accent-accent cursor-pointer" />
        <label for="skipJoint" class="text-[11px] font-extrabold tracking-tight text-text">Skip joint leave (cuti bersama)</label>
      </div>
      <div class="flex gap-2 items-end">
        <button
          class="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[13px] font-extrabold tracking-tight bg-accent text-white shadow-accent transition-all duration-200 ease-in hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
          type="submit"
          :disabled="savingSettings"
        >
          Save settings
        </button>
      </div>
    </form>
    <p class="text-text-muted text-[12px] mt-2">Defaults: country ID, time zone Asia/Jakarta.</p>
  </div>

  <!-- Holidays list + sync -->
  <div v-if="tab === 'holidays'" class="border border-border rounded-xl shadow-soft-lg p-6 reveal mb-7">
    <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-4">Holidays</div>
    <div class="flex items-center gap-3 mb-5 flex-wrap">
      <div class="min-w-[160px]">
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Year</label>
        <input
          v-model.number="holidayYear"
          type="number"
          min="2000"
          max="2100"
          @change="loadHolidays"
          class="w-full px-4 py-3.5 rounded-xl border text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none bg-panel border-border"
        />
      </div>
      <button
        class="inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-[13px] font-extrabold tracking-tight bg-accent text-white shadow-accent transition-all duration-200 ease-in hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
        @click="loadHolidays"
        :disabled="loadingHolidays"
      >
        Load
      </button>
    </div>

    <div v-if="loadingHolidays && !holidays.length" class="flex flex-col items-center gap-2.5 py-24 text-center text-text-muted fade-in-fast">
      <span class="w-10 h-10 border-2 border-accent/20 border-t-accent rounded-full spin-slow" aria-hidden="true"></span> Loading…
    </div>

    <div v-if="!loadingHolidays && !error && !holidays.length" class="flex flex-col items-center justify-center py-24 text-center text-text-muted fade-in">
      <p class="text-[17px] font-extrabold text-text mt-3.5 mb-1.5">No holidays</p>
      <p>Pick a year and load the calendar, or sync from the national calendar below.</p>
    </div>

    <div class="border border-border rounded-xl overflow-hidden shadow-soft mb-6">
      <table class="w-full border-collapse text-[13px]">
        <thead>
          <tr class="text-text-dim">
            <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Date</th>
            <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Name</th>
            <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border w-[16%]">Type</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="h in holidays" :key="h.date" class="hover:bg-panel-hover transition-colors duration-200 ease-in">
            <td class="px-5 py-4 border-b border-border align-middle text-text font-mono text-[13px] text-text-dim">{{ h.date }}</td>
            <td class="px-5 py-4 border-b border-border align-middle text-text">{{ h.name }}</td>
            <td class="px-5 py-4 border-b border-border align-middle text-text">
              <span class="badge" :class="h.type === 'joint' ? 'bg-warning/8 text-warning border-warning/20' : 'bg-accent/8 text-accent border-accent/20'">{{ h.type }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="border border-border rounded-xl shadow-soft-lg p-6 reveal">
      <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-4">Sync with national calendar</div>
      <div class="flex items-center gap-3 mb-4 flex-wrap">
        <div class="min-w-[160px]">
          <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Year</label>
          <input
            v-model.number="syncYear"
            type="number"
            min="2000"
            max="2100"
            class="w-full px-4 py-3.5 rounded-xl border text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none bg-panel border-border"
          />
        </div>
        <button
          class="inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-[13px] font-extrabold tracking-tight bg-accent text-white shadow-accent transition-all duration-200 ease-in hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
          @click="syncHolidays"
          :disabled="syncing"
        >
          Sync holidays
        </button>
        <span v-if="syncResult" class="text-text">{{ syncResult.synced }} holiday(s) synced for {{ syncResult.year }}</span>
      </div>
    </div>
  </div>

  <!-- Exceptions -->
  <div v-if="tab === 'exceptions'" class="border border-border rounded-xl shadow-soft-lg p-6 reveal mb-7">
    <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-4">Manual exceptions</div>

    <div class="border border-border rounded-xl overflow-hidden shadow-soft mb-6">
      <table class="w-full border-collapse text-[13px]">
        <thead>
          <tr class="text-text-dim">
            <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Date</th>
            <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Reason</th>
            <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border w-[16%]">Skip</th>
            <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border w-[18%]">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in exceptions" :key="e.id" class="hover:bg-panel-hover transition-colors duration-200 ease-in">
            <td class="px-5 py-4 border-b border-border align-middle text-text font-mono text-[13px] text-text-dim">{{ e.date }}</td>
            <td class="px-5 py-4 border-b border-border align-middle text-text">{{ e.reason || "—" }}</td>
            <td class="px-5 py-4 border-b border-border align-middle text-text">
              <span class="badge" :class="e.skip ? 'bg-success/8 text-success border-success/20' : 'bg-text-muted/10 text-text-dim border border-border'">{{ e.skip ? "Yes" : "No" }}</span>
            </td>
            <td class="px-5 py-4 border-b border-border align-middle text-text flex gap-2">
              <button
                class="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-[12px] font-extrabold tracking-tight border border-danger/20 bg-danger/6 text-danger transition-all duration-200 ease-in hover:bg-danger/10 hover:border-danger/40 whitespace-nowrap"
                @click="handleDeleteException(e.id)"
              >
                Delete
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="flex items-center gap-3 mb-4 flex-wrap mt-4">
      <div class="min-w-[170px]" :class="{ 'border-danger': excError, 'border-border': !excError }">
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Date</label>
        <input v-model="excDate" type="date" @input="excError = ''"
          class="w-full px-4 py-3.5 rounded-xl border text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none bg-panel border-border"
        />
      </div>
      <div class="min-w-[200px]">
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Reason</label>
        <input v-model="excReason" type="text" placeholder="Company day off"
          class="w-full px-4 py-3.5 rounded-xl border text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none bg-panel border-border"
        />
      </div>
      <div class="flex items-center gap-2.5 mb-3 cursor-pointer leading-none">
        <input type="checkbox" v-model="excSkip" id="excSkip" class="w-4 h-4 shrink-0 accent-accent cursor-pointer" />
        <label for="excSkip" class="text-[11px] font-extrabold tracking-tight text-text">Skip standup on this date</label>
      </div>
      <p v-if="excError" class="col-span-full text-danger text-[11px] font-extrabold mt-1.5 slide-in">{{ excError }}</p>
      <button
        class="inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-[13px] font-extrabold tracking-tight bg-accent text-white shadow-accent transition-all duration-200 ease-in hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
        @click="addException"
        :disabled="addingException"
      >
        Add exception
      </button>
    </div>
  </div>

  <!-- Check date -->
  <div v-if="tab === 'check'" class="border border-border rounded-xl shadow-soft-lg p-6 max-w-[560px] reveal">
    <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-4">Check a date</div>
    <div class="flex items-center gap-3 mb-5 flex-wrap">
      <div class="min-w-[200px]">
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Date</label>
        <input v-model="checkDate" type="date"
          class="w-full px-4 py-3.5 rounded-xl border text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none bg-panel border-border"
        />
      </div>
      <button
        class="inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-[13px] font-extrabold tracking-tight bg-accent text-white shadow-accent transition-all duration-200 ease-in hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
        @click="checkExcluded"
        :disabled="checking"
      >
        Check
      </button>
    </div>

    <div v-if="checkResult" class="flex items-center gap-2.5 px-4 py-3.5 rounded-xl border border-border bg-panel-hover mt-2 slide-in">
      <span class="badge" :class="checkResult.excluded ? 'bg-success/8 text-success border-success/20' : 'bg-text-muted/10 text-text-dim border border-border'">
        {{ checkResult.excluded ? "Excluded from standups" : "Not excluded" }}
      </span>
      <span v-if="checkResult.reason" class="ml-2 font-mono text-[13px] text-text-dim">{{ checkResult.reason }}</span>
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
