<template>
  <header class="flex items-baseline justify-between gap-3 flex-wrap mb-7">
    <div>
      <h2 class="text-[26px] font-display font-extrabold tracking-tight text-text">Employees</h2>
      <p class="text-text-muted text-sm mt-1">
        Directory of team members and their WhatsApp contacts.
      </p>
    </div>
    <button
      @click="showAddForm = true"
      :disabled="loading"
      class="inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-[13px] font-extrabold tracking-tight bg-accent text-white shadow-accent transition-all duration-200 ease-in hover:bg-accent-hover hover:shadow-[0_0_0_12px_rgba(63,68,226,0.45)] active:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
    >
      Add employee
    </button>
  </header>

  <div v-if="error" class="mb-5 px-4 py-3.5 rounded-xl border border-danger/30 bg-danger/5 text-danger text-[12px] font-extrabold slide-in">{{ error }}</div>

  <div class="flex items-center gap-3 mb-5 flex-wrap">
    <div class="min-w-[250px]">
      <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Search name or phone</label>
      <input
        v-model="searchQuery"
        type="search"
        placeholder="Search…"
        @input="loadEmployees"
        class="w-full px-4 py-3.5 rounded-xl border text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none bg-panel border-border"
      />
    </div>
    <select
      v-model="activeFilter"
      @change="loadEmployees"
      class="px-4 py-3.5 rounded-xl border border-border text-sm cursor-pointer bg-panel transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none"
    >
      <option :value="null">All employees</option>
      <option :value="true">Active only</option>
      <option :value="false">Inactive only</option>
    </select>
  </div>

  <div v-if="loading && !employees.length" class="flex flex-col items-center gap-2.5 py-24 text-center text-text-muted fade-in-fast">
    <span class="w-10 h-10 border-2 border-accent/20 border-t-accent rounded-full spin-slow" aria-hidden="true"></span>
    <span class="text-sm font-extrabold tracking-tight">Loading employees…</span>
  </div>

  <div v-if="!loading && !error && !employees.length" class="flex flex-col items-center justify-center py-24 text-center fade-in">
    <div class="w-14 h-14 rounded-full border border-border bg-panel-hover flex items-center justify-center text-text-dim mb-4" aria-hidden="true">—</div>
    <h3 class="text-[18px] font-extrabold tracking-tight text-text mb-1">No employees found</h3>
    <p class="text-text-muted text-sm">Add your first team member to get started.</p>
  </div>

  <div class="border border-border rounded-xl overflow-hidden shadow-soft mb-7">
    <table class="w-full border-collapse text-[13px]">
      <thead>
        <tr class="text-text-dim">
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Name</th>
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Phone</th>
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border">Team</th>
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border w-[16%]">Role</th>
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border w-[16%]">Status</th>
          <th class="text-left px-5 py-4 text-[11px] font-extrabold tracking-wider uppercase border-b border-border w-[26%]">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in employees" :key="e.id" class="hover:bg-panel-hover transition-colors duration-200 ease-in">
          <td class="px-5 py-4 border-b border-border align-middle text-text">{{ e.name }}</td>
          <td class="px-5 py-4 border-b border-border align-middle text-text font-mono text-[13px] text-text-dim">{{ e.phone }}</td>
          <td class="px-5 py-4 border-b border-border align-middle text-text">{{ e.teamName || "—" }}</td>
          <td class="px-5 py-4 border-b border-border align-middle">
            <span class="badge" :class="roleBadgeUtils(e.roleName)">{{ e.roleName || "—" }}</span>
          </td>
          <td class="px-5 py-4 border-b border-border align-middle">
            <span class="badge" :class="e.isActive ? 'bg-success/8 text-success border-success/20' : 'bg-text-muted/10 text-text-dim border border-border'">{{ e.isActive ? "Active" : "Inactive" }}</span>
          </td>
          <td class="px-5 py-4 border-b border-border align-middle text-text flex gap-2 items-end">
            <div v-if="editingRoleId === e.id" class="flex items-center gap-2">
              <select
                v-model="roleDrafts[e.id]"
                class="px-3 py-2 pr-7 rounded-xl border border-border text-[13px] cursor-pointer bg-panel transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none w-[180px]"
                @change="saveRole(e.id)"
              >
                <option :value="null">No role</option>
                <option v-for="r in roles" :key="r.id" :value="r.id">{{ r.name }}</option>
              </select>
              <button
                class="px-3 py-2 rounded-xl border border-border text-[12px] font-extrabold text-text transition-colors duration-200 ease-in hover:bg-panel-hover"
                @click="editingRoleId = null"
              >
                Cancel
              </button>
              <button
                :disabled="savingRoleId === e.id"
                class="px-3.5 py-2 rounded-xl text-[12px] font-extrabold bg-accent text-white hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap transition-colors duration-200 ease-in"
                @click="saveRole(e.id)"
              >
                {{ savingRoleId === e.id ? "…" : "Save" }}
              </button>
            </div>
            <div v-else class="flex items-center gap-2">
              <button
                class="px-3 py-2 rounded-xl border border-border text-[12px] font-extrabold text-text transition-colors duration-200 ease-in hover:bg-panel-hover disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
                @click="toggleActive(e)"
                :disabled="savingId === e.id"
              >
                {{ savingId === e.id ? "…" : e.isActive ? "Deactivate" : "Activate" }}
              </button>
              <button
                class="px-3 py-2 rounded-xl border border-border text-[12px] font-extrabold text-text transition-colors duration-200 ease-in hover:bg-panel-hover"
                @click="editingRoleId = e.id"
              >
                Change role
              </button>
            </div>
          </td>
        </tr>
        <tr v-if="!employees.length && !loading && !error">
          <td colspan="6" class="px-5 py-4 border-b border-border align-middle text-center text-text-muted">
            No employees yet. Add one to get started.
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div v-if="showAddForm" class="border border-border rounded-xl shadow-soft-lg p-6 mb-7 reveal">
    <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-4">Add employee</div>
    <form @submit.prevent="createEmployee" class="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4 items-end">
      <div>
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Full name</label>
        <input
          v-model="empName"
          type="text"
          placeholder="Budi Santoso"
          required
          @input="createError = ''"
          class="w-full px-4 py-3.5 rounded-xl border text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none bg-panel border-border"
          :class="{ 'border-danger': createError, 'border-border': !createError }"
        />
      </div>
      <div>
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">WhatsApp number</label>
        <input
          v-model="empPhone"
          type="tel"
          placeholder="+62 812-3456-7890"
          required
          @input="createError = ''"
          class="w-full px-4 py-3.5 rounded-xl border text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none bg-panel border-border"
          :class="{ 'border-danger': createError, 'border-border': !createError }"
        />
      </div>
      <div>
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Role</label>
        <select
          v-model="empRoleId"
          @input="createError = ''"
          class="w-full px-4 py-3.5 pr-7 rounded-xl border border-border text-sm cursor-pointer bg-panel transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none"
        >
          <option :value="null">Default role</option>
          <option v-for="r in roles" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
      </div>
      <p v-if="createError" class="col-span-full text-danger text-[11px] font-extrabold mt-1.5 slide-in">{{ createError }}</p>
      <div class="flex gap-2 items-end">
        <button
          type="submit"
          :disabled="creating"
          class="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[13px] font-extrabold tracking-tight bg-accent text-white shadow-accent transition-all duration-200 ease-in hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
        >
          Create employee
        </button>
        <button
          type="button"
          class="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[13px] font-extrabold tracking-tight border border-border text-text transition-colors duration-200 ease-in hover:bg-panel-hover"
          @click="showAddForm = false"
        >
          Cancel
        </button>
      </div>
    </form>
  </div>

  <div class="border border-border rounded-xl shadow-soft-lg p-6 reveal">
    <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-4">Update phone number</div>
    <form @submit.prevent="updatePhone" class="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4 items-end">
      <div>
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Employee</label>
        <select
          v-model="phoneEmployeeId"
          class="w-full px-4 py-3.5 pr-7 rounded-xl border border-border text-sm cursor-pointer bg-panel transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none"
          required
        >
          <option :value="null">Select an employee</option>
          <option v-for="e in employees" :key="e.id" :value="e.id">{{ e.name }} — {{ e.phone }}</option>
        </select>
      </div>
      <div>
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">New WhatsApp number</label>
        <input
          v-model="phoneNumber"
          type="tel"
          placeholder="+62 812…"
          required
          @input="phoneError = ''"
          class="w-full px-4 py-3.5 rounded-xl border text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none bg-panel border-border"
          :class="{ 'border-danger': phoneError, 'border-border': !phoneError }"
        />
      </div>
      <p v-if="phoneError" class="col-span-full text-danger text-[11px] font-extrabold mt-1.5 slide-in">{{ phoneError }}</p>
      <div class="flex gap-2 items-end">
        <button
          type="submit"
          :disabled="!phoneEmployeeId || !phoneNumber || updatingPhone"
          class="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[13px] font-extrabold tracking-tight bg-accent text-white shadow-accent transition-all duration-200 ease-in hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
        >
          Update phone
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
  ApiError,
  showToast,
  type Employee,
  type Role,
} from "../api";

const employees = ref<Employee[]>([]);
const roles = ref<Role[]>([]);
const loading = ref(false);
const error = ref("");

const searchQuery = ref("");
const activeFilter = ref<string | boolean | null>(null);

const showAddForm = ref(false);
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

const editingRoleId = ref<string | null>(null);
const roleDrafts = ref<Record<string, string | null>>({});
const savingRoleId = ref<string | null>(null);

async function loadEmployees() {
  loading.value = true;
  error.value = "";
  try {
    const filters: { search?: string; active?: boolean | null } = {};
    if (searchQuery.value) filters.search = searchQuery.value;
    if (activeFilter.value !== null) filters.active = activeFilter.value;
    employees.value = await employeesApi.list(filters);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load employees.";
  } finally {
    loading.value = false;
  }
}

async function loadRoles() {
  try {
    roles.value = await rolesApi.list();
  } catch {
    roles.value = [];
  }
}

onMounted(async () => {
  await loadEmployees();
  await loadRoles();
});

async function toggleActive(e: Employee) {
  const confirmed = window.confirm(
    `Are you sure you want to ${e.isActive ? "deactivate" : "activate"} "${e.name}"?`
  );
  if (!confirmed) return;

  savingId.value = e.id;
  try {
    await employeesApi.deactivate(e.id);
    showToast(`${e.name} ${e.isActive ? "deactivated" : "activated"}.`, "success");
    await loadEmployees();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to update employee.";
  } finally {
    savingId.value = null;
  }
}

async function createEmployee() {
  createError.value = "";
  if (!empName.value.trim() || !empPhone.value.trim()) {
    createError.value = "Name and phone are required.";
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
    showToast("Employee created.", "success");
    empName.value = "";
    empPhone.value = "";
    showAddForm.value = false;
    await loadEmployees();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to create employee.";
  } finally {
    creating.value = false;
  }
}

async function updatePhone() {
  phoneError.value = "";
  if (!phoneEmployeeId.value || !phoneNumber.value.trim()) {
    phoneError.value = "Select an employee and enter a phone number.";
    return;
  }
  error.value = "";
  updatingPhone.value = true;
  try {
    await employeesApi.updatePhone(phoneEmployeeId.value, phoneNumber.value.trim());
    showToast("Phone number updated.", "success");
    phoneEmployeeId.value = null;
    phoneNumber.value = "";
    await loadEmployees();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to update phone number.";
  } finally {
    updatingPhone.value = false;
  }
}

async function saveRole(id: string) {
  const roleId = roleDrafts.value[id] ?? null;
  savingRoleId.value = id;
  try {
    await employeesApi.updateRole(id, roleId);
    showToast("Role updated.", "success");
    editingRoleId.value = null;
    await loadEmployees();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to update role.";
  } finally {
    savingRoleId.value = null;
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
