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
        dark: {
          bg: '#06080f',
          card: '#111827',
          card2: '#1a2235',
          border: '#1e293b',
          hover: '#1a2332',
        },
        accent: {
          DEFAULT: '#f97316',
          light: '#fb923c',
          dark: '#ea580c',
        },
        seg: {
          s1: '#f97316',
          s2: '#a855f7',
          s3: '#22c55e',
          s4: '#3b82f6',
        },
      },
      fontFamily: {
        sora: ['Sora', 'sans-serif'],
        mono: ['Space Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
