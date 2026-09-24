// Run in its OWN process — never imported into the main test-runner process — because
// config.ts's isTestMode() reads AGENT_TELEGRAM_HOME once at module load, matching how a
// real daemon process (also freshly spawned per run) sees it. Mutating process.env after
// config.ts is already loaded in the shared test-runner process would not exercise the same
// code path. Prints one line and exits 0 either way, so the calling test can assert on
// stdout without caring which branch fired:
//   OK <value>     - the guarded call returned normally
//   THREW <message> - the guarded call (or resolveBin/apiBase itself) refused

const [, , check] = process.argv;

async function run(): Promise<string> {
  if (check === "maestro-add") {
    const { maestroAdd } = await import("../../src/inbox/maestro.ts");
    const id = await maestroAdd("isolation probe");
    return `OK id=${id}`;
  }
  if (check === "api-base") {
    const { apiBase } = await import("../../src/config.ts");
    return `OK value=${apiBase()}`;
  }
  throw new Error(`unknown check: ${check}`);
}

run().then(
  (line) => console.log(line),
  (error: unknown) => console.log(`THREW ${(error as Error)?.message ?? String(error)}`),
);
