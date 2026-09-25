import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = path.resolve('src/cli.mjs');
const run = (args, input) => spawnSync(process.execPath, [cli, ...args], { input, encoding: 'utf8', env: { ...process.env, CANVAS_TOKEN: '' } });

test('init, sanitized capture, and partial sync work in a private workspace', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'course-context-test-'));
  try {
    const initialized = run(['init', workspace]);
    assert.equal(initialized.status, 0, initialized.stderr);
    const configFile = path.join(workspace, '.course-context/config.json');
    const config = JSON.parse(await readFile(configFile, 'utf8'));
    config.canvas.base_url = 'https://canvas.school.edu';
    config.term_window = { start_date: '2026-08-15', end_date: '2026-12-31' };
    config.canvas.courses = [{ id: 42, slug: 'class1' }];
    config.public_sources = [];
    config.connected_sources = [{ id: 'class1.grade-table', course: 'class1', url: 'https://www.gradescope.com/' }];
    await writeFile(configFile, JSON.stringify(config));
    const capture = {
      source_id: 'class1.grade-table', checked_at: new Date().toISOString(), status: 'checked', complete: true,
      records: [{ id: 'hw1', kind: 'assignment', title: 'Homework 1', url: 'https://school.edu/hw1?token=private' }],
    };
    const captured = run(['capture', workspace], JSON.stringify(capture));
    assert.equal(captured.status, 0, captured.stderr);
    const saved = await readFile(path.join(workspace, '.course-context/capture-input/class1.grade-table.json'), 'utf8');
    assert.doesNotMatch(saved, /token=private/);
    const synced = run(['sync', workspace]);
    assert.equal(synced.status, 2, synced.stderr);
    const state = JSON.parse(await readFile(path.join(workspace, '.course-context/state.json'), 'utf8'));
    assert.equal(state.sources['class1.grade-table'].status, 'checked');
    assert.equal(state.sources['class1.canvas.assignments'].status, 'not_attempted');
    assert.equal(state.sources['class1.grade-table'].records[0].url, 'https://school.edu/hw1');
    const second = run(['sync', workspace]);
    assert.equal(second.status, 2, second.stderr);
    const secondState = JSON.parse(await readFile(path.join(workspace, '.course-context/state.json'), 'utf8'));
    assert.equal(secondState.sources['class1.grade-table'].status, 'not_attempted');
    assert.equal(secondState.sources['class1.grade-table'].records.length, 1);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('refuses to save course data in a Git workspace until its private directory is ignored', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'course-context-git-test-'));
  try {
    const git = spawnSync('git', ['init', '-q', workspace], { encoding: 'utf8' });
    assert.equal(git.status, 0, git.stderr);
    assert.equal(run(['init', workspace]).status, 0);
    const configFile = path.join(workspace, '.course-context/config.json');
    const config = JSON.parse(await readFile(configFile, 'utf8'));
    config.canvas.base_url = 'https://canvas.school.edu';
    config.canvas.courses = [{ id: 42, slug: 'class1' }];
    config.public_sources = [];
    config.connected_sources = [{ id: 'class1.table', course: 'class1', url: 'https://www.gradescope.com/' }];
    await writeFile(configFile, JSON.stringify(config));
    const capture = { source_id: 'class1.table', checked_at: new Date().toISOString(), status: 'checked', complete: true, records: [] };
    assert.equal(run(['check', workspace]).status, 2);
    const rejected = run(['capture', workspace], JSON.stringify(capture));
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /private_dir_not_gitignored/);
    await writeFile(path.join(workspace, '.gitignore'), '.course-context/\n');
    assert.equal(run(['check', workspace]).status, 0);
    assert.equal(run(['capture', workspace], JSON.stringify(capture)).status, 0);
    const staged = spawnSync('git', ['-C', workspace, 'add', '-f', '.course-context/config.json'], { encoding: 'utf8' });
    assert.equal(staged.status, 0, staged.stderr);
    const tracked = run(['check', workspace]);
    assert.equal(tracked.status, 2);
    assert.match(tracked.stdout, /private_dir_tracked_in_git/);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});
