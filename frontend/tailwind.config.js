import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    resolve(__dirname, 'index.html'),
    resolve(__dirname, 'src/**/*.{js,ts,jsx,tsx}'),
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
