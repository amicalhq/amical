/// <reference types="vite/client" />

// Declare module for URL imports
declare module "*?url" {
  const url: string;
  export default url;
}

// Declare module for raw imports
declare module "*?raw" {
  const content: string;
  export default content;
}
