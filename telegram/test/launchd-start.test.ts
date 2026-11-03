// How the CLI starts a missing daemon and how `tg doctor` spots a daemon launchd does not own. launchctl, the plist
// check, the lock file and the process table are all injected; nothing here runs a real launchctl or a daemon.

import assert from "node:assert/strict";
import { test } from "node:test";
import { startDaemon } from "../src/cli/client.ts";
import {
  LAUNCHD_LABEL,
  kickstartLaunchd,
  launchdInstalled,
  launchdJobPid,
  launchdPlistPath,
  lockHolderPid,
  strayDaemonWarning,
  type RunCommand,
} from "../src/cli/launchd.ts";

function recorder(fail = false): { run: RunCommand; calls: string[][] } {
  const calls: string[][] = [];
  const run: RunCommand = (file, args) => {
    calls.push([file, ...args]);
    if (fail) throw new Error("launchctl failed");
    return "";
  };
  return { run, calls };
}

test("with a launchd job installed, a missing daemon is started by launchctl kickstart, not spawned", () => {
  const { run, calls } = recorder();
  let spawned = 0;
  const how = startDaemon({ installed: () => true, kickstart: () => kickstartLaunchd(run, 501), spawn: () => void spawned++ });
  assert.equal(how, "launchd");
  assert.equal(spawned, 0);
  assert.deepEqual(calls, [["launchctl", "kickstart", `gui/501/${LAUNCHD_LABEL}`]]);
});

test("without a launchd job, the CLI spawns a detached daemon and never calls launchctl", () => {
  const { run, calls } = recorder();
  let spawned = 0;
  const how = startDaemon({ installed: () => false, kickstart: () => kickstartLaunchd(run, 501), spawn: () => void spawned++ });
  assert.equal(how, "spawn");
  assert.equal(spawned, 1);
  assert.deepEqual(calls, []);
});

test("when launchctl refuses (job not loaded), the CLI falls back to spawning", () => {
  const { run } = recorder(true);
  let spawned = 0;
  const how = startDaemon({ installed: () => true, kickstart: () => kickstartLaunchd(run, 501), spawn: () => void spawned++ });
  assert.equal(how, "spawn");
  assert.equal(spawned, 1);
});

test("the plist check looks at the LaunchAgents plist for the job label", () => {
  const seen: string[] = [];
  assert.equal(launchdInstalled((p) => (seen.push(p), true), "/home/x"), true);
  assert.equal(launchdInstalled(() => false, "/home/x"), false);
  assert.deepEqual(seen, [launchdPlistPath("/home/x")]);
  assert.equal(launchdPlistPath("/home/x"), `/home/x/Library/LaunchAgents/${LAUNCHD_LABEL}.plist`);
});

test("launchdJobPid reads the pid line of launchctl print; no pid or a failure gives undefined", () => {
  const printed = (out: string): RunCommand => () => out;
  assert.equal(launchdJobPid(printed(`${LAUNCHD_LABEL} = {\n\tstate = running\n\tpid = 4242\n\tlast exit code = 0\n}`), 501), 4242);
  assert.equal(launchdJobPid(printed(`${LAUNCHD_LABEL} = {\n\tstate = waiting\n\tlast exit code = 0\n}`), 501), undefined);
  assert.equal(launchdJobPid(recorder(true).run, 501), undefined);
});

test("lockHolderPid parses the lock file and tolerates junk or a missing file", () => {
  assert.equal(lockHolderPid(() => "123\n"), 123);
  assert.equal(lockHolderPid(() => "abc"), undefined);
  assert.equal(lockHolderPid(() => { throw new Error("ENOENT"); }), undefined);
});

const base = { installed: () => true, lockPid: () => 100 as number | undefined, alive: () => true, jobPid: () => 100 as number | undefined, uid: 501 };

test("doctor warns when the daemon holding the lock is not the launchd job's process", () => {
  const warning = strayDaemonWarning({ ...base, jobPid: () => undefined });
  assert.match(warning ?? "", /daemon \(pid 100\) was not started by launchd/);
  assert.match(warning ?? "", /has no process/);
  assert.match(warning ?? "", new RegExp(`launchctl kickstart gui/501/${LAUNCHD_LABEL}`));
  assert.match(strayDaemonWarning({ ...base, jobPid: () => 200 }) ?? "", /runs pid 200/);
});

test("doctor stays quiet when launchd owns the daemon, no job is installed, or no daemon is alive", () => {
  assert.equal(strayDaemonWarning(base), undefined);
  assert.equal(strayDaemonWarning({ ...base, installed: () => false, jobPid: () => undefined }), undefined);
  assert.equal(strayDaemonWarning({ ...base, alive: () => false, jobPid: () => undefined }), undefined);
  assert.equal(strayDaemonWarning({ ...base, lockPid: () => undefined, jobPid: () => undefined }), undefined);
});
