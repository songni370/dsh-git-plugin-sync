/**
 * Render the GitHub Release body for a tag from CHANGELOG.md.
 *
 * Usage: node scripts/release-notes.mjs v0.2.3 > RELEASE_NOTES.md
 */
import { readFileSync } from 'node:fs'

const tag = process.argv[2] ?? process.env.RELEASE_TAG ?? ''
if (!/^v\d+\.\d+\.\d+/.test(tag)) {
  console.error('usage: node scripts/release-notes.mjs vX.Y.Z')
  process.exit(2)
}
const version = tag.replace(/^v/, '')
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const changelog = readFileSync('CHANGELOG.md', 'utf8')

const marker = `## [${version}]`
const start = changelog.indexOf(marker)
if (start < 0) {
  console.error(`CHANGELOG.md has no section for ${version}`)
  process.exit(1)
}
const next = changelog.indexOf('\n## [', start + marker.length)
const section = changelog.slice(start, next < 0 ? undefined : next).trim()

const install = `## 安装 / Install

\`\`\`sh
dsh plugin --profile web add ${pkg.name}@latest
\`\`\`

更新 / Update:

\`\`\`sh
dsh plugin --profile web update ${pkg.name}@latest
\`\`\``

console.log(`${install}\n\n${section}\n\n---\n[${pkg.name}@${version} on npm](https://www.npmjs.com/package/${pkg.name}/v/${version})`)
