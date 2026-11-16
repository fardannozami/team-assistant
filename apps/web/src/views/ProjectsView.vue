<template>
  <header class="mb-7 flex flex-wrap items-baseline justify-between gap-3">
    <div>
      <h2 class="font-display text-[26px] font-extrabold tracking-tight text-text">Project</h2>
      <p class="mt-1 text-sm text-text-muted">Catat project, fee yang diterima, dan pembagian fee ke PM, designer, dan developer.</p>
    </div>
    <button type="button" class="min-h-12 rounded-xl bg-accent px-5 text-sm font-bold text-white shadow-accent hover:bg-accent-hover" @click="openEditor(null)">Tambah project</button>
  </header>

  <div v-if="error" class="mb-5 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3.5 text-[12px] font-extrabold text-danger slide-in" role="alert">{{ error }}</div>

  <div class="mb-5 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
    <label class="sr-only" for="project-search">Cari project</label>
    <input id="project-search" v-model="search" type="search" placeholder="Cari nama project, platform, atau anggota" :class="inputClass" />
    <label class="sr-only" for="filter-status">Status project</label>
    <select id="filter-status" v-model="statusFilter" :class="inputClass">
      <option value="">Semua status</option>
      <option v-for="(label, key) in STATUS_LABEL" :key="key" :value="key">{{ label }}</option>
    </select>
    <label class="sr-only" for="filter-payment">Status payment</label>
    <select id="filter-payment" v-model="paymentFilter" :class="inputClass">
      <option value="">Semua payment</option>
      <option v-for="(label, key) in PAYMENT_STATUS_LABEL" :key="key" :value="key">{{ label }}</option>
    </select>
  </div>

  <div v-if="loading && !projects.length" class="flex flex-col items-center gap-2.5 py-24 text-center text-text-muted fade-in-fast">
    <span class="h-10 w-10 rounded-full border-2 border-accent/20 border-t-accent spin-slow" aria-hidden="true"></span>
    <span class="text-sm font-extrabold tracking-tight">Memuat project…</span>
  </div>

  <div v-else-if="!error && !projects.length" class="flex flex-col items-center justify-center py-24 text-center fade-in">
    <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-border bg-panel-hover text-text-dim" aria-hidden="true">—</div>
    <h3 class="mb-1 text-[18px] font-extrabold tracking-tight text-text">Belum ada project</h3>
    <p class="text-sm text-text-muted">Tambahkan project pertama beserta pembagian fee-nya.</p>
  </div>

  <template v-else-if="projects.length">
    <!-- Totals of what is filtered, cancelled projects left out -->
    <section class="mb-6 grid gap-3 sm:grid-cols-3" aria-label="Ringkasan">
      <div class="rounded-2xl border border-border bg-panel p-4 shadow-soft">
        <div class="font-display text-[26px] font-extrabold tracking-tight text-text">{{ counted.length }}</div>
        <div class="mt-1 text-[11px] font-extrabold uppercase tracking-wider text-text-dim">Project (tanpa batal)</div>
      </div>
      <div class="rounded-2xl border border-border bg-panel p-4 shadow-soft">
        <div class="font-display text-[20px] font-extrabold tracking-tight text-success">{{ formatTotals(totals.received) }}</div>
        <div class="mt-1 text-[11px] font-extrabold uppercase tracking-wider text-text-dim">Fee diterima</div>
      </div>
      <div class="rounded-2xl border border-border bg-panel p-4 shadow-soft">
        <div class="font-display text-[20px] font-extrabold tracking-tight text-warning">{{ formatTotals(totals.unpaid) }}</div>
        <div class="mt-1 text-[11px] font-extrabold uppercase tracking-wider text-text-dim">Belum dibayar ke tim</div>
      </div>
    </section>

    <section v-if="perPerson.length" class="mb-6 rounded-2xl border border-border bg-panel p-4 shadow-soft-lg sm:p-6" aria-labelledby="per-person-title">
      <h3 id="per-person-title" class="text-lg font-extrabold text-text">Rekap fee per orang</h3>
      <p class="mt-1 text-sm text-text-muted">Dari project yang tampil di filter, tanpa project batal.</p>
      <div class="table-scroll mt-3">
        <table class="w-full border-collapse text-[13px]">
          <thead>
            <tr class="text-text-dim">
              <th class="border-b border-border px-3 py-2.5 text-left text-[11px] font-extrabold uppercase tracking-wider">Nama</th>
              <th class="border-b border-border px-3 py-2.5 text-right text-[11px] font-extrabold uppercase tracking-wider">Project</th>
              <th class="border-b border-border px-3 py-2.5 text-right text-[11px] font-extrabold uppercase tracking-wider">Total fee</th>
              <th class="border-b border-border px-3 py-2.5 text-right text-[11px] font-extrabold uppercase tracking-wider">Sudah dibayar</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in perPerson" :key="p.employeeId">
              <td class="border-b border-border px-3 py-2.5 text-text">{{ p.name }}</td>
              <td class="border-b border-border px-3 py-2.5 text-right tabular-nums text-text">{{ p.projects }}</td>
              <td class="border-b border-border px-3 py-2.5 text-right font-bold tabular-nums text-text">{{ formatTotals(p.total) }}</td>
              <td class="border-b border-border px-3 py-2.5 text-right tabular-nums text-text-muted">{{ formatTotals(p.paid) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <p v-if="!filtered.length" class="py-10 text-center text-sm text-text-muted">Tidak ada project yang cocok dengan filter.</p>

    <ul class="space-y-3">
      <li v-for="p in filtered" :key="p.id" class="rounded-2xl border border-border bg-panel p-4 shadow-soft sm:p-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="text-xs font-bold uppercase tracking-wider text-text-dim">{{ p.platform }} · {{ PAYMENT_TYPE_LABEL[p.paymentType] }}</div>
            <h3 class="mt-0.5 font-bold text-text">{{ p.name }}</h3>
            <p class="mt-0.5 text-xs text-text-muted">{{ dateRange(p) }}</p>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <span class="badge" :class="STATUS_BADGE[p.status]">{{ STATUS_LABEL[p.status] }}</span>
            <span class="badge" :class="PAYMENT_BADGE[p.paymentStatus]">{{ PAYMENT_STATUS_LABEL[p.paymentStatus] }}</span>
          </div>
        </div>

        <dl class="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm sm:grid-cols-3">
          <div><dt class="text-xs font-bold text-text-dim">Fee diterima</dt><dd class="tabular-nums text-text">{{ money(p.feeReceived, p.currency) }}</dd></div>
          <div><dt class="text-xs font-bold text-text-dim">Potongan platform {{ p.platformFeePercent }}%</dt><dd class="tabular-nums text-text">{{ money(p.platformFee, p.currency) }}</dd></div>
          <div><dt class="text-xs font-bold text-text-dim">Total fee dibagi</dt><dd class="font-bold tabular-nums text-text">{{ money(p.splitBase, p.currency) }}</dd></div>
        </dl>

        <div class="mt-3 grid gap-3 sm:grid-cols-3">
          <div v-for="role in MEMBER_ROLES" :key="role.id">
            <div class="text-xs font-bold text-text-dim">{{ role.label }}</div>
            <ul v-if="membersOf(p, role.id).length" class="mt-1 space-y-0.5 text-[13px]">
              <li v-for="m in membersOf(p, role.id)" :key="m.employeeId" class="flex justify-between gap-2">
                <span class="truncate text-text">{{ m.employeeName }} <span class="text-text-dim">{{ m.sharePercent }}%</span></span>
                <span class="shrink-0 tabular-nums text-text-muted">{{ money(m.fee, p.currency) }}</span>
              </li>
            </ul>
            <p v-else class="mt-1 text-[13px] text-text-dim">—</p>
          </div>
        </div>

        <p v-if="p.notes" class="mt-3 whitespace-pre-wrap text-sm text-text-muted">{{ p.notes }}</p>

        <div class="mt-3 flex justify-end gap-1">
          <button type="button" class="min-h-10 rounded-xl px-3 text-sm font-semibold text-text-muted hover:bg-panel-hover" @click="openEditor(p)">Ubah</button>
          <button type="button" class="min-h-10 rounded-xl px-3 text-sm font-semibold text-text-muted hover:bg-danger/5 hover:text-danger" @click="remove(p)">Hapus</button>
        </div>
      </li>
    </ul>
  </template>

  <!-- Editor -->
  <div v-if="form" class="fixed inset-0 z-50 flex items-end justify-center bg-text/30 backdrop-blur-sm fade-in-fast sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="editor-title" @keydown.esc="closeEditor">
    <form class="max-h-[92vh] w-full max-w-[720px] overflow-y-auto rounded-t-2xl border border-border bg-panel p-4 shadow-soft-lg sm:rounded-2xl sm:p-6" @submit.prevent="save">
      <div class="flex items-center justify-between gap-3">
        <h3 id="editor-title" class="text-lg font-extrabold text-text">{{ editingId ? "Ubah project" : "Tambah project" }}</h3>
        <button type="button" class="grid h-10 w-10 place-items-center rounded-xl text-lg text-text-dim hover:bg-panel-hover" aria-label="Tutup" @click="closeEditor">×</button>
      </div>

      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        <label class="block sm:col-span-2">
          <span :class="labelClass">Nama project</span>
          <input v-model="form.name" required maxlength="300" :class="inputClass" class="w-full" />
        </label>
        <label class="block">
          <span :class="labelClass">Platform</span>
          <input v-model="form.platform" required maxlength="100" list="platforms" placeholder="Upwork" :class="inputClass" class="w-full" />
          <datalist id="platforms"><option v-for="p in platforms" :key="p" :value="p" /></datalist>
        </label>
        <label class="block">
          <span :class="labelClass">Tipe payment</span>
          <select v-model="form.paymentType" :class="inputClass" class="w-full">
            <option v-for="(label, key) in PAYMENT_TYPE_LABEL" :key="key" :value="key">{{ label }}</option>
          </select>
        </label>
        <label class="block">
          <span :class="labelClass">Start date</span>
          <input v-model="form.startDate" type="date" :class="inputClass" class="w-full" />
        </label>
        <label class="block">
          <span :class="labelClass">End date</span>
          <input v-model="form.endDate" type="date" :min="form.startDate || undefined" :class="inputClass" class="w-full" />
        </label>
        <label class="block">
          <span :class="labelClass">Status project</span>
          <select v-model="form.status" :class="inputClass" class="w-full">
            <option v-for="(label, key) in STATUS_LABEL" :key="key" :value="key">{{ label }}</option>
          </select>
        </label>
        <label class="block">
          <span :class="labelClass">Status payment</span>
          <select v-model="form.paymentStatus" :class="inputClass" class="w-full">
            <option v-for="(label, key) in PAYMENT_STATUS_LABEL" :key="key" :value="key">{{ label }}</option>
          </select>
        </label>
      </div>

      <fieldset class="mt-6">
        <legend class="text-sm font-extrabold text-text">Fee</legend>
        <div class="mt-2 grid gap-4 sm:grid-cols-4">
          <label class="block">
            <span :class="labelClass">Mata uang</span>
            <input v-model="form.currency" required maxlength="3" :class="inputClass" class="w-full uppercase" />
          </label>
          <label class="block">
            <span :class="labelClass">Fee diterima</span>
            <input v-model.number="form.feeReceived" type="number" min="0" step="0.01" required :class="inputClass" class="w-full" />
          </label>
          <label class="block">
            <span :class="labelClass">Potongan platform %</span>
            <input v-model.number="form.platformFeePercent" type="number" min="0" max="99" step="0.01" required :class="inputClass" class="w-full" />
          </label>
          <label class="block">
            <span :class="labelClass">Total fee dibagi</span>
            <input v-model.number="totalFeeInput" type="number" min="0" step="0.01" :placeholder="`Otomatis: ${preview.auto}`" :class="inputClass" class="w-full" />
          </label>
        </div>
        <p class="mt-2 text-sm text-text-muted">
          Potongan platform: <strong class="text-text">{{ money(preview.cut, form.currency) }}</strong> · Dibagi ke tim: <strong class="text-text">{{ money(preview.base, form.currency) }}</strong>.
          "Total fee dibagi" otomatis fee diterima dikurangi potongan platform; isi hanya kalau jumlahnya berbeda.
        </p>
        <p v-if="totalFeeTooHigh" class="mt-1 text-sm font-semibold text-danger">Total fee dibagi lebih besar dari fee diterima.</p>
      </fieldset>

      <fieldset v-for="role in MEMBER_ROLES" :key="role.id" class="mt-6">
        <legend class="flex w-full items-baseline justify-between gap-2 text-sm font-extrabold text-text">
          <span>{{ role.label }}</span>
          <span class="text-xs font-semibold" :class="poolOk(role.id) ? 'text-text-muted' : 'text-warning'">{{ poolLabel(role.id) }}</span>
        </legend>
        <ul class="mt-2 space-y-2">
          <li v-for="(m, i) in formMembers(role.id)" :key="i" class="grid grid-cols-[1fr_88px_auto] items-center gap-2 sm:grid-cols-[1fr_96px_120px_auto]">
            <label class="sr-only" :for="`member-${role.id}-${i}`">{{ role.label }} {{ i + 1 }}</label>
            <select :id="`member-${role.id}-${i}`" v-model="m.employeeId" required :class="inputClass" class="min-w-0">
              <option value="" disabled>Pilih anggota</option>
              <option v-for="person in peopleFor(m)" :key="person.id" :value="person.id">{{ person.name }}{{ person.isActive ? "" : " (nonaktif)" }}</option>
            </select>
            <label class="relative">
              <span class="sr-only">Persen</span>
              <input v-model.number="m.sharePercent" type="number" min="0" max="100" step="0.01" required :class="inputClass" class="w-full pr-7" />
              <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-dim">%</span>
            </label>
            <span class="hidden text-right text-sm tabular-nums text-text-muted sm:block">{{ money(previewFees.get(m) ?? 0, form.currency) }}</span>
            <button type="button" class="grid h-11 w-11 place-items-center rounded-xl text-lg text-text-dim hover:bg-danger/5 hover:text-danger" :aria-label="`Hapus ${role.label} ${i + 1}`" @click="removeMember(m)">×</button>
          </li>
        </ul>
        <div class="mt-2 flex flex-wrap gap-2">
          <button type="button" class="min-h-10 rounded-xl border border-border px-3 text-sm font-semibold text-text hover:bg-panel-hover" @click="addMember(role.id)">+ {{ role.label }}</button>
          <button v-if="poolMembers(role.id).length > 1" type="button" class="min-h-10 rounded-xl px-3 text-sm font-semibold text-text-muted hover:bg-panel-hover" @click="splitEvenly(role.id)">Bagi rata</button>
        </div>
      </fieldset>

      <label class="mt-6 block">
        <span :class="labelClass">Catatan</span>
        <textarea v-model="form.notes" rows="2" maxlength="2000" :class="inputClass" class="w-full py-3"></textarea>
      </label>

      <div class="mt-6 flex justify-end gap-2">
        <button type="button" class="min-h-12 rounded-xl px-5 text-sm font-semibold text-text-muted hover:bg-panel-hover" @click="closeEditor">Batal</button>
        <button type="submit" class="min-h-12 rounded-xl bg-accent px-5 text-sm font-bold text-white disabled:opacity-60" :disabled="saving">{{ saving ? "Menyimpan…" : "Simpan" }}</button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  ApiError,
  projectsApi,
  showToast,
  type PaymentStatus,
  type PaymentType,
  type Project,
  type ProjectInput,
  type ProjectMemberRole,
  type ProjectPerson,
  type ProjectStatus,
} from "../api";

type FormMember = ProjectInput["members"][number];

const STATUS_LABEL: Record<ProjectStatus, string> = { ongoing: "Ongoing", completed: "Completed", cancelled: "Batal" };
const PAYMENT_TYPE_LABEL: Record<PaymentType, string> = { fixed: "Fixed", hourly: "Hourly" };
const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = { pending: "Pending", accepted: "Accepted", paid: "Dibayar ke tim" };
const STATUS_BADGE: Record<ProjectStatus, string> = {
  ongoing: "bg-warning/8 text-warning border-warning/20",
  completed: "bg-success/8 text-success border-success/20",
  cancelled: "bg-text-muted/10 text-text-dim border border-border",
};
const PAYMENT_BADGE: Record<PaymentStatus, string> = {
  pending: "bg-text-muted/10 text-text-dim border border-border",
  accepted: "bg-accent/8 text-accent border-accent/20",
  paid: "bg-success/8 text-success border-success/20",
};
const MEMBER_ROLES: { id: ProjectMemberRole; label: string }[] = [
  { id: "pm_sales", label: "PM & Sales" },
  { id: "designer", label: "Designer" },
  { id: "developer", label: "Developer" },
];
const inputClass =
  "min-h-12 rounded-xl border border-border bg-panel px-4 text-base placeholder-text-dim focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none";
const labelClass = "mb-1.5 block text-[11px] font-extrabold uppercase tracking-wider text-text-dim";

const projects = ref<Project[]>([]);
const people = ref<ProjectPerson[]>([]);
const loading = ref(false);
const error = ref("");
const search = ref("");
const statusFilter = ref<ProjectStatus | "">("");
const paymentFilter = ref<PaymentStatus | "">("");

const form = ref<ProjectInput | null>(null);
const editingId = ref<string | null>(null);
const saving = ref(false);

function message(err: unknown, fallback: string) {
  if (err instanceof ApiError && err.status === 403) return "Hanya PM, Admin, atau Owner yang bisa mengelola project.";
  return err instanceof ApiError ? err.message : fallback;
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    [projects.value, people.value] = await Promise.all([projectsApi.list(), projectsApi.people()]);
  } catch (err) {
    error.value = message(err, "Gagal memuat project.");
  } finally {
    loading.value = false;
  }
}
onMounted(load);

// ---- List ----

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return projects.value.filter(
    (p) =>
      (!statusFilter.value || p.status === statusFilter.value) &&
      (!paymentFilter.value || p.paymentStatus === paymentFilter.value) &&
      (!q || [p.name, p.platform, ...p.members.map((m) => m.employeeName)].some((s) => s.toLowerCase().includes(q))),
  );
});
const counted = computed(() => filtered.value.filter((p) => p.status !== "cancelled"));

type Totals = Record<string, number>; // per currency
const add = (t: Totals, currency: string, n: number) => {
  t[currency] = Math.round(((t[currency] ?? 0) + n) * 100) / 100;
};

const totals = computed(() => {
  const received: Totals = {};
  const unpaid: Totals = {};
  for (const p of counted.value) {
    add(received, p.currency, p.feeReceived);
    if (p.paymentStatus !== "paid") add(unpaid, p.currency, p.members.reduce((s, m) => s + m.fee, 0));
  }
  return { received, unpaid };
});

const perPerson = computed(() => {
  const map = new Map<string, { employeeId: string; name: string; projects: Set<string>; total: Totals; paid: Totals }>();
  for (const p of counted.value) {
    for (const m of p.members) {
      const entry = map.get(m.employeeId) ?? { employeeId: m.employeeId, name: m.employeeName, projects: new Set(), total: {}, paid: {} };
      entry.projects.add(p.id);
      add(entry.total, p.currency, m.fee);
      if (p.paymentStatus === "paid") add(entry.paid, p.currency, m.fee);
      map.set(m.employeeId, entry);
    }
  }
  return [...map.values()]
    .map((e) => ({ ...e, projects: e.projects.size }))
    .sort((a, b) => a.name.localeCompare(b.name));
});

const platforms = computed(() => [...new Set(["Upwork", "Fiverr", "Direct", ...projects.value.map((p) => p.platform)])]);

function membersOf(p: Project, role: ProjectMemberRole) {
  return p.members.filter((m) => m.role === role);
}

function money(n: number, currency: string) {
  try {
    return new Intl.NumberFormat("id-ID", { style: "currency", currency, maximumFractionDigits: 2 }).format(n || 0);
  } catch {
    return `${currency} ${(n || 0).toLocaleString("id-ID")}`;
  }
}
function formatTotals(t: Totals) {
  const entries = Object.entries(t);
  return entries.length ? entries.map(([c, n]) => money(n, c)).join(" + ") : money(0, "USD");
}
function formatDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}
function dateRange(p: Project) {
  if (!p.startDate && !p.endDate) return "Tanggal belum diisi";
  return `${p.startDate ? formatDate(p.startDate) : "?"} – ${p.endDate ? formatDate(p.endDate) : "sekarang"}`;
}

async function remove(p: Project) {
  if (!confirm(`Hapus project "${p.name}" beserta pembagian fee-nya?`)) return;
  try {
    await projectsApi.remove(p.id);
    projects.value = projects.value.filter((x) => x.id !== p.id);
    showToast("Project dihapus.", "success");
  } catch (err) {
    showToast(message(err, "Gagal menghapus project."), "error");
  }
}

// ---- Editor ----

function openEditor(p: Project | null) {
  editingId.value = p?.id ?? null;
  form.value = p
    ? {
        platform: p.platform,
        name: p.name,
        startDate: p.startDate,
        endDate: p.endDate,
        status: p.status,
        paymentType: p.paymentType,
        currency: p.currency,
        feeReceived: p.feeReceived,
        platformFeePercent: p.platformFeePercent,
        totalFee: p.totalFee,
        paymentStatus: p.paymentStatus,
        notes: p.notes,
        members: p.members.map((m) => ({ employeeId: m.employeeId, role: m.role, sharePercent: m.sharePercent })),
      }
    : {
        platform: "Upwork",
        name: "",
        startDate: null,
        endDate: null,
        status: "ongoing",
        paymentType: "fixed",
        currency: "USD",
        feeReceived: 0,
        platformFeePercent: 10,
        totalFee: null,
        paymentStatus: "pending",
        notes: null,
        members: [],
      };
}
function closeEditor() {
  form.value = null;
  editingId.value = null;
}

// Empty input means "use fee received", stored as null.
const totalFeeInput = computed({
  get: () => form.value?.totalFee ?? "",
  set: (v: number | string) => {
    if (form.value) form.value.totalFee = v === "" || v === null ? null : Number(v);
  },
});

const preview = computed(() => {
  const f = form.value;
  if (!f) return { cut: 0, auto: 0, base: 0 };
  const received = Number(f.feeReceived) || 0;
  const cut = Math.round(received * Math.min(Number(f.platformFeePercent) || 0, 99)) / 100;
  const auto = Math.round((received - cut) * 100) / 100;
  return { cut, auto, base: f.totalFee ?? auto };
});
const totalFeeTooHigh = computed(() => !!form.value && form.value.totalFee != null && form.value.totalFee > (Number(form.value.feeReceived) || 0));

// Same rounding as the API: per pool in cents, leftover cents to the largest
// remainders, so a pool at 100% adds up to the split base exactly.
const previewFees = computed(() => {
  const fees = new Map<FormMember, number>();
  const base = preview.value.base;
  for (const pm of [true, false]) {
    const pool = form.value?.members.filter((m) => isPmPool(m.role) === pm) ?? [];
    const exact = pool.map((m) => Math.round(base * (Number(m.sharePercent) || 0) * 1e6) / 1e6);
    const cents = exact.map(Math.floor);
    let left = Math.round(exact.reduce((s, c) => s + c, 0)) - cents.reduce((s, c) => s + c, 0);
    const order = exact.map((_, k) => k).sort((a, b) => exact[b]! - cents[b]! - (exact[a]! - cents[a]!));
    for (const k of order) {
      if (left <= 0) break;
      cents[k]! += 1;
      left -= 1;
    }
    pool.forEach((m, k) => fees.set(m, cents[k]! / 100));
  }
  return fees;
});

// PM & Sales split one 100% pool; designers and developers share the other.
const isPmPool = (role: ProjectMemberRole) => role === "pm_sales";
function formMembers(role: ProjectMemberRole) {
  return form.value?.members.filter((m) => m.role === role) ?? [];
}
function poolMembers(role: ProjectMemberRole) {
  return form.value?.members.filter((m) => isPmPool(m.role) === isPmPool(role)) ?? [];
}
function poolTotal(role: ProjectMemberRole) {
  return Math.round(poolMembers(role).reduce((s, m) => s + (Number(m.sharePercent) || 0), 0) * 100) / 100;
}
function poolOk(role: ProjectMemberRole) {
  return !poolMembers(role).length || poolTotal(role) === 100;
}
// Designers and developers share a pool, so its total shows once (under Developer).
function poolLabel(role: ProjectMemberRole) {
  if (role === "designer" || !poolMembers(role).length) return "";
  const scope = isPmPool(role) ? "PM & Sales" : "Designer + developer";
  const total = poolTotal(role);
  if (total === 100) return `${scope}: 100% terbagi`;
  if (total > 100) return `${scope}: ${total}%, lebih ${Math.round((total - 100) * 100) / 100}% dari 100%`;
  return `${scope}: ${total}% terbagi, sisa ${Math.round((100 - total) * 100) / 100}% belum dibagi`;
}
// PM & Sales start at 50% of the split fee (as in the sheet), others at what is left.
function addMember(role: ProjectMemberRole) {
  const left = Math.max(0, Math.round((100 - poolTotal(role)) * 100) / 100);
  form.value?.members.push({ employeeId: "", role, sharePercent: isPmPool(role) ? Math.min(50, left) : left });
}
function removeMember(m: FormMember) {
  if (form.value) form.value.members = form.value.members.filter((x) => x !== m);
}
function splitEvenly(role: ProjectMemberRole) {
  const pool = poolMembers(role);
  const each = Math.floor((100 / pool.length) * 100) / 100;
  pool.forEach((m, i) => (m.sharePercent = i === pool.length - 1 ? Math.round((100 - each * (pool.length - 1)) * 100) / 100 : each));
}
// Active people, plus whoever is already picked (they may have been deactivated since).
function peopleFor(m: FormMember) {
  const taken = new Set(formMembers(m.role).filter((x) => x !== m).map((x) => x.employeeId));
  return people.value.filter((p) => (p.isActive || p.id === m.employeeId) && !taken.has(p.id));
}

async function save() {
  if (!form.value) return;
  if (totalFeeTooHigh.value) {
    showToast("Total fee dibagi tidak boleh lebih dari fee diterima.", "error");
    return;
  }
  for (const role of ["pm_sales", "designer"] as const) {
    if (poolTotal(role) > 100) {
      showToast(`Total ${isPmPool(role) ? "PM & Sales" : "designer + developer"} lebih dari 100%.`, "error");
      return;
    }
  }
  saving.value = true;
  try {
    const input: ProjectInput = {
      ...form.value,
      startDate: form.value.startDate || null,
      endDate: form.value.endDate || null,
      notes: form.value.notes?.trim() || null,
    };
    if (editingId.value) await projectsApi.update(editingId.value, input);
    else await projectsApi.create(input);
    showToast("Project disimpan.", "success");
    closeEditor();
    await load();
  } catch (err) {
    showToast(message(err, "Gagal menyimpan project."), "error");
  } finally {
    saving.value = false;
  }
}
</script>
