import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#040508",
        surface: "#0F0E1A",
        surface2: "#141228",
        primary: "#5B4FE8",
        green: "#00C896",
        gold: "#D4A847",
        border: "rgba(255,255,255,0.06)",
        ritual: {
          bg: "#0D0D0D",
          elevated: "#161616",
          surface: "#1E1E1E",
        },
        rebal: {
          card: "#0F0E1A",
          border: "rgba(255,255,255,0.06)",
          primary: "#5B4FE8",
          primaryHover: "#4A3FD7",
          success: "#00C896",
          danger: "#FF4757",
        },
        accent: {
          green: "#00C896",
          lime: "#BFFF00",
          pink: "#5B4FE8",
          gold: "#D4A847",
          red: "#FF4757",
        },
      },
      fontFamily: {
        mono: ["Space Mono", "ui-monospace", "monospace"],
        sans: ["Inter", "sans-serif"],
        display: ["var(--font-inter)", "system-ui", "sans-serif"],
        body: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      borderColor: {
        DEFAULT: "rgba(255,255,255,0.06)",
        primary: "#5B4FE8",
        green: "#00C896",
        gold: "#D4A847",
      },
      ringColor: {
        primary: "#5B4FE8",
        green: "#00C896",
        gold: "#D4A847",
      },
      boxShadow: {
        tee: "0 0 20px rgba(0,200,150,0.25)",
        glow: "0 0 40px rgba(91,79,232,0.3)",
        logo: "0 8px 40px rgba(72,120,240,0.35), 0 0 80px rgba(24,48,168,0.2)",
      },
    },
  },
  plugins: [],
} satisfies Config;
