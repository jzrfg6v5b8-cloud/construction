import type { ToolRequest } from "./llm";

export const deepSeekAgentToolNames = [
  "get_project_assets",
  "get_floor_plan",
  "get_unverified_measurements",
  "get_products",
  "get_materials",
  "get_procurement_items",
  "validate_layout",
  "calculate_bom",
  "calculate_quote",
  "check_asset_coverage",
  "create_design_escalation",
  "generate_proposal_copy",
] as const;

export type DeepSeekAgentToolName = (typeof deepSeekAgentToolNames)[number];

export const deepSeekAgentTools: ToolRequest["tools"] = deepSeekAgentToolNames.map((name) => ({
  name,
  description: `受控业务工具：${name}`,
  parameters: {
    type: "object",
    properties: { projectId: { type: "string" } },
    required: ["projectId"],
    additionalProperties: false,
  },
}));

export interface AgentToolExecutor {
  execute(name: DeepSeekAgentToolName, args: Record<string, unknown>, actorId: string): Promise<unknown>;
}

const mutatingTools = new Set<DeepSeekAgentToolName>(["create_design_escalation"]);

export async function executeAuditedTool(
  executor: AgentToolExecutor,
  name: string,
  args: Record<string, unknown>,
  actorId: string,
) {
  if (!deepSeekAgentToolNames.includes(name as DeepSeekAgentToolName)) throw new Error("TOOL_NOT_ALLOWED");
  // Wall locking, compliance approval and construction-ready transitions are intentionally not exposed.
  const result = await executor.execute(name as DeepSeekAgentToolName, args, actorId);
  return { name, mutating: mutatingTools.has(name as DeepSeekAgentToolName), actorId, result };
}
