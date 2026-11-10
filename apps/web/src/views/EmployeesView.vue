<template>
  <div class="flex items-baseline justify-between mt-6 mb-3.5 gap-4 flex-wrap">
    <div>
      <h2 class="text-[24px] font-display font-extrabold tracking-tight">Employees</h2>
      <p class="text-text-muted text-sm mt-1.5">Directory of team members and their WhatsApp contacts.</p>
    </div>
    <button
      class="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-sm text-[12px] font-extrabold tracking-tight bg-accent text-white shadow-[0_0_0_4px_rgba(91,107,245,0.45)] transition-all duration-200 ease-in hover:bg-accent-hover hover:shadow-[0_0_0_10px_rgba(91,107,245,0.45)] active:shadow-[0_0_0_4px_rgba(91,107,245,0.45)] whitespace-nowrap leading-none disabled:opacity-50 disabled:cursor-not-allowed"
      @click="showAddForm = true"
      :disabled="loading"
    >
      Add employee
    </button>
  </div>

  <div v-if="error" class="flex items-center gap-3 px-4 py-3 rounded-sm text-sm mb-4 bg-red-300/10 text-red-300 border border-red-300/35 slide-in">{{ error }}</div>

  <div class="flex items-center gap-3 mb-4 flex-wrap">
    <div class="mb-[18px]">
      <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-muted mb-2">Search name or phone</label>
      <input
        v-model="searchQuery"
        type="search"
        placeholder="Search…"
        @input="loadEmployees"
        class="w-full px-3.5 py-[11px] rounded-sm border text-sm placeholder-text-dim transition-all duration-200 ease-in focus:ring-4 focus:-translate-y-1 bg-[#0b1020] border-border focus:ring-accent/50 focus:border-border-focus"
      />
    </div>
    <select
      v-model="activeFilter"
      class="w-full px-3.5 py-[11px] pr-7 rounded-sm border border-border text-sm cursor-pointer bg-[#0b1020] transition-all duration-200 ease-in focus:ring-4 focus:-translate-y-1 focus:ring-accent/50 focus:border-border-focus"
      @change="loadEmployees"
    >
      <option :value="null">All employees</option>
      <option :value="true">Active only</option>
      <option :value="false">Inactive only</option>
    </select>
  </div>

  <div v-if="loading && !employees.length" class="flex flex-col items-center gap-2.5 py-[52px] px-5 text-text-muted fade-in-fast">
    <span class="w-[36px] h-[36px] border-[3px] border-accent/20 border-t-accent rounded-full spin-slow"></span> Loading employees…
  </div>

  <div v-if="!loading && !error && !employees.length" class="flex flex-col items-center justify-center py-[64px] px-5 text-text-muted fade-in">
    <p class="text-[17px] font-extrabold text-text mt-3.5 mb-1.5">No employees found</p>
    <p>Add your first team member to get started.</p>
  </div>

  <div class="overflow-x-auto border border-border rounded-sm">
    <table class="w-full border-collapse text-[13px]">
      <thead>
        <tr>
          <th class="text-left px-4 py-3 text-[11px] font-extrabold tracking-wider uppercase text-text-muted border-b border-border">Name</th>
          <th class="text-left px-4 py-3 text-[11px] font-extrabold tracking-wider uppercase text-text-muted border-b border-border">Phone</th>
          <th class="text-left px-4 py-3 text-[11px] font-extrabold tracking-wider uppercase text-text-muted border-b border-border">Team</th>
          <th class="text-left px-4 py-3 text-[11px] font-extrabold tracking-wider uppercase text-text-muted border-b border-border w-[16%]">Role</th>
          <th class="text-left px-4 py-3 text-[11px] font-extrabold tracking-wider uppercase text-text-muted border-b border-border w-[14%]">Status</th>
          <th class="text-left px-4 py-3 text-[11px] font-extrabold tracking-wider uppercase text-text-muted border-b border-border w-[22%]">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in employees" :key="e.id">
          <td class="px-4 py-3.5 border-b border-border align-middle text-text hover:bg-panel-hover">{{ e.name }}</td>
          <td class="px-4 py-3.5 border-b border-border align-middle text-text hover:bg-panel-hover font-mono text-[13px] text-text-dim">{{ e.phone }}</td>
          <td class="px-4 py-3.5 border-b border-border align-middle text-text hover:bg-panel-hover">{{ e.teamName || "—" }}</td>
          <td class="px-4 py-3.5 border-b border-border align-middle text-text hover:bg-panel-hover">
            <span class="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-extrabold tracking-tight uppercase border transition-all duration-200 ease-in hover:-translate-y-1" :class="roleBadgeUtils(e.roleName)">
              {{ e.roleName || "—" }}
            </span>
          </td>
          <td class="px-4 py-3.5 border-b border-border align-middle text-text hover:bg-panel-hover">
            <span class="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-extrabold tracking-tight uppercase border transition-all duration-200 ease-in hover:-translate-y-1" :class="e.isActive ? 'bg-success/10 text-success border border-success/30' : 'bg-text-muted/10 text-text-muted border border-border'">
              {{ e.isActive ? "Active" : "Inactive" }}
            </span>
          </td>
          <td class="px-4 py-3.5 border-b border-border align-middle text-text hover:bg-panel-hover flex gap-2.5 items-end mt-2">
            <div v-if="editingRoleId === e.id" class="flex flex-wrap gap-2 items-center">
              <select
                v-model="roleDrafts[e.id]"
                class="w-[170px] px-3 py-2 pr-7 rounded-sm border border-border bg-[#0b1020] text-text text-[13px] cursor-pointer transition-all duration-200 ease-in focus:border-border-focus focus:ring-4 focus:ring-accent/50 focus:-translate-y-1"
                @change="saveRole(e.id)"
              >
                <option :value="null">No role</option>
                <option v-for="r in roles" :key="r.id" :value="r.id">{{ r.name }}</option>
              </select>
              <button
                class="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-sm text-[12px] font-extrabold tracking-tight border border-border bg-panel-hover text-text transition-all duration-200 ease-in hover:border-text-muted hover:bg-panel hover:text-text whitespace-nowrap leading-none disabled:opacity-50 disabled:cursor-not-allowed"
                @click="editingRoleId = null"
              >
                Cancel
              </button>
              <button
                class="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-sm text-[12px] font-extrabold tracking-tight bg-accent text-white shadow-[0_0_0_4px_rgba(91,107,245,0.45)] transition-all duration-200 ease-in hover:bg-accent-hover hover:shadow-[0_0_0_10px_rgba(91,107,245,0.45)] active:shadow-[0_0_0_4px_rgba(91,107,245,0.45)] whitespace-nowrap leading-none disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="savingRoleId === e.id"
                @click="saveRole(e.id)"
              >
                {{ savingRoleId === e.id ? "…" : "Save" }}
              </button>
            </div>
            <div v-else>
              <button
                class="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-sm text-[12px] font-extrabold tracking-tight border border-border bg-panel-hover text-text transition-all duration-200 ease-in hover:border-text-muted hover:bg-panel hover:text-text whitespace-nowrap leading-none disabled:opacity-50 disabled:cursor-not-allowed"
                @click="toggleActive(e)"
                :disabled="savingId === e.id"
              >
                {{ savingId === e.id ? "…" : e.isActive ? "Deactivate" : "Activate" }}
              </button>
              <button
                class="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-sm text-[12px] font-extrabold tracking-tight border border-border bg-panel-hover text-text transition-all duration-200 ease-in hover:border-text-muted hover:bg-panel hover:text-text whitespace-nowrap leading-none disabled:opacity-50 disabled:cursor-not-allowed"
                @click="editingRoleId = e.id"
              >
                Change role
              </button>
            </div>
          </td>
        </tr>
        <tr v-if="!employees.length && !loading && !error">
          <td colspan="7" class="px-4 py-3.5 border-b border-border align-middle text-text text-center text-text-muted">
            No employees yet. Add one to get started.
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div v-if="showAddForm" class="bg-panel border border-border rounded p-6 shadow transition-all duration-200 ease-in hover:border-border-focus hover:-translate-y-[2px] hover:shadow-lg">
    <div class="text-[13px] font-extrabold tracking-wider uppercase text-text-muted mb-[18px]">Add employee</div>
    <form @submit.prevent="createEmployee" class="flex flex-col gap-4 grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] items-end">
      <div class="mb-[18px]">
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-muted mb-2">Full name</label>
        <input
          v-model="empName"
          type="text"
          placeholder="Budi Santoso"
          required
          @input="createError = ''"
          class="w-full px-3.5 py-[11px] rounded-sm border text-sm placeholder-text-dim transition-all duration-200 ease-in focus:ring-4 focus:-translate-y-1 bg-[#0b1020] border-border focus:ring-accent/50 focus:border-border-focus"
          :class="{ 'border-danger focus:ring-danger/40': createError, 'border-border focus:ring-accent/50': !createError }"
        />
      </div>
      <div class="mb-[18px]">
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-muted mb-2">WhatsApp number</label>
        <input
          v-model="empPhone"
          type="tel"
          placeholder="+62 812-3456-7890"
          required
          @input="createError = ''"
          class="w-full px-3.5 py-[11px] rounded-sm border text-sm placeholder-text-dim transition-all duration-200 ease-in focus:ring-4 focus:-translate-y-1 bg-[#0b1020] border-border focus:ring-accent/50 focus:border-border-focus"
          :class="{ 'border-danger focus:ring-danger/40': createError, 'border-border focus:ring-accent/50': !createError }"
        />
      </div>
      <div class="mb-[18px]">
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-muted mb-2">Role</label>
        <select v-model="empRoleId" @input="createError = ''"
          class="w-full px-3.5 py-[11px] pr-7 rounded-sm border border-border text-sm cursor-pointer bg-[#0b1020] transition-all duration-200 ease-in focus:ring-4 focus:-translate-y-1 focus:ring-accent/50 focus:border-border-focus"
        >
          <option :value="null">Default role</option>
          <option v-for="r in roles" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
      </div>
      <p v-if="createError" class="text-danger text-[11px] font-extrabold mt-2 slide-in">{{ createError }}</p>
      <div class="flex gap-2.5 items-end mt-2">
        <button
          class="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-sm text-[12px] font-extrabold tracking-tight bg-accent text-white shadow-[0_0_0_4px_rgba(91,107,245,0.45)] transition-all duration-200 ease-in hover:bg-accent-hover hover:shadow-[0_0_0_10px_rgba(91,107,245,0.45)] active:shadow-[0_0_0_4px_rgba(91,107,245,0.45)] whitespace-nowrap leading-none disabled:opacity-50 disabled:cursor-not-allowed"
          type="submit"
          :disabled="creating"
        >
          Create employee
        </button>
        <button
          class="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-sm text-[12px] font-extrabold tracking-tight border border-border bg-panel-hover text-text transition-all duration-200 ease-in hover:border-text-muted hover:bg-panel hover:text-text whitespace-nowrap leading-none disabled:opacity-50 disabled:cursor-not-allowed"
          type="button"
          @click="showAddForm = false"
        >
          Cancel
        </button>
      </div>
    </form>
  </div>

  <div class="bg-panel border border-border rounded p-6 shadow transition-all duration-200 ease-in hover:border-border-focus hover:-translate-y-[2px] hover:shadow-lg mt-[14px]">
    <div class="text-[13px] font-extrabold tracking-wider uppercase text-text-muted mb-[18px]">Update phone number</div>
    <form @submit.prevent="updatePhone" class="flex flex-col gap-4 grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] items-end">
      <div class="mb-[18px]">
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-muted mb-2">Employee</label>
        <select v-model="phoneEmployeeId" class="w-full px-3.5 py-[11px] pr-7 rounded-sm border border-border text-sm cursor-pointer bg-[#0b1020] transition-all duration-200 ease-in focus:ring-4 focus:-translate-y-1 focus:ring-accent/50 focus:border-border-focus" required>
          <option :value="null">Select an employee</option>
          <option v-for="e in employees" :key="e.id" :value="e.id">{{ e.name }} — {{ e.phone }}</option>
        </select>
      </div>
      <div class="mb-[18px]">
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-muted mb-2">New WhatsApp number</label>
        <input
          v-model="phoneNumber"
          type="tel"
          placeholder="+62 812…"
          required
          @input="phoneError = ''"
          class="w-full px-3.5 py-[11px] rounded-sm border text-sm placeholder-text-dim transition-all duration-200 ease-in focus:ring-4 focus:-translate-y-1 bg-[#0b1020] border-border focus:ring-accent/50 focus:border-border-focus"
          :class="{ 'border-danger focus:ring-danger/40': phoneError, 'border-border focus:ring-accent/50': !phoneError }"
        />
      </div>
      <p v-if="phoneError" class="text-danger text-[11px] font-extrabold mt-2 slide-in">{{ phoneError }}</p>
      <div class="flex gap-2.5 items-end mt-2">
        <button
          class="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-sm text-[12px] font-extrabold tracking-tight bg-accent text-white shadow-[0_0_0_4px_rgba(91,107,245,0.45)] transition-all duration-200 ease-in hover:bg-accent-hover hover:shadow-[0_0_0_10px_rgba(91,107,245,0.45)] active:shadow-[0_0_0_4px_rgba(91,107,245,0.45)] whitespace-nowrap leading-none disabled:opacity-50 disabled:cursor-not-allowed"
          type="submit"
          :disabled="!phoneEmployeeId || !phoneNumber || updatingPhone"
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
  if (!name) return "bg-text-muted/10 text-text-muted border border-border";
  const n = name.toLowerCase();
  if (n.includes("owner")) return "bg-fuchsia-400/10 text-fuchsia-400 border border-fuchsia-400/30";
  if (n.includes("admin")) return "bg-danger/10 text-danger border border-danger/35";
  return "bg-accent/10 text-accent border border-accent/30";
}
</script>
