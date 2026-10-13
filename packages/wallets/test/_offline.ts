import { makeOfflineFetch } from "./_offline-fetch";

// Bun installs this before loading tests or their imports. Keep the descriptor
// configurable so the existing Floor loopback preload can wrap this same fence.
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: makeOfflineFetch(globalThis.fetch),
});
