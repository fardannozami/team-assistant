<template>
  <div class="text-[12px] text-text-muted">
    <p class="font-bold text-text">{{ activity.summary }}</p>
    <ul v-if="activity.shown.length" class="mt-1 space-y-0.5">
      <li v-for="item in activity.shown" :key="`${item.type}:${item.url ?? item.title}`" class="truncate">
        <a v-if="item.url" :href="item.url" target="_blank" rel="noopener" class="hover:text-accent hover:underline">{{ item.title }}</a>
        <span v-else>{{ item.title }}</span>
        <span v-if="item.repository" class="text-text-dim"> · {{ item.repository }}</span>
      </li>
      <li v-if="activity.more" class="text-text-dim">dan {{ activity.more }} lainnya</li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { StandupGithubActivity } from "../api";

defineProps<{ activity: StandupGithubActivity }>();
</script>
