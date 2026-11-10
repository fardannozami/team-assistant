<template>
  <div class="w-full max-w-[420px] p-11 bg-panel border border-border rounded-lg shadow-lg reveal-slow">
    <div class="flex items-center gap-2.5 font-extrabold text-[20px] tracking-tight mb-[30px]">
      <div class="w-8 h-8 rounded-[10px] bg-accent text-white text-[15px] grid place-items-center shadow-[0_0_0_5px_rgba(91,107,245,0.45)]">TA</div>
      <div class="font-extrabold text-[20px] tracking-tight">Team Assistant</div>
    </div>
    <h1 class="text-[30px] font-display font-extrabold tracking-tight mb-1.5">Sign in</h1>
    <p class="text-text-muted text-sm mb-[30px]">Use your administrator account to open the dashboard.</p>

    <form @submit.prevent="handleSubmit" class="flex flex-col gap-5">
      <div class="mb-[18px]">
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-muted mb-2">Email address</label>
        <input
          v-model="email"
          name="email"
          type="email"
          autocomplete="email"
          placeholder="you@company.com"
          :disabled="loading"
          @input="error = ''"
          class="w-full px-3.5 py-[11px] rounded-sm border text-sm placeholder-text-dim transition-all duration-200 ease-in focus:ring-4 focus:-translate-y-1 bg-[#0b1020]"
          :class="{ 'border-border focus:ring-accent/50': !error, 'border-danger focus:ring-danger/40': error }"
        />
      </div>
      <div class="mb-[18px]">
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-muted mb-2">Password</label>
        <input
          v-model="password"
          name="password"
          type="password"
          autocomplete="current-password"
          placeholder="••••••••"
          :disabled="loading"
          @input="error = ''"
          class="w-full px-3.5 py-[11px] rounded-sm border text-sm placeholder-text-dim transition-all duration-200 ease-in focus:ring-4 focus:-translate-y-1 bg-[#0b1020]"
          :class="{ 'border-border focus:ring-accent/50': !error, 'border-danger focus:ring-danger/40': error }"
        />
      </div>
      <p v-if="error" class="text-danger text-[11px] font-extrabold mt-2 slide-in">{{ error }}</p>
      <button
        class="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-sm text-[12px] font-extrabold tracking-tight bg-accent text-white shadow-[0_0_0_4px_rgba(91,107,245,0.45)] transition-all duration-200 ease-in hover:bg-accent-hover hover:shadow-[0_0_0_10px_rgba(91,107,245,0.45)] active:shadow-[0_0_0_4px_rgba(91,107,245,0.45)] whitespace-nowrap leading-none disabled:opacity-45"
        type="submit"
        :disabled="loading"
      >
        <span v-if="loading" class="w-[18px] h-[18px] border-[2.5px] border-white/25 border-t-white rounded-full spin-slow" aria-hidden="true"></span>
        {{ loading ? "Signing in…" : "Sign in" }}
      </button>
    </form>

    <p class="mt-[30px] pt-5.5 border-t border-border text-[12px] text-text-muted text-center">
      Team Assistant admin dashboard &middot; API base: {{ apiBase }}
    </p>
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

const apiBase =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:4000";

async function handleSubmit() {
  error.value = "";
  loading.value = true;
  try {
    await authApi.login(email.value.trim(), password.value);
    emit("login");
  } catch (err) {
    error.value =
      err instanceof ApiError ? err.message : "Unexpected error. Please try again.";
  } finally {
    loading.value = false;
  }
}
</script>
