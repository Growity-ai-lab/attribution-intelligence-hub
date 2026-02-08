/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        po: {
          red: '#E30613',
          dark: '#1A1A2E',
          blue: '#16213E',
          accent: '#0F3460',
          gold: '#E2B714',
        },
      },
    },
  },
  plugins: [],
}
