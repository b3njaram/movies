/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  future: { hoverOnlyWhenSupported: true },
  theme: {
    extend: {
      colors: {
        nf: {
          red: '#E50914',
          redDark: '#B20710',
          black: '#141414',
          card: '#181818',
          gray: '#2F2F2F',
          muted: '#B3B3B3',
        },
      },
      fontFamily: {
        logo: ['"Bebas Neue"', 'Impact', '"Arial Narrow"', 'sans-serif'],
        sans: ['"Netflix Sans"', '"Helvetica Neue"', 'Helvetica', 'Arial', 'sans-serif'],
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        fadeInUp: {
          from: { opacity: '0', transform: 'translateY(18px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          from: { opacity: '0', transform: 'scale(0.94) translateY(12px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        dropIn: {
          from: { opacity: '0', transform: 'translateY(-8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-600px 0' },
          '100%': { backgroundPosition: '600px 0' },
        },
        kenburns: {
          from: { transform: 'scale(1)' },
          to: { transform: 'scale(1.07)' },
        },
        logoIn: {
          '0%': { opacity: '0', transform: 'scale(0.85)', letterSpacing: '0.35em' },
          '100%': { opacity: '1', transform: 'scale(1)', letterSpacing: '0.04em' },
        },
        pop: {
          '0%': { transform: 'scale(0.6)', opacity: '0' },
          '60%': { transform: 'scale(1.12)', opacity: '1' },
          '100%': { transform: 'scale(1)' },
        },
        slideLeft: {
          from: { opacity: '0', transform: 'translateX(24px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        fadeIn: 'fadeIn .5s ease-out both',
        fadeInUp: 'fadeInUp .6s cubic-bezier(.2,.8,.2,1) both',
        scaleIn: 'scaleIn .35s cubic-bezier(.2,.8,.2,1) both',
        dropIn: 'dropIn .2s ease-out both',
        shimmer: 'shimmer 1.6s linear infinite',
        kenburns: 'kenburns 28s ease-out forwards',
        logoIn: 'logoIn 1.1s cubic-bezier(.2,.8,.2,1) both',
        pop: 'pop .35s ease-out both',
        slideLeft: 'slideLeft .4s ease-out both',
      },
    },
  },
  plugins: [],
};
