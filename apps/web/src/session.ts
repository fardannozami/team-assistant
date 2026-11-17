import { computed, ref } from "vue";

/** The signed-in user's dashboard role, set by the shell once /auth/me loads. */
export const currentRole = ref<string | null>(null);

// Mirrors the API's requireRole("Owner", "Admin") on settings and write endpoints.
export const isAdmin = computed(() => currentRole.value === "Owner" || currentRole.value === "Admin");
