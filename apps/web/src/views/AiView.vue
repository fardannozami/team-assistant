<template>
  <header class="flex items-baseline justify-between gap-3 flex-wrap mb-7">
    <div>
      <h2 class="text-[26px] font-display font-extrabold tracking-tight text-text">Asisten AI</h2>
      <p class="text-text-muted text-sm mt-1">
        Bot memakai AI untuk memahami pesan bebas dari anggota. Gunakan API key milik Anda sendiri, sehingga pemakaian dan kuotanya terpisah dari workspace lain.
      </p>
    </div>
  </header>

  <div v-if="error" class="mb-5 px-4 py-3.5 rounded-xl border border-danger/30 bg-danger/5 text-danger text-[12px] font-extrabold slide-in" role="alert">{{ error }}</div>

  <div v-if="loading" class="flex items-center gap-3 text-sm text-text-muted">
    <span class="h-5 w-5 animate-spin rounded-full border-2 border-accent/20 border-t-accent" aria-hidden="true"></span>
    Memuat pengaturan…
  </div>

  <template v-else-if="settings">
    <!-- Status -->
    <section class="mb-7">
      <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-3">Status</div>
      <div class="flex flex-wrap items-center gap-3 px-4 py-4 rounded-xl border border-border bg-panel-hover">
        <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-[11px] font-extrabold tracking-tight uppercase border" :class="settings.configured ? 'bg-success/8 text-success border-success/20' : 'bg-text-muted/10 text-text-dim border-border'">
          {{ settings.configured ? "Aktif" : settings.sharedKeyAvailable ? "Memakai key server" : "Belum diatur" }}
        </span>
        <span v-if="settings.configured" class="text-sm text-text-muted">
          {{ providerLabel(settings.provider) }} · <span class="font-mono text-text">{{ settings.model }}</span> · key berakhiran
          <span class="font-mono text-text">…{{ settings.apiKeyHint }}</span>
        </span>
        <span v-else class="text-sm text-text-muted">Tanpa API key, bot tetap mencatat standup, tetapi tidak menjawab pertanyaan bebas.</span>
      </div>
      <p v-if="warning" class="mt-3 px-4 py-3 rounded-xl border border-warning/30 bg-warning/5 text-sm text-text slide-in">{{ warning }}</p>
    </section>

    <!-- Form -->
    <section>
      <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-3">{{ settings.configured ? "Ubah API key" : "Masukkan API key" }}</div>

      <div class="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-5" role="radiogroup" aria-label="Penyedia AI">
        <button
          v-for="p in providerOptions"
          :key="p.id"
          type="button"
          role="radio"
          :aria-checked="form.provider === p.id"
          class="min-h-12 rounded-xl border px-3 text-sm font-semibold transition"
          :class="form.provider === p.id ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-muted hover:bg-panel-hover'"
          @click="selectProvider(p.id)"
        >
          {{ p.label }}
        </button>
      </div>

      <p v-if="currentOption.help" class="text-text-muted text-sm mb-5">
        {{ currentOption.help }}
        <a v-if="currentOption.keyUrl" :href="currentOption.keyUrl" target="_blank" rel="noopener" class="font-semibold text-accent hover:underline">Buat API key ›</a>
      </p>

      <form class="grid gap-4" @submit.prevent="save">
        <div v-if="form.provider === 'custom'">
          <label for="ai-base-url" class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Base URL (kompatibel OpenAI)</label>
          <input id="ai-base-url" v-model="form.baseUrl" type="url" placeholder="https://api.contoh.com/v1" required :class="inputClass" />
        </div>
        <div>
          <label for="ai-model" class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Model</label>
          <input id="ai-model" v-model="form.model" type="text" :placeholder="settings.providers[form.provider].model || 'nama-model'" :class="inputClass" />
          <div v-if="modelOptions.length" class="mt-2">
            <p class="text-text-muted text-xs mb-1.5">Gratis dan mendukung tool calling:</p>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="m in modelOptions"
                :key="m.id"
                type="button"
                class="rounded-xl border px-3 py-2 text-left transition"
                :class="activeModel === m.id ? 'border-accent bg-accent/10' : 'border-border hover:bg-panel-hover'"
                :aria-pressed="activeModel === m.id"
                @click="form.model = m.id"
              >
                <span class="block font-mono text-xs font-semibold text-text">{{ m.id }}</span>
                <span class="block text-[11px] text-text-muted">{{ m.note }}</span>
              </button>
            </div>
          </div>
          <p v-else-if="form.provider !== 'custom'" class="mt-1.5 text-text-muted text-xs">Pilih model yang mendukung tool calling; tanpa itu bot tidak bisa membaca data tim.</p>
        </div>
        <div>
          <label for="ai-key" class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">API key</label>
          <input
            id="ai-key"
            v-model="form.apiKey"
            type="password"
            autocomplete="off"
            :placeholder="keepsExistingKey ? `Biarkan kosong untuk tetap memakai …${settings.apiKeyHint}` : 'Tempel API key'"
            :required="!keepsExistingKey"
            :class="inputClass"
          />
          <p class="mt-1.5 text-text-muted text-xs">Disimpan terenkripsi dan tidak pernah ditampilkan kembali.</p>
        </div>

        <div class="flex flex-wrap gap-2">
          <button
            type="submit"
            :disabled="saving"
            class="inline-flex items-center justify-center gap-2.5 px-4 py-3.5 rounded-xl text-[13px] font-extrabold tracking-tight bg-accent text-white shadow-accent transition-all duration-200 ease-in hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <span v-if="saving" class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full spin-slow" aria-hidden="true"></span>
            {{ saving ? "Menguji key…" : "Uji & simpan" }}
          </button>
          <button
            v-if="settings.configured"
            type="button"
            :disabled="saving"
            class="px-4 py-3.5 rounded-xl text-[13px] font-extrabold tracking-tight border border-border text-danger hover:bg-danger/5 disabled:opacity-60"
            @click="remove"
          >
            Hapus key
          </button>
        </div>
      </form>
    </section>
  </template>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { aiApi, ApiError, showToast, type AiProvider, type AiSettings } from "../api";

const providerOptions: { id: AiProvider; label: string; help: string; keyUrl?: string }[] = [
  { id: "gemini", label: "Google Gemini", help: "Ada kuota gratis harian. Buat key di Google AI Studio.", keyUrl: "https://aistudio.google.com/apikey" },
  { id: "groq", label: "Groq", help: "Gratis tanpa kartu kredit, dengan batas permintaan per menit dan per hari. Sangat cepat.", keyUrl: "https://console.groq.com/keys" },
  { id: "openai", label: "OpenAI", help: "Berbayar sesuai pemakaian.", keyUrl: "https://platform.openai.com/api-keys" },
  { id: "openrouter", label: "OpenRouter", help: "Satu key untuk banyak model. Tulis model dengan format penyedia/model.", keyUrl: "https://openrouter.ai/keys" },
  { id: "custom", label: "Lainnya", help: "Penyedia lain yang kompatibel dengan API OpenAI (endpoint /chat/completions)." },
];

const inputClass =
  "w-full px-4 py-3.5 rounded-xl border border-border bg-panel text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none";

const settings = ref<AiSettings | null>(null);
const loading = ref(true);
const saving = ref(false);
const error = ref("");
const warning = ref("");
const form = reactive<{ provider: AiProvider; baseUrl: string; model: string; apiKey: string }>({
  provider: "gemini",
  baseUrl: "",
  model: "",
  apiKey: "",
});

const currentOption = computed(() => providerOptions.find((p) => p.id === form.provider)!);
// The server keeps the stored key only when the endpoint stays the same.
const keepsExistingKey = computed(() => Boolean(settings.value?.configured && settings.value.provider === form.provider && (form.provider !== "custom" || form.baseUrl.replace(/\/+$/, "") === settings.value.baseUrl)));

const modelOptions = computed(() => settings.value?.providers[form.provider].models ?? []);
const activeModel = computed(() => form.model.trim() || settings.value?.providers[form.provider].model || "");

function providerLabel(id: AiProvider | null) {
  return providerOptions.find((p) => p.id === id)?.label ?? "";
}

function selectProvider(id: AiProvider) {
  form.provider = id;
  const current = settings.value;
  form.model = current?.provider === id ? (current.model ?? "") : "";
  form.baseUrl = current?.provider === id ? (current.baseUrl ?? "") : "";
  error.value = "";
}

function fillForm(s: AiSettings) {
  settings.value = s;
  selectProvider(s.provider ?? "gemini");
  form.apiKey = "";
}

async function load() {
  loading.value = true;
  try {
    fillForm(await aiApi.settings());
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Pengaturan AI gagal dimuat.";
  } finally {
    loading.value = false;
  }
}

async function save() {
  error.value = "";
  warning.value = "";
  saving.value = true;
  try {
    const res = await aiApi.save({
      provider: form.provider,
      baseUrl: form.provider === "custom" ? form.baseUrl : undefined,
      model: form.model.trim() || undefined,
      apiKey: form.apiKey.trim() || undefined,
    });
    fillForm(res.settings);
    warning.value = res.warning ? `Key disimpan, tetapi: ${res.warning}` : "";
    showToast("API key berhasil diuji dan disimpan.", "success");
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "API key gagal disimpan.";
  } finally {
    saving.value = false;
  }
}

async function remove() {
  if (!confirm("Hapus API key? Bot akan berhenti menjawab pertanyaan bebas.")) return;
  saving.value = true;
  try {
    fillForm(await aiApi.remove());
    warning.value = "";
    showToast("API key dihapus.", "success");
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "API key gagal dihapus.";
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>
