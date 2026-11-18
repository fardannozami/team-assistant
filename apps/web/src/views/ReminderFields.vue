<template>
  <fieldset class="space-y-4 rounded-xl border border-border p-4">
    <legend class="px-1 text-sm font-semibold text-text">Pengingat & penutupan</legend>
    <div class="grid gap-4 sm:grid-cols-2">
      <div>
        <label :for="`${id}-midday`" class="mb-1.5 block text-sm font-semibold text-text">Pengingat siang</label>
        <input :id="`${id}-midday`" v-model="model.midday" type="time" :class="inputClass" />
      </div>
      <div>
        <label :for="`${id}-afternoon`" class="mb-1.5 block text-sm font-semibold text-text">Pengingat sore</label>
        <input :id="`${id}-afternoon`" v-model="model.afternoon" type="time" :class="inputClass" />
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
  midday: string;
  afternoon: string;
  closeTime: string;
  summaryTime: string;
};

const props = defineProps<{ time: string }>();
const model = defineModel<ReminderSettings>({ required: true });
const id = useId();

const inputClass =
  "min-h-12 w-full rounded-xl border border-border bg-panel px-4 text-base placeholder-text-dim focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20";

// Mirrors the worker: a reminder only goes out between the prompt and the close.
const preview = computed(() => {
  const parts: string[] = [];
  const reminders = [
    { label: "siang", time: model.value.midday },
    { label: "sore", time: model.value.afternoon },
  ].filter((r) => r.time);
  const sendable = reminders.filter(
    (r) => (!props.time || r.time > props.time) && (!model.value.closeTime || r.time < model.value.closeTime),
  );
  if (!reminders.length) parts.push("Tanpa pengingat.");
  else if (sendable.length) parts.push(`Pengingat ke yang belum selesai: ${sendable.map((r) => `${r.label} ${r.time}`).join(", ")}.`);
  if (sendable.length < reminders.length) parts.push("Pengingat harus setelah jam standup dan sebelum jam tutup.");
  if (model.value.summaryTime) parts.push(`Admin menerima daftar yang belum standup pukul ${model.value.summaryTime}.`);
  if (model.value.closeTime) parts.push(`Pukul ${model.value.closeTime} standup ditutup; yang belum selesai tercatat tidak mengisi.`);
  return parts.join(" ");
});
</script>
