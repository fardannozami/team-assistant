<template>
  <button class="button" type="button">
    <slot />
  </button>
</template>

<script setup lang="ts">
// Button component
</script>

<style scoped>
.button {
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  border: 1px solid #e5e7eb;
  background: #ffffff;
  cursor: pointer;
}
</style>
