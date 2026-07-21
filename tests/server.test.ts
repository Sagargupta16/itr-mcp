import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

async function connectedClient() {
  const server = createServer();
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

describe("itr-agent server", () => {
  it("lists all twelve tools", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "compare_regimes",
      "compute_hra",
      "compute_interest_234",
      "compute_tax",
      "filing_checklist",
      "list_deductions",
      "list_tax_years",
      "parse_ais",
      "parse_form26as",
      "recommend_itr_form",
      "reconcile_documents",
      "schedule_advance_tax",
    ]);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
  });

  it("compute_tax returns structured content", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "compute_tax",
      arguments: { regime: "new", salaryIncome: 1275000 },
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { totalTax: number; fy: string };
    expect(sc.totalTax).toBe(0);
    expect(sc.fy).toBe("2025-26");
  });

  it("compare_regimes recommends a winner", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "compare_regimes",
      arguments: { salaryIncome: 1500000, deductions: 200000 },
    });
    const sc = result.structuredContent as {
      recommended: string;
      savings: number;
    };
    expect(["new", "old"]).toContain(sc.recommended);
    expect(sc.savings).toBeGreaterThanOrEqual(0);
  });

  it("unknown fiscal year is a tool error, not a crash", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "compute_tax",
      arguments: { regime: "new", salaryIncome: 100000, fy: "1999-00" },
    });
    expect(result.isError).toBe(true);
  });

  it("parse_form26as fails actionably on a missing file", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "parse_form26as",
      arguments: { path: "Z:/does/not/exist.txt" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as { text: string }[])[0]?.text ?? "";
    expect(text).toContain("TRACES Text export");
  });

  it("recommend_itr_form returns structured content with reasoning", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "recommend_itr_form",
      arguments: { totalIncome: 1800000, hasForeignAssetsOrIncome: true },
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      recommended: string;
      ruledOut: { form: string; rule: string }[];
      dueDate: string;
    };
    expect(sc.recommended).toBe("ITR-2");
    expect(sc.ruledOut.length).toBeGreaterThan(0);
    expect(sc.dueDate).toBe("2026-07-31");
  });

  it("filing_checklist returns ordered steps for the form", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "filing_checklist",
      arguments: { form: "ITR-2" },
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      form: string;
      steps: { step: number; phase: string }[];
    };
    expect(sc.form).toBe("ITR-2");
    expect(sc.steps[0]?.step).toBe(1);
    expect(sc.steps.at(-1)?.phase).toBe("verify");
  });

  it("exposes the file_my_itr guided prompt", async () => {
    const client = await connectedClient();
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toContain("file_my_itr");
    const prompt = await client.getPrompt({
      name: "file_my_itr",
      arguments: {},
    });
    const text =
      prompt.messages[0]?.content.type === "text"
        ? prompt.messages[0].content.text
        : "";
    expect(text).toContain("ONE question at a time");
    expect(text).toContain("never file on my behalf");
  });
});
