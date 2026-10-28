// Pre-flight: make sure the plugin module is loadable and its tool schemas satisfy
// the host's strict JSON-schema subset (every object must declare additionalProperties).
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const problems = []

function checkSchema(schema, path) {
  if (!schema || typeof schema !== 'object') return
  if (Array.isArray(schema.type)) { /* fine */ }
  if (schema.type === 'object' && schema.properties !== undefined) {
    if (schema.additionalProperties !== true && schema.additionalProperties !== false) {
      problems.push(`${path}: object schema missing explicit additionalProperties`)
    }
    for (const [key, value] of Object.entries(schema.properties ?? {})) {
      checkSchema(value, `${path}.${key}`)
    }
  } else if (schema.type === 'object' && schema.additionalProperties === undefined) {
    problems.push(`${path}: object schema missing additionalProperties`)
  }
  if (schema.type === 'array' && schema.items) checkSchema(schema.items, `${path}[]`)
}

const mod = await import('../src/index.js')
console.log('exports:', Object.keys(mod).join(', '))
console.log('name =', mod.name, '| inject =', JSON.stringify(mod.inject))
console.log('Config present:', Boolean(mod.Config), '| apply is function:', typeof mod.apply === 'function')

const { createTools } = await import('../src/tools.js')
const tools = createTools({}, { shotDir: join(tmpdir(), 'dsh-screen-preflight'), observeMaxWidth: 800, observeMaxHeight: 600 })

for (const tool of tools) {
  console.log(`\n- ${tool.name}: params=${Object.keys(tool.parameters ?? {}).join(',') || '(none)'}`)
  for (const [key, value] of Object.entries(tool.parameters ?? {})) checkSchema(value, `${tool.name}.parameters.${key}`)
  checkSchema(tool.output?.schema, `${tool.name}.output.schema`)
  if (typeof tool.execute !== 'function') problems.push(`${tool.name}: no execute`)
  if (!tool.description) problems.push(`${tool.name}: no description`)
}

console.log('\n=== problems ===')
console.log(problems.length ? problems.join('\n') : 'none ✅')