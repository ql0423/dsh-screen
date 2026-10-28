// Resolve host-provided packages when running inside DSH, and fall back to usable
// stand-ins when the module is exercised outside the host (tests, probes, tooling).
let defineToolImpl = null
let zImpl = null

try {
  const mod = await import('@deepseek-ai/dsh-tools')
  defineToolImpl = mod.defineTool ?? mod.default?.defineTool ?? null
} catch { /* outside the host: keep the pass-through */ }

try {
  const mod = await import('@deepseek-ai/schemastery')
  zImpl = mod.default ?? mod
} catch { /* outside the host: no schema, defaults come from resolveConfig */ }

/** Identity fallback: a tool object is already the shape the tools service registers. */
export const defineTool = defineToolImpl ?? (definition => definition)

export const z = zImpl

export const hasHostRuntime = Boolean(defineToolImpl && zImpl)