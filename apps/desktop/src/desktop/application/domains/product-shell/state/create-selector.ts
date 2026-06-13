// Spec: desktop-product-shell-render-isolation.

// Tiny reselect-style memoized selector. The result is recomputed only when one of the
// input selectors returns a value that fails `Object.is` against the previous run; while
// the inputs are referentially stable the SAME result reference is returned, so a
// subscribing component bails out of re-rendering.
//
// Single result slot — correct for one live store (a single state lineage): each
// `setState` produces the next state the selectors are called with, so last-input
// caching never thrashes across unrelated states.
//
// Fixing `State` via a factory (instead of inferring it per call) lets TypeScript infer
// the input tuple and result without the caller restating the state type each time.
export function createSelectorFor<State>() {
  return function createSelector<
    const Inputs extends readonly ((state: State) => unknown)[],
    Result,
  >(
    inputs: Inputs,
    combiner: (...values: { [K in keyof Inputs]: ReturnType<Inputs[K]> }) => Result,
  ): (state: State) => Result {
    let lastInputs: readonly unknown[] | undefined;
    let lastResult: Result;
    return (state: State): Result => {
      const nextInputs = inputs.map((input) => input(state));
      if (
        lastInputs !== undefined &&
        nextInputs.every((value, index) => Object.is(value, lastInputs![index]))
      ) {
        return lastResult;
      }
      lastInputs = nextInputs;
      lastResult = combiner(...(nextInputs as { [K in keyof Inputs]: ReturnType<Inputs[K]> }));
      return lastResult;
    };
  };
}
