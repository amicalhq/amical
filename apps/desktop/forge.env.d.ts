/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

declare module "*?url" {
  const url: string;
  export default url;
}
