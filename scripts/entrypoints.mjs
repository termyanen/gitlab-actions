// Repository-relative inputs shared by the bundler and source graph validation.
export const scriptEntryPoints = {
  background: "src/app/entrypoints/background.ts",
  content_proxy: "src/app/entrypoints/content_proxy.ts",
};

// Extension-owned React pages share one runtime. They are built separately so
// none of their dependencies can become a content-script or worker chunk.
export const uiEntryPoints = {
  welcome: "src/app/entrypoints/welcome.ts",
  "quick-popup": "src/app/entrypoints/quick-popup.ts",
  popup: "src/app/entrypoints/popup.ts",
};

export const moduleEntryPoints = {
  "modules/content": "src/app/content/runtime.ts",
};
