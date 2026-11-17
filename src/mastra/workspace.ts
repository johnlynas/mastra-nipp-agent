import path from 'node:path';
import { LocalFilesystem, Workspace } from '@mastra/core/workspace';

/**
 * Agent workspace with local filesystem access (Mastra workspaces).
 *
 * Assigning this workspace to an agent gives it the built-in file tools:
 * read_file, write_file, edit_file, list_files, delete, file_stat, mkdir,
 * grep (all prefixed `mastra_workspace_`). No sandbox is configured — the
 * tools operate directly on disk through the LocalFilesystem provider.
 *
 * Path safety:
 * - `basePath` is the root of the agent's file view; relative paths resolve
 *   from it and `.` lists the root.
 * - With the default `contained: true`, absolute host paths outside basePath
 *   are rejected with a PermissionError. Add specific directories via
 *   `allowedPaths` if the agent ever needs them (e.g. shared documents).
 * - Set `readOnly: true` on the LocalFilesystem to strip write tools if the
 *   agent should only read files.
 *
 * basePath is an absolute path by design: in Mastra projects the cwd changes
 * between `mastra dev`, `mastra start`, and direct execution, so a relative
 * path would resolve to different locations (docs: local-filesystem →
 * "Recommended: Use absolute paths"). This app runs via `next dev` from the
 * project root, so the default resolves to <project>/workspace; override with
 * WORKSPACE_PATH for an explicit location. The directory is created
 * automatically on first use (lazy init).
 */
export const agentWorkspace = new Workspace({
  filesystem: new LocalFilesystem({
    basePath: process.env.WORKSPACE_PATH ?? path.resolve(process.cwd(), 'workspace'),
  }),
});
