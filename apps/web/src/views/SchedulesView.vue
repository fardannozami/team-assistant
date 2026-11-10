<template>
  <header class="flex items-baseline justify-between gap-3 flex-wrap mb-7">
    <div>
      <h2 class="text-[26px] font-display font-extrabold tracking-tight text-text">Jadwal</h2>
      <p class="text-text-muted text-sm mt-1">
        Atur waktu pengiriman pertanyaan standup atau mulai secara manual.
      </p>
    </div>
    <button
      @click="showCreateForm = true; createStep = 1"
      :disabled="loading"
      class="inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-[13px] font-extrabold tracking-tight bg-accent text-white shadow-accent transition-all duration-200 ease-in hover:bg-accent-hover hover:shadow-[0_0_0_12px_rgba(63,68,226,0.45)] active:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
    >
      Buat jadwal
    </button>
  </header>

  <div v-if="error" class="mb-5 px-4 py-3.5 rounded-xl border border-danger/30 bg-danger/5 text-danger text-[12px] font-extrabold slide-in">{{ error }}</div>

  <div v-if="showCreateForm" class="mb-7 rounded-2xl border border-border bg-panel p-4 shadow-soft-lg sm:p-6 reveal">
    <div class="mb-4 flex items-center justify-between gap-3">
      <div>
        <div class="text-lg font-extrabold text-text">Buat jadwal</div>
        <div class="mt-1 text-sm text-text-muted">Langkah {{ createStep }} dari 2</div>
      </div>
      <button type="button" class="min-h-10 rounded-xl px-3 text-sm font-semibold text-text-muted hover:bg-panel-hover" @click="showCreateForm = false">Batal</button>
    </div>
    <div class="mb-5 h-1.5 overflow-hidden rounded-full bg-panel-hover"><div class="h-full rounded-full bg-accent transition-all" :style="{ width: createStep === 1 ? '50%' : '100%' }"></div></div>
    <form @submit.prevent="handleCreate" class="space-y-4">
      <template v-if="createStep === 1">
        <div>
          <label class="mb-1.5 block text-sm font-semibold text-text">Nama jadwal</label>
          <input v-model="form.name" type="text" placeholder="Standup harian" required @input="formError = ''" class="min-h-12 w-full rounded-xl border bg-panel px-4 text-base placeholder-text-dim focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20" :class="{ 'border-danger': formError, 'border-border': !formError }" />
        </div>
        <div>
          <label class="mb-1.5 block text-sm font-semibold text-text">Waktu</label>
          <input v-model="form.time" type="time" required @input="formError = ''" class="min-h-12 w-full rounded-xl border bg-panel px-4 text-base focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20" :class="{ 'border-danger': formError, 'border-border': !formError }" />
        </div>
      </template>
      <template v-else>
        <div>
          <label class="mb-1.5 block text-sm font-semibold text-text">Zona waktu</label>
          <input v-model="form.timezone" type="text" placeholder="Asia/Jakarta" class="min-h-12 w-full rounded-xl border border-border bg-panel px-4 text-base focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20" />
        </div>
        <div>
          <label class="mb-1.5 block text-sm font-semibold text-text">Pengingat sebelumnya (menit)</label>
          <input v-model.number="form.reminder" type="number" min="0" max="1440" class="min-h-12 w-full rounded-xl border border-border bg-panel px-4 text-base focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20" />
        </div>
        <div>
          <label class="mb-2 block text-sm font-semibold text-text">Hari aktif</label>
          <div class="flex flex-wrap gap-2">
            <label v-for="(d, index) in DAYS" :key="d" class="inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-bold" :class="form.weekdays.includes(index) ? 'border-accent bg-accent text-white' : 'border-border bg-panel-hover text-text-muted'">
              <input type="checkbox" :checked="form.weekdays.includes(index)" @change="toggleWeekday(form.weekdays, index)" class="h-4 w-4 accent-accent" />{{ d }}
            </label>
          </div>
        </div>
        <div class="rounded-xl bg-panel-hover p-4 text-sm text-text-muted">{{ form.name }} · {{ form.time }} · {{ form.timezone || 'Asia/Jakarta' }}</div>
      </template>
      <p v-if="formError" class="text-sm font-semibold text-danger" role="alert">{{ formError }}</p>
      <div class="flex gap-2 pt-1">
        <button v-if="createStep === 2" type="button" class="min-h-12 flex-1 rounded-xl border border-border px-4 text-sm font-bold text-text" @click="createStep = 1">Kembali</button>
        <button v-if="createStep === 1" type="button" class="min-h-12 flex-1 rounded-xl bg-accent px-4 text-sm font-bold text-white disabled:opacity-50" :disabled="!form.name.trim() || !form.time" @click="createStep = 2">Lanjutkan</button>
        <button v-else type="submit" :disabled="creating || !form.weekdays.length" class="min-h-12 flex-1 rounded-xl bg-accent px-4 text-sm font-bold text-white disabled:opacity-60">{{ creating ? 'Menyimpan…' : 'Simpan jadwal' }}</button>
      </div>
    </form>
  </div>

  <div v-if="editingId" class="mt-4 mb-7 rounded-2xl border border-border bg-panel p-4 shadow-soft-lg sm:p-6 reveal">
    <div class="mb-4 flex items-center justify-between gap-3">
      <div>
        <div class="text-lg font-extrabold text-text">Ubah jadwal</div>
        <div class="mt-1 text-sm text-text-muted">Langkah {{ editStep }} dari 2 · {{ editingSchedule?.name }}</div>
      </div>
      <button type="button" class="min-h-10 rounded-xl px-3 text-sm font-semibold text-text-muted hover:bg-panel-hover" @click="editingId = null; editStep = 1">Batal</button>
    </div>
    <div class="mb-5 h-1.5 overflow-hidden rounded-full bg-panel-hover"><div class="h-full rounded-full bg-accent transition-all" :style="{ width: editStep === 1 ? '50%' : '100%' }"></div></div>
    <form @submit.prevent="handleSave" class="space-y-4">
      <template v-if="editStep === 1">
        <div>
          <label class="mb-1.5 block text-sm font-semibold text-text">Nama jadwal</label>
          <input v-model="edit.name" type="text" required @input="formError = ''" class="min-h-12 w-full rounded-xl border border-border bg-panel px-4 text-base focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20" />
        </div>
        <div>
          <label class="mb-1.5 block text-sm font-semibold text-text">Waktu</label>
          <input v-model="edit.time" type="time" required @input="formError = ''" class="min-h-12 w-full rounded-xl border border-border bg-panel px-4 text-base focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20" />
        </div>
      </template>
      <template v-else>
        <div>
          <label class="mb-1.5 block text-sm font-semibold text-text">Zona waktu</label>
          <input v-model="edit.timezone" type="text" class="min-h-12 w-full rounded-xl border border-border bg-panel px-4 text-base focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20" />
        </div>
        <div>
          <label class="mb-1.5 block text-sm font-semibold text-text">Pengingat sebelumnya (menit)</label>
          <input v-model.number="edit.reminder" type="number" min="0" max="1440" class="min-h-12 w-full rounded-xl border border-border bg-panel px-4 text-base focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20" />
        </div>
        <div>
          <label class="mb-2 block text-sm font-semibold text-text">Hari aktif</label>
          <div class="flex flex-wrap gap-2">
            <label v-for="(d, index) in DAYS" :key="d" class="inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-bold" :class="edit.weekdays.includes(index) ? 'border-accent bg-accent text-white' : 'border-border bg-panel-hover text-text-muted'">
              <input type="checkbox" :checked="edit.weekdays.includes(index)" @change="toggleWeekday(edit.weekdays, index)" class="h-4 w-4 accent-accent" />{{ d }}
            </label>
          </div>
        </div>
        <label class="flex min-h-12 items-center gap-3 rounded-xl border border-border px-4 text-sm font-semibold text-text">
          <input type="checkbox" v-model="edit.isActive" id="editIsActive" class="h-5 w-5 accent-accent" />Jadwal aktif
        </label>
        <div class="rounded-xl bg-panel-hover p-4 text-sm text-text-muted">{{ edit.name }} · {{ edit.time }} · {{ weekdayLabels(edit.weekdays).join(', ') }}</div>
      </template>
      <p v-if="formError" class="text-sm font-semibold text-danger" role="alert">{{ formError }}</p>
      <div class="flex gap-2 pt-1">
        <button v-if="editStep === 2" type="button" class="min-h-12 flex-1 rounded-xl border border-border px-4 text-sm font-bold text-text" @click="editStep = 1">Kembali</button>
        <button v-if="editStep === 1" type="button" class="min-h-12 flex-1 rounded-xl bg-accent px-4 text-sm font-bold text-white disabled:opacity-50" :disabled="!edit.name.trim() || !edit.time" @click="editStep = 2">Lanjutkan</button>
        <button v-else type="submit" :disabled="updating || !edit.weekdays.length" class="min-h-12 flex-1 rounded-xl bg-accent px-4 text-sm font-bold text-white disabled:opacity-60">{{ updating ? 'Menyimpan…' : 'Simpan perubahan' }}</button>
      </div>
    </form>
  </div>

  <div class="table-scroll mb-7 rounded-xl border border-border shadow-soft">
    <table class="w-full border-collapse text-[13px]">
      <thead>
        <tr class="text-text-dim">
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Nama</th>
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Waktu</th>
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Hari aktif</th>
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Zona waktu</th>
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Pengingat</th>
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border w-[12%]">Status</th>
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border w-[30%]">Aksi</th>
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
            <span class="badge" :class="s.isActive ? 'bg-success/8 text-success border-success/20' : 'bg-text-muted/10 text-text-dim border border-border'">{{ s.isActive ? "Aktif" : "Nonaktif" }}</span>
          </td>
          <td class="px-5 py-4 border-b border-border align-middle text-text flex gap-2">
            <button
              class="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-[12px] font-extrabold tracking-tight border border-border text-text transition-colors duration-200 ease-in hover:bg-panel-hover disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
              @click="editSchedule(s)"
              :disabled="editingId !== null && editingId !== s.id"
            >
              {{ editingId === s.id ? "Mengubah…" : "Ubah" }}
            </button>
            <button
              class="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-[12px] font-extrabold tracking-tight bg-accent text-white shadow-accent transition-all duration-200 ease-in hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
              @click="handleTrigger(s)"
              :disabled="triggeringId === s.id"
            >
              {{ triggeringId === s.id ? "…" : "Jalankan" }}
            </button>
            <button
              class="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-[12px] font-extrabold tracking-tight border border-danger/20 bg-danger/6 text-danger transition-all duration-200 ease-in hover:bg-danger/10 hover:border-danger/40 whitespace-nowrap"
              @click="handleDelete(s)"
            >
              Hapus
            </button>
          </td>
        </tr>
        <tr v-if="!schedules.length && !loading && !error">
          <td colspan="7" class="px-5 py-4 border-b border-border align-middle text-center text-text-muted">
            Belum ada jadwal. Buat jadwal untuk memulai.
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div v-if="loading && !schedules.length" class="flex flex-col items-center gap-2.5 py-24 text-center text-text-muted fade-in-fast">
    <span class="w-10 h-10 border-2 border-accent/20 border-t-accent rounded-full spin-slow" aria-hidden="true"></span>
    <span class="text-sm font-extrabold tracking-tight">Memuat jadwal…</span>
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

const DAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

const schedules = ref<Schedule[]>([]);
const loading = ref(false);
const error = ref("");

const showCreateForm = ref(false);
const createStep = ref(1);
const editStep = ref(1);
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
    error.value = err instanceof ApiError ? err.message : "Gagal memuat jadwal.";
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
    formError.value = "Nama, waktu, dan minimal satu hari wajib diisi.";
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
    showToast("Jadwal berhasil dibuat.", "success");
    createStep.value = 1;
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
    error.value = err instanceof ApiError ? err.message : "Gagal membuat jadwal.";
  } finally {
    creating.value = false;
  }
}

function editSchedule(s: Schedule) {
  editStep.value = 1;
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
    showToast("Jadwal berhasil diperbarui.", "success");
    editingId.value = null;
    editingSchedule.value = null;
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Gagal menyimpan jadwal.";
  } finally {
    updating.value = false;
  }
}

async function handleTrigger(s: Schedule) {
  triggeringId.value = s.id;
  try {
    await schedulesApi.trigger(s.id);
    showToast(`Standup dimulai untuk "${s.name}".`, "success");
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Gagal menjalankan jadwal.";
  } finally {
    triggeringId.value = null;
  }
}

async function handleDelete(s: Schedule) {
  if (!window.confirm(`Hapus jadwal "${s.name}"?`)) return;
  try {
    await schedulesApi.delete(s.id);
    showToast("Jadwal berhasil dihapus.", "success");
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Gagal menghapus jadwal.";
  }
}
</script>
