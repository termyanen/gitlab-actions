// Repository-relative inputs shared by the bundler and source graph validation.
export const scriptEntryPoints = {
  background: "src/app/entrypoints/background.ts",
  content_proxy: "src/app/entrypoints/content_proxy.ts",
  popup: "src/app/entrypoints/popup.ts",
  welcome: "src/app/entrypoints/welcome.ts",
};

export const moduleEntryPoints = {
  "modules/content": "src/app/content/runtime.ts",
};
