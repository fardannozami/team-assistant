<template>
  <header class="mb-7">
    <h2 class="font-display text-[26px] font-extrabold tracking-tight text-text">Fee</h2>
    <p class="mt-1 text-sm text-text-muted">
      Bonus fee per orang dan lead dari project USD yang selesai di periode ini. Total di bawah $500 belum eligible dan dibawa ke periode berikutnya.
    </p>
  </header>

  <div class="mb-5 grid gap-3 sm:grid-cols-[auto_1fr_1fr]">
    <label class="sr-only" for="fee-period">Periode</label>
    <select id="fee-period" v-model="period" :class="inputClass">
      <option v-for="(label, key) in PERIOD_LABEL" :key="key" :value="key">{{ label }}</option>
    </select>
    <label class="flex items-center gap-2">
      <span class="w-14 shrink-0 text-[11px] font-extrabold uppercase tracking-wider text-text-dim">Dari</span>
      <input v-model="dateFrom" type="date" :max="dateTo || undefined" :class="inputClass" class="w-full min-w-0" @input="period = 'custom'" />
    </label>
    <label class="flex items-center gap-2">
      <span class="w-14 shrink-0 text-[11px] font-extrabold uppercase tracking-wider text-text-dim">Sampai</span>
      <input v-model="dateTo" type="date" :min="dateFrom || undefined" :class="inputClass" class="w-full min-w-0" @input="period = 'custom'" />
    </label>
  </div>

  <details class="mb-6 rounded-2xl border border-border bg-panel p-4 shadow-soft">
    <summary class="cursor-pointer text-sm font-bold text-text">Pengaturan · Hitung bonus mulai {{ startDate ? formatDate(startDate) : "awal" }}</summary>
    <div class="mt-3 flex flex-wrap items-end gap-3">
      <label class="block">
        <span class="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wider text-text-dim">Hitung bonus mulai</span>
        <input v-model="startDraft" type="date" :class="inputClass" />
      </label>
      <button type="button" class="min-h-12 rounded-xl border border-border px-4 text-sm font-bold text-text hover:bg-panel-hover disabled:opacity-60" :disabled="savingSettings" @click="saveSettings">Simpan</button>
    </div>
    <p class="mt-2 text-sm text-text-muted">Project yang selesai sebelum tanggal ini dianggap sudah dibayar di luar aplikasi dan tidak ikut carry over.</p>
  </details>

  <div v-if="error" class="mb-5 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3.5 text-[12px] font-extrabold text-danger slide-in" role="alert">{{ error }}</div>

  <div v-if="loading && !people.length" class="flex flex-col items-center gap-2.5 py-24 text-center text-text-muted fade-in-fast">
    <span class="h-10 w-10 rounded-full border-2 border-accent/20 border-t-accent spin-slow" aria-hidden="true"></span>
    <span class="text-sm font-extrabold tracking-tight">Memuat fee…</span>
  </div>

  <div v-else-if="!error && !people.length" class="flex flex-col items-center justify-center py-24 text-center fade-in">
    <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-border bg-panel-hover text-text-dim" aria-hidden="true">—</div>
    <h3 class="mb-1 text-[18px] font-extrabold tracking-tight text-text">Belum ada fee di periode ini</h3>
    <p class="text-sm text-text-muted">Tidak ada project USD yang selesai dan belum dibayar sampai {{ formatDate(dateTo) }}.</p>
  </div>

  <div v-else class="grid gap-5 lg:grid-cols-[320px_1fr]">
    <!-- People -->
    <ul class="space-y-2" aria-label="Anggota">
      <li v-for="p in people" :key="p.employee.id">
        <button
          type="button"
          class="w-full rounded-2xl border bg-panel p-4 text-left shadow-soft transition hover:border-accent/40"
          :class="selectedId === p.employee.id ? 'border-accent ring-2 ring-accent/20' : 'border-border'"
          :aria-pressed="selectedId === p.employee.id"
          @click="select(p.employee.id)"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="truncate font-bold text-text">{{ p.employee.name }}</div>
              <div v-if="p.employee.lead" class="mt-0.5 text-xs font-semibold text-accent">{{ LEAD_LABEL[p.employee.lead] }}</div>
            </div>
            <div class="shrink-0 text-right font-display text-[17px] font-extrabold tabular-nums" :class="totalFor(p) > 0 ? 'text-success' : 'text-text-dim'">{{ money(totalFor(p)) }}</div>
          </div>
          <ul class="mt-2 space-y-0.5 text-xs">
            <li v-for="g in p.statement.groups" :key="g.group" class="flex justify-between gap-2">
              <span class="text-text-muted">{{ GROUP_LABEL[g.group] }} {{ money(g.base) }}</span>
              <span v-if="g.eligible" class="font-semibold text-success">{{ percentFor(p, g) }}%</span>
              <span v-else class="text-warning">belum eligible</span>
            </li>
          </ul>
        </button>
      </li>
    </ul>

    <!-- Preview -->
    <section v-if="selected" class="min-w-0 rounded-2xl border border-border bg-panel p-4 shadow-soft-lg sm:p-6" aria-labelledby="preview-title">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="preview-title" class="text-lg font-extrabold text-text">Fee {{ periodText }} - {{ selected.employee.name }}</h3>
          <p class="mt-0.5 font-mono text-xs text-text-dim">{{ selected.employee.phone }}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="min-h-11 rounded-xl border border-border px-4 text-sm font-bold text-text hover:bg-panel-hover disabled:opacity-60" :disabled="busy" @click="download">Download PDF</button>
          <button type="button" class="min-h-11 rounded-xl border border-border px-4 text-sm font-bold text-text hover:bg-panel-hover disabled:opacity-60" :disabled="busy" @click="sendWa">Kirim WA</button>
          <button type="button" class="min-h-11 rounded-xl bg-accent px-4 text-sm font-bold text-white hover:bg-accent-hover disabled:opacity-60" :disabled="busy || !selected.statement.groups.some((g) => g.eligible)" @click="finalize">Finalisasi</button>
        </div>
      </div>

      <div class="table-scroll mt-4">
        <table class="w-full border-collapse text-[13px]">
          <thead>
            <tr class="text-text-dim">
              <th class="border-b border-border px-3 py-2.5 text-left text-[11px] font-extrabold uppercase tracking-wider">Platform</th>
              <th class="border-b border-border px-3 py-2.5 text-left text-[11px] font-extrabold uppercase tracking-wider">Nama project</th>
              <th class="border-b border-border px-3 py-2.5 text-left text-[11px] font-extrabold uppercase tracking-wider">Anggota</th>
              <th class="border-b border-border px-3 py-2.5 text-right text-[11px] font-extrabold uppercase tracking-wider">Total fee</th>
              <th class="border-b border-border px-3 py-2.5 text-right text-[11px] font-extrabold uppercase tracking-wider">Kontribusi</th>
              <th class="border-b border-border px-3 py-2.5 text-right text-[11px] font-extrabold uppercase tracking-wider">Fee</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in selected.statement.rows" :key="r.projectId">
              <td class="border-b border-border px-3 py-2 text-text-muted">{{ r.platform }}</td>
              <td class="border-b border-border px-3 py-2 text-text">
                {{ r.name }}
                <span v-if="r.carried" class="ml-1 rounded-full bg-warning/10 px-1.5 text-[10px] font-bold text-warning" :title="`Selesai ${formatDate(r.endDate)}`">carry over</span>
              </td>
              <td class="border-b border-border px-3 py-2 text-text-muted">{{ r.members.join(", ") }}</td>
              <td class="border-b border-border px-3 py-2 text-right tabular-nums text-text">{{ money(r.total) }}</td>
              <td class="border-b border-border px-3 py-2 text-right tabular-nums text-text-muted">{{ r.fee ? `${r.contributionPercent}%` : "" }}</td>
              <td class="border-b border-border px-3 py-2 text-right tabular-nums text-text">{{ money(r.fee) }}</td>
            </tr>
            <tr v-if="!selected.statement.rows.length">
              <td colspan="6" class="px-3 py-6 text-center text-text-muted">Tidak ada project yang belum dibayar.</td>
            </tr>
          </tbody>
          <tfoot v-if="selected.statement.rows.length">
            <tr class="font-bold">
              <td colspan="3"></td>
              <td class="px-3 py-2.5 text-right tabular-nums text-text">{{ money(sum(selected.statement.rows.map((r) => r.total))) }}</td>
              <td class="px-3 py-2.5 text-right text-text-dim">Total</td>
              <td class="px-3 py-2.5 text-right tabular-nums text-text">{{ money(sum(selected.statement.rows.map((r) => r.fee))) }}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div class="mt-4 space-y-2">
        <div v-for="g in selected.statement.groups" :key="g.group" class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
          <div class="min-w-0">
            <div class="text-sm font-bold text-text">Fee {{ GROUP_LABEL[g.group] }}</div>
            <div class="text-xs text-text-muted">
              Total {{ money(g.base) }}
              <template v-if="g.eligible"> · tabel {{ g.tierPercent }}%</template>
              <template v-else> · belum eligible (min. $500), dibawa ke periode berikutnya</template>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <template v-if="g.eligible">
              <label class="relative">
                <span class="sr-only">Persen {{ GROUP_LABEL[g.group] }}</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  :value="percentFor(selected, g)"
                  class="min-h-10 w-24 rounded-xl border border-border bg-panel px-3 pr-7 text-right text-sm tabular-nums focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none"
                  @input="setPercent(g.group, ($event.target as HTMLInputElement).value)"
                />
                <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-dim">%</span>
              </label>
              <button v-if="percentFor(selected, g) !== g.tierPercent" type="button" class="min-h-10 rounded-xl px-2 text-xs font-semibold text-text-muted hover:bg-panel-hover" @click="setPercent(g.group, '')">Reset ke tabel</button>
            </template>
            <span class="w-24 text-right font-bold tabular-nums text-text">{{ g.eligible ? money(bonusFor(selected, g)) : "-" }}</span>
          </div>
        </div>
        <div class="flex items-center justify-between rounded-xl bg-warning/10 px-4 py-3">
          <span class="text-sm font-extrabold text-text">TOTAL FEE</span>
          <span class="font-display text-[20px] font-extrabold tabular-nums text-text">{{ money(totalFor(selected)) }}</span>
        </div>
      </div>

      <div class="mt-6">
        <h4 class="text-sm font-extrabold text-text">Riwayat pembayaran</h4>
        <p v-if="!payouts.length" class="mt-1 text-sm text-text-muted">Belum ada fee {{ selected.employee.name }} yang difinalisasi.</p>
        <ul v-else class="mt-2 space-y-2">
          <li v-for="h in payouts" :key="h.id" class="rounded-xl border border-border px-4 py-3 text-sm">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span class="font-bold text-text">{{ GROUP_LABEL[h.group] }}</span>
                <span class="text-text-muted"> · {{ formatDate(h.periodFrom) }} – {{ formatDate(h.periodTo) }} · {{ h.percent }}% × {{ money(h.base) }} = </span>
                <span class="font-bold text-success">{{ money(h.bonus) }}</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs text-text-dim">difinalisasi {{ formatDate(h.createdAt.slice(0, 10)) }}</span>
                <button type="button" class="min-h-9 rounded-xl px-2 text-xs font-semibold text-text-muted hover:bg-danger/5 hover:text-danger" @click="undo(h)">Batalkan</button>
              </div>
            </div>
            <details class="mt-1 text-xs text-text-muted">
              <summary class="cursor-pointer">{{ h.projects.length }} project</summary>
              <ul class="mt-1 space-y-0.5">
                <li v-for="pr in h.projects" :key="pr.name + pr.amount" class="flex justify-between gap-2"><span class="truncate">{{ pr.name }}</span><span class="tabular-nums">{{ money(pr.amount) }}</span></li>
              </ul>
            </details>
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  ApiError,
  feesApi,
  showToast,
  type EmployeeLead,
  type FeeGroup,
  type FeeGroupTotal,
  type FeePayout,
  type FeePerson,
} from "../api";
import { localIsoDate } from "../dates";

const GROUP_LABEL: Record<FeeGroup, string> = {
  pm: "PM & Sales",
  maker: "Designer / Developer",
  lead_design: "Lead Designer",
  lead_development: "Lead Developer",
};
const LEAD_LABEL: Record<EmployeeLead, string> = { design: "Lead Design", development: "Lead Development" };
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const inputClass =
  "min-h-12 rounded-xl border border-border bg-panel px-4 text-base placeholder-text-dim focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none";

// Same presets as the Projects page; editing a date by hand makes it "custom".
type Period = "this_month" | "last_month" | "custom";
const PERIOD_LABEL: Record<Period, string> = { this_month: "Bulan ini", last_month: "Bulan lalu", custom: "Custom" };
function periodRange(p: Period): [string, string] | null {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (p === "this_month") return [localIsoDate(new Date(y, m, 1)), localIsoDate(new Date(y, m + 1, 0))];
  if (p === "last_month") return [localIsoDate(new Date(y, m - 1, 1)), localIsoDate(new Date(y, m, 0))];
  return null;
}
const period = ref<Period>("last_month");
const [defaultFrom, defaultTo] = periodRange("last_month")!;
const dateFrom = ref(defaultFrom);
const dateTo = ref(defaultTo);
watch(period, (p) => {
  const range = periodRange(p);
  if (range) [dateFrom.value, dateTo.value] = range;
});

const people = ref<FeePerson[]>([]);
const startDate = ref<string | null>(null);
const startDraft = ref("");
const loading = ref(false);
const error = ref("");
const busy = ref(false);
const savingSettings = ref(false);
const selectedId = ref<string | null>(null);
const payouts = ref<FeePayout[]>([]);
// Percents the owner typed, per person and group; the tier's when absent.
const overrides = ref<Record<string, Partial<Record<FeeGroup, number>>>>({});

const selected = computed(() => people.value.find((p) => p.employee.id === selectedId.value) ?? null);

function message(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

let loadSeq = 0;
async function load() {
  if (!dateFrom.value || !dateTo.value || dateFrom.value > dateTo.value) return;
  const seq = ++loadSeq;
  loading.value = true;
  error.value = "";
  try {
    const overview = await feesApi.overview(dateFrom.value, dateTo.value);
    if (seq !== loadSeq) return;
    people.value = overview.people;
    startDate.value = overview.startDate;
    startDraft.value = overview.startDate ?? "";
    if (!people.value.some((p) => p.employee.id === selectedId.value)) selectedId.value = people.value[0]?.employee.id ?? null;
  } catch (err) {
    if (seq === loadSeq) error.value = message(err, "Gagal memuat fee.");
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}
onMounted(load);
watch([dateFrom, dateTo], load);

async function loadPayouts() {
  payouts.value = [];
  if (!selectedId.value) return;
  const id = selectedId.value;
  try {
    const list = await feesApi.payouts(id);
    if (selectedId.value === id) payouts.value = list;
  } catch {
    // History is secondary; the statement still works without it.
  }
}
watch(selectedId, loadPayouts);

function select(id: string) {
  selectedId.value = id;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const sum = (ns: number[]) => round2(ns.reduce((s, n) => s + n, 0));

function percentFor(p: FeePerson, g: FeeGroupTotal) {
  return overrides.value[p.employee.id]?.[g.group] ?? g.tierPercent;
}
function bonusFor(p: FeePerson, g: FeeGroupTotal) {
  return g.eligible ? round2((g.base * percentFor(p, g)) / 100) : 0;
}
function totalFor(p: FeePerson) {
  return sum(p.statement.groups.map((g) => bonusFor(p, g)));
}
function setPercent(group: FeeGroup, value: string) {
  if (!selectedId.value) return;
  const own = { ...(overrides.value[selectedId.value] ?? {}) };
  const n = Number(value);
  if (value === "" || !Number.isFinite(n)) delete own[group];
  else own[group] = Math.min(100, Math.max(0, n));
  overrides.value = { ...overrides.value, [selectedId.value]: own };
}

function input() {
  const p = selected.value!;
  // Only overrides that differ from the table are sent.
  const percents: Partial<Record<FeeGroup, number>> = {};
  for (const g of p.statement.groups) {
    const value = percentFor(p, g);
    if (g.eligible && value !== g.tierPercent) percents[g.group] = value;
  }
  return { from: dateFrom.value, to: dateTo.value, employeeId: p.employee.id, percents };
}

const periodText = computed(() => {
  const [fy, fm, fd] = dateFrom.value.split("-").map(Number);
  const [ty, tm, td] = dateTo.value.split("-").map(Number);
  const lastDay = new Date(ty!, tm!, 0).getDate();
  if (fy === ty && fm === tm && fd === 1 && td === lastDay) return `${MONTHS[fm! - 1]} ${fy}`;
  return `${formatDate(dateFrom.value)} – ${formatDate(dateTo.value)}`;
});

async function download() {
  if (!selected.value) return;
  busy.value = true;
  try {
    const blob = await feesApi.pdf(input());
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Fee ${periodText.value} - ${selected.value.employee.name}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    showToast(message(err, "Gagal membuat PDF."), "error");
  } finally {
    busy.value = false;
  }
}

async function sendWa() {
  const p = selected.value;
  if (!p || !confirm(`Kirim PDF fee ${periodText.value} ke ${p.employee.name} (${p.employee.phone}) lewat WhatsApp?`)) return;
  busy.value = true;
  try {
    await feesApi.send(input());
    showToast(`PDF fee terkirim ke ${p.employee.name}.`, "success");
  } catch (err) {
    showToast(message(err, "Gagal mengirim lewat WhatsApp."), "error");
  } finally {
    busy.value = false;
  }
}

async function finalize() {
  const p = selected.value;
  if (!p) return;
  const eligible = p.statement.groups.filter((g) => g.eligible);
  const lines = eligible.map((g) => `${GROUP_LABEL[g.group]}: ${percentFor(p, g)}% × ${money(g.base)} = ${money(bonusFor(p, g))}`);
  if (!confirm(`Finalisasi fee ${p.employee.name}?\n\n${lines.join("\n")}\n\nProject-nya ditandai sudah dibayar dan tidak dihitung lagi.`)) return;
  busy.value = true;
  try {
    await feesApi.finalize(input());
    showToast(`Fee ${p.employee.name} difinalisasi.`, "success");
    delete overrides.value[p.employee.id];
    await Promise.all([load(), loadPayouts()]);
  } catch (err) {
    showToast(message(err, "Gagal finalisasi."), "error");
  } finally {
    busy.value = false;
  }
}

async function undo(h: FeePayout) {
  if (!confirm(`Batalkan pembayaran ${GROUP_LABEL[h.group]} ${money(h.bonus)} untuk ${h.employeeName}? Project-nya akan dihitung lagi (carry over).`)) return;
  try {
    await feesApi.undoPayout(h.id);
    showToast("Pembayaran dibatalkan.", "success");
    await Promise.all([load(), loadPayouts()]);
  } catch (err) {
    showToast(message(err, "Gagal membatalkan."), "error");
  }
}

async function saveSettings() {
  savingSettings.value = true;
  try {
    await feesApi.saveSettings(startDraft.value || null);
    showToast("Pengaturan fee disimpan.", "success");
    await load();
  } catch (err) {
    showToast(message(err, "Gagal menyimpan pengaturan."), "error");
  } finally {
    savingSettings.value = false;
  }
}

function money(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);
}
function formatDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}
</script>
