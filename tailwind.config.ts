import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ritual: {
          bg: "#0D0D0D",
          elevated: "#161616",
          surface: "#1E1E1E",
        },
        rebal: {
          card: "#161616",
          border: "#1E1E1E",
          primary: "#7C3AED",
          primaryHover: "#6D28D9",
          success: "#10B981",
          danger: "#EF4444",
        },
        accent: {
          green: "#10B981",
          lime: "#BFFF00",
          pink: "#7C3AED",
          gold: "#FACC15",
          red: "#EF4444",
        },
      },
      fontFamily: {
        display: ["var(--font-inter)", "system-ui", "sans-serif"],
        body: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-space-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        tee: "0 0 20px rgba(25,209,132,0.25)",
      },
    },
  },
  plugins: [],
} satisfies Config;
