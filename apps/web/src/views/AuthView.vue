<template>
  <div class="login-card">
    <div class="login-brand">
      <div class="brand-mark">TA</div>
      <div class="brand-name">Team Assistant</div>
    </div>
    <h1 class="login-title">Sign in</h1>
    <p class="login-sub">Use your administrator account to open the dashboard.</p>

    <form @submit.prevent="handleSubmit" class="form">
      <div class="field" :class="{ 'field--error': error }">
        <label class="field-label">Email address</label>
        <input
          v-model="email"
          name="email"
          type="email"
          autocomplete="email"
          placeholder="you@company.com"
          :disabled="loading"
          @input="error = ''"
        />
      </div>
      <div class="field" :class="{ 'field--error': error }">
        <label class="field-label">Password</label>
        <input
          v-model="password"
          name="password"
          type="password"
          autocomplete="current-password"
          placeholder="••••••••"
          :disabled="loading"
          @input="error = ''"
        />
      </div>
      <p v-if="error" class="field-error-text">{{ error }}</p>
      <button class="btn btn--primary" type="submit" :disabled="loading">
        <span v-if="loading" class="spinner-small" aria-hidden="true"></span>
        {{ loading ? "Signing in…" : "Sign in" }}
      </button>
    </form>

    <p class="footer-note">
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
