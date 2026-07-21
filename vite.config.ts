import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
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
    resolve: {
        tsconfigPaths: true
    },
    plugins: [
        tailwindcss(),
    ]
})

/// <reference types="vite/client" />
