import * as http from "node:http";
import type { IAgentRuntime, Memory, MessageProcessingResult } from "@elizaos/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudManagedGatewayRelayService } from "../services/cloud-managed-gateway-relay";
import { CloudApiClient } from "../utils/cloud-api";

const AGENT_ID = "00000000-0000-4000-8000-000000000001";

type PendingRelayRequest = {
  requestId: string;
  rpc: {
    jsonrpc: "2.0";
    id?: string | number;
    method: string;
    params?: Record<string, unknown>;
  };
  queuedAt: string;
};

let server: http.Server;
let baseUrl: string;
let pendingRequests: PendingRelayRequest[] = [];
let registeredSessions: Array<Record<string, unknown>> = [];
let submittedResponses: Array<Record<string, unknown>> = [];
let deletedSessions: string[] = [];

function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error("Timed out waiting for condition"));
        return;
      }
      setTimeout(tick, 25);
    };
    tick();
  });
}

function createRuntimeStub(): {
  runtime: IAgentRuntime;
  ensureConnection: ReturnType<typeof vi.fn>;
  createMemory: ReturnType<typeof vi.fn>;
} {
  const ensureConnection = vi.fn().mockResolvedValue(undefined);
  const createMemory = vi.fn().mockResolvedValue(undefined);

  const runtime = {
    agentId: AGENT_ID,
    character: {
      name: "Local Milady",
    },
    messageService: {
      handleMessage: vi.fn(
        async (
          _runtime: IAgentRuntime,
          message: Memory,
          callback?: (content: {
            text?: string;
            source?: string;
            channelType?: string;
          }) => Promise<Memory[]>
        ): Promise<MessageProcessingResult> => {
          expect(message.content.text).toBe("hello from discord");
          expect(message.content.source).toBe("discord");
          expect(message.metadata).toMatchObject({
            entityName: "Owner Person",
          });

          if (callback) {
            await callback({
              text: "Local reply",
              source: "discord",
              channelType: "DM",
            });
          }

          return {
            didRespond: true,
            responseContent: { text: "Local reply", source: "discord", channelType: "DM" },
            responseMessages: [],
          };
        }
      ),
    },
    ensureConnection,
    createMemory,
    getService: vi.fn(),
  } as unknown as IAgentRuntime;

  return { runtime, ensureConnection, createMemory };
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const path = url.pathname;
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf-8")) : {};

      res.setHeader("Content-Type", "application/json");

      if (req.method === "POST" && path === "/api/v1/milady/gateway-relay/sessions") {
        registeredSessions.push(body);
        res.writeHead(200);
        res.end(
          JSON.stringify({
            success: true,
            data: {
              session: {
                id: "session-1",
                organizationId: "org-1",
                userId: "user-1",
                runtimeAgentId: body.runtimeAgentId,
                agentName: body.agentName,
                platform: "local-runtime",
                createdAt: "2026-04-10T00:00:00.000Z",
                lastSeenAt: "2026-04-10T00:00:00.000Z",
              },
            },
          })
        );
        return;
      }

      if (req.method === "GET" && path === "/api/v1/milady/gateway-relay/sessions/session-1/next") {
        const request = pendingRequests.shift() ?? null;
        res.writeHead(200);
        res.end(
          JSON.stringify({
            success: true,
            data: {
              request,
            },
          })
        );
        return;
      }

      if (
        req.method === "POST" &&
        path === "/api/v1/milady/gateway-relay/sessions/session-1/responses"
      ) {
        submittedResponses.push(body);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
        return;
      }

      if (req.method === "DELETE" && path === "/api/v1/milady/gateway-relay/sessions/session-1") {
        deletedSessions.push("session-1");
        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ success: false, error: "Not found" }));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  pendingRequests = [];
  registeredSessions = [];
  submittedResponses = [];
  deletedSessions = [];
});

afterEach(() => {
  delete process.env.MILADY_CLOUD_PROVISIONED;
  delete process.env.ELIZA_CLOUD_PROVISIONED;
});

describe("CloudManagedGatewayRelayService", () => {
  it("registers a local runtime, handles a relayed message, and disconnects on stop", async () => {
    pendingRequests.push({
      requestId: "request-1",
      queuedAt: "2026-04-10T00:00:01.000Z",
      rpc: {
        jsonrpc: "2.0",
        id: "rpc-1",
        method: "message.send",
        params: {
          text: "hello from discord",
          roomId: "discord-dm:discord-user-1:channel:dm-1",
          channelType: "DM",
          source: "discord",
          sender: {
            id: "discord-user-1",
            username: "owner",
            displayName: "Owner Person",
          },
          metadata: {
            discord: {
              channelId: "dm-1",
              messageId: "message-1",
            },
          },
        },
      },
    });

    const { runtime, ensureConnection, createMemory } = createRuntimeStub();
    const authService = {
      isAuthenticated: () => true,
      getApiKey: () => "token-1",
      getClient: () => new CloudApiClient(`${baseUrl}/api/v1`, "token-1"),
    };
    (runtime.getService as ReturnType<typeof vi.fn>).mockImplementation((serviceType: string) =>
      serviceType === "CLOUD_AUTH" ? authService : null
    );

    const service = (await CloudManagedGatewayRelayService.start(
      runtime
    )) as CloudManagedGatewayRelayService;

    await waitFor(() => submittedResponses.length === 1);

    expect(registeredSessions).toEqual([
      {
        runtimeAgentId: AGENT_ID,
        agentName: "Local Milady",
      },
    ]);
    expect(ensureConnection).toHaveBeenCalledTimes(1);
    expect(ensureConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "discord",
        channelId: "discord-dm:discord-user-1:channel:dm-1",
        type: "DM",
      })
    );
    expect(createMemory).toHaveBeenCalledTimes(1);
    expect(submittedResponses[0]).toMatchObject({
      requestId: "request-1",
      response: {
        jsonrpc: "2.0",
        id: "rpc-1",
        result: {
          text: "Local reply",
          didRespond: true,
          runtimeAgentId: AGENT_ID,
        },
      },
    });

    await service.stop();

    expect(deletedSessions).toEqual(["session-1"]);
  });

  it("does not register when the runtime itself is already cloud provisioned", async () => {
    process.env.MILADY_CLOUD_PROVISIONED = "1";

    const { runtime } = createRuntimeStub();
    const authService = {
      isAuthenticated: () => true,
      getApiKey: () => "token-1",
      getClient: () => new CloudApiClient(`${baseUrl}/api/v1`, "token-1"),
    };
    (runtime.getService as ReturnType<typeof vi.fn>).mockImplementation((serviceType: string) =>
      serviceType === "CLOUD_AUTH" ? authService : null
    );

    const service = (await CloudManagedGatewayRelayService.start(
      runtime
    )) as CloudManagedGatewayRelayService;

    await sleep(250);
    await service.stop();

    expect(registeredSessions).toHaveLength(0);
    expect(submittedResponses).toHaveLength(0);
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
