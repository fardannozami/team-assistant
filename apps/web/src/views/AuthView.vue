<template>
  <div class="w-full max-w-[400px]">
    <div class="mb-8 flex flex-col items-center text-center">
      <div class="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-accent font-display text-lg font-extrabold text-white shadow-accent">TA</div>
      <h1 class="font-display text-3xl font-extrabold tracking-tight text-text">Team Assistant</h1>
      <p class="mt-2 text-text-muted">Standup harian tim lewat WhatsApp.</p>
    </div>

    <div class="bg-panel border border-border rounded-2xl shadow-soft-lg p-6 sm:p-8 reveal-slow">
      <div v-if="error" class="mb-6 px-4 py-3.5 rounded-xl border border-danger/30 bg-danger/5 text-danger text-[12px] font-extrabold slide-in">{{ error }}</div>

      <form @submit.prevent="handleSubmit" class="flex flex-col gap-4">
        <div>
          <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Alamat email</label>
          <input
            v-model="email"
            name="email"
            type="email"
            autocomplete="email"
            placeholder="nama@perusahaan.com"
            :disabled="loading"
            @input="error = ''"
            class="w-full px-4 py-3.5 rounded-xl border text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none bg-panel border-border"
            :class="{ 'border-danger': error, 'border-border': !error }"
          />
        </div>
        <div>
          <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Kata sandi</label>
          <input
            v-model="password"
            name="password"
            type="password"
            autocomplete="current-password"
            placeholder="••••••••"
            :disabled="loading"
            @input="error = ''"
            class="w-full px-4 py-3.5 rounded-xl border text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none bg-panel border-border"
            :class="{ 'border-danger': error, 'border-border': !error }"
          />
        </div>
        <button
          type="submit"
          :disabled="loading"
          class="inline-flex items-center justify-center gap-2.5 px-4 py-4 rounded-xl text-[15px] font-extrabold tracking-tight bg-accent text-white shadow-accent transition-all duration-200 ease-in hover:bg-accent-hover hover:shadow-[0_0_0_12px_rgba(63,68,226,0.45)] active:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
        >
          <span v-if="loading" class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full spin-slow" aria-hidden="true"></span>
          {{ loading ? "Sedang masuk…" : "Masuk" }}
        </button>
      </form>

      <template v-if="googleEnabled">
        <div class="my-5 flex items-center gap-3 text-xs text-text-muted">
          <span class="h-px flex-1 bg-border"></span>atau<span class="h-px flex-1 bg-border"></span>
        </div>
        <a
          :href="authApi.googleLoginUrl"
          class="flex min-h-12 items-center justify-center gap-3 rounded-xl border border-border bg-panel px-4 text-[15px] font-bold text-text transition hover:bg-panel-hover"
          :class="{ 'pointer-events-none opacity-60': loading }"
        >
          <svg class="h-5 w-5" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
          </svg>
          Masuk dengan Google
        </a>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ApiError, authApi } from "../api";

const props = defineProps<{ initialError?: string }>();
const emit = defineEmits<{ (e: "login"): void }>();

const email = ref("");
const password = ref("");
const loading = ref(false);
const error = ref(props.initialError ?? "");
const googleEnabled = ref(false);

onMounted(async () => {
  googleEnabled.value = (await authApi.providers()).google;
});

async function handleSubmit() {
  error.value = "";
  loading.value = true;
  try {
    await authApi.login(email.value.trim(), password.value);
    emit("login");
  } catch (err) {
    error.value =
      err instanceof ApiError ? err.message : "Terjadi kesalahan. Silakan coba lagi.";
  } finally {
    loading.value = false;
  }
}
</script>
