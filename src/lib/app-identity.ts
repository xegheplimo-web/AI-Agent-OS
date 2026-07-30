/* Application identity constants.
 *
 * Extracted from the health route so the route module only exports Next.js-
 * recognized symbols (GET, dynamic, etc.). Next.js generates route types that
 * reject arbitrary exports — placing constants here keeps them importable
 * without breaking the build. */

export const APP_IDENTITY = "ai-agent-os-control-plane";
export const PROTOCOL_VERSION = 1;
