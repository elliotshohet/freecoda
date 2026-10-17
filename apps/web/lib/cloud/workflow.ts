import { FatalError } from "workflow";
async function executeTurnStep(runId: string, turn: number) {
  "use step";
  try {
    const { executeRunTurn } = await import("./service");
    return await executeRunTurn(runId, turn);
  } catch {
    throw new FatalError(
      "Cloud execution stopped. See the private project event log.",
    );
  }
}
executeTurnStep.maxRetries = 0;
export async function cloudAgentWorkflow(runId: string) {
  "use workflow";
  for (let turn = 0; turn < 8; turn++) {
    if (await executeTurnStep(runId, turn)) return;
  }
}
async function importStep(projectId: string) {
  "use step";
  const { importCloudProject } = await import("./service");
  await importCloudProject(projectId);
}
importStep.maxRetries = 0;
export async function cloudImportWorkflow(projectId: string) {
  "use workflow";
  await importStep(projectId);
}
