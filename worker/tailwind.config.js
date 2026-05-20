/** @type {import('tailwindcss').Config} */
export default {
  content: ["./web/index.html", "./web/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0b0d11",
        fg: "#e8eaed",
        muted: "#9aa0a6",
        accent: "#d97706"
      }
    }
  },
  plugins: []
}
