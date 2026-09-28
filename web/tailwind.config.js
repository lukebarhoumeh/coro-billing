/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        success: { DEFAULT: "hsl(var(--success))", foreground: "hsl(var(--success-foreground))" },
        warning: { DEFAULT: "hsl(var(--warning))", foreground: "hsl(var(--warning-foreground))" },
        danger: { DEFAULT: "hsl(var(--danger))", foreground: "hsl(var(--danger-foreground))" },
        glass: {
          1: "hsl(var(--glass-1))",
          2: "hsl(var(--glass-2))",
          3: "hsl(var(--glass-3))",
        },
        edge: { DEFAULT: "hsl(var(--edge))", hi: "hsl(var(--edge-hi))" },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        glass: "var(--radius-glass)",
      },
      fontFamily: {
        // Midnight Ledger type system: Fraunces carries headings and the big
        // KPI numerals (financial gravitas); Plex Sans carries UI + dense data
        // (excellent tabular figures); Plex Mono carries slugs/SKU codes.
        display: ["Fraunces", "Georgia", "serif"],
        sans: ["'IBM Plex Sans'", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        ledger: "0 1px 0 0 hsl(var(--border)), 0 12px 32px -16px hsl(222 60% 2% / 0.8)",
        "ledger-lift": "0 1px 0 0 hsl(var(--brass) / 0.35), 0 20px 48px -20px hsl(222 60% 2% / 0.9)",
        glass: "0 10px 34px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.05)",
        "glass-lift": "0 16px 44px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.07)",
        "brass-glow": "0 4px 18px hsl(var(--brass-glow))",
      },
      transitionTimingFunction: { glass: "cubic-bezier(0.16, 1, 0.3, 1)" },
      keyframes: {
        "rise-in": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "rise-in": "rise-in 0.45s cubic-bezier(0.22, 1, 0.36, 1) both",
      },
    },
  },
  plugins: [],
};
