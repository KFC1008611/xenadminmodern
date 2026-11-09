/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    './src/renderer/src/**/*.{ts,tsx}',
    './src/renderer/index.html',
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        sidebar: "hsl(var(--sidebar))",
        raised: "hsl(var(--raised))",
        subtle: "hsl(var(--subtle))",
        "primary-hover": "hsl(var(--primary-hover))",
        "on-solid": "hsl(var(--on-solid))",
        success: "hsl(var(--success))",
        "success-soft": "hsl(var(--success-soft))",
        "success-solid": "hsl(var(--success-solid))",
        warning: "hsl(var(--warning))",
        "warning-soft": "hsl(var(--warning-soft))",
        "warning-solid": "hsl(var(--warning-solid))",
        danger: "hsl(var(--danger))",
        "danger-soft": "hsl(var(--danger-soft))",
        "danger-solid": "hsl(var(--danger-solid))",
        info: "hsl(var(--info))",
        "info-soft": "hsl(var(--info-soft))",
        "info-solid": "hsl(var(--info-solid))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        xl: "10px",
        lg: "var(--radius)",
        md: "7px",
        sm: "4px",
      },
    },
  },
  plugins: [],
}
