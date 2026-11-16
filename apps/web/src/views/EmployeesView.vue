<template>
  <header class="flex items-baseline justify-between gap-3 flex-wrap mb-7">
    <div>
      <h2 class="text-[26px] font-display font-extrabold tracking-tight text-text">Anggota tim</h2>
      <p class="text-text-muted text-sm mt-1">
        Daftar anggota tim dan nomor WhatsApp mereka.
      </p>
    </div>
    <button
      :disabled="loading"
      class="inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-[13px] font-extrabold tracking-tight bg-accent text-white shadow-accent transition-all duration-200 ease-in hover:bg-accent-hover hover:shadow-[0_0_0_12px_rgba(63,68,226,0.45)] active:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
      @click="showAddForm = true; addStep = 1"
    >
      Tambah anggota
    </button>
  </header>

  <div v-if="error" class="mb-5 px-4 py-3.5 rounded-xl border border-danger/30 bg-danger/5 text-danger text-[12px] font-extrabold slide-in">{{ error }}</div>

  <div class="flex items-center gap-3 mb-5 flex-wrap">
    <div class="min-w-[250px]">
      <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Cari nama atau nomor</label>
      <input
        v-model="searchQuery"
        type="search"
        placeholder="Cari anggota…"
        class="w-full px-4 py-3.5 rounded-xl border text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none bg-panel border-border"
        @input="loadEmployees"
      />
    </div>
    <select
      v-model="activeFilter"
      class="px-4 py-3.5 rounded-xl border border-border text-sm cursor-pointer bg-panel transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none"
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
        <div class="min-w-0"><h3 class="font-bold text-text">{{ e.name }}</h3><p class="mt-0.5 break-all font-mono text-xs text-text-dim">{{ e.phone }}</p><p class="mt-1 text-xs text-text-muted">{{ e.teamName || 'Tanpa tim' }}</p></div>
        <span class="badge shrink-0" :class="e.isActive ? 'bg-success/8 text-success border-success/20' : 'bg-text-muted/10 text-text-dim border border-border'">{{ e.isActive ? 'Aktif' : 'Nonaktif' }}</span>
      </div>
      <form v-if="editingId === e.id" class="mt-3 space-y-2 border-t border-border pt-3" @submit.prevent="saveEdit(e.id)">
        <input v-model="draft.name" type="text" required placeholder="Nama" class="min-h-11 w-full rounded-xl border border-border bg-panel px-3 text-sm" />
        <select v-model="draft.teamId" class="min-h-11 w-full rounded-xl border border-border bg-panel px-3 text-sm"><option :value="null">Tanpa tim</option><option v-for="t in teams" :key="t.id" :value="t.id">{{ t.name }}</option><option :value="NEW_TEAM">+ Tim baru…</option></select>
        <input v-if="draft.teamId === NEW_TEAM" v-model="draft.newTeamName" type="text" required placeholder="Nama tim baru" class="min-h-11 w-full rounded-xl border border-border bg-panel px-3 text-sm" />
        <select v-model="draft.roleId" class="min-h-11 w-full rounded-xl border border-border bg-panel px-3 text-sm"><option :value="null">Tanpa peran</option><option v-for="r in roles" :key="r.id" :value="r.id">{{ r.name }}</option></select>
        <div class="flex gap-2">
          <button type="button" class="min-h-11 flex-1 rounded-xl border border-border px-3 text-sm font-bold" @click="editingId = null">Batal</button>
          <button type="submit" :disabled="savingEditId === e.id" class="min-h-11 flex-1 rounded-xl bg-accent px-3 text-sm font-bold text-white disabled:opacity-60">{{ savingEditId === e.id ? '…' : 'Simpan' }}</button>
        </div>
      </form>
      <div v-else class="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
        <span class="badge" :class="roleBadgeUtils(e.roleName)">{{ e.roleName || 'Tanpa peran' }}</span>
        <div class="flex gap-2">
          <button class="min-h-11 rounded-xl border border-border px-3 text-xs font-bold text-text" :disabled="savingId === e.id" @click="toggleActive(e)">{{ savingId === e.id ? '…' : e.isActive ? 'Nonaktifkan' : 'Aktifkan' }}</button>
          <button class="min-h-11 rounded-xl border border-border px-3 text-xs font-bold text-text" @click="startEdit(e)">Ubah</button>
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
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Tim</th>
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border w-[16%]">Peran</th>
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border w-[16%]">Status</th>
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border w-[26%]">Aksi</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in employees" :key="e.id" class="hover:bg-panel-hover transition-colors duration-200 ease-in">
          <td class="px-5 py-4 border-b border-border align-middle text-text">
            <input v-if="editingId === e.id" v-model="draft.name" type="text" required class="px-3 py-2 rounded-xl border border-border text-[13px] bg-panel transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none w-full min-w-[140px]" />
            <template v-else>{{ e.name }}</template>
          </td>
          <td class="px-5 py-4 border-b border-border align-middle text-text font-mono text-[13px] text-text-dim">{{ e.phone }}</td>
          <td class="px-5 py-4 border-b border-border align-middle text-text">
            <div v-if="editingId === e.id" class="flex flex-col gap-2">
              <select v-model="draft.teamId" class="px-3 py-2 rounded-xl border border-border text-[13px] bg-panel transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none pr-7 cursor-pointer w-full min-w-[140px]">
                <option :value="null">Tanpa tim</option>
                <option v-for="t in teams" :key="t.id" :value="t.id">{{ t.name }}</option>
                <option :value="NEW_TEAM">+ Tim baru…</option>
              </select>
              <input v-if="draft.teamId === NEW_TEAM" v-model="draft.newTeamName" type="text" placeholder="Nama tim baru" class="px-3 py-2 rounded-xl border border-border text-[13px] bg-panel transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none w-full" />
            </div>
            <template v-else>{{ e.teamName || "—" }}</template>
          </td>
          <td class="px-5 py-4 border-b border-border align-middle">
            <select v-if="editingId === e.id" v-model="draft.roleId" class="px-3 py-2 rounded-xl border border-border text-[13px] bg-panel transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none pr-7 cursor-pointer w-full min-w-[120px]">
              <option :value="null">Tanpa peran</option>
              <option v-for="r in roles" :key="r.id" :value="r.id">{{ r.name }}</option>
            </select>
            <span v-else class="badge" :class="roleBadgeUtils(e.roleName)">{{ e.roleName || "—" }}</span>
          </td>
          <td class="px-5 py-4 border-b border-border align-middle">
            <span class="badge" :class="e.isActive ? 'bg-success/8 text-success border-success/20' : 'bg-text-muted/10 text-text-dim border border-border'">{{ e.isActive ? "Aktif" : "Nonaktif" }}</span>
          </td>
          <td class="px-5 py-4 border-b border-border align-middle text-text flex gap-2 items-end">
            <div v-if="editingId === e.id" class="flex items-center gap-2">
              <button
                class="px-3 py-2 rounded-xl border border-border text-[12px] font-extrabold text-text transition-colors duration-200 ease-in hover:bg-panel-hover"
                @click="editingId = null"
              >
                Batal
              </button>
              <button
                :disabled="savingEditId === e.id"
                class="px-3.5 py-2 rounded-xl text-[12px] font-extrabold bg-accent text-white hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap transition-colors duration-200 ease-in"
                @click="saveEdit(e.id)"
              >
                {{ savingEditId === e.id ? "…" : "Simpan" }}
              </button>
            </div>
            <div v-else class="flex items-center gap-2">
              <button
                class="px-3 py-2 rounded-xl border border-border text-[12px] font-extrabold text-text transition-colors duration-200 ease-in hover:bg-panel-hover disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
                :disabled="savingId === e.id"
                @click="toggleActive(e)"
              >
                {{ savingId === e.id ? "…" : e.isActive ? "Nonaktifkan" : "Aktifkan" }}
              </button>
              <button
                class="px-3 py-2 rounded-xl border border-border text-[12px] font-extrabold text-text transition-colors duration-200 ease-in hover:bg-panel-hover"
                @click="startEdit(e)"
              >
                Ubah
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div v-if="showAddForm" class="mb-7 rounded-2xl border border-border bg-panel p-4 shadow-soft-lg sm:p-6 reveal">
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
      </template>
      <template v-else>
        <div>
          <label class="mb-1.5 block text-sm font-semibold text-text">Peran</label>
          <select v-model="empRoleId" class="min-h-12 w-full rounded-xl border border-border bg-panel px-4 text-base focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20" @input="createError = ''">
            <option :value="null">Peran bawaan</option>
            <option v-for="r in roles" :key="r.id" :value="r.id">{{ r.name }}</option>
          </select>
        </div>
        <div class="rounded-xl bg-panel-hover p-4 text-sm text-text-muted">{{ empName }} · {{ empPhone }}<span v-if="empRoleId"> · {{ roles.find((role) => role.id === empRoleId)?.name }}</span></div>
      </template>
      <p v-if="createError" class="text-sm font-semibold text-danger" role="alert">{{ createError }}</p>
      <div class="flex gap-2 pt-1">
        <button v-if="addStep === 2" type="button" class="min-h-12 flex-1 rounded-xl border border-border px-4 text-sm font-bold text-text" @click="addStep = 1">Kembali</button>
        <button v-if="addStep === 1" type="button" class="min-h-12 flex-1 rounded-xl bg-accent px-4 text-sm font-bold text-white disabled:opacity-50" :disabled="!empName.trim() || !empPhone.trim()" @click="addStep = 2">Lanjutkan</button>
        <button v-else type="submit" :disabled="creating" class="min-h-12 flex-1 rounded-xl bg-accent px-4 text-sm font-bold text-white disabled:opacity-60">{{ creating ? 'Menyimpan…' : 'Simpan anggota' }}</button>
      </div>
    </form>
  </div>

  <div class="rounded-2xl border border-border bg-panel p-4 shadow-soft-lg sm:p-6 reveal">
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
import { ref, onMounted } from "vue";
import {
  employeesApi,
  rolesApi,
  teamsApi,
  ApiError,
  showToast,
  type Employee,
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
const empRoleId = ref<string | null>(null);
const creating = ref(false);
const createError = ref("");

const phoneEmployeeId = ref<string | null>(null);
const phoneNumber = ref("");
const updatingPhone = ref(false);
const phoneError = ref("");

const savingId = ref<string | null>(null);

// Sentinel select value: create a team from draft.newTeamName on save.
const NEW_TEAM = "__new__";
const editingId = ref<string | null>(null);
const draft = ref({ name: "", teamId: null as string | null, roleId: null as string | null, newTeamName: "" });
const savingEditId = ref<string | null>(null);

async function loadEmployees() {
  loading.value = true;
  error.value = "";
  try {
    const filters: { search?: string; active?: boolean | null } = {};
    if (searchQuery.value) filters.search = searchQuery.value;
    if (activeFilter.value !== null) filters.active = activeFilter.value;
    employees.value = await employeesApi.list(filters);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Gagal memuat anggota.";
  } finally {
    loading.value = false;
  }
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
      roleId: empRoleId.value,
    });
    showToast("Anggota berhasil ditambahkan.", "success");
    empName.value = "";
    empPhone.value = "";
    addStep.value = 1;
    showAddForm.value = false;
    await loadEmployees();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Gagal menambahkan anggota.";
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

function startEdit(employee: Employee) {
  draft.value = {
    name: employee.name,
    teamId: employee.teamId,
    roleId: employee.roleId,
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
      await loadTeams();
    }
    await employeesApi.update(id, { name, teamId, roleId: draft.value.roleId });
    showToast("Anggota berhasil diperbarui.", "success");
    editingId.value = null;
    await loadEmployees();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Gagal memperbarui anggota.";
  } finally {
    savingEditId.value = null;
  }
}

function roleBadgeUtils(name: string | null) {
  if (!name) return "bg-text-muted/10 text-text-dim border border-border";
  const n = name.toLowerCase();
  if (n.includes("owner")) return "bg-accent/8 text-accent border-accent/20";
  if (n.includes("admin")) return "bg-danger/8 text-danger border-danger/20";
  return "bg-success/8 text-success border-success/20";
}
</script>
