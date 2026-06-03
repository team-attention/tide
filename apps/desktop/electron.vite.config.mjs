import { externalizeDepsPlugin } from "electron-vite";

export default {
  main: {
    // Externalize package dependencies so the Backend bundle does not inline
    // heavy Node packages such as the TypeScript compiler. Inlining the
    // compiler crashed Electron utilityProcess startup with
    // ERR_AMBIGUOUS_MODULE_SYNTAX. App `.ts` source (relative imports) stays
    // bundled; only `dependencies` are required from node_modules at runtime.
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          "electron-main": "src/desktop/main/electron-main.ts",
          "backend-entrypoint": "src/backend/infrastructure/node/backend-entrypoint.ts",
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: "src/desktop/preload/index.ts",
        output: {
          format: "cjs",
          entryFileNames: "index.cjs",
        },
      },
    },
  },
  renderer: {
    root: "src/desktop/renderer",
    build: {
      rollupOptions: {
        input: "src/desktop/renderer/index.html",
      },
    },
  },
};
