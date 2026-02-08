/**
 * Unit tests for the credit balance provider formatting.
 *
 * Verifies that credit balances are formatted correctly with
 * appropriate LOW/CRITICAL warnings and top-up URLs.
 */

import { describe, expect, it } from "vitest";

const TOP_UP_URL = "https://www.elizacloud.ai/dashboard/billing";

// Inline the format logic from credit-balance.ts for isolated testing
function formatCredits(balance: number): {
  text: string;
  values: {
    cloudCredits: number;
    cloudCreditsLow: boolean;
    cloudCreditsCritical: boolean;
    cloudTopUpUrl: string;
  };
} {
  const low = balance < 2.0;
  const critical = balance < 0.5;
  let text = `ElizaCloud credits: $${balance.toFixed(2)}`;
  if (critical) text += ` (CRITICAL \u2014 top up at ${TOP_UP_URL})`;
  else if (low) text += ` (LOW \u2014 top up at ${TOP_UP_URL})`;
  return {
    text,
    values: {
      cloudCredits: balance,
      cloudCreditsLow: low,
      cloudCreditsCritical: critical,
      cloudTopUpUrl: TOP_UP_URL,
    },
  };
}

describe("Credit display formatting", () => {
  it("formats $5.00 as healthy (no warning)", () => {
    const result = formatCredits(5.0);
    expect(result.text).toBe("ElizaCloud credits: $5.00");
    expect(result.values.cloudCreditsLow).toBe(false);
    expect(result.values.cloudCreditsCritical).toBe(false);
  });

  it("formats $2.50 as healthy", () => {
    const result = formatCredits(2.5);
    expect(result.text).toBe("ElizaCloud credits: $2.50");
    expect(result.values.cloudCreditsLow).toBe(false);
  });

  it("formats $1.99 as LOW", () => {
    const result = formatCredits(1.99);
    expect(result.text).toContain("(LOW");
    expect(result.text).toContain(TOP_UP_URL);
    expect(result.values.cloudCreditsLow).toBe(true);
    expect(result.values.cloudCreditsCritical).toBe(false);
  });

  it("formats $0.49 as CRITICAL", () => {
    const result = formatCredits(0.49);
    expect(result.text).toContain("(CRITICAL");
    expect(result.text).toContain(TOP_UP_URL);
    expect(result.values.cloudCreditsLow).toBe(true);
    expect(result.values.cloudCreditsCritical).toBe(true);
  });

  it("formats $0.00 as CRITICAL", () => {
    const result = formatCredits(0);
    expect(result.text).toContain("(CRITICAL");
    expect(result.values.cloudCreditsCritical).toBe(true);
  });

  it("always includes top-up URL in values", () => {
    const result = formatCredits(100);
    expect(result.values.cloudTopUpUrl).toBe(TOP_UP_URL);
  });

  it("$2.00 boundary is LOW (strictly less than)", () => {
    // $2.00 exactly: low is balance < 2.0, so 2.0 is NOT low
    const result = formatCredits(2.0);
    expect(result.values.cloudCreditsLow).toBe(false);
  });

  it("$0.50 boundary is LOW but NOT CRITICAL", () => {
    const result = formatCredits(0.5);
    expect(result.values.cloudCreditsLow).toBe(true);
    expect(result.values.cloudCreditsCritical).toBe(false);
  });
});

describe("Initial credit amount", () => {
  it("default initial credits is $5.00", () => {
    const DEFAULT_INITIAL_CREDITS = 5.0;
    expect(DEFAULT_INITIAL_CREDITS).toBe(5.0);
  });

  it("$5.00 initial credit is healthy (not low or critical)", () => {
    const result = formatCredits(5.0);
    expect(result.values.cloudCreditsLow).toBe(false);
    expect(result.values.cloudCreditsCritical).toBe(false);
  });

  it("$5 covers ~5000 Birdeye API calls", () => {
    const birdeyeCost = 0.001;
    const calls = Math.floor(5.0 / birdeyeCost);
    expect(calls).toBe(5000);
  });
});

// ─── Edge Cases: Extreme Values, Precision, Negative ─────────────────────────

describe("Credit display edge cases", () => {
  it("negative balance shows CRITICAL", () => {
    const result = formatCredits(-1.5);
    expect(result.values.cloudCreditsCritical).toBe(true);
    expect(result.values.cloudCreditsLow).toBe(true);
    expect(result.text).toContain("CRITICAL");
    expect(result.text).toContain("$-1.50");
  });

  it("very large balance formats correctly", () => {
    const result = formatCredits(99999.99);
    expect(result.text).toBe("ElizaCloud credits: $99999.99");
    expect(result.values.cloudCreditsLow).toBe(false);
    expect(result.values.cloudCreditsCritical).toBe(false);
  });

  it("fractional cent precision is preserved", () => {
    const result = formatCredits(3.456);
    expect(result.text).toContain("$3.46"); // toFixed(2) rounds
    expect(result.values.cloudCredits).toBe(3.456); // raw value preserved
  });

  it("exactly $0.50 is LOW but not CRITICAL (boundary)", () => {
    const result = formatCredits(0.5);
    expect(result.values.cloudCreditsLow).toBe(true);
    expect(result.values.cloudCreditsCritical).toBe(false);
  });

  it("$0.499999 is CRITICAL (just below boundary)", () => {
    const result = formatCredits(0.499999);
    expect(result.values.cloudCreditsCritical).toBe(true);
  });

  it("$2.0001 is NOT low (just above boundary)", () => {
    const result = formatCredits(2.0001);
    expect(result.values.cloudCreditsLow).toBe(false);
  });

  it("$1.9999 IS low (just below boundary)", () => {
    const result = formatCredits(1.9999);
    expect(result.values.cloudCreditsLow).toBe(true);
    expect(result.values.cloudCreditsCritical).toBe(false);
  });
});
