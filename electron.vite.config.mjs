export default {
  main: {
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
