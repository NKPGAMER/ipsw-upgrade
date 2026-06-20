import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { resolve } from "path";

export default defineConfig({
    root: "src",
    base: "./",
    build: {
        outDir: "../dist",
        emptyOutDir: true,
        rollupOptions: {
            input: {
                index: resolve(__dirname, "src/index.html"),
                splash: resolve(__dirname, "src/splash.html")
            }
        }
    },
    plugins: [
        tailwindcss(),
        tsconfigPaths()
    ]
})

/// <reference types="vite/client" />
