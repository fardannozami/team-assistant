/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{vue,ts,tsx,js,jsx}",
  ],
  theme: {
    extend: {
      /* ---- color (carried over from the design tokens) ---- */
      colors: {
        transparent: "transparent",
        current: "currentColor",
        bg: "#070910",
        panel: "#0f1322",
        "panel-hover": "#141b2e",
        border: "#1e293b",
        "border-focus": "#5b6bf5",
        text: "#f1f5f9",
        "text-muted": "#94a3b8",
        "text-dim": "#64748b",
        accent: "#5b6bf5",
        "accent-hover": "#4657e8",
        danger: "#e95a6b",
        "danger-hover": "#c44656",
        success: "#34d399",
        warning: "#fbbf24",
      },
      /* ---- radius ---- */
      borderRadius: {
        sm: "12px",
        DEFAULT: "18px",
        lg: "26px",
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
        shadow: "0 30px 60px -15px rgba(0, 0, 0, 0.55)",
        lg: "0 40px 90px -20px rgba(0, 0, 0, 0.62)",
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
