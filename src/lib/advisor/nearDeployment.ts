/**
 * Which code an attested NEAR AI enclave runs.
 *
 * `@nearai/inference-sdk` proves that a quote comes from a genuine Intel TDX machine and binds our
 * nonce and the model key to it, but by default it accepts any deployment: anyone who rents a TDX
 * machine can run their own code and pass. This check pins the deployment to NEAR's:
 *
 * 1. The measured launcher configuration (`appCompose`, bound to the quote by MRCONFIGID) must be
 *    one of NEAR's launcher templates below. Only the machine label, the telemetry endpoint and the
 *    dstack version name may differ; image digests and the pre-launch script may not.
 * 2. The compose manager the launcher started must be the image that template names.
 * 3. Every deployment file the manager brought up since it started must be a file of NEAR's public
 *    repository at the recorded commit, with the recorded SHA-256.
 *
 * Not covered (README, Limitations): which builds the model-serving images come from (the SDK's
 * provenance helper cannot read NEAR's compose files, which set images through YAML anchors), and
 * whether a deployment commit is on NEAR's main branch rather than in a fork.
 *
 * Kept free of `@/` imports: it runs under plain `node --test`.
 */

/** Launcher templates seen in NEAR AI's production attestations, by `launcherTemplateHash`. */
export const NEAR_LAUNCHER_TEMPLATES: Readonly<Record<string, string>> = {
  // dstack-nvidia 0.5.11 and 0.5.12 launchers: all 9 GLM 5.3 Flash, Qwen3.8 27B, DeepSeek V4.1 Flash
  // abliterated and FLUX.2 klein enclaves on 2026-11-23. When NEAR updates it, add the new hash here
  // (the error names it) after checking the change, or set NEXT_PUBLIC_NEAR_DEPLOYMENT_CHECK=warn.
  cfc0bae3a21b5d580542e4c2f5de7e95369db22b5a768fb8867a2c247b87962c: "NEAR AI launcher, dstack-nvidia 0.5.11–0.5.12",
};

export const NEAR_COMPOSE_REPOSITORY = "nearai/cvm-compose-files";

/** Telemetry endpoints NEAR's launchers report to; the launcher template is otherwise identical. */
const TELEMETRY_ENDPOINTS = ["https://telemetry.infra.near.ai", "https://telemetry-stg.infra.near.ai"];

export type DeploymentAction = Readonly<Record<string, unknown>>;

/** What the SDK hands a deployment verifier (a subset of its `MeasuredDeployment`). */
export type MeasuredDeploymentLike = {
  readonly appCompose: string;
  readonly composeManager?: { readonly actions: readonly DeploymentAction[] };
};

export type DeploymentCheck = {
  readonly template: string;
  readonly managerImage: string;
  readonly composeFiles: readonly { commit: string; file: string }[];
};

export class DeploymentNotRecognised extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.reason = reason;
    this.name = "DeploymentNotRecognised";
  }
}

export type DeploymentCheckDeps = {
  /** Fetch a URL's body as text; throws on a non-2xx answer. */
  readonly fetchText: (url: string) => Promise<string>;
  /** Remembers deployment files already proven, so a reload does not fetch them again. */
  readonly cache?: { has(key: string): boolean; add(key: string): void };
};

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** JSON with keys sorted at every level, so key order in NEAR's file cannot change the hash. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseAppCompose(appCompose: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(appCompose) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new DeploymentNotRecognised("launcher_unreadable", "The enclave's launcher configuration is not valid JSON.");
}

/** Hash of the launcher configuration with the per-machine fields masked. */
export async function launcherTemplateHash(appCompose: string): Promise<string> {
  const config = parseAppCompose(appCompose);
  const name = typeof config.name === "string" ? config.name.replace(/^dstack-nvidia-\d+\.\d+\.\d+$/, "dstack-nvidia-<version>") : config.name;
  let compose = typeof config.docker_compose_file === "string" ? config.docker_compose_file : "";
  compose = compose.replace(/INSTANCE_LABEL=[A-Za-z0-9._-]+/g, "INSTANCE_LABEL=<label>");
  for (const endpoint of TELEMETRY_ENDPOINTS) compose = compose.split(endpoint).join("<telemetry>");
  return sha256Hex(canonical({ ...config, name, docker_compose_file: compose }));
}

/** The compose manager image the launcher template starts by default. */
export function templateManagerImage(appCompose: string): string | null {
  const compose = parseAppCompose(appCompose).docker_compose_file;
  if (typeof compose !== "string") return null;
  const match = compose.match(/COMPOSE_MANAGER_IMAGE:-(nearaidev\/compose-manager@sha256:[0-9a-f]{64})\}/);
  return match ? match[1] : null;
}

const COMMIT = /^[0-9a-f]{40}$/;
const FILE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const isRepoPath = (file: string) => FILE.test(file) && file.split("/").every((part) => part !== "." && part !== "..");
const SHA256 = /^[0-9a-f]{64}$/;

export async function checkNearDeployment(deployment: MeasuredDeploymentLike, deps: DeploymentCheckDeps): Promise<DeploymentCheck> {
  const template = await launcherTemplateHash(deployment.appCompose);
  if (!(template in NEAR_LAUNCHER_TEMPLATES)) {
    throw new DeploymentNotRecognised(
      "launcher_unknown",
      `The enclave's launcher is not one of NEAR AI's known launchers (template ${template.slice(0, 12)}).`
    );
  }

  const actions = deployment.composeManager?.actions ?? [];
  const startIndex = actions.map((a) => a.action).lastIndexOf("compose_manager_started");
  if (startIndex < 0) {
    throw new DeploymentNotRecognised("manager_missing", "The enclave did not report starting NEAR AI's deployment manager.");
  }
  const expectedManager = templateManagerImage(deployment.appCompose);
  const startedManager = actions[startIndex].image;
  if (!expectedManager || startedManager !== expectedManager) {
    throw new DeploymentNotRecognised("manager_mismatch", "The enclave runs a deployment manager other than the one NEAR AI's launcher names.");
  }

  const files = new Map<string, { commit: string; file: string; sha: string }>();
  for (const action of actions.slice(startIndex + 1)) {
    if (action.action !== "compose_up") continue;
    const { commit, file, file_sha256: sha } = action as { commit?: unknown; file?: unknown; file_sha256?: unknown };
    if (typeof commit !== "string" || typeof file !== "string" || typeof sha !== "string" || !COMMIT.test(commit) || !isRepoPath(file) || !SHA256.test(sha)) {
      throw new DeploymentNotRecognised("deployment_unreadable", "The enclave reported a deployment without a commit, file and hash.");
    }
    files.set(`${commit}:${file}:${sha}`, { commit, file, sha });
  }
  if (files.size === 0) {
    throw new DeploymentNotRecognised("deployment_missing", "The enclave reported no deployment since its manager started.");
  }

  for (const [key, { commit, file, sha }] of files) {
    if (deps.cache?.has(key)) continue;
    const url = `https://raw.githubusercontent.com/${NEAR_COMPOSE_REPOSITORY}/${commit}/${file}`;
    let body: string;
    try {
      body = await deps.fetchText(url);
    } catch {
      throw new DeploymentNotRecognised("deployment_unpublished", `NEAR AI's repository has no ${file} at ${commit.slice(0, 8)}.`);
    }
    if ((await sha256Hex(body)) !== sha) {
      throw new DeploymentNotRecognised("deployment_mismatch", `${file} at ${commit.slice(0, 8)} differs from what the enclave runs.`);
    }
    deps.cache?.add(key);
  }

  return {
    template,
    managerImage: startedManager as string,
    composeFiles: [...files.values()].map(({ commit, file }) => ({ commit, file })),
  };
}
