import type { NativeRuntimeReducer } from "../../../../application/domains/native-agent/native-runtime-state.ts";
import { reduceStructuredNativeEvent } from "./structured-native-reducer.ts";

export const reduceClaudeNativeEvent: NativeRuntimeReducer = reduceStructuredNativeEvent;
