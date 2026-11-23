<template>
  <header class="flex items-baseline justify-between gap-3 flex-wrap mb-7">
    <div>
      <h2 class="text-[26px] font-display font-extrabold tracking-tight text-text">Anggota tim</h2>
      <p class="text-text-muted text-sm mt-1">
        Daftar anggota tim dan nomor WhatsApp mereka.
      </p>
    </div>
    <button
      v-if="isAdmin"
      :disabled="loading"
      class="inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-[13px] font-extrabold tracking-tight bg-accent text-white shadow-accent transition-all duration-200 ease-in hover:bg-accent-hover hover:shadow-[0_0_0_12px_rgba(63,68,226,0.45)] active:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
      @click="openAddForm"
    >
      Tambah anggota
    </button>
  </header>

  <div v-if="error" class="mb-5 px-4 py-3.5 rounded-xl border border-danger/30 bg-danger/5 text-danger text-[12px] font-extrabold slide-in">{{ error }}</div>

  <div class="flex items-end gap-3 mb-5 flex-wrap">
    <div class="min-w-[250px]">
      <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Cari nama atau nomor</label>
      <input
        v-model="searchQuery"
        type="search"
        placeholder="Cari anggota…"
        class="w-full px-4 py-3.5 rounded-xl border text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none bg-panel border-border"
        @input="searchEmployees"
      />
    </div>
    <select
      v-model="activeFilter"
      class="px-4 py-3.5 rounded-xl border border-border text-sm leading-5 cursor-pointer bg-panel transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none"
      @change="loadEmployees"
    >
      <option :value="null">Semua anggota</option>
      <option :value="true">Aktif saja</option>
      <option :value="false">Nonaktif saja</option>
    </select>
  </div>

  <div v-if="loading && !employees.length" class="flex flex-col items-center gap-2.5 py-24 text-center text-text-muted fade-in-fast">
    <span class="w-10 h-10 border-2 border-accent/20 border-t-accent rounded-full spin-slow" aria-hidden="true"></span>
    <span class="text-sm font-extrabold tracking-tight">Memuat anggota…</span>
  </div>

  <div v-if="!loading && !error && !employees.length" class="flex flex-col items-center justify-center py-24 text-center fade-in">
    <div class="w-14 h-14 rounded-full border border-border bg-panel-hover flex items-center justify-center text-text-dim mb-4" aria-hidden="true">—</div>
    <h3 class="text-[18px] font-extrabold tracking-tight text-text mb-1">Anggota tidak ditemukan</h3>
    <p class="text-text-muted text-sm">Tambahkan anggota pertama untuk memulai.</p>
  </div>

  <div class="mb-7 space-y-3 md:hidden">
    <article v-for="e in employees" :key="e.id" class="rounded-2xl border border-border bg-panel p-4 shadow-soft">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0"><h3 class="flex flex-wrap items-center gap-2 font-bold text-text">{{ e.name }} <span v-if="isAdminRole(e.roleName)" class="badge" :class="roleBadgeUtils(e.roleName)">{{ e.roleName }}</span></h3><p class="mt-0.5 break-all font-mono text-xs text-text-dim">{{ e.phone }}</p><p class="mt-1 text-xs text-text-muted">{{ e.teamName || 'Tanpa tim' }} · Shift {{ SHIFT_LABEL[e.shift].toLowerCase() }}<span v-if="e.lead"> · {{ LEAD_LABEL[e.lead] }}</span></p></div>
        <span class="badge shrink-0" :class="e.isActive ? 'bg-success/8 text-success border-success/20' : 'bg-text-muted/10 text-text-dim border border-border'">{{ e.isActive ? 'Aktif' : 'Nonaktif' }}</span>
      </div>
      <form v-if="editingId === e.id" class="mt-3 space-y-2 border-t border-border pt-3" @submit.prevent="saveEdit(e.id)">
        <input v-model="draft.name" type="text" required placeholder="Nama" class="min-h-11 w-full rounded-xl border border-border bg-panel px-3 text-sm" />
        <select v-model="draft.teamId" class="min-h-11 w-full rounded-xl border border-border bg-panel px-3 text-sm"><option :value="null">Tanpa tim</option><option v-for="t in teams" :key="t.id" :value="t.id">{{ t.name }}</option><option :value="NEW_TEAM">+ Tim baru…</option></select>
        <input v-if="draft.teamId === NEW_TEAM" v-model="draft.newTeamName" type="text" required placeholder="Nama tim baru" class="min-h-11 w-full rounded-xl border border-border bg-panel px-3 text-sm" />
        <label class="flex min-h-11 items-center gap-2 text-sm font-semibold text-text"><input v-model="draft.admin" type="checkbox" class="h-4 w-4 accent-accent" /> Admin</label>
        <select v-model="draft.shift" aria-label="Shift" class="min-h-11 w-full rounded-xl border border-border bg-panel px-3 text-sm"><option v-for="(label, key) in SHIFT_LABEL" :key="key" :value="key">Shift {{ label.toLowerCase() }}</option></select>
        <select v-model="draft.lead" aria-label="Posisi" class="min-h-11 w-full rounded-xl border border-border bg-panel px-3 text-sm"><option :value="null">Tanpa posisi</option><option v-for="(label, key) in LEAD_LABEL" :key="key" :value="key">{{ label }}</option></select>
        <div class="flex gap-2">
          <button type="button" class="min-h-11 flex-1 rounded-xl border border-border px-3 text-sm font-bold" @click="editingId = null">Batal</button>
          <button type="submit" :disabled="savingEditId === e.id" class="min-h-11 flex-1 rounded-xl bg-accent px-3 text-sm font-bold text-white disabled:opacity-60">{{ savingEditId === e.id ? '…' : 'Simpan' }}</button>
        </div>
      </form>
      <div v-else-if="isAdmin" class="mt-3 flex items-center justify-end gap-3 border-t border-border pt-3">
        <div class="flex gap-2">
          <button class="min-h-11 rounded-xl border border-border px-3 text-xs font-bold text-text" :disabled="savingId === e.id" @click="toggleActive(e)">{{ savingId === e.id ? '…' : e.isActive ? 'Nonaktifkan' : 'Aktifkan' }}</button>
          <button class="min-h-11 rounded-xl border border-border px-3 text-xs font-bold text-text" @click="startEdit(e)">Ubah</button>
          <button class="min-h-11 rounded-xl border border-danger/30 px-3 text-xs font-bold text-danger disabled:opacity-60" :disabled="deletingId === e.id" @click="removeEmployee(e)">{{ deletingId === e.id ? '…' : 'Hapus' }}</button>
        </div>
      </div>
    </article>
  </div>

  <div class="table-scroll mb-7 hidden rounded-xl border border-border shadow-soft md:block">
    <table class="w-full border-collapse text-[13px]">
      <thead>
        <tr class="text-text-dim">
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Nama</th>
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Telepon</th>
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Shift</th>
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Posisi</th>
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border w-[16%]">Status</th>
          <th v-if="isAdmin" class="text-right px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Aksi</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in employees" :key="e.id" class="hover:bg-panel-hover transition-colors duration-200 ease-in">
          <td class="px-5 py-4 border-b border-border align-middle text-text">
            <input v-if="editingId === e.id" v-model="draft.name" type="text" required class="px-3 py-2 rounded-xl border border-border text-[13px] bg-panel transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none w-full min-w-[140px]" />
            <label v-if="editingId === e.id" class="mt-2 flex items-center gap-2 text-[13px] font-semibold text-text"><input v-model="draft.admin" type="checkbox" class="h-4 w-4 accent-accent" /> Admin</label>
            <span v-else class="inline-flex flex-wrap items-center gap-2">{{ e.name }} <span v-if="isAdminRole(e.roleName)" class="badge" :class="roleBadgeUtils(e.roleName)">{{ e.roleName }}</span></span>
          </td>
          <td class="px-5 py-4 border-b border-border align-middle text-text font-mono text-[13px] text-text-dim">{{ e.phone }}</td>
          <td class="px-5 py-4 border-b border-border align-middle text-text">
            <select v-if="editingId === e.id" v-model="draft.shift" aria-label="Shift" class="px-3 py-2 rounded-xl border border-border text-[13px] bg-panel transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none pr-7 cursor-pointer w-full min-w-[100px]">
              <option v-for="(label, key) in SHIFT_LABEL" :key="key" :value="key">{{ label }}</option>
            </select>
            <template v-else>{{ SHIFT_LABEL[e.shift] }}</template>
          </td>
          <td class="px-5 py-4 border-b border-border align-middle text-text">
            <select v-if="editingId === e.id" v-model="draft.lead" aria-label="Posisi" class="px-3 py-2 rounded-xl border border-border text-[13px] bg-panel transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none pr-7 cursor-pointer w-full min-w-[130px]">
              <option :value="null">—</option>
              <option v-for="(label, key) in LEAD_LABEL" :key="key" :value="key">{{ label }}</option>
            </select>
            <template v-else>{{ e.lead ? LEAD_LABEL[e.lead] : "—" }}</template>
          </td>
          <td class="px-5 py-4 border-b border-border align-middle">
            <span class="badge" :class="e.isActive ? 'bg-success/8 text-success border-success/20' : 'bg-text-muted/10 text-text-dim border border-border'">{{ e.isActive ? "Aktif" : "Nonaktif" }}</span>
          </td>
          <td v-if="isAdmin" class="px-5 py-4 border-b border-border align-middle text-text">
            <div v-if="editingId === e.id" class="flex items-center justify-end gap-1.5">
              <button type="button" class="h-9 w-9 grid place-items-center rounded-xl border transition-colors duration-200 ease-in disabled:opacity-60 disabled:cursor-not-allowed border-border text-text-muted hover:bg-panel-hover" aria-label="Batal" title="Batal" @click="editingId = null">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
              <button type="button" :disabled="savingEditId === e.id" class="h-9 w-9 grid place-items-center rounded-xl border transition-colors duration-200 ease-in disabled:opacity-60 disabled:cursor-not-allowed border-accent bg-accent text-white hover:bg-accent-hover" aria-label="Simpan" title="Simpan" @click="saveEdit(e.id)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
              </button>
            </div>
            <div v-else class="flex items-center justify-end gap-1.5">
              <button
                type="button"
                class="h-9 w-9 grid place-items-center rounded-xl border transition-colors duration-200 ease-in disabled:opacity-60 disabled:cursor-not-allowed border-border hover:bg-panel-hover"
                :class="e.isActive ? 'text-text-muted' : 'text-success'"
                :disabled="savingId === e.id"
                :aria-label="e.isActive ? `Nonaktifkan ${e.name}` : `Aktifkan ${e.name}`"
                :title="e.isActive ? 'Nonaktifkan' : 'Aktifkan'"
                @click="toggleActive(e)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v10" /><path d="M18.4 6.6a9 9 0 1 1-12.77.04" /></svg>
              </button>
              <button type="button" class="h-9 w-9 grid place-items-center rounded-xl border transition-colors duration-200 ease-in disabled:opacity-60 disabled:cursor-not-allowed border-border text-text hover:bg-panel-hover" :aria-label="`Ubah ${e.name}`" title="Ubah" @click="startEdit(e)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
              </button>
              <button
                type="button"
                class="h-9 w-9 grid place-items-center rounded-xl border transition-colors duration-200 ease-in disabled:opacity-60 disabled:cursor-not-allowed border-danger/30 text-danger hover:bg-danger/5"
                :disabled="deletingId === e.id"
                :aria-label="`Hapus ${e.name}`"
                title="Hapus"
                @click="removeEmployee(e)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /></svg>
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div v-if="isAdmin && showAddForm" class="mb-7 rounded-2xl border border-border bg-panel p-4 shadow-soft-lg sm:p-6 reveal">
    <div class="mb-4 flex items-center justify-between gap-3">
      <div>
        <div class="text-lg font-extrabold text-text">Tambah anggota</div>
        <div class="mt-1 text-sm text-text-muted">Langkah {{ addStep }} dari 2</div>
      </div>
      <button type="button" class="min-h-10 rounded-xl px-3 text-sm font-semibold text-text-muted hover:bg-panel-hover" @click="showAddForm = false">Batal</button>
    </div>
    <div class="mb-5 h-1.5 overflow-hidden rounded-full bg-panel-hover"><div class="h-full rounded-full bg-accent transition-all" :style="{ width: addStep === 1 ? '50%' : '100%' }"></div></div>
    <form class="space-y-4" @submit.prevent="createEmployee">
      <template v-if="addStep === 1">
        <div>
          <label class="mb-1.5 block text-sm font-semibold text-text">Nama lengkap</label>
          <input v-model="empName" type="text" placeholder="Budi Santoso" required class="min-h-12 w-full rounded-xl border bg-panel px-4 text-base placeholder-text-dim focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20" :class="{ 'border-danger': createError, 'border-border': !createError }" @input="createError = ''" />
        </div>
        <div>
          <label class="mb-1.5 block text-sm font-semibold text-text">Nomor WhatsApp</label>
          <input v-model="empPhone" type="tel" placeholder="+62 812-3456-7890" required class="min-h-12 w-full rounded-xl border bg-panel px-4 text-base placeholder-text-dim focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20" :class="{ 'border-danger': createError, 'border-border': !createError }" @input="createError = ''" />
        </div>
        <div>
          <label for="emp-github" class="mb-1.5 block text-sm font-semibold text-text">Username GitHub <span class="font-normal text-text-dim">(opsional)</span></label>
          <input id="emp-github" v-model="empGithub" type="text" placeholder="budi-santoso" maxlength="40" autocomplete="off" autocapitalize="off" spellcheck="false" class="min-h-12 w-full rounded-xl border border-border bg-panel px-4 text-base placeholder-text-dim focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20" @input="createError = ''" />
          <p class="mt-1 text-xs text-text-dim">Agar commit &amp; PR-nya ikut masuk standup. Kosongkan untuk yang tidak pakai GitHub, misalnya tim design.</p>
        </div>
      </template>
      <template v-else>
        <div>
          <label for="emp-shift" class="mb-1.5 block text-sm font-semibold text-text">Shift</label>
          <select id="emp-shift" v-model="empShift" class="min-h-12 w-full rounded-xl border border-border bg-panel px-4 text-base focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20">
            <option v-for="(label, key) in SHIFT_LABEL" :key="key" :value="key">{{ label }}</option>
          </select>
          <p class="mt-1.5 text-xs text-text-muted">{{ SHIFT_HINT[empShift] }}</p>
        </div>
        <div>
          <label for="emp-lead" class="mb-1.5 block text-sm font-semibold text-text">Posisi</label>
          <select id="emp-lead" v-model="empLead" class="min-h-12 w-full rounded-xl border border-border bg-panel px-4 text-base focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20">
            <option :value="null">Tanpa posisi</option>
            <option v-for="(label, key) in LEAD_LABEL" :key="key" :value="key">{{ label }}</option>
          </select>
          <p class="mt-1.5 text-xs text-text-muted">Lead Design dan Lead Development mendapat bonus dari total semua project dengan tipe tersebut.</p>
        </div>
        <div class="rounded-xl bg-panel-hover p-4 text-sm text-text-muted">{{ empName }} · {{ empPhone }}<span v-if="empGithub.trim()"> · GitHub @{{ empGithub.trim().replace(/^@/, '') }}</span> · Shift {{ SHIFT_LABEL[empShift].toLowerCase() }}<span v-if="empLead"> · {{ LEAD_LABEL[empLead] }}</span></div>
      </template>
      <p v-if="createError" class="text-sm font-semibold text-danger" role="alert">{{ createError }}</p>
      <div class="flex gap-2 pt-1">
        <button v-if="addStep === 2" type="button" class="min-h-12 flex-1 rounded-xl border border-border px-4 text-sm font-bold text-text" @click="addStep = 1">Kembali</button>
        <button v-if="addStep === 1" type="button" class="min-h-12 flex-1 rounded-xl bg-accent px-4 text-sm font-bold text-white disabled:opacity-50" :disabled="!empName.trim() || !empPhone.trim()" @click="addStep = 2">Lanjutkan</button>
        <button v-else type="submit" :disabled="creating" class="min-h-12 flex-1 rounded-xl bg-accent px-4 text-sm font-bold text-white disabled:opacity-60">{{ creating ? 'Menyimpan…' : 'Simpan anggota' }}</button>
      </div>
    </form>
  </div>

  <div v-if="isAdmin" class="rounded-2xl border border-border bg-panel p-4 shadow-soft-lg sm:p-6 reveal">
    <div class="mb-4 text-lg font-extrabold text-text">Ubah nomor telepon</div>
    <form class="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4 items-end" @submit.prevent="updatePhone">
      <div>
        <label class="mb-1.5 block text-sm font-semibold text-text">Anggota</label>
        <select
          v-model="phoneEmployeeId"
          class="w-full px-4 py-3.5 pr-7 rounded-xl border border-border text-sm cursor-pointer bg-panel transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none"
          required
        >
          <option :value="null">Pilih anggota</option>
          <option v-for="e in employees" :key="e.id" :value="e.id">{{ e.name }} — {{ e.phone }}</option>
        </select>
      </div>
      <div>
        <label class="mb-1.5 block text-sm font-semibold text-text">Nomor WhatsApp baru</label>
        <input
          v-model="phoneNumber"
          type="tel"
          placeholder="+62 812…"
          required
          class="w-full px-4 py-3.5 rounded-xl border text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none bg-panel border-border"
          :class="{ 'border-danger': phoneError, 'border-border': !phoneError }"
          @input="phoneError = ''"
        />
      </div>
      <p v-if="phoneError" class="col-span-full text-danger text-[11px] font-extrabold mt-1.5 slide-in">{{ phoneError }}</p>
      <div class="flex gap-2 items-end">
        <button
          type="submit"
          :disabled="!phoneEmployeeId || !phoneNumber || updatingPhone"
          class="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[13px] font-extrabold tracking-tight bg-accent text-white shadow-accent transition-all duration-200 ease-in hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
        >
Simpan nomor
        </button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import { isAdmin } from "../session";
import {
  employeesApi,
  rolesApi,
  teamsApi,
  ApiError,
  showToast,
  type Employee,
  type EmployeeLead,
  type EmployeeShift,
  type Role,
  type Team,
} from "../api";

const employees = ref<Employee[]>([]);
const roles = ref<Role[]>([]);
const teams = ref<Team[]>([]);
const loading = ref(false);
const error = ref("");

const searchQuery = ref("");
const activeFilter = ref<string | boolean | null>(null);

const showAddForm = ref(false);
const addStep = ref(1);
const empName = ref("");
const empPhone = ref("");
const empGithub = ref("");
const empShift = ref<EmployeeShift>("day");
const empLead = ref<EmployeeLead | null>(null);
const LEAD_LABEL: Record<EmployeeLead, string> = { design: "Lead Design", development: "Lead Development", developer: "Developer", designer: "Designer", pm_sales: "PM & Sales" };

const SHIFT_LABEL: Record<EmployeeShift, string> = { day: "Siang", night: "Malam" };
const SHIFT_HINT: Record<EmployeeShift, string> = {
  day: "Standup pagi sesuai jadwal (default 09:00), checkout 16:00.",
  night: "Standup 19:00, checkout 07:00 keesokan paginya.",
};
const creating = ref(false);
const createError = ref("");

const phoneEmployeeId = ref<string | null>(null);
const phoneNumber = ref("");
const updatingPhone = ref(false);
const phoneError = ref("");

const savingId = ref<string | null>(null);
const deletingId = ref<string | null>(null);

// Sentinel select value: create a team from draft.newTeamName on save.
const NEW_TEAM = "__new__";
const editingId = ref<string | null>(null);
const draft = ref({ name: "", teamId: null as string | null, roleId: null as string | null, admin: false, shift: "day" as EmployeeShift, lead: null as EmployeeLead | null, newTeamName: "" });
const savingEditId = ref<string | null>(null);

// Only the latest request may write the list, so a slow response for an
// older search or filter can't overwrite a newer one.
let loadSeq = 0;
async function loadEmployees() {
  const seq = ++loadSeq;
  loading.value = true;
  error.value = "";
  try {
    const filters: { search?: string; active?: boolean | null } = {};
    if (searchQuery.value) filters.search = searchQuery.value;
    if (activeFilter.value !== null) filters.active = activeFilter.value;
    const list = await employeesApi.list(filters);
    if (seq === loadSeq) employees.value = list;
  } catch (err) {
    if (seq === loadSeq) error.value = err instanceof ApiError ? err.message : "Gagal memuat anggota.";
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

let searchTimer: ReturnType<typeof setTimeout> | undefined;
function searchEmployees() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadEmployees, 250);
}
onBeforeUnmount(() => clearTimeout(searchTimer));

// New members start as Employee, the role the server would give them anyway.
function defaultRoleId() {
  return roles.value.find((r) => r.name === "Employee")?.id ?? null;
}

async function loadRoles() {
  try {
    // PM is a dashboard-only role, never a WhatsApp member's.
    roles.value = (await rolesApi.list()).filter((r) => r.name !== "PM");
  } catch {
    roles.value = [];
  }
}

async function loadTeams() {
  try {
    teams.value = await teamsApi.list();
  } catch {
    teams.value = [];
  }
}

onMounted(async () => {
  await loadEmployees();
  await Promise.all([loadRoles(), loadTeams()]);
});

async function toggleActive(e: Employee) {
  const confirmed = window.confirm(
    `Yakin ingin ${e.isActive ? "menonaktifkan" : "mengaktifkan"} "${e.name}"?`
  );
  if (!confirmed) return;

  savingId.value = e.id;
  try {
    await employeesApi.setActive(e.id, !e.isActive);
    showToast(`${e.name} ${e.isActive ? "dinonaktifkan" : "diaktifkan"}.`, "success");
    await loadEmployees();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Gagal memperbarui anggota.";
  } finally {
    savingId.value = null;
  }
}

// Every new member starts from a blank form.
function resetAddForm() {
  empName.value = "";
  empPhone.value = "";
  empGithub.value = "";
  empShift.value = "day";
  empLead.value = null;
  createError.value = "";
  addStep.value = 1;
}

function openAddForm() {
  resetAddForm();
  showAddForm.value = true;
}

async function createEmployee() {
  createError.value = "";
  if (!empName.value.trim() || !empPhone.value.trim()) {
    createError.value = "Nama dan nomor telepon wajib diisi.";
    return;
  }
  error.value = "";
  creating.value = true;
  try {
    await employeesApi.create({
      name: empName.value.trim(),
      phone: empPhone.value.trim(),
      // Always Employee; admin is granted later from the edit form.
      roleId: defaultRoleId(),
      githubLogin: empGithub.value.trim() || null,
      shift: empShift.value,
      lead: empLead.value,
    });
    showToast("Anggota berhasil ditambahkan.", "success");
    resetAddForm();
    showAddForm.value = false;
    await loadEmployees();
  } catch (err) {
    // Shown inside the form; a GitHub problem sends them back to that field.
    createError.value = err instanceof ApiError ? err.message : "Gagal menambahkan anggota.";
    if (/github/i.test(createError.value)) addStep.value = 1;
  } finally {
    creating.value = false;
  }
}

async function updatePhone() {
  phoneError.value = "";
  if (!phoneEmployeeId.value || !phoneNumber.value.trim()) {
    phoneError.value = "Pilih anggota dan masukkan nomor telepon.";
    return;
  }
  error.value = "";
  updatingPhone.value = true;
  try {
    await employeesApi.updatePhone(phoneEmployeeId.value, phoneNumber.value.trim());
    showToast("Nomor telepon berhasil diperbarui.", "success");
    phoneEmployeeId.value = null;
    phoneNumber.value = "";
    await loadEmployees();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Gagal memperbarui nomor telepon.";
  } finally {
    updatingPhone.value = false;
  }
}

async function removeEmployee(e: Employee) {
  const confirmed = window.confirm(
    `Hapus "${e.name}" secara permanen? Hanya anggota tanpa riwayat yang bisa dihapus.`
  );
  if (!confirmed) return;

  error.value = "";
  deletingId.value = e.id;
  try {
    await employeesApi.remove(e.id);
    showToast(`${e.name} dihapus.`, "success");
    await loadEmployees();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Gagal menghapus anggota.";
  } finally {
    deletingId.value = null;
  }
}

function startEdit(employee: Employee) {
  draft.value = {
    name: employee.name,
    teamId: employee.teamId,
    roleId: employee.roleId,
    admin: isAdminRole(employee.roleName),
    shift: employee.shift,
    lead: employee.lead,
    newTeamName: "",
  };
  editingId.value = employee.id;
}

async function saveEdit(id: string) {
  const name = draft.value.name.trim();
  if (!name) {
    error.value = "Nama wajib diisi.";
    return;
  }
  error.value = "";
  savingEditId.value = id;
  try {
    let teamId = draft.value.teamId;
    if (teamId === NEW_TEAM) {
      const teamName = draft.value.newTeamName.trim();
      if (!teamName) {
        error.value = "Nama tim baru wajib diisi.";
        return;
      }
      teamId = (await teamsApi.create(teamName)).id;
      // Point the draft at the new team so a retry after a failed update
      // below reuses it instead of creating a duplicate.
      draft.value.teamId = teamId;
      draft.value.newTeamName = "";
      await loadTeams();
    }
    await employeesApi.update(id, { name, teamId, roleId: draftRoleId(), shift: draft.value.shift, lead: draft.value.lead });
    showToast("Anggota berhasil diperbarui.", "success");
    editingId.value = null;
    await loadEmployees();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Gagal memperbarui anggota.";
  } finally {
    savingEditId.value = null;
  }
}

const isAdminRole = (name: string | null) => name === "Owner" || name === "Admin";

// The admin switch only changes the role when flipped, so an Owner or
// Manager left as is keeps their role. Off means Employee.
function draftRoleId() {
  const { roleId, admin } = draft.value;
  const current = roles.value.find((r) => r.id === roleId)?.name ?? null;
  if (admin === isAdminRole(current)) return roleId;
  return admin ? (roles.value.find((r) => r.name === "Admin")?.id ?? roleId) : defaultRoleId();
}

function roleBadgeUtils(name: string | null) {
  if (!name) return "bg-text-muted/10 text-text-dim border border-border";
  const n = name.toLowerCase();
  if (n.includes("owner")) return "bg-accent/8 text-accent border-accent/20";
  if (n.includes("admin")) return "bg-danger/8 text-danger border-danger/20";
  return "bg-success/8 text-success border-success/20";
}
</script>
