/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{vue,ts,tsx,js,jsx}",
  ],
  theme: {
    extend: {
      /* ---- color (light palette carried from design tokens) ---- */
      colors: {
        transparent: "transparent",
        current: "currentColor",
        bg: "#f7f6f2",
        panel: "#ffffff",
        "panel-hover": "#f0efe6",
        border: "#e3e1d8",
        "border-focus": "#3f44e2",
        text: "#1c1c1c",
        "text-muted": "#7a7870",
        "text-dim": "#57554f",
        accent: "#3f44e2",
        "accent-hover": "#3238c9",
        danger: "#c74a5c",
        "danger-hover": "#a83d4e",
        success: "#2e9e7f",
        "success-hover": "#27856a",
        warning: "#c4942e",
        "warning-hover": "#a87d28",
      },
      /* ---- radius ---- */
      borderRadius: {
        sm: "10px",
        DEFAULT: "16px",
        lg: "24px",
        full: "9999px",
      },
      /* ---- type ---- */
      fontFamily: {
        sans: ["var(--font-body)"],
        display: ["var(--font-display)"],
        mono: ["var(--font-mono)"],
      },
      /* ---- shadow ---- */
      boxShadow: {
        soft: "0 18px 36px -12px rgba(20, 22, 28, 0.07)",
        "soft-lg": "0 28px 56px -18px rgba(20, 22, 28, 0.09)",
        accent: "0 0 0 5px rgba(63, 68, 226, 0.25)",
      },
      /* ---- motion ---- */
      transitionTimingFunction: {
        "ease-in": "cubic-bezier(0.4, 0, 0.2, 1)",
        "ease-out": "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
}
