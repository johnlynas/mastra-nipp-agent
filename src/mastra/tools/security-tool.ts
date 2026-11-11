import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { callMcpTool, type RequestContextLike } from './dispatch';

/** `security` domain tool — payload encryption key management. */
const ACTION_MAP: Record<string, string> = {
  create_payload_key: 'security_security_payload_key_create',
  revoke_payload_key: 'security_security_payload_key_revoke_create',
};

export const securityTool = createTool({
  id: 'security',
  description:
    'Payload encryption key management. Actions: create_payload_key, revoke_payload_key. ' +
    'Both are sensitive platform operations — confirm with the user before running. Omit orgId to act on the caller\'s active organization.',
  inputSchema: z.object({
    action: z.enum(['create_payload_key', 'revoke_payload_key']),
    orgId: z.string().optional(),
  }),
  execute: async (input, options) => {
    const toolId = ACTION_MAP[input.action];
    if (!toolId) return { success: false, error: `Unknown security action '${input.action}'.` };
    return callMcpTool(toolId, input as Record<string, unknown>, { requestContext: options?.requestContext as RequestContextLike | undefined });
  },
});
