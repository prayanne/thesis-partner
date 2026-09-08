import { createThesisMcpHandler } from "@thesis/mcp";
import { executeOperation, DomainError } from "@thesis/domain";
import { AppError } from "@thesis/security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handler = createThesisMcpHandler(async (operation) => {
  try {
    return await executeOperation(operation, {
      principal: operation.principal!,
    });
  } catch (error) {
    if (error instanceof DomainError)
      throw new AppError(error.code, error.message, error.status);
    throw error;
  }
});
export const POST = handler.fetch;
export const GET = handler.fetch;
export const DELETE = handler.fetch;
