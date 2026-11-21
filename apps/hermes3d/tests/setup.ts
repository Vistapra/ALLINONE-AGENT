import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/dom";

// Default asyncUtilTimeout (1000ms) causes real, reproducible flakiness in waitFor()-based
// tests on low-core-count reference hardware under full-suite parallel load (confirmed: the
// same assertions pass 100% reliably in isolation, and the full suite's actual wall-clock
// bottleneck is jsdom/worker startup, not these assertions themselves) - a longer ceiling
// costs nothing when the awaited condition is met early, it only raises the margin before a
// genuinely stuck assertion is reported as failed.
configure({ asyncUtilTimeout: 5000 });

const ensureLocalStorage = () => {
  if (typeof window === "undefined") return;
  const existing = window.localStorage as unknown as Record<string, unknown> | undefined;
  if (
    existing &&
    typeof existing.getItem === "function" &&
    typeof existing.setItem === "function" &&
    typeof existing.removeItem === "function" &&
    typeof existing.clear === "function"
  ) {
    return;
  }

  const store = new Map<string, string>();
  const storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(String(key)) ? store.get(String(key)) ?? null : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(String(key));
    },
    setItem(key: string, value: string) {
      store.set(String(key), String(value));
    },
  };

  Object.defineProperty(window, "localStorage", {
    value: storage,
    configurable: true,
  });
};

ensureLocalStorage();
