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
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { ApiError, authApi } from "../api";

const emit = defineEmits<{ (e: "login"): void }>();

const email = ref("");
const password = ref("");
const loading = ref(false);
const error = ref("");

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
