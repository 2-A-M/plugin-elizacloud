/**
 * CloudAuthService — Device-based auto-signup and session management.
 *
 * On first launch, derives a hardware fingerprint and calls
 * POST /api/v1/device-auth. The cloud backend creates a user + org +
 * $5 credit + API key if new, or returns the existing session.
 */

import { type IAgentRuntime, logger, Service } from "@elizaos/core";
import type {
  CloudCredentials,
  DeviceAuthResponse,
  DevicePlatform,
} from "../types/cloud";
import { DEFAULT_CLOUD_CONFIG } from "../types/cloud";
import { CloudApiClient } from "../utils/cloud-api";

/** SHA-256 hash of hostname + platform + arch + cpu + memory. */
async function deriveDeviceId(): Promise<string> {
  const os = await import("node:os");
  const crypto = await import("node:crypto");
  const cpus = os.cpus();
  const raw = [
    os.hostname(),
    os.platform(),
    os.arch(),
    cpus[0]?.model ?? "?",
    cpus.length,
    os.totalmem(),
  ].join(":");
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function detectPlatform(): DevicePlatform {
  if (typeof process === "undefined") return "web";
  const map: Record<string, DevicePlatform> = {
    darwin: "macos",
    win32: "windows",
    linux: "linux",
  };
  return map[process.platform] ?? "linux";
}

export class CloudAuthService extends Service {
  static serviceType = "CLOUD_AUTH";
  capabilityDescription =
    "ElizaCloud device authentication and session management";

  private client: CloudApiClient;
  private credentials: CloudCredentials | null = null;

  constructor(runtime?: IAgentRuntime) {
    super(runtime);
    this.client = new CloudApiClient(DEFAULT_CLOUD_CONFIG.baseUrl);
  }

  static async start(runtime: IAgentRuntime): Promise<Service> {
    const service = new CloudAuthService(runtime);
    await service.initialize();
    return service;
  }

  async stop(): Promise<void> {
    this.credentials = null;
  }

  private async initialize(): Promise<void> {
    const baseUrl = String(
      this.runtime.getSetting("ELIZAOS_CLOUD_BASE_URL") ??
        DEFAULT_CLOUD_CONFIG.baseUrl,
    );
    this.client.setBaseUrl(baseUrl);

    // Try existing API key first.  If the key is present in settings
    // (persisted via config file or character secrets in the DB), trust it
    // immediately so the agent is functional even when the cloud API is
    // temporarily unreachable.  A background validation fires to confirm
    // the key — if it turns out to be revoked the next model call will
    // surface the error, but the agent won't stall on startup.
    const existingKey = this.runtime.getSetting("ELIZAOS_CLOUD_API_KEY");
    if (existingKey) {
      const key = String(existingKey);
      this.client.setApiKey(key);

      // Accept the key optimistically — no blocking network call.
      this.credentials = {
        apiKey: key,
        userId: String(
          this.runtime.getSetting("ELIZAOS_CLOUD_USER_ID") ?? "",
        ),
        organizationId: String(
          this.runtime.getSetting("ELIZAOS_CLOUD_ORG_ID") ?? "",
        ),
        authenticatedAt: Date.now(),
      };
      logger.info("[CloudAuth] Authenticated with saved API key");

      // Non-blocking validation — if the key is invalid the next model
      // call will surface the error; we just log a warning here.
      this.validateApiKey(key).then((valid) => {
        if (!valid) {
          logger.warn(
            "[CloudAuth] Saved API key could not be validated (cloud may be unreachable or key revoked) — model calls will use the key anyway",
          );
        }
      }).catch(() => {
        // Swallow — already logged inside validateApiKey
      });
      return;
    }

    // Device-based auto-signup when explicitly enabled
    const enabled = this.runtime.getSetting("ELIZAOS_CLOUD_ENABLED");
    if (enabled === "true" || enabled === "1") {
      try {
        await this.authenticateWithDevice();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          `[CloudAuth] Device auth failed (cloud may be unreachable): ${msg}`,
        );
        logger.info(
          "[CloudAuth] Service will start unauthenticated — cloud features disabled until connectivity is restored",
        );
      }
    } else {
      logger.info(
        "[CloudAuth] Cloud not enabled (set ELIZAOS_CLOUD_ENABLED=true)",
      );
    }
  }

  private async validateApiKey(key: string): Promise<boolean> {
    try {
      const resp = await fetch(`${this.client.getBaseUrl()}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000),
      });
      return resp.ok;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        `[CloudAuth] Could not reach cloud API to validate key: ${msg}`,
      );
      return false;
    }
  }

  async authenticateWithDevice(): Promise<CloudCredentials> {
    const deviceId = await deriveDeviceId();
    const platform = detectPlatform();
    const appVersion = process.env.ELIZAOS_CLOUD_APP_VERSION ?? "2.0.0-alpha";
    const os = await import("node:os");

    logger.info(`[CloudAuth] Authenticating device (platform=${platform})`);

    const response = await this.client.postUnauthenticated<DeviceAuthResponse>(
      "/device-auth",
      {
        deviceId,
        platform,
        appVersion,
        deviceName: os.hostname(),
      },
    );

    this.credentials = {
      apiKey: response.data.apiKey,
      userId: response.data.userId,
      organizationId: response.data.organizationId,
      authenticatedAt: Date.now(),
    };
    this.client.setApiKey(response.data.apiKey);

    const action = response.data.isNew
      ? "New account created"
      : "Authenticated";
    logger.info(
      `[CloudAuth] ${action} (credits: $${response.data.credits.toFixed(2)})`,
    );

    return this.credentials;
  }

  isAuthenticated(): boolean {
    return this.credentials !== null;
  }
  getCredentials(): CloudCredentials | null {
    return this.credentials;
  }
  getApiKey(): string | undefined {
    return this.credentials?.apiKey ?? this.client.getApiKey();
  }
  getClient(): CloudApiClient {
    return this.client;
  }
  getUserId(): string | undefined {
    return this.credentials?.userId;
  }
  getOrganizationId(): string | undefined {
    return this.credentials?.organizationId;
  }
}
