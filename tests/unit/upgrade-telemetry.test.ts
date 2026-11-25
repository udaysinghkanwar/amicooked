import { it, expect, vi } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { reportUpgrade } from "../../src/telemetry.js";
// @ts-expect-error plain JS Vercel function
import { handle } from "../../site/api/e.js";

it("delivers upgrade events over HTTP to the existing endpoint and Redis pipeline without setup counters", async () => {
  const pipelines: string[][][] = [];
  const redis = vi.fn(async (_url: string, init?: RequestInit) => {
    const commands = JSON.parse(String(init?.body));
    pipelines.push(commands);
    return Response.json(commands.map(() => ({ result: 1 })));
  });
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = new Request("http://localhost/api/e", { method: "POST", body: Buffer.concat(chunks) });
    const response = await handle(request, { KV_REST_API_URL: "https://redis.test", KV_REST_API_TOKEN: "fixture" }, redis);
    res.writeHead(response.status).end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/e`;
  const fetchImpl: typeof fetch = (_url, init) => fetch(url, init);
  try {
    for (const mode of ["manual", "automatic"] as const) {
      expect(await reportUpgrade({ from: "0.1.7", to: "0.1.8", mode, channel: "native" }, { env: {}, fetchImpl, platform: "darwin-arm64" })).toBe(true);
    }
    expect(pipelines).toHaveLength(2);
    expect(pipelines.flat().filter(command => command[1] === "upgrade:total")).toHaveLength(2);
    expect(pipelines[0]).toContainEqual(["HINCRBY", "upgrade:modes", "manual", "1"]);
    expect(pipelines[1]).toContainEqual(["HINCRBY", "upgrade:modes", "automatic", "1"]);
    expect(pipelines.flat().every(command => command[1].startsWith("upgrade:"))).toBe(true);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
