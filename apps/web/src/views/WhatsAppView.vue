<template>
  <div class="page-head">
    <div>
      <h2 class="page-title">WhatsApp</h2>
      <p class="page-desc">
        Connect the Team Assistant bot to WhatsApp so it can message employees
        and receive replies.
      </p>
    </div>
  </div>

  <div v-if="error" class="alert alert--error">{{ error }}</div>

  <!-- Connection status -->
  <div class="card">
    <div class="card-title">Connection status</div>

    <div class="wa-status">
      <div class="wa-status-item">
        <span class="wa-status-label">Bot</span>
        <span class="badge" :class="status.connected ? 'badge--active' : 'badge--inactive'"
          >{{ status.connected ? "Connected" : "Disconnected" }}</span
        >
      </div>
      <div class="wa-status-item">
        <span class="wa-status-label">Registered</span>
        <span class="badge" :class="status.registered ? 'badge--active' : 'badge--inactive'"
          >{{ status.registered ? "Registered" : "Not registered" }}</span
        >
      </div>
      <div class="wa-status-item" v-if="status.pairingCode">
        <span class="wa-status-label">Pairing code</span>
        <span class="wa-code mono">{{ status.pairingCode }}</span>
      </div>
    </div>

    <div class="wa-actions">
      <button
        class="btn btn--primary"
        @click="startBot"
        :disabled="loadingStart || status.connected"
      >
        {{ loadingStart ? "Starting…" : "Start bot" }}
      </button>
      <button
        class="btn btn--danger"
        @click="stopBot"
        :disabled="loadingStop || !status.connected"
      >
        {{ loadingStop ? "Stopping…" : "Stop bot" }}
      </button>
    </div>

    <p
      v-if="status.phone"
      class="field-helper"
      style="margin-top: 10px"
    >
      Linked number: <span class="mono">{{ status.phone }}</span>
    </p>
  </div>

  <!-- QR code -->
  <div class="card">
    <div class="card-title">QR code</div>

    <div class="wa-qr">
      <div v-if="qrLoading" class="loading" style="padding: 26px 20px">
        <span class="spinner-small"></span> Loading QR…
      </div>

      <div v-else-if="qrCode" class="wa-qr-display">
        <img :src="qrImageUrl" :alt="''" class="wa-qr-img" />
        <p class="wa-qr-hint">
          Scan this QR with WhatsApp &rarr; Linked Devices
        </p>
      </div>

      <div v-else class="wa-qr-empty">
        <p class="wa-qr-hint">No QR available (connected or waiting).</p>
        <p class="field-helper" style="margin: 0">
          Start the bot above to generate a pairing QR code.
        </p>
      </div>
    </div>
  </div>

  <!-- Pairing code -->
  <div class="card">
    <div class="card-title">Pair by phone number</div>

    <p class="field-helper">
      Enter your WhatsApp number with country code (for example
      <span class="mono">+62 812-3456-7890</span>). The bot will send a pairing
      code to that number.
    </p>

    <form @submit.prevent="pairPhone" class="form form--grid">
      <div class="field" :class="{ 'field--error': pairError }">
        <label class="field-label">Phone number</label>
        <input
          v-model="pairPhoneNumber"
          type="tel"
          placeholder="+62 812-3456-7890"
          required
          @input="pairError = ''"
        />
      </div>
      <p v-if="pairError" class="field-error-text">{{ pairError }}</p>
      <div class="field field--actions">
        <button
          class="btn btn--primary"
          type="submit"
          :disabled="pairing"
        >
          {{ pairing ? "Pairing…" : "Send pairing code" }}
        </button>
      </div>
    </form>

    <div v-if="pairingCode" class="wa-pair-result">
      <span class="wa-code-label">Pairing code</span>
      <span class="wa-code">{{ pairingCode }}</span>
      <p class="field-helper" style="margin-top: 8px; margin-bottom: 0">
        Enter this code in WhatsApp &rarr; Linked Devices &rarr; Link with phone
        number instead.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import {
  whatsappApi,
  ApiError,
  showToast,
  type WhatsAppStatus,
} from "../api";

const status = ref<WhatsAppStatus>({
  connected: false,
  registered: false,
  pairingCode: null,
  phone: null,
});
const qrCode = ref<string | null>(null);
const qrLoading = ref(false);
const error = ref("");

const loadingStart = ref(false);
const loadingStop = ref(false);

const pairPhoneNumber = ref("");
const pairing = ref(false);
const pairError = ref("");
const pairingCode = ref<string | null>(null);

const qrImageUrl = computed(() =>
  qrCode.value
    ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qrCode.value)}`
    : ""
);

let statusTimer: number | null = null;
let qrTimer: number | null = null;

function startPolling() {
  fetchStatus();
  fetchQr();
  statusTimer = window.setInterval(fetchStatus, 5000);
  qrTimer = window.setInterval(fetchQr, 3000);
}

function stopPolling() {
  if (statusTimer !== null) {
    window.clearInterval(statusTimer);
    statusTimer = null;
  }
  if (qrTimer !== null) {
    window.clearInterval(qrTimer);
    qrTimer = null;
  }
}

async function fetchStatus() {
  try {
    status.value = await whatsappApi.status();
  } catch {
    // Background polls stay silent; errors are surfaced through explicit actions.
  }
}

async function fetchQr() {
  qrLoading.value = true;
  try {
    const res = await whatsappApi.qr();
    qrCode.value = res.qr ?? null;
  } catch {
    // Keep the last known QR on transient failures.
  } finally {
    qrLoading.value = false;
  }
}

async function startBot() {
  loadingStart.value = true;
  error.value = "";
  try {
    await whatsappApi.start();
    showToast("WhatsApp bot starting.", "success");
    await fetchStatus();
  } catch (err) {
    error.value =
      err instanceof ApiError ? err.message : "Failed to start the bot.";
  } finally {
    loadingStart.value = false;
  }
}

async function stopBot() {
  loadingStop.value = true;
  error.value = "";
  try {
    await whatsappApi.stop();
    showToast("WhatsApp bot stopped.", "success");
    await fetchStatus();
  } catch (err) {
    error.value =
      err instanceof ApiError ? err.message : "Failed to stop the bot.";
  } finally {
    loadingStop.value = false;
  }
}

async function pairPhone() {
  pairError.value = "";
  if (!pairPhoneNumber.value.trim()) {
    pairError.value = "Enter a phone number.";
    return;
  }

  pairing.value = true;
  try {
    const res = await whatsappApi.pair(pairPhoneNumber.value.trim());
    pairingCode.value = res.pairingCode ?? null;
    showToast("Pairing code sent to your number.", "success");
  } catch (err) {
    pairError.value =
      err instanceof ApiError ? err.message : "Failed to send pairing code.";
  } finally {
    pairing.value = false;
  }
}

onMounted(startPolling);
onUnmounted(stopPolling);
</script>

<style scoped>
.wa-status {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}
.wa-status-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: #0b1020;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.wa-status-label {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.wa-code {
  margin-left: auto;
  font: 13px var(--font-mono);
  letter-spacing: 0.05em;
  color: var(--accent);
  background: var(--panel-hover);
  border: 1px solid var(--border);
  padding: 2px 8px;
  border-radius: 6px;
}
.wa-actions {
  display: flex;
  gap: 10px;
  margin-top: 8px;
}
.wa-qr {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding-top: 6px;
}
.wa-qr-img {
  width: 220px;
  height: 220px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #0b1020;
  box-shadow: var(--shadow);
}
.wa-qr-hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
  text-align: center;
}
.wa-qr-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
  padding: 30px 20px;
  text-align: center;
}
.wa-pair-result {
  margin-top: 14px;
  padding: 16px;
  background: #0b1020;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  text-align: center;
}
.wa-code-label {
  display: block;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.wa-pair-result .wa-code {
  color: var(--success);
  border-color: var(--success-glow);
  display: inline-block;
}
</style>