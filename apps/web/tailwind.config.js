/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        primary: 'rgb(var(--color-primary) / <alpha-value>)',
        ink: 'rgb(var(--color-ink) / <alpha-value>)',
        dark: 'rgb(var(--color-ink) / <alpha-value>)',
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        mist: 'rgb(var(--color-mist) / <alpha-value>)',
        success: 'rgb(var(--color-success) / <alpha-value>)',
        warning: 'rgb(var(--color-warning) / <alpha-value>)',
        danger: 'rgb(var(--color-danger) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-sans)', 'ui-sans-serif', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 0 rgba(11, 18, 32, 0.04), 0 12px 32px -16px rgba(11, 18, 32, 0.18)',
        lift: '0 18px 40px -24px rgba(11, 18, 32, 0.28)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.45s ease-out both',
      },
    },
  },
  plugins: [],
};
