// Runs one of this repo's React components without React: the real component
// source is compiled and called as a plain function, with useState, useRef and
// useEffect answered here. It exists for the bugs that live in how a screen's
// state and effects interact — the order two effects run in, what a callback
// does when it arrives late — which a test of a pure helper cannot reach and a
// regex over the source can only pretend to.
//
// What it keeps faithful to React, because the bugs depended on it:
//   - effects run after the render, in the order they are declared, and only
//     when a dependency changed;
//   - every state change made by those effects lands before the next render
//     (so the last one written wins, as it does in one React commit);
//   - setting state to the value it already holds does not render again.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

/** The component file, compiled to something `runInNewContext` can run. */
export function compileComponent(url) {
  return ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}

/** A plain TypeScript module with no imports of its own, loaded for real. */
export function loadLib(url, modules = {}) {
  const compiled = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, require: (name) => modules[name] ?? {} });
  return exports;
}

/** Elements as plain objects. The key is kept: rows in a list are found by it. */
export const jsxRuntime = {
  jsx: (type, props, key) => ({ type, props, key }),
  jsxs: (type, props, key) => ({ type, props, key }),
  Fragment: "Fragment",
};

/** Every element in a rendered tree, depth first. */
export function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}

/** The words inside an element, as a person would read them. */
export function text(node) {
  if (node == null || node === false || node === true) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return text(node.props?.children);
}

export const named = (name) => (node) => (node.type?.name ?? node.type) === name;

/** useState / useRef / useEffect for one mounted component. */
export function hookRuntime() {
  const slots = [];
  let cursor = 0;
  let queued = [];
  let changed = false;

  const react = {
    useState(initial) {
      const slot = (slots[cursor++] ??= {
        value: typeof initial === "function" ? initial() : initial,
      });
      slot.set ??= (next) => {
        const value = typeof next === "function" ? next(slot.value) : next;
        if (Object.is(value, slot.value)) return;
        slot.value = value;
        changed = true;
      };
      return [slot.value, slot.set];
    },
    useRef(initial) {
      return (slots[cursor++] ??= { current: initial });
    },
    useMemo: (compute) => compute(),
    useCallback: (fn) => fn,
    useEffect(effect, deps) {
      const index = cursor++;
      const before = slots[index];
      const same =
        Boolean(before) &&
        Array.isArray(deps) &&
        Array.isArray(before.deps) &&
        deps.length === before.deps.length &&
        deps.every((dep, i) => Object.is(dep, before.deps[i]));
      slots[index] = { deps, cleanup: before?.cleanup };
      if (!same) queued.push({ index, effect });
    },
  };

  /** Renders until nothing an effect did asks for another render. */
  function render(Component, props) {
    for (let pass = 0; pass < 25; pass++) {
      cursor = 0;
      queued = [];
      changed = false;
      const tree = Component(props);
      for (const { index } of queued) slots[index].cleanup?.();
      for (const { index, effect } of queued) {
        const cleanup = effect();
        slots[index].cleanup = typeof cleanup === "function" ? cleanup : undefined;
      }
      if (!changed) return tree;
    }
    throw new Error("the component kept re-rendering and never settled");
  }

  return { react, render };
}

/**
 * useMutation, with the two properties of the real one that matter to a test:
 * the request is sent with what the screen held when the button was pressed,
 * and the callbacks that run when it answers are the latest render's.
 */
export function mutationDouble() {
  const mutations = [];
  const thrown = [];
  let cursor = 0;
  return {
    /** Call at the start of every render. */
    rewind() {
      cursor = 0;
    },
    useMutation(options) {
      const mutation = (mutations[cursor++] ??= { isPending: false });
      mutation.options = options;
      mutation.mutate = (variables) => {
        mutation.isPending = true;
        const sent = (async () => mutation.options.mutationFn(variables))();
        sent
          .then(
            (result) => mutation.options.onSuccess?.(result, variables),
            (error) => mutation.options.onError?.(error, variables),
          )
          .catch((error) => thrown.push(error))
          .finally(() => {
            mutation.isPending = false;
          });
      };
      return mutation;
    },
    /**
     * Waits for every request that has been answered to finish its callbacks.
     * A callback that threw fails the test here instead of vanishing.
     */
    async settle() {
      await new Promise((resolve) => setImmediate(resolve));
      if (thrown.length > 0) throw thrown.shift();
    },
  };
}

/** A promise the test resolves when it decides the server has answered. */
export function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
