<template>
  <header class="mb-7">
    <h2 class="text-[26px] font-display font-extrabold tracking-tight text-text">Check-in</h2>
    <p class="text-text-muted text-sm mt-1">
      Check-out di akhir minggu dan ice breaking di awal minggu, dikirim lewat WhatsApp seperti standup. Hasilnya ada di Laporan.
    </p>
  </header>

  <div v-if="error" class="mb-5 px-4 py-3.5 rounded-xl border border-danger/30 bg-danger/5 text-danger text-[12px] font-extrabold slide-in" role="alert">{{ error }}</div>
  <div v-if="loading" class="flex items-center gap-3 text-sm text-text-muted">
    <span class="h-5 w-5 animate-spin rounded-full border-2 border-accent/20 border-t-accent" aria-hidden="true"></span>
    Memuat…
  </div>

  <div class="space-y-6">
    <section v-for="form in forms" :key="form.kind" class="rounded-2xl border border-border bg-panel p-4 shadow-soft-lg sm:p-6" :aria-labelledby="`checkin-${form.kind}`">
      <div class="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 :id="`checkin-${form.kind}`" class="text-lg font-extrabold text-text">{{ META[form.kind].title }}</h3>
          <p class="mt-1 text-sm text-text-muted">{{ META[form.kind].description }}</p>
        </div>
        <label class="inline-flex min-h-11 items-center gap-3 rounded-xl border border-border px-4 text-sm font-semibold text-text">
          <input v-model="form.isActive" type="checkbox" class="h-5 w-5 accent-accent" />Aktif
        </label>
      </div>

      <div class="space-y-4">
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label :for="`${form.kind}-time`" class="mb-1.5 block text-sm font-semibold text-text">Jam kirim</label>
            <input :id="`${form.kind}-time`" v-model="form.timeOfDay" type="time" required :class="inputClass" />
          </div>
          <div>
            <label :for="`${form.kind}-tz`" class="mb-1.5 block text-sm font-semibold text-text">Zona waktu</label>
            <input :id="`${form.kind}-tz`" v-model="form.timezone" type="text" placeholder="Asia/Jakarta" :class="inputClass" />
          </div>
          <div>
            <label :for="`${form.kind}-reminder`" class="mb-1.5 block text-sm font-semibold text-text">Pengingat (menit setelah dikirim)</label>
            <input :id="`${form.kind}-reminder`" v-model.number="form.reminder" type="number" min="1" max="1440" placeholder="Kosong = tanpa pengingat" :class="inputClass" />
          </div>
          <div>
            <label :for="`${form.kind}-close`" class="mb-1.5 block text-sm font-semibold text-text">Ditutup jam (opsional)</label>
            <input :id="`${form.kind}-close`" v-model="form.closeTime" type="time" :class="inputClass" />
          </div>
        </div>

        <div>
          <span class="mb-2 block text-sm font-semibold text-text">Hari</span>
          <div class="flex flex-wrap gap-2">
            <label v-for="(d, index) in DAYS" :key="d" class="inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-bold" :class="form.weekdays.includes(index) ? 'border-accent bg-accent text-white' : 'border-border bg-panel-hover text-text-muted'">
              <input type="checkbox" :checked="form.weekdays.includes(index)" class="h-4 w-4 accent-accent" @change="toggleWeekday(form.weekdays, index)" />{{ d }}
            </label>
          </div>
        </div>

        <fieldset class="space-y-2 rounded-xl border border-border p-4">
          <legend class="px-1 text-sm font-semibold text-text">Pertanyaan</legend>
          <p v-if="form.kind === 'icebreaker'" class="text-sm text-text-muted">Pesan dibuka dengan kata motivasi: dibuat AI jika API key terpasang, selain itu dari daftar bawaan.</p>
          <ol class="space-y-2">
            <li v-for="(q, i) in form.questions" :key="q.key" class="flex flex-col gap-2 rounded-xl bg-panel-hover p-3 sm:flex-row sm:items-center">
              <span class="hidden w-6 shrink-0 text-sm font-bold text-text-dim sm:block">{{ i + 1 }}.</span>
              <input v-model="q.text" type="text" maxlength="300" required :aria-label="`Pertanyaan ${i + 1}`" :class="[inputClass, 'min-h-11 flex-1']" />
              <div class="flex shrink-0 items-center gap-1">
                <select v-model="q.type" :aria-label="`Jenis jawaban pertanyaan ${i + 1}`" class="min-h-11 rounded-xl border border-border bg-panel px-3 text-sm">
                  <option value="text">Teks</option>
                  <option value="mood">Skor 1–5</option>
                </select>
                <button type="button" class="grid h-11 w-11 place-items-center rounded-xl text-text-muted hover:bg-panel disabled:opacity-30" :disabled="i === 0" aria-label="Naikkan" @click="move(form.questions, i, -1)">↑</button>
                <button type="button" class="grid h-11 w-11 place-items-center rounded-xl text-text-muted hover:bg-panel disabled:opacity-30" :disabled="i === form.questions.length - 1" aria-label="Turunkan" @click="move(form.questions, i, 1)">↓</button>
                <button type="button" class="grid h-11 w-11 place-items-center rounded-xl text-text-muted hover:bg-danger/5 hover:text-danger disabled:opacity-30" :disabled="form.questions.length === 1" aria-label="Hapus" @click="form.questions.splice(i, 1)">✕</button>
              </div>
            </li>
          </ol>
          <button type="button" class="min-h-11 rounded-xl px-3 text-sm font-semibold text-accent hover:bg-accent/5 disabled:opacity-40" :disabled="form.questions.length >= 10" @click="addQuestion(form.questions)">+ Tambah pertanyaan</button>
        </fieldset>

        <p class="rounded-xl bg-panel-hover p-4 text-sm text-text-muted">{{ summary(form) }}</p>

        <div class="flex flex-col gap-2 sm:flex-row">
          <button type="button" class="min-h-12 flex-1 rounded-xl bg-accent px-4 text-sm font-bold text-white disabled:opacity-60" :disabled="busy === form.kind" @click="save(form)">
            {{ busy === form.kind ? "Menyimpan…" : "Simpan" }}
          </button>
          <button type="button" class="min-h-12 flex-1 rounded-xl border border-border px-4 text-sm font-bold text-text disabled:opacity-60" :disabled="!form.saved || busy === `${form.kind}:send`" :title="form.saved ? '' : 'Simpan dulu sebelum mengirim'" @click="sendNow(form)">
            {{ busy === `${form.kind}:send` ? "Mengirim…" : "Kirim sekarang" }}
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ApiError, checkinsApi, showToast, type CheckinConfig, type CheckinKind, type CheckinQuestion } from "../api";

const DAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const META: Record<CheckinKind, { title: string; description: string }> = {
  checkout: {
    title: "Check-out mingguan",
    description: "Menutup minggu: skor minggu ini, pencapaian, tantangan, dan rencana minggu depan.",
  },
  icebreaker: {
    title: "Ice breaking",
    description: "Membuka minggu: kata motivasi, lalu tanya mood (1–5) dan cerita singkat.",
  },
};
const inputClass =
  "min-h-12 w-full rounded-xl border border-border bg-panel px-4 text-base placeholder-text-dim focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20";

type Form = {
  kind: CheckinKind;
  saved: boolean;
  isActive: boolean;
  timeOfDay: string;
  timezone: string;
  reminder: number | "" | null;
  closeTime: string;
  weekdays: number[];
  questions: CheckinQuestion[];
};

const forms = ref<Form[]>([]);
const loading = ref(false);
const error = ref("");
const busy = ref<string | null>(null);

function toForm(c: CheckinConfig): Form {
  return {
    kind: c.kind,
    saved: c.id !== null,
    isActive: c.isActive,
    timeOfDay: c.timeOfDay,
    timezone: c.timezone,
    reminder: c.reminderMinutes,
    closeTime: c.closeTime ?? "",
    weekdays: c.weekdays.slice(),
    questions: c.questions.map((q) => ({ ...q })),
  };
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    forms.value = (await checkinsApi.configs()).map(toForm);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Gagal memuat check-in.";
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function toggleWeekday(days: number[], d: number) {
  const i = days.indexOf(d);
  if (i >= 0) days.splice(i, 1);
  else days.push(d);
}

function move(list: CheckinQuestion[], i: number, delta: number) {
  const [q] = list.splice(i, 1);
  list.splice(i + delta, 0, q!);
}

function addQuestion(list: CheckinQuestion[]) {
  list.push({ key: `q_${Date.now().toString(36)}`, text: "", type: "text" });
}

function summary(f: Form) {
  const days = [...f.weekdays].sort((a, b) => a - b).map((d) => DAYS[d]).join(", ") || "—";
  const reminder = typeof f.reminder === "number" && f.reminder > 0 ? `, pengingat +${f.reminder} mnt` : "";
  const close = f.closeTime ? `, ditutup ${f.closeTime}` : "";
  return `${f.isActive ? "Aktif" : "Nonaktif"} · ${days} jam ${f.timeOfDay} (${f.timezone || "Asia/Jakarta"})${reminder}${close} · ${f.questions.length} pertanyaan`;
}

async function save(f: Form) {
  if (!f.weekdays.length) return showToast("Pilih minimal satu hari.", "error");
  if (f.questions.some((q) => !q.text.trim())) return showToast("Ada pertanyaan yang masih kosong.", "error");
  busy.value = f.kind;
  try {
    const saved = await checkinsApi.save(f.kind, {
      isActive: f.isActive,
      timeOfDay: f.timeOfDay,
      timezone: f.timezone.trim() || "Asia/Jakarta",
      reminderMinutes: typeof f.reminder === "number" && f.reminder > 0 ? f.reminder : null,
      closeTime: f.closeTime || null,
      weekdays: f.weekdays.slice().sort((a, b) => a - b),
      questions: f.questions.map((q) => ({ ...q, text: q.text.trim() })),
    });
    forms.value = forms.value.map((x) => (x.kind === f.kind ? toForm(saved) : x));
    showToast(`${META[f.kind].title} disimpan.`, "success");
  } catch (err) {
    showToast(err instanceof ApiError ? err.message : "Gagal menyimpan.", "error");
  } finally {
    busy.value = null;
  }
}

async function sendNow(f: Form) {
  busy.value = `${f.kind}:send`;
  try {
    const r = await checkinsApi.trigger(f.kind);
    if (r.whatsappConnected === false) showToast("WhatsApp belum terhubung.", "error");
    else if (r.excluded) showToast(`Hari ini dikecualikan${r.reason ? ` (${r.reason})` : ""}, tidak dikirim.`, "error");
    else showToast(`Dikirim ke ${r.sent} orang${r.skipped ? `, ${r.skipped} sudah selesai` : ""}${r.failed ? `, ${r.failed} gagal` : ""}.`, r.failed ? "error" : "success");
  } catch (err) {
    showToast(err instanceof ApiError ? err.message : "Gagal mengirim.", "error");
  } finally {
    busy.value = null;
  }
}
</script>
