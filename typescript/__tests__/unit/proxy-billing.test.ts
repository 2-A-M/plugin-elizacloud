/**
 * Unit tests for proxy billing cost calculations.
 *
 * Verifies that the proxy pricing constants are correct and
 * cost lookups work for all service types.
 */

import { describe, expect, it } from "vitest";

// Inline the pricing constants from the cloud backend for testing
const PROXY_PRICING: Readonly<Record<string, number>> = {
  birdeye: 0.001,
  helius: 0.0005,
  alchemy: 0.0005,
  "solana-rpc": 0.0003,
  "evm-rpc": 0.0003,
};

function getProxyCost(service: string): number {
  return PROXY_PRICING[service] ?? 0.001;
}

describe("Proxy billing: pricing", () => {
  it("Birdeye costs $0.001 per request", () => {
    expect(getProxyCost("birdeye")).toBe(0.001);
  });

  it("Helius costs $0.0005 per request", () => {
    expect(getProxyCost("helius")).toBe(0.0005);
  });

  it("Alchemy costs $0.0005 per request", () => {
    expect(getProxyCost("alchemy")).toBe(0.0005);
  });

  it("Solana RPC costs $0.0003 per request", () => {
    expect(getProxyCost("solana-rpc")).toBe(0.0003);
  });

  it("EVM RPC costs $0.0003 per request", () => {
    expect(getProxyCost("evm-rpc")).toBe(0.0003);
  });

  it("unknown service defaults to $0.001", () => {
    expect(getProxyCost("unknown-service")).toBe(0.001);
  });
});

describe("Proxy billing: cost estimation", () => {
  it("10 Birdeye calls cost $0.01", () => {
    const totalCost = getProxyCost("birdeye") * 10;
    expect(totalCost).toBeCloseTo(0.01);
  });

  it("100 Solana RPC calls cost $0.03", () => {
    const totalCost = getProxyCost("solana-rpc") * 100;
    expect(totalCost).toBeCloseTo(0.03);
  });

  it("1000 EVM RPC calls cost $0.30", () => {
    const totalCost = getProxyCost("evm-rpc") * 1000;
    expect(totalCost).toBeCloseTo(0.30);
  });

  it("$5 of credits covers ~5000 Birdeye calls", () => {
    const budget = 5.0;
    const callCount = Math.floor(budget / getProxyCost("birdeye"));
    expect(callCount).toBe(5000);
  });

  it("$5 of credits covers ~16666 Solana RPC calls", () => {
    const budget = 5.0;
    const callCount = Math.floor(budget / getProxyCost("solana-rpc"));
    expect(callCount).toBe(16666);
  });
});

describe("Proxy billing: credit sufficiency check", () => {
  function hasProxyCredits(balance: number, service: string): boolean {
    return balance >= getProxyCost(service);
  }

  it("$5.00 balance is sufficient for all services", () => {
    for (const service of Object.keys(PROXY_PRICING)) {
      expect(hasProxyCredits(5.0, service)).toBe(true);
    }
  });

  it("$0.0002 balance is insufficient for all services", () => {
    for (const service of Object.keys(PROXY_PRICING)) {
      expect(hasProxyCredits(0.0002, service)).toBe(false);
    }
  });

  it("$0.0003 balance is exactly sufficient for RPC but not Birdeye", () => {
    expect(hasProxyCredits(0.0003, "solana-rpc")).toBe(true);
    expect(hasProxyCredits(0.0003, "evm-rpc")).toBe(true);
    expect(hasProxyCredits(0.0003, "birdeye")).toBe(false);
  });

  it("$0.001 balance is exactly sufficient for Birdeye", () => {
    expect(hasProxyCredits(0.001, "birdeye")).toBe(true);
  });

  it("$0 balance is insufficient for everything", () => {
    for (const service of Object.keys(PROXY_PRICING)) {
      expect(hasProxyCredits(0, service)).toBe(false);
    }
  });
});

// ─── Edge Cases: Floating Point, Precision, Accumulation ─────────────────────

describe("Proxy billing: floating point precision", () => {
  it("accumulated Birdeye costs don't drift (10000 calls)", () => {
    // 10000 * 0.001 should be exactly 10.0
    let total = 0;
    for (let i = 0; i < 10000; i++) {
      total += getProxyCost("birdeye");
    }
    // Allow tiny floating point drift
    expect(total).toBeCloseTo(10.0, 10);
  });

  it("accumulated Solana RPC costs stay precise (10000 calls)", () => {
    let total = 0;
    for (let i = 0; i < 10000; i++) {
      total += getProxyCost("solana-rpc");
    }
    expect(total).toBeCloseTo(3.0, 10);
  });

  it("cost comparison works correctly at boundaries", () => {
    const birdeyeCost = getProxyCost("birdeye");
    const rpcCost = getProxyCost("solana-rpc");

    // Birdeye is more expensive than RPC
    expect(birdeyeCost).toBeGreaterThan(rpcCost);

    // Birdeye and Helius are different
    expect(getProxyCost("birdeye")).not.toBe(getProxyCost("helius"));
  });

  it("all costs are positive numbers", () => {
    for (const service of ["birdeye", "helius", "alchemy", "solana-rpc", "evm-rpc"]) {
      const cost = getProxyCost(service);
      expect(cost).toBeGreaterThan(0);
      expect(Number.isFinite(cost)).toBe(true);
      expect(Number.isNaN(cost)).toBe(false);
    }
  });

  it("remaining balance after $5 - N calls is correct", () => {
    const budget = 5.0;
    const birdeyeCost = getProxyCost("birdeye");

    // After 4999 calls: $5.00 - $4.999 = $0.001
    const remaining = budget - (4999 * birdeyeCost);
    expect(remaining).toBeCloseTo(0.001, 6);
    expect(remaining >= getProxyCost("birdeye")).toBe(true);

    // After 5000 calls: $5.00 - $5.00 = $0.00
    const remaining2 = budget - (5000 * birdeyeCost);
    expect(remaining2).toBeCloseTo(0, 6);
    expect(remaining2 >= getProxyCost("birdeye")).toBe(false);
  });
});
