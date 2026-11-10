<template>
  <div class="page-head">
    <div>
      <h2 class="page-title">Employees</h2>
      <p class="page-desc">Directory of team members and their WhatsApp contacts.</p>
    </div>
    <button class="btn btn--primary" @click="showAddForm = true" :disabled="loading">
      Add employee
    </button>
  </div>

  <div v-if="error" class="alert alert--error">{{ error }}</div>

  <div class="toolbar">
    <div class="field">
      <label class="field-label">Search name or phone</label>
      <input
        v-model="searchQuery"
        type="search"
        placeholder="Search…"
        @input="loadEmployees"
      />
    </div>
    <select v-model="activeFilter" class="input" @change="loadEmployees">
      <option :value="null">All employees</option>
      <option :value="true">Active only</option>
      <option :value="false">Inactive only</option>
    </select>
  </div>

  <div v-if="loading && !employees.length" class="loading">
    <span class="spinner"></span> Loading employees…
  </div>

  <div v-if="!loading && !error && !employees.length" class="empty">
    <p class="empty-title">No employees found</p>
    <p>Add your first team member to get started.</p>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Phone</th>
          <th>Team</th>
          <th style="width: 16%">Role</th>
          <th style="width: 14%">Status</th>
          <th style="width: 22%">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in employees" :key="e.id">
          <td>{{ e.name }}</td>
          <td class="mono">{{ e.phone }}</td>
          <td>{{ e.teamName || "—" }}</td>
          <td>
            <span class="badge" :class="roleBadgeClass(e.roleName)">
              {{ e.roleName || "—" }}
            </span>
          </td>
          <td>
            <span
              class="badge"
              :class="e.isActive ? 'badge--active' : 'badge--inactive'"
            >
              {{ e.isActive ? "Active" : "Inactive" }}
            </span>
          </td>
          <td class="actions">
            <div v-if="editingRoleId === e.id" class="role-change">
              <select
                v-model="roleDrafts[e.id]"
                class="role-select"
                @change="saveRole(e.id)"
              >
                <option :value="null">No role</option>
                <option
                  v-for="r in roles"
                  :key="r.id"
                  :value="r.id"
                >
                  {{ r.name }}
                </option>
              </select>
              <button
                class="btn btn--ghost btn--sm"
                @click="editingRoleId = null"
              >
                Cancel
              </button>
              <button
                class="btn btn--primary btn--sm"
                :disabled="savingRoleId === e.id"
                @click="saveRole(e.id)"
              >
                {{ savingRoleId === e.id ? "…" : "Save" }}
              </button>
            </div>
            <div v-else>
              <button
                class="btn btn--ghost btn--sm"
                @click="toggleActive(e)"
                :disabled="savingId === e.id"
              >
                {{ savingId === e.id ? "…" : e.isActive ? "Deactivate" : "Activate" }}
              </button>
              <button
                class="btn btn--ghost btn--sm"
                @click="editingRoleId = e.id"
              >
                Change role
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div v-if="showAddForm" class="card">
    <div class="card-title">Add employee</div>
    <form @submit.prevent="createEmployee" class="form form--grid">
      <div class="field" :class="{ 'field--error': createError }">
        <label class="field-label">Full name</label>
        <input
          v-model="empName"
          type="text"
          placeholder="Budi Santoso"
          required
          @input="createError = ''"
        />
      </div>
      <div class="field" :class="{ 'field--error': createError }">
        <label class="field-label">WhatsApp number</label>
        <input
          v-model="empPhone"
          type="tel"
          placeholder="+62 812-3456-7890"
          required
          @input="createError = ''"
        />
      </div>
      <div class="field" :class="{ 'field--error': createError }">
        <label class="field-label">Role</label>
        <select v-model="empRoleId" class="input" @input="createError = ''">
          <option :value="null">Default role</option>
          <option v-for="r in roles" :key="r.id" :value="r.id">
            {{ r.name }}
          </option>
        </select>
      </div>
      <p v-if="createError" class="field-error-text">{{ createError }}</p>
      <div class="field field--actions">
        <button class="btn btn--primary" type="submit" :disabled="creating">
          Create employee
        </button>
        <button
          class="btn btn--ghost"
          type="button"
          @click="showAddForm = false"
        >
          Cancel
        </button>
      </div>
    </form>
  </div>

  <div class="card">
    <div class="card-title">Update phone number</div>
    <form @submit.prevent="updatePhone" class="form form--grid">
      <div class="field" :class="{ 'field--error': phoneError }">
        <label class="field-label">Employee</label>
        <select v-model="phoneEmployeeId" class="input" required>
          <option :value="null">Select an employee</option>
          <option v-for="e in employees" :key="e.id" :value="e.id">
            {{ e.name }} — {{ e.phone }}
          </option>
        </select>
      </div>
      <div class="field" :class="{ 'field--error': phoneError }">
        <label class="field-label">New WhatsApp number</label>
        <input
          v-model="phoneNumber"
          type="tel"
          placeholder="+62 812…"
          required
          @input="phoneError = ''"
        />
      </div>
      <p v-if="phoneError" class="field-error-text">{{ phoneError }}</p>
      <div class="field field--actions">
        <button
          class="btn btn--primary"
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

function roleBadgeClass(name: string | null) {
  if (!name) return "badge--inactive";
  const n = name.toLowerCase();
  if (n.includes("owner")) return "badge--owner";
  if (n.includes("admin")) return "badge--admin";
  return "badge--staff";
}


</script>

<style scoped>
.role-change {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.role-select {
  width: 170px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: #0b1020;
  color: var(--text);
  font-size: 13px;
}
.role-select:focus {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 4px var(--ring);
}
</style>
