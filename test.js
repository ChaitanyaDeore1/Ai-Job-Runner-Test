// Automated test: proves duplicates happen WITHOUT a key, and are prevented WITH one.
// Run with:  npm test      (server does not need to be running)
process.env.JOB_DELAY_MS = '100'; // fast fake AI for tests
const assert = require('assert');
const app = require('./server');

const server = app.listen(0); // port 0 = pick any free port
const base = `http://localhost:${server.address().port}`;

const post = (text, key) =>
  fetch(`${base}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
    body: JSON.stringify({ text }),
  }).then(async (r) => ({ status: r.status, ...(await r.json()) }));

const state = () => fetch(`${base}/api/jobs`).then((r) => r.json());
const reset = () => fetch(`${base}/api/reset`, { method: 'POST' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(name, fn) {
  await reset();
  await fn();
  console.log(`  PASS  ${name}`);
}

(async () => {
  console.log('AI Job Runner tests\n');

  await run('1 click, no key -> 1 job', async () => {
    await post('hello world');
    assert.strictEqual((await state()).jobs.length, 1);
  });

  await run('2 fast clicks, NO key -> 2 duplicate jobs (the problem)', async () => {
    await Promise.all([post('same text'), post('same text')]);
    const s = await state();
    assert.strictEqual(s.jobs.length, 2);
    assert.strictEqual(s.stats.jobsCreated, 2);
  });

  await run('2 fast clicks, SAME key -> only 1 job (the fix)', async () => {
    const [a, b] = await Promise.all([post('same text', 'key-1'), post('same text', 'key-1')]);
    const s = await state();
    assert.strictEqual(s.jobs.length, 1);
    assert.strictEqual(a.job.id, b.job.id);
    assert.deepStrictEqual([a.status, b.status].sort(), [200, 201]); // one created, one replayed
    assert.strictEqual(s.stats.replays, 1);
  });

  await run('retry later with SAME key -> still the same job', async () => {
    const first = await post('retry me', 'key-2');
    await sleep(300); // job finishes in between
    const retry = await post('retry me', 'key-2');
    assert.strictEqual(first.job.id, retry.job.id);
    assert.strictEqual(retry.replayed, true);
    assert.strictEqual((await state()).jobs.length, 1);
  });

  await run('2 requests, DIFFERENT keys -> 2 jobs (different intent)', async () => {
    await Promise.all([post('same text', 'key-a'), post('same text', 'key-b')]);
    assert.strictEqual((await state()).jobs.length, 2);
  });

  await run('same key, different text -> 422 rejected', async () => {
    await post('first text', 'key-3');
    const bad = await post('other text', 'key-3');
    assert.strictEqual(bad.status, 422);
    assert.strictEqual((await state()).jobs.length, 1);
  });

  await run('jobs finish and have a mock AI result', async () => {
    await post('this is a great demo', 'key-4');
    await sleep(300);
    const j = (await state()).jobs[0];
    assert.strictEqual(j.status, 'done');
    assert.strictEqual(j.result.sentiment, 'positive');
    assert.strictEqual(j.result.wordCount, 5);
  });

  console.log('\nAll tests passed.');
  server.close();
})().catch((e) => {
  console.error('\nTEST FAILED:', e.message);
  server.close();
  process.exit(1);
});
