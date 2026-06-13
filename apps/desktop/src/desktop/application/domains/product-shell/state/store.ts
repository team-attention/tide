import type { ProductShellState } from "./types.ts";
// Spec: desktop-product-shell-render-isolation.

// External store for the Product Shell state. The reducers are unchanged — `setState`
// takes the same `(state) => state` updaters `setShellState` takes today — but holding
// the state here lets components subscribe to only the slice they render (via memoized
// selectors), instead of the whole tree re-running on every change.
export interface ProductShellStore {
  getState(): ProductShellState;
  setState(updater: (state: ProductShellState) => ProductShellState): void;
  subscribe(listener: () => void): () => void;
}

export function createProductShellStore(initialState: ProductShellState): ProductShellStore {
  let state = initialState;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    setState: (updater) => {
      const next = updater(state);
      // A reducer that returns the same reference is a no-op — notifying would force
      // every subscriber to re-check its selector for nothing.
      if (next === state) {
        return;
      }
      state = next;
      // Snapshot the listener set: a listener that unsubscribes (or subscribes) during
      // notification must not corrupt the in-progress iteration.
      for (const listener of [...listeners]) {
        listener();
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
