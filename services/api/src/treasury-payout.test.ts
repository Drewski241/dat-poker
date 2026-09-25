import { afterEach, describe, expect, it } from "vitest";
import {
  computeWithdrawPayout,
  inspectTreasuryPayout,
  looksLikeXchAddress,
  onChainSageWithdrawEnabled,
  treasuryPayoutHealthUrl,
  treasurySelfPayoutError,
} from "./treasury-payout.js";

describe("computeWithdrawPayout", () => {
  it("pays net winnings for virtual buy-in", () => {
    expect(computeWithdrawPayout(1_050_000n, 1_000_000n, "net")).toBe(50_000n);
  });

  it("returns zero when stack is below buy-in", () => {
    expect(computeWithdrawPayout(900_000n, 1_000_000n, "net")).toBe(0n);
  });

  it("pays full stack in full mode", () => {
    expect(computeWithdrawPayout(1_050_000n, 1_000_000n, "full")).toBe(1_050_000n);
  });
});

describe("onChainSageWithdrawEnabled", () => {
  afterEach(() => {
    delete process.env.DAT_ENABLE_ONCHAIN_WITHDRAW;
    delete process.env.DAT_TREASURY_PAYOUT_URL;
    delete process.env.TREASURY_XCH_ADDRESS;
  });

  it("is off when no treasury URL is configured", () => {
    delete process.env.DAT_ENABLE_ONCHAIN_WITHDRAW;
    delete process.env.DAT_TREASURY_PAYOUT_URL;
    expect(onChainSageWithdrawEnabled()).toBe(false);
  });

  it("defaults on when a treasury URL is set", () => {
    delete process.env.DAT_ENABLE_ONCHAIN_WITHDRAW;
    process.env.DAT_TREASURY_PAYOUT_URL = "http://127.0.0.1:4200/payout";
    expect(onChainSageWithdrawEnabled()).toBe(true);
  });

  it("can be forced off even when a treasury URL is set", () => {
    process.env.DAT_ENABLE_ONCHAIN_WITHDRAW = "false";
    process.env.DAT_TREASURY_PAYOUT_URL = "http://127.0.0.1:4200/payout";
    expect(onChainSageWithdrawEnabled()).toBe(false);
  });

  it("rejects the treasury Sage address", () => {
    process.env.TREASURY_XCH_ADDRESS = "xch1treasurywalletaddress";
    expect(treasurySelfPayoutError("xch1treasurywalletaddress")).toMatch(/treasury wallet/i);
    expect(treasurySelfPayoutError("xch1playerwalletaddress00")).toBeNull();
    expect(looksLikeXchAddress("xch1sngunlock")).toBe(true);
  });

  it("maps /payout to /health and reports a refused localhost ping", async () => {
    expect(treasuryPayoutHealthUrl("http://localhost:4200/payout")).toBe("http://localhost:4200/health");
    expect(treasuryPayoutHealthUrl("http://10.0.0.8:4200/payout/")).toBe("http://10.0.0.8:4200/health");
    const ping = await inspectTreasuryPayout("http://127.0.0.1:9/payout");
    expect(ping.reachable).toBe(false);
    expect(ping.host).toBe("127.0.0.1:9");
    expect(ping.error).toMatch(/127\.0\.0\.1:9/i);
    expect(ping.walletRpcReachable).toBeNull();
    expect(ping.walletConfigured).toBeNull();
  });

  it("surfaces Sage login errors from treasury /health", async () => {
    const { createServer } = await import("node:http");
    const server = createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            offerMode: "rpc",
            walletConfigured: true,
            walletRpcReachable: false,
            walletError: "sudo SAGE_CREATE_KEY=1 bash enable-treasury-sage.sh",
            sageFingerprint: null,
          }),
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const ping = await inspectTreasuryPayout(`http://127.0.0.1:${port}/payout`);
    expect(ping.reachable).toBe(true);
    expect(ping.walletConfigured).toBe(true);
    expect(ping.walletRpcReachable).toBe(false);
    expect(ping.error).toMatch(/SAGE_CREATE_KEY=1/);
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("reads walletRpcReachable from treasury /health", async () => {
    const { createServer } = await import("node:http");
    const server = createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok", offerMode: "rpc", walletRpcReachable: false }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const ping = await inspectTreasuryPayout(`http://127.0.0.1:${port}/payout`);
    expect(ping.reachable).toBe(true);
    expect(ping.offerMode).toBe("rpc");
    expect(ping.walletRpcReachable).toBe(false);
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("surfaces a spendable-coin walletError while Sage RPC is reachable", async () => {
    const { createServer } = await import("node:http");
    const server = createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            offerMode: "rpc",
            walletConfigured: true,
            walletRpcReachable: true,
            walletError: "Treasury Sage has not finished syncing this key",
            datSelectableMojos: "0",
          }),
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const ping = await inspectTreasuryPayout(`http://127.0.0.1:${port}/payout`);
    expect(ping.reachable).toBe(true);
    expect(ping.walletRpcReachable).toBe(true);
    expect(ping.error).toMatch(/not finished syncing/i);
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("treats missing Sage certs as a treasury error while HTTP is up", async () => {
    const { createServer } = await import("node:http");
    const server = createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            offerMode: "rpc",
            walletConfigured: false,
            walletError: "run enable-treasury-sage.sh",
          }),
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const ping = await inspectTreasuryPayout(`http://127.0.0.1:${port}/payout`);
    expect(ping.reachable).toBe(true);
    expect(ping.walletConfigured).toBe(false);
    expect(ping.error).toMatch(/enable-treasury-sage\.sh/);
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });
});
