# Agent workspace

This directory is the root of the NIPP portal agent's local filesystem access
(`LocalFilesystem` in `src/mastra/workspace.ts`). The agent's file tools
(read, write, edit, list, grep, mkdir, delete) resolve relative paths from
here; anything outside it is rejected.

Files created here by the agent (reports, notes, exports) are git-ignored —
only this README and `.gitkeep` are tracked.
