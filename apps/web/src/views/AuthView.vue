<template>
  <div class="flex items-center justify-center min-h-screen px-6">
    <div class="w-full max-w-[780px]">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-0 items-center">
        <!-- Brand panel -->
        <div>
          <div class="flex items-center gap-2.5 mb-6">
            <div class="w-10 h-10 rounded-xl bg-accent text-white text-[17px] font-display font-extrabold grid place-items-center shadow-accent">TA</div>
            <div class="font-display font-extrabold text-[20px] tracking-tight text-text">Team Assistant</div>
          </div>
          <h1 class="text-[44px] font-display font-extrabold tracking-tight text-text mb-2 lg:mb-6">Welcome back.</h1>
          <p class="text-text-muted text-lg mb-10 lg:mb-14">Sign in to your administrator account to open the dashboard.</p>
          <p class="text-[13px] text-text-dim">Team Assistant admin dashboard · API base: {{ apiBase }}</p>
        </div>

        <!-- Sign-in form -->
        <div class="bg-panel border border-border rounded-2xl shadow-soft-lg p-8 lg:p-12 reveal-slow">
          <h2 class="text-[24px] font-display font-extrabold tracking-tight text-text mb-1">Sign in</h2>
          <p class="text-text-muted text-sm mb-10">Use your administrator account.</p>

          <div v-if="error" class="mb-6 px-4 py-3.5 rounded-xl border border-danger/30 bg-danger/5 text-danger text-[12px] font-extrabold slide-in">{{ error }}</div>

          <form @submit.prevent="handleSubmit" class="flex flex-col gap-5">
            <div>
              <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Email address</label>
              <input
                v-model="email"
                name="email"
                type="email"
                autocomplete="email"
                placeholder="you@company.com"
                :disabled="loading"
                @input="error = ''"
                class="w-full px-4 py-3.5 rounded-xl border text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none bg-panel border-border"
                :class="{ 'border-danger': error, 'border-border': !error }"
              />
            </div>
            <div>
              <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Password</label>
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
              {{ loading ? "Signing in…" : "Sign in" }}
            </button>
          </form>
        </div>
      </div>
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
