export default {
  main: {
    build: {
      rollupOptions: {
        input: "src/desktop/main/electron-main.ts",
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: "src/desktop/preload/index.ts",
      },
    },
  },
  renderer: {
    root: "src/desktop/renderer",
  },
};
