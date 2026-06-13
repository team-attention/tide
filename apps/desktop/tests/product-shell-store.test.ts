// Spec: desktop-product-shell-render-isolation. The store + memoized-selector foundation
// that lets shell components subscribe to only their slice.
import assert from "node:assert/strict";
import test from "node:test";

import {
  createProductShellState,
  createProductShellStore,
  createSelectorFor,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";

test("store notifies subscribers on a real change and exposes the new state", () => {
  const store = createProductShellStore(createProductShellState({ includeFixtureData: false }));
  let notifications = 0;
  const unsubscribe = store.subscribe(() => {
    notifications += 1;
  });

  store.setState((state) => ({ ...state, searchQuery: "abc" }));
  assert.equal(notifications, 1);
  assert.equal(store.getState().searchQuery, "abc");

  unsubscribe();
  store.setState((state) => ({ ...state, searchQuery: "def" }));
  assert.equal(notifications, 1, "unsubscribed listener must not fire");
  assert.equal(store.getState().searchQuery, "def");
});

test("store does not notify when the reducer returns the same state reference", () => {
  const store = createProductShellStore(createProductShellState({ includeFixtureData: false }));
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });

  store.setState((state) => state);
  assert.equal(notifications, 0);
});

test("createSelector recomputes only when an input reference changes", () => {
  interface S {
    a: { v: number };
    b: { v: number };
  }
  let computes = 0;
  const select = createSelectorFor<S>()(
    [(state) => state.a],
    (a) => {
      computes += 1;
      return a.v * 2;
    },
  );

  const a = { v: 1 };
  assert.equal(select({ a, b: { v: 0 } }), 2);
  assert.equal(computes, 1);

  // b changed, a did not → no recompute.
  assert.equal(select({ a, b: { v: 99 } }), 2);
  assert.equal(computes, 1);

  // a changed → recompute.
  assert.equal(select({ a: { v: 5 }, b: { v: 99 } }), 10);
  assert.equal(computes, 2);
});

test("createSelector returns the SAME result reference while inputs are stable", () => {
  interface S {
    a: number[];
    other: number;
  }
  const select = createSelectorFor<S>()(
    [(state) => state.a],
    (a) => ({ doubled: a.map((n) => n * 2) }),
  );

  const a = [1, 2, 3];
  const first = select({ a, other: 0 });
  const second = select({ a, other: 1 }); // `other` changed, `a` stable
  assert.equal(first, second, "a memoized consumer must see the same reference and bail");
});
