import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
    base: "./",
    plugins: [
        tailwindcss(),
        tsconfigPaths()
    ]
})

/// <reference types="vite/client" />