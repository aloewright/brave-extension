/** @type {import('tailwindcss').Config} */
export default {
  content: ["./web/index.html", "./web/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#4a4a4e",
        surface: "#5c5d60",
        fg: "#fbfaf4",
        muted: "#d8d5cc",
        accent: "#fbfaf4"
      }
    }
  },
  plugins: []
}
