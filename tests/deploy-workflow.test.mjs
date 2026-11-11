import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// GitHub runs this workflow, so these checks keep its production safeguards from being edited away.
const workflow = readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
const jobs = Object.fromEntries(workflow.slice(workflow.indexOf("\njobs:\n")).split(/^ {2}(?=[\w-]+:$)/m).slice(1)
  .map((job) => [job.slice(0, job.indexOf(":")), job]));
const steps = jobs.deploy.split(/^ {6}- /m).slice(1);

test("only main can build, publish or deploy a production image", () => {
  assert.match(jobs.deploy, /^ {4}if: github\.ref == 'refs\/heads\/main'$/m);
  for (const [name, job] of Object.entries(jobs)) {
    if (name !== "deploy") assert.doesNotMatch(job, /secrets\.|docker\/|ssh|dokku/, `${name} must not reach production`);
  }
  // A run from another branch queues separately, so it can't replace a deploy from main that is waiting to start.
  assert.match(workflow, /^ {2}group: deploy-\$\{\{ github\.ref \}\}$/m);
});

test("every SSH connection trusts only the verified host key from secrets", () => {
  assert.doesNotMatch(workflow, /ssh-keyscan|StrictHostKeyChecking=(no|accept-new)|UserKnownHostsFile/);
  const connecting = steps.filter((step) => /\bssh -/.test(step));
  assert.equal(connecting.length, 2);
  for (const step of connecting) {
    const variable = step.match(/^ {10}(\w+): \$\{\{ secrets\.TRAVEL_BACKUP_KNOWN_HOSTS \}\}$/m)?.[1];
    assert.ok(variable, "the step reads the pinned host key");
    assert.ok(step.includes(`: "\${${variable}:?`), "a missing host key stops the step");
    assert.ok(step.includes(`printf '%s\\n' "$${variable}" > ~/.ssh/known_hosts`), "known_hosts holds only the pinned key");
    for (const command of step.match(/\bssh -.*/g)) assert.match(command, /^ssh -o BatchMode=yes -o StrictHostKeyChecking=yes /);
  }
});

test("Dokku allows 20m request bodies before the image is deployed", () => {
  const deploy = steps.find((step) => step.startsWith("name: Deploy to Dokku"));
  const limit = deploy.indexOf('dokku nginx:set "$APP" client-max-body-size 20m');
  assert.ok(limit > 0 && limit < deploy.indexOf("dokku git:from-image"));
});
