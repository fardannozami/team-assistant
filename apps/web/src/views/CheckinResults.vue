<template>
  <div class="rounded-2xl border border-border bg-panel p-4 shadow-soft-lg sm:p-6 reveal">
    <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim">{{ kind === "checkout" ? "Check-out mingguan" : "Mood awal minggu" }}</div>
        <div v-if="data?.date" class="mt-1 text-sm text-text-muted">
          {{ done }}/{{ data.rows.length }} selesai<template v-if="data.averageMood"> · rata-rata {{ data.averageMood }}/5 {{ emoji(Math.round(data.averageMood)) }}</template>
        </div>
      </div>
      <div v-if="data?.dates.length" class="min-w-[180px]">
        <label :for="`${kind}-date`" class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Periode</label>
        <select :id="`${kind}-date`" v-model="date" class="min-h-11 w-full rounded-xl border border-border bg-panel px-3 text-sm" @change="load">
          <option v-for="d in data.dates" :key="d" :value="d">{{ d }}</option>
        </select>
      </div>
    </div>

    <div v-if="error" class="mb-4 rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger" role="alert">{{ error }}</div>
    <div v-else-if="loading" class="flex items-center gap-3 text-sm text-text-muted">
      <span class="h-5 w-5 animate-spin rounded-full border-2 border-accent/20 border-t-accent" aria-hidden="true"></span>
      Memuat…
    </div>
    <div v-else-if="!data?.date" class="flex flex-col items-center justify-center py-16 text-center">
      <h3 class="text-[18px] font-extrabold tracking-tight text-text mb-1">Belum ada data</h3>
      <p class="text-text-muted text-sm">Aktifkan di Pengaturan → Check-in, atau kirim sekarang dari sana.</p>
    </div>
    <template v-else>
      <p v-if="motivation" class="mb-4 rounded-xl bg-accent/5 p-4 text-sm text-text">💬 {{ motivation }}</p>
      <ul class="space-y-3">
        <li v-for="row in data.rows" :key="row.employeeId" class="rounded-xl border border-border p-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="min-w-0">
              <span class="font-bold text-text">{{ row.employeeName }}</span>
              <span v-if="row.teamName" class="ml-2 text-xs text-text-muted">{{ row.teamName }}</span>
            </div>
            <span class="rounded-full px-2.5 py-1 text-xs font-bold" :class="STATUS[row.status]?.cls ?? 'bg-panel-hover text-text-muted'">
              {{ row.mood ? `${row.mood} ${emoji(row.mood)} · ` : "" }}{{ STATUS[row.status]?.label ?? row.status }}
            </span>
          </div>
          <dl v-if="textQuestions.some((q) => row.answers[q.key])" class="mt-3 space-y-2 text-sm">
            <div v-for="q in textQuestions" v-show="row.answers[q.key]" :key="q.key">
              <dt class="text-text-muted">{{ q.text }}</dt>
              <dd class="text-text">{{ row.answers[q.key] }}</dd>
            </div>
          </dl>
        </li>
      </ul>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ApiError, checkinsApi, type CheckinKind, type CheckinResponses } from "../api";

const props = defineProps<{ kind: CheckinKind }>();

const MOODS = ["😫", "😕", "😐", "🙂", "🤩"];
const STATUS: Record<string, { label: string; cls: string }> = {
  completed: { label: "Selesai", cls: "bg-success/10 text-success" },
  in_progress: { label: "Sedang mengisi", cls: "bg-accent/10 text-accent" },
  pending: { label: "Belum mengisi", cls: "bg-panel-hover text-text-muted" },
  missed: { label: "Terlewat", cls: "bg-danger/10 text-danger" },
};

const data = ref<CheckinResponses | null>(null);
const date = ref<string | undefined>();
const loading = ref(false);
const error = ref("");

const done = computed(() => data.value?.rows.filter((r) => r.status === "completed").length ?? 0);
const textQuestions = computed(() => data.value?.questions.filter((q) => q.type === "text") ?? []);
const motivation = computed(() => data.value?.rows.find((r) => r.motivation)?.motivation ?? null);

function emoji(score: number) {
  return MOODS[score - 1] ?? "";
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    data.value = await checkinsApi.responses(props.kind, date.value);
    date.value = data.value.date ?? undefined;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Gagal memuat hasil.";
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>
