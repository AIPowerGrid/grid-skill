export interface DarkDeploymentOptions {
  localUrl?: string;
  publicOrigin?: string;
  fetchImpl?: typeof globalThis.fetch;
}

export interface DarkDeploymentResult {
  status: "ready_dark";
  local_health: "private_ready";
  public_mcp: "auth_challenge_ready";
  oauth: "disabled";
}

export function verifyDarkDeployment(
  options?: DarkDeploymentOptions,
): Promise<DarkDeploymentResult>;
