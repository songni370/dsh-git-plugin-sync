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
const headingEnd = changelog.indexOf('\n', start)
const next = changelog.indexOf('\n## [', headingEnd)
const body = changelog.slice(headingEnd + 1, next < 0 ? undefined : next).trim()
const section = body
  .replace(/^### Added$/m, '### 新增')
  .replace(/^### Changed$/m, '### 变更')
  .replace(/^### Fixed$/m, '### 修复')
  .replace(/^### Security$/m, '### 安全')
  .replace(/^### Deprecated$/m, '### 弃用')
  .replace(/^### Removed$/m, '### 移除')

const install = `## 安装 / Install

\`\`\`sh
dsh plugin --profile web add ${pkg.name}@latest
\`\`\`

更新 / Update:

\`\`\`sh
dsh plugin --profile web update ${pkg.name}@latest
\`\`\``

console.log(`${install}\n\n## ${tag}\n${section}\n\n---\n[${pkg.name}@${version} on npm](https://www.npmjs.com/package/${pkg.name}/v/${version})`)
