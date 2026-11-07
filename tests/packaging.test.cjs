'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var os = require('node:os');
var execFileSync = require('node:child_process').execFileSync;
var root = require('./helpers/extension.cjs').root;

['pack.sh', 'Shared CI workflow'].forEach(function(builder) {
  test(builder + ' includes extension resources and excludes test/development files', function() {
    // Build in an isolated fixture, never next to the user's existing archives.
    var staging = fs.mkdtempSync(path.join(os.tmpdir(), 'gitlab-actions-package-'));
    try {
      var manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
      var required = ['manifest.json', 'background.js', 'content_proxy.js', 'content.css', 'popup.html', 'popup.js', 'welcome.html', 'welcome.js'];
      Object.keys(manifest.icons).forEach(function(size) { required.push(manifest.icons[size]); });
      fs.readdirSync(path.join(root, '_locales'), {withFileTypes: true}).filter(entry => entry.isDirectory()).map(entry => entry.name).forEach(function(locale) { required.push('_locales/' + locale + '/messages.json'); });
      required.concat(['pack.sh', 'package.json', 'tsconfig.json']).forEach(function(file) {
        // Migrated runtime scripts are built from src; only legacy entrypoints
        // and static assets still exist at the repository root.
        if (!fs.existsSync(path.join(root, file)) && file.endsWith('.js')) return;
        var destination = path.join(staging, file);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(root, file), destination);
      });
      ['src', 'scripts'].forEach(function(directory) {
        fs.cpSync(path.join(root, directory), path.join(staging, directory), { recursive: true });
      });
      fs.symlinkSync(path.join(root, 'node_modules'), path.join(staging, 'node_modules'), 'dir');
      ['tests/example.test.cjs', 'tests/helpers/mock.cjs', '.git/config', '.github/workflows/tests.yml', '.agents/skills/prepare-release/SKILL.md', '.claude/skills/fixture/SKILL.md', 'docs/index.html', 'docs/requirements.txt', 'promo/example.txt', 'package-lock.json', 'AGENTS.md', 'CONTRIBUTING.md', 'GEMINI.md', 'CLAUDE.md', 'ROADMAP.md', '_locales/.DS_Store', 'icons/.DS_Store'].forEach(function(file) {
        var destination = path.join(staging, file);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, 'Must not ship');
      });

      var archive;
      if (builder === 'pack.sh') {
        execFileSync('bash', [path.join(staging, 'pack.sh')], { cwd: staging, stdio: 'pipe' });
        archive = 'gitlab-mr-actions-v' + manifest.version + '.zip';
      } else {
        // Execute only the checked-in local "Build zip" step. Never run the
        // credential/upload/publish steps or contact the Chrome Web Store.
        var workflow = fs.readFileSync(path.join(root, '.github/workflows/verify.yml'), 'utf8');
        var build = workflow.match(/      - name: Build zip\n        run: \|\n([\s\S]*?)(?=\n      - name:)/);
        assert.ok(build, 'Build zip step must be found');
        // The shared workflow has already built dist during npm run check.
        execFileSync(process.execPath, ['scripts/build.mjs'], {cwd: staging, stdio: 'pipe'});
        var command = build[1].split('\n').map(function(line) { return line.slice(10); }).join('\n');
        execFileSync('bash', ['-c', command], { cwd: staging, stdio: 'pipe' });
        archive = 'extension.zip';
      }
      var entries = execFileSync('unzip', ['-Z', '-1', path.join(staging, archive)], { encoding: 'utf8' }).trim().split('\n');
      assert.ok(entries.includes('modules/content.js'), 'Packaged module entry is required');
      assert.ok(entries.some(file => file.startsWith('modules/chunks/')), 'Packaged lazy chunks are required');
      required.forEach(function(file) { assert.ok(entries.includes(file), 'Missing packaged resource: ' + file); });
      entries.forEach(function(file) {
        assert.equal(file.split('/').some(function(part) { return part.startsWith('.'); }), false, 'Hidden file must not ship: ' + file);
        assert.equal(/^(tests\/|node_modules\/|src\/|scripts\/|\.|docs\/|promo\/|package(?:-lock)?\.json$|pack\.sh$|(?:AGENTS|CONTRIBUTING|GEMINI|CLAUDE|ROADMAP)\.md$)/.test(file), false, 'Unexpected packaged file: ' + file);
        assert.equal(/\.(?:ts|map)$/.test(file), false, 'Development source must not ship: ' + file);
      });
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  });
});
