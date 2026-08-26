import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        success: { DEFAULT: "hsl(var(--success))", foreground: "hsl(var(--success-foreground))" },
        warning: { DEFAULT: "hsl(var(--warning))", foreground: "hsl(var(--warning-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      // Escala de espaçamento nomeada (SPEC redesign — Etapa 2). Aditiva: a escala
      // numérica padrão do Tailwind (p-4, gap-6...) continua disponível e usada no
      // resto do app — estes nomes existem pra quem quiser referenciar a escala
      // 4/8/16/24/32/48 de forma semântica em componentes novos.
      spacing: {
        xs: "4px",
        sm: "8px",
        md: "16px",
        lg: "24px",
        xl: "32px",
        "2xl": "48px",
      },
      // Hierarquia tipográfica (SPEC redesign — Etapa 2) — nomeia o padrão de
      // tamanhos que já é usado informalmente pelo app (text-xl font-extrabold para
      // título de página, text-sm font-bold para header de card, text-xs para
      // rótulos, text-[11px]/text-[10px] para badges/meta). Ver src/DESIGN_TOKENS.md.
      fontSize: {
        display: ["1.25rem", { lineHeight: "1.75rem", fontWeight: "800" }],
        heading: ["0.875rem", { lineHeight: "1.25rem", fontWeight: "700" }],
        body: ["0.875rem", { lineHeight: "1.25rem", fontWeight: "500" }],
        label: ["0.75rem", { lineHeight: "1rem", fontWeight: "500" }],
        caption: ["0.6875rem", { lineHeight: "0.875rem", fontWeight: "500" }],
        micro: ["0.625rem", { lineHeight: "0.75rem", fontWeight: "600" }],
      },
      // Sombras sutis (SPEC redesign — Etapa 2) — mesmos valores que já existiam
      // hardcoded em .card-glass/.card-glass-sm/.glow-primary/.glow-accent
      // (src/index.css), agora com var(--border)/var(--primary)/var(--accent) como
      // fonte única em vez de literais hsl(...) duplicados.
      boxShadow: {
        subtle:
          "0 0 0 1px hsl(var(--border) / 0.5), 0 8px 40px -12px hsl(var(--shadow-color) / var(--shadow-strength))",
        "subtle-sm":
          "0 0 0 1px hsl(var(--border) / 0.5), 0 4px 24px -8px hsl(var(--shadow-color) / var(--shadow-strength-sm))",
        glow: "0 0 20px -4px hsl(var(--primary) / 0.25), 0 0 6px -2px hsl(var(--primary) / 0.15)",
        "glow-accent": "0 0 20px -4px hsl(var(--accent) / 0.25)",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
        "pulse-glow": {
          "0%, 100%": { boxShadow: "0 0 20px -4px hsl(var(--primary) / 0.25)" },
          "50%": { boxShadow: "0 0 30px -2px hsl(var(--primary) / 0.4)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
