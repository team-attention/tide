import { createContext, useContext, useMemo, useRef, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import type { ProductShellState, ProductShellStore } from "../../../../application/domains/product-shell/product-shell.ts";
import { createProductShellStore } from "../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "./support/types.ts";
// Spec: desktop-product-shell-render-isolation.

// The store instance is created once at the ProductShell root, so this context value is
// stable and never itself triggers consumer re-renders.
const StoreContext = createContext<ProductShellStore | null>(null);

export const ProductShellStoreProvider = StoreContext.Provider;

export function useProductShellStore(): ProductShellStore {
  const store = useContext(StoreContext);
  if (store === null) {
    throw new Error("useProductShellStore must be used inside a ProductShellStoreProvider.");
  }
  return store;
}

// Subscribe to a slice of the shell state. `selector` MUST be reference-stable — a
// memoized area selector (createSelector) or an Object.is-stable scalar read. An inline
// selector that builds a fresh object every call would make useSyncExternalStore see a
// new snapshot forever and re-render in a loop.
export function useProductShellSlice<T>(selector: (state: ProductShellState) => T): T {
  const store = useProductShellStore();
  const snapshot = (): T => selector(store.getState());
  // getServerSnapshot mirrors getSnapshot so renderToStaticMarkup (SSR tests) works.
  return useSyncExternalStore(store.subscribe, snapshot, snapshot);
}

// Owns the shell store: creates it once from `createInitial`, exposes the live state and
// a `setShellState` that keeps the React Dispatch<SetStateAction> shape (so the existing
// reducers/handlers are unchanged) while writing through the store.
export function useShellStore(createInitial: () => ProductShellState): {
  store: ProductShellStore;
  shellState: ProductShellState;
  setShellState: Dispatch<SetStateAction<ProductShellState>>;
} {
  const storeRef = useRef<ProductShellStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createProductShellStore(createInitial());
  }
  const store = storeRef.current;
  const shellState = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const setShellState = useMemo<Dispatch<SetStateAction<ProductShellState>>>(
    () => (action) =>
      store.setState((previous) =>
        typeof action === "function"
          ? (action as (state: ProductShellState) => ProductShellState)(previous)
          : action,
      ),
    [store],
  );
  return { store, shellState, setShellState };
}

// One stable handlers object whose every method delegates at CALL time to the latest
// `handlers` (rebuilt each render with fresh state). Stable identity lets the memo
// columns bail; call-time delegation means a captured handler is never stale. The
// handler set has a static shape, so the first render's keys cover the session.
export function useStableHandlers(handlers: ProductShellHandlers): ProductShellHandlers {
  const ref = useRef(handlers);
  ref.current = handlers;
  return useMemo<ProductShellHandlers>(() => {
    const stable: Record<string, (...args: unknown[]) => unknown> = {};
    for (const key of Object.keys(ref.current)) {
      stable[key] = (...args: unknown[]) =>
        (ref.current as unknown as Record<string, (...a: unknown[]) => unknown>)[key](...args);
    }
    return stable as unknown as ProductShellHandlers;
  }, []);
}
