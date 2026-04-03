import { defineConfig } from "vite";
import electron from "vite-plugin-electron";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
    plugins: [
        tailwindcss()
    ]
})