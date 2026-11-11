<template>
  <fieldset class="space-y-4 rounded-xl border border-border p-4">
    <legend class="px-1 text-sm font-semibold text-text">Pengingat & penutupan</legend>
    <div class="grid gap-4 sm:grid-cols-2">
      <div>
        <label :for="`${id}-first`" class="mb-1.5 block text-sm font-semibold text-text">Pengingat pertama (menit setelah standup)</label>
        <input :id="`${id}-first`" v-model.number="model.reminder" type="number" min="0" max="1440" placeholder="Kosong = tanpa pengingat" :class="inputClass" />
      </div>
      <div>
        <label :for="`${id}-repeat`" class="mb-1.5 block text-sm font-semibold text-text">Ulangi tiap (menit)</label>
        <input :id="`${id}-repeat`" v-model.number="model.repeat" type="number" min="15" max="720" placeholder="Kosong = sekali saja" :disabled="!hasReminder" :class="[inputClass, 'disabled:opacity-50']" />
      </div>
      <div>
        <label :for="`${id}-close`" class="mb-1.5 block text-sm font-semibold text-text">Standup ditutup jam</label>
        <input :id="`${id}-close`" v-model="model.closeTime" type="time" :class="inputClass" />
      </div>
      <div>
        <label :for="`${id}-summary`" class="mb-1.5 block text-sm font-semibold text-text">Ringkasan ke admin jam</label>
        <input :id="`${id}-summary`" v-model="model.summaryTime" type="time" :class="inputClass" />
      </div>
    </div>
    <p class="text-sm text-text-muted">{{ preview }}</p>
  </fieldset>
</template>

<script setup lang="ts">
import { computed, useId } from "vue";

export type ReminderSettings = {
  reminder: number | "" | null;
  repeat: number | "" | null;
  closeTime: string;
  summaryTime: string;
};

const props = defineProps<{ time: string }>();
const model = defineModel<ReminderSettings>({ required: true });
const id = useId();

const inputClass =
  "min-h-12 w-full rounded-xl border border-border bg-panel px-4 text-base placeholder-text-dim focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20";

const hasReminder = computed(() => typeof model.value.reminder === "number" && model.value.reminder > 0);

const toMinutes = (t: string) => {
  const [h = 0, m = 0] = t.split(":").map(Number);
  return h * 60 + m;
};
const toTime = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

// Mirrors the worker's schedule so admins see exactly when reminders go out.
const preview = computed(() => {
  const parts: string[] = [];
  if (hasReminder.value && props.time) {
    const end = model.value.closeTime ? toMinutes(model.value.closeTime) : 1440;
    const step = typeof model.value.repeat === "number" && model.value.repeat > 0 ? model.value.repeat : 0;
    const times: string[] = [];
    for (let t = toMinutes(props.time) + (model.value.reminder as number); t < end && times.length < 24; t += step) {
      times.push(toTime(t));
      if (!step) break;
    }
    parts.push(times.length ? `Pengingat ke yang belum selesai: ${times.join(", ")}.` : "Pengingat jatuh setelah jam tutup, jadi tidak terkirim.");
  } else {
    parts.push("Tanpa pengingat.");
  }
  if (model.value.summaryTime) parts.push(`Admin menerima daftar yang belum standup pukul ${model.value.summaryTime}.`);
  if (model.value.closeTime) parts.push(`Pukul ${model.value.closeTime} standup ditutup; yang belum selesai tercatat tidak mengisi.`);
  return parts.join(" ");
});
</script>
