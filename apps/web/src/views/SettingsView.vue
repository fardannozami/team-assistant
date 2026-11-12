<template>
  <div>
    <div class="mb-6 flex gap-1 overflow-x-auto rounded-2xl border border-border bg-panel p-1 shadow-soft" role="tablist" aria-label="Pengaturan">
      <button
        v-for="s in sections"
        :key="s.id"
        role="tab"
        :aria-selected="section === s.id"
        class="min-h-11 flex-1 whitespace-nowrap rounded-xl px-4 text-sm font-semibold transition"
        :class="section === s.id ? 'bg-accent text-white' : 'text-text-muted hover:bg-panel-hover'"
        @click="emit('section', s.id)"
      >
        {{ s.label }}
      </button>
    </div>
    <component :is="current" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import WhatsAppView from "./WhatsAppView.vue";
import SchedulesView from "./SchedulesView.vue";
import HolidaysView from "./HolidaysView.vue";
import AiView from "./AiView.vue";
import CheckinsView from "./CheckinsView.vue";
import GithubView from "./GithubView.vue";

const props = defineProps<{ section: string }>();
const emit = defineEmits<{ (event: "section", id: string): void }>();

const sections = [
  { id: "whatsapp", label: "WhatsApp", view: WhatsAppView },
  { id: "ai", label: "AI", view: AiView },
  { id: "github", label: "GitHub", view: GithubView },
  { id: "schedules", label: "Jadwal", view: SchedulesView },
  { id: "checkins", label: "Check-in", view: CheckinsView },
  { id: "holidays", label: "Hari libur", view: HolidaysView },
];
const current = computed(() => (sections.find((s) => s.id === props.section) ?? sections[0]!).view);
</script>
