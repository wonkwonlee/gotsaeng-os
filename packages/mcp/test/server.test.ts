import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ServerConfig } from "../src/config";
import { createGotsaengMcpServer } from "../src/server";

let root: string;
let config: ServerConfig;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "gs-mcp-server-"));
  await mkdir(path.join(root, "vault"), { recursive: true });
  await writeFile(
    path.join(root, "vault", "note.md"),
    [
      "---",
      "title: Note",
      "type: decision",
      "updated: 2026-08-01",
      "---",
      "",
      "- decision: X.",
    ].join("\n"),
    "utf8",
  );
  config = {
    vaultRoot: path.join(root, "vault"),
    outputRoot: path.join(root, "out"),
    projectName: "Demo",
    staleDays: 90,
  };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("createGotsaengMcpServer", () => {
  it("exposes exactly the five tools and answers a call end-to-end", async () => {
    const server = createGotsaengMcpServer(config);
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "compile_context_pack",
      "list_context_artifacts",
      "prepare_ai_handoff",
      "read_context_artifact",
      "validate_vault",
    ]);

    const result = await client.callTool({ name: "validate_vault", arguments: {} });
    const first = (result.content as Array<{ type: string; text: string }>)[0];
    const payload = JSON.parse(first?.text ?? "{}") as { filesChecked?: number };
    expect(payload.filesChecked).toBe(1);

    const bad = await client.callTool({
      name: "read_context_artifact",
      arguments: { name: "nope.md" },
    });
    expect(bad.isError).toBe(true);

    await client.close();
    await server.close();
  });

  it("serializes concurrent compile_context_pack and prepare_ai_handoff calls so neither's artifact index update is lost", async () => {
    // Regression test: compile_context_pack and prepare_ai_handoff both
    // read-modify-write ARTIFACT_INDEX.json. MCP clients can issue tool calls
    // concurrently, so without serialization one call's read-then-write can
    // race the other's and drop its update. Fire them together and confirm
    // the final index has both.
    const server = createGotsaengMcpServer(config);
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    await Promise.all([
      client.callTool({ name: "compile_context_pack", arguments: {} }),
      client.callTool({
        name: "prepare_ai_handoff",
        arguments: { sections: ["DECISION_LOG.md"] },
      }),
    ]);

    const listed = await client.callTool({ name: "list_context_artifacts", arguments: {} });
    const first = (listed.content as Array<{ type: string; text: string }>)[0];
    const payload = JSON.parse(first?.text ?? "{}") as { artifacts: Array<{ name: string }> };
    const names = payload.artifacts.map((artifact) => artifact.name);
    expect(names).toContain("DECISION_LOG.md");
    expect(names).toContain("LLM_HANDOFF.md");

    await client.close();
    await server.close();
  });
});
