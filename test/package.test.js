import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const patch = await readFile(resolve(root, 'cordis.patch.yml'), 'utf8')
const client = await readFile(resolve(root, 'lib/client.js'), 'utf8')

const DSH_PEER_RANGE = '>=0.1.5-rc.2 <0.1.6'
const DSH_PEERS = [
  '@deepseek-ai/dsh-credentials',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-commands',
  '@deepseek-ai/dsh-api-session-controller',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-chat',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-commands',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-settings-general',
  '@deepseek-ai/dsh-settings',
]
const CLIENT_INJECT = [
  '@deepseek-ai/dsh-api-session-controller',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-chat',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-commands',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-settings-general',
]

test('declares the DSH 0.1.5 package contract without expanding the publish surface', () => {
  assert.equal(packageJson.name, 'dsh-deepseek-billing')
  assert.equal(packageJson.version, '0.2.0')
  assert.equal(packageJson.engines?.node, '^22.19.0 || >=24.0.0')
  assert.deepEqual(packageJson.repository, {
    type: 'git',
    url: 'git+https://github.com/golitter/dsh-deepseek-billing.git',
  })
  assert.equal(packageJson.homepage, 'https://github.com/golitter/dsh-deepseek-billing#readme')
  assert.deepEqual(packageJson.bugs, {
    url: 'https://github.com/golitter/dsh-deepseek-billing/issues',
  })

  assert.match(patch, /id: deepseek-billing/)
  assert.match(patch, /name: ['"]dsh-deepseek-billing['"]\s*$/m)
  assert.match(client, /window\.__ModuleLoader__\.load\(\{\s*id: "dsh-deepseek-billing"/s)

  assert.equal(packageJson.exports?.['./client'], './lib/client.js')
  assert.equal(packageJson.dsh?.bundle?.patch, './cordis.patch.yml')

  const peerDependencies = packageJson.peerDependencies ?? {}
  assert.deepEqual(DSH_PEERS, Object.keys(peerDependencies).filter((name) => name.startsWith('@deepseek-ai/dsh-')))
  for (const name of DSH_PEERS) assert.equal(peerDependencies[name], DSH_PEER_RANGE)
  for (const name of ['@deepseek-ai/dsh-credentials', '@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-commands']) {
    assert.equal(peerDependenciesMetaOptional(packageJson, name), false)
  }
  assert.equal(peerDependenciesMetaOptional(packageJson, '@deepseek-ai/dsh-settings'), true)

  assert.deepEqual(packageJson.dsh?.client?.inject, CLIENT_INJECT)
  assert.equal(packageJson.dependencies?.['@deepseek-ai/schemastery'], '^3.18.2')
  assert.deepEqual(packageJson.files, ['lib', 'cordis.patch.yml'])
  assert.ok(!packageJson.files.some((entry) => /^(docs?|test|screenshots?)(?:\/|$)/i.test(entry)))
})

function peerDependenciesMetaOptional(manifest, name) {
  return manifest.peerDependenciesMeta?.[name]?.optional === true
}
