const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const api = import('../scripts/release.mjs');

async function fixture(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'extension-release-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const en = '# Changes\n\n## 1.2.3\n\n- Current change.\n\n### Fixes\n\n- Current fix.\n\n---\n\n## 1.2.2\n\n- Older change.\n';
  const ru = '# Изменения\n\n## 1.2.3\n\n- Текущее изменение.\n\n## 1.2.2\n\n- Старое изменение.\n';
  const files = {
    'manifest.json': JSON.stringify({version: '1.2.3'}),
    'package.json': JSON.stringify({private: true}),
    'CHANGELOG.md': en, 'CHANGELOG_RU.md': ru,
    'docs/CHANGELOG.md': en, 'docs/CHANGELOG_RU.md': ru,
    'docs/index.html': '<script type="application/ld+json">{"@type":"SoftwareApplication","softwareVersion":"1.2.3"}</script>',
    'docs/review-guide.html': '<footer><span>GitLab MR Actions · 1.2.3</span></footer>',
    'docs/privacy.html': '<footer><span>GitLab MR Actions · 1.2.3</span></footer>',
    ...overrides,
  };
  for (const [name, body] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, name)), {recursive: true});
    await fs.writeFile(path.join(root, name), body);
  }
  return {root, files};
}

test('release notes contain both current languages and subsections without older releases', async t => {
  const {root, files} = await fixture(t);
  const {checkRelease, releaseNotes} = await api;
  const notes = releaseNotes(await checkRelease(root, {ready: true}));
  assert.match(notes, /GitLab MR Actions 1\.2\.3/);
  assert.match(notes, /### Fixes\n\n- Current fix/);
  assert.match(notes, /Текущее изменение/);
  assert.doesNotMatch(notes, /Older change|Старое изменение|\n---/);
  for (const [name, body] of Object.entries(files))
    assert.equal(await fs.readFile(path.join(root, name), 'utf8'), body, 'validation/notes must not modify sources');
});

for (const file of ['docs/review-guide.html', 'docs/privacy.html', 'docs/index.html', 'docs/CHANGELOG.md', 'docs/CHANGELOG_RU.md']) {
  test('release check rejects stale published metadata: ' + file, async t => {
    const {root} = await fixture(t, {[file]: 'stale content'});
    const {checkRelease} = await api;
    await assert.rejects(checkRelease(root), error => error.message.includes(file));
  });
}

test('pending notes are allowed in PRs but must be promoted before a release', async t => {
  const {root, files} = await fixture(t);
  for (const name of ['CHANGELOG.md', 'CHANGELOG_RU.md']) {
    const pending = '## Unreleased\n\n- Pending change.\n\n' + files[name];
    await fs.writeFile(path.join(root, name), pending);
    await fs.writeFile(path.join(root, 'docs', name), pending);
  }
  const {checkRelease} = await api;
  await checkRelease(root);
  await assert.rejects(checkRelease(root, {ready: true}), /Promote Unreleased/);
});

test('release check rejects a missing translation of pending changes', async t => {
  const {root, files} = await fixture(t);
  const pending = '## Unreleased\n\n- Pending change.\n\n' + files['CHANGELOG.md'];
  await fs.writeFile(path.join(root, 'CHANGELOG.md'), pending);
  await fs.writeFile(path.join(root, 'docs/CHANGELOG.md'), pending);
  await assert.rejects((await api).checkRelease(root), /both Unreleased/);
});

test('release check rejects diverging histories and a second package version', async t => {
  const {root, files} = await fixture(t);
  for (const file of ['CHANGELOG_RU.md', 'docs/CHANGELOG_RU.md'])
    await fs.writeFile(path.join(root, file), files[file].replace('## 1.2.2', '## 1.2.1'));
  await assert.rejects((await api).checkRelease(root), /histories differ/);
  await fs.writeFile(path.join(root, 'package.json'), '{"version":"1.2.3"}');
  await assert.rejects((await api).checkRelease(root), /second release version/);
});

test('release parser rejects duplicate headings instead of silently picking one', async () => {
  const {parseChangelog} = await api;
  assert.throws(() => parseChangelog('## 1.2.3\n- First\n## 1.2.3\n- Second', 'fixture'), /duplicate release/);
  assert.throws(() => parseChangelog('## Unreleased\n## Unreleased\n## 1.2.3\n- Item', 'fixture'), /duplicate Unreleased/);
  assert.throws(() => parseChangelog('## 1.2.2\n- Lower\n## 1.2.3\n- Higher', 'fixture'), /newest first/);
  assert.throws(() => parseChangelog('## 1.2.3.0\n- Same\n## 1.2.3\n- Same', 'fixture'), /newest first/);
  assert.equal(parseChangelog('## unreleased\n- Pending\n## 1.2.3\n- Current', 'fixture').pending, '- Pending');
});

for (const version of ['1.2.3-beta', '01.2.3', '1.2.65536', '0.0.0']) {
  test('release check rejects invalid manifest version ' + version, async t => {
    const {root} = await fixture(t, {'manifest.json': JSON.stringify({version})});
    await assert.rejects((await api).checkRelease(root), /invalid extension release version/);
  });
}
