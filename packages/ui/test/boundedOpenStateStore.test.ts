import { describe, expect, it } from "vitest";
import { createBoundedOpenStateStore } from "../src/lib/boundedOpenState.js";

describe("createBoundedOpenStateStore", () => {
  it("stores and reads open state per key", () => {
    const store = createBoundedOpenStateStore(3);
    store.set("a", true);
    store.set("b", false);
    expect(store.get("a")).toBe(true);
    expect(store.get("b")).toBe(false);
    expect(store.get("missing")).toBeUndefined();
    expect(store.size()).toBe(2);
  });

  it("evicts the oldest key when inserting a new key at the cap", () => {
    const store = createBoundedOpenStateStore(3);
    store.set("a", true);
    store.set("b", true);
    store.set("c", true);
    store.set("d", true);
    expect(store.size()).toBe(3);
    expect(store.get("a")).toBeUndefined();
    expect(store.get("b")).toBe(true);
    expect(store.get("c")).toBe(true);
    expect(store.get("d")).toBe(true);
  });

  it("does not evict when updating an existing key at the cap", () => {
    const store = createBoundedOpenStateStore(2);
    store.set("a", true);
    store.set("b", true);
    store.set("b", false);
    expect(store.size()).toBe(2);
    expect(store.get("a")).toBe(true);
    expect(store.get("b")).toBe(false);
  });

  it("clear resets every key", () => {
    const store = createBoundedOpenStateStore(2);
    store.set("a", true);
    store.clear();
    expect(store.size()).toBe(0);
    expect(store.get("a")).toBeUndefined();
  });
});
