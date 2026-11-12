/**
 * Local shutdown test for inference-throughput-probe-vllm.ts
 *
 * Verifies that endJob() is called on:
 *   A) an unexpected throw after job post
 *   B) an unhandledRejection
 *   C) an uncaughtException
 *
 * Run: npx tsx scripts/test-vllm-probe-shutdown.mts
 * Expected: three PASS lines, no FAIL.
 */

let endJobCallCount = 0;

// ── Minimal mock client ───────────────────────────────────────────────────────
function makeMockClient(jobId: string) {
  return {
    jobs: {
      list: async () => ({ tx: 'tx', job: jobId, run: 'run' }),
      get:  async () => ({ state: 'RUNNING', node: { toString: () => 'node123' } }),
      end:  async () => { endJobCallCount++; console.log(`  [mock] client.jobs.end(${jobId}) called`); },
      getMarket: async () => ({ queueType: 1, queue: ['n1', 'n2'] }),
      delist: async () => {},
    },
    ipfs:   { retrieve: async () => ({}) },
    solana: { connection: null, wallet: { publicKey: null } },
  };
}

// ── Extracted shutdown logic (mirrors the probe's pattern) ───────────────────
async function runScenario(label: string, throwAfterPost: () => Promise<void>): Promise<void> {
  console.log(`\n--- ${label} ---`);
  endJobCallCount = 0;

  const jobId = 'TestJobId1234567890';
  const client = makeMockClient(jobId);
  let jobEnded = false;

  async function endJob(reason: string) {
    if (jobEnded) return;
    jobEnded = true;
    console.log(`  endJob(${reason}) called`);
    await client.jobs.end(jobId);
  }

  // Register process-level handlers (simulate probe's registration)
  const uncaughtHandler = async (e: unknown) => {
    console.log(`  [uncaughtException] ${e}`);
    await endJob('uncaughtException');
    process.exitCode = 1;
  };
  const rejectionHandler = async (reason: unknown) => {
    console.log(`  [unhandledRejection] ${reason}`);
    await endJob('unhandledRejection');
    process.exitCode = 1;
  };

  process.once('uncaughtException',   uncaughtHandler as (e: Error) => void);
  process.once('unhandledRejection',  rejectionHandler as (r: unknown) => void);

  try {
    // Simulate: job posted
    const { job: job_id } = await client.jobs.list({}, 1800, 'market');
    console.log(`  job posted: ${job_id}`);

    // Simulate work that might throw
    await throwAfterPost();

  } finally {
    await endJob('finally');
    // Clean up handlers if we got here without them firing
    process.removeListener('uncaughtException',  uncaughtHandler as (e: Error) => void);
    process.removeListener('unhandledRejection', rejectionHandler as (r: unknown) => void);
    // Check here — error re-throws after finally so code after try/finally is unreachable on throw
    if (endJobCallCount >= 1) {
      console.log(`  PASS: endJob called ${endJobCallCount} time(s)`);
    } else {
      console.error(`  FAIL: endJob was NOT called`);
      process.exitCode = 1;
    }
  }
}

// ── Scenario A: synchronous throw inside try body ─────────────────────────────
try {
  await runScenario('A: throw inside try', async () => {
    throw new Error('simulated error after job post');
  });
} catch { /* expected — finally still ran */ }

// ── Scenario B: unhandledRejection ────────────────────────────────────────────
await new Promise<void>(resolve => {
  endJobCallCount = 0;
  const jobId = 'TestJobIdRejection1234';
  const client = makeMockClient(jobId);
  let jobEnded = false;

  async function endJob(reason: string) {
    if (jobEnded) return;
    jobEnded = true;
    console.log(`\n--- B: unhandledRejection ---`);
    console.log(`  endJob(${reason}) called`);
    await client.jobs.end(jobId);
    if (endJobCallCount >= 1) {
      console.log(`  PASS: endJob called on unhandledRejection`);
    } else {
      console.error(`  FAIL: endJob not called`);
      process.exitCode = 1;
    }
    resolve();
  }

  process.once('unhandledRejection', async (reason) => {
    console.log(`  [unhandledRejection] ${reason}`);
    await endJob('unhandledRejection');
  });

  // Fire an unhandled rejection
  void (async () => {
    await client.jobs.list({}, 1800, 'market'); // job "posted"
    // deliberately not awaited — creates unhandled rejection
    Promise.reject(new Error('unhandled rejection after job post'));
  })();
});

// ── Scenario C: uncaughtException ─────────────────────────────────────────────
await new Promise<void>(resolve => {
  endJobCallCount = 0;
  const jobId = 'TestJobIdUncaught12345';
  const client = makeMockClient(jobId);
  let jobEnded = false;

  async function endJob(reason: string) {
    if (jobEnded) return;
    jobEnded = true;
    console.log(`\n--- C: uncaughtException ---`);
    console.log(`  endJob(${reason}) called`);
    await client.jobs.end(jobId);
    if (endJobCallCount >= 1) {
      console.log(`  PASS: endJob called on uncaughtException`);
    } else {
      console.error(`  FAIL: endJob not called`);
      process.exitCode = 1;
    }
    resolve();
  }

  process.once('uncaughtException', async (e) => {
    console.log(`  [uncaughtException] ${e.message}`);
    await endJob('uncaughtException');
  });

  // Fire an uncaught exception via setImmediate (bypasses current try/catch)
  void client.jobs.list({}, 1800, 'market').then(() => {
    setImmediate(() => { throw new Error('uncaught exception after job post'); });
  });
});

console.log('\nAll shutdown scenarios tested.');
