/** @type {import('tailwindcss').Config} */
const withAlpha = (v) => `rgb(var(${v}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Theme-able surface + text tokens (driven by CSS vars in index.css)
        canvas: withAlpha('--canvas'),
        surface: {
          DEFAULT: withAlpha('--surface'),
          2: withAlpha('--surface-2'),
          3: withAlpha('--surface-3'),
        },
        line: withAlpha('--line'),
        'line-strong': withAlpha('--line-strong'),
        ink: {
          DEFAULT: withAlpha('--ink'),
          muted: withAlpha('--ink-muted'),
          subtle: withAlpha('--ink-subtle'),
        },
        // Brand + semantic (stable across themes)
        brand: {
          DEFAULT: withAlpha('--brand'),
          soft: withAlpha('--brand-soft'),
          foreground: withAlpha('--brand-foreground'),
        },
        teal: withAlpha('--teal'),
        success: withAlpha('--success'),
        warning: withAlpha('--warning'),
        danger: withAlpha('--danger'),
        info: withAlpha('--info'),
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.02em' }],
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        soft: '0 1px 2px rgba(0,0,0,0.18), 0 1px 1px rgba(0,0,0,0.12)',
        card: '0 2px 8px -2px rgba(0,0,0,0.30), 0 8px 24px -8px rgba(0,0,0,0.40)',
        pop: '0 8px 28px -6px rgba(0,0,0,0.5), 0 2px 6px rgba(0,0,0,0.35)',
        glow: '0 0 0 1px rgb(var(--brand) / 0.35), 0 8px 32px -8px rgb(var(--brand) / 0.45)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, rgb(var(--brand)) 0%, rgb(var(--teal)) 100%)',
        'grid-faint':
          'linear-gradient(rgb(var(--line) / 0.6) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--line) / 0.6) 1px, transparent 1px)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        shimmer: 'shimmer 1.6s infinite',
        'pulse-soft': 'pulse-soft 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
}
