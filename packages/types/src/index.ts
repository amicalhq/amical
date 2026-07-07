// RPC Envelopes
export * from "./schemas/rpc/request.js";
export * from "./schemas/rpc/response.js";

// Method Schemas (params + results)
export * from "./schemas/methods/get-accessibility-tree-details.js";
export * from "./schemas/methods/get-accessibility-context.js";
export * from "./schemas/methods/paste-text.js";
export * from "./schemas/methods/start-recording.js";
export * from "./schemas/methods/stop-recording.js";
export * from "./schemas/methods/set-shortcuts.js";
export * from "./schemas/methods/set-draft-enter-capture.js";
export * from "./schemas/methods/set-allow-injected-keys.js";
export * from "./schemas/methods/recheck-pressed-keys.js";
export * from "./schemas/methods/get-selected-text-via-copy.js";

// Event Schemas
export * from "./schemas/events/helper-events.js";

// Remote config (server-controlled surfaces + future config domains)
export * from "./schemas/remote-config.js";
