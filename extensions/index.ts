import { isAbsolute } from "node:path";
import type { ExtensionAPI, SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import { formatSize, truncateHead } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  dropIndexZg,
  indexZg,
  rgZg,
  searchZg,
  statusZg,
  type ZgIndexInput,
  type ZgRgInput,
  type ZgSearchInput,
} from "../src/zg.ts";

const MAX_OUTPUT_BYTES = 16 * 1024;
const MAX_OUTPUT_LINES = 250;
const TRUNCATION_FOOTER_BYTES = 512;
const TRUNCATION_FOOTER_LINES = 3;
const SYMBOL_TYPES = ["module", "class", "interface", "function", "value", "alias"];
const FRESHNESS = ["eventual", "wait_for_fresh"];
const DEVICES = ["auto", "cpu", "metal", "vulkan", "cuda"];

const searchParameters = Type.Object({
  root: Type.String({ description: "Absolute workspace path to search." }),
  query: Type.Optional(Type.String({ minLength: 1, description: "One hybrid natural-language or exact query." })),
  queries: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1, description: "Hybrid query groups." })),
  fts: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1, description: "Ranked lexical query groups." })),
  vector: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1, description: "Semantic-only query groups." })),
  fuse: Type.Optional(Type.Boolean({ description: "Combine every query group into one ranked plan." })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, description: "Maximum items per query group." })),
  globs: Type.Optional(Type.Array(Type.String(), { description: "Ordered case-sensitive path rules." })),
  insensitiveGlobs: Type.Optional(Type.Array(Type.String(), { description: "Ordered case-insensitive path rules." })),
  fileTypes: Type.Optional(Type.Array(Type.String(), { description: "ripgrep file types to include." })),
  excludedFileTypes: Type.Optional(Type.Array(Type.String(), { description: "ripgrep file types to exclude." })),
  symbolTypes: Type.Optional(Type.Array(Type.String({ enum: SYMBOL_TYPES }), { description: `Indexed symbol types: ${SYMBOL_TYPES.join(", ")}.` })),
  preferSymbol: Type.Optional(Type.Boolean({ description: "Prefer an exact indexed symbol." })),
  modifiedAfter: Type.Optional(Type.String({ description: "Only files modified after this time." })),
  modifiedBefore: Type.Optional(Type.String({ description: "Only files modified before this time." })),
  freshness: Type.Optional(Type.String({ enum: FRESHNESS, description: "eventual or wait_for_fresh." })),
  autoUpdate: Type.Optional(Type.Boolean({ description: "Compatibility input. true is rejected because direct CLI mode cannot schedule a background update." })),
}, { additionalProperties: false });

const indexParameters = Type.Object({
  root: Type.String({ description: "Absolute workspace path whose index is managed." }),
  embedding: Type.Optional(Type.String({ description: "Embedding model for a new or rebuilt index." })),
  rebuild: Type.Optional(Type.Boolean({ description: "Recreate an existing index." })),
  resetPaths: Type.Optional(Type.Boolean({ description: "Replace stored file-selection settings." })),
  globs: Type.Optional(Type.Array(Type.String(), { description: "Path globs used for file discovery." })),
  insensitiveGlobs: Type.Optional(Type.Array(Type.String(), { description: "Case-insensitive path globs used for file discovery." })),
  fileTypes: Type.Optional(Type.Array(Type.String(), { description: "ripgrep file types to include." })),
  excludedFileTypes: Type.Optional(Type.Array(Type.String(), { description: "ripgrep file types to exclude." })),
  hidden: Type.Optional(Type.Boolean({ description: "Include hidden files." })),
  noIgnore: Type.Optional(Type.Boolean({ description: "Do not respect ignore files." })),
  ignoreFiles: Type.Optional(Type.Array(Type.String(), { description: "Additional ignore files." })),
  maxDepth: Type.Optional(Type.Integer({ minimum: 1 })),
  maxFileSize: Type.Optional(Type.String({ description: "Maximum indexed file size, such as 1M." })),
  follow: Type.Optional(Type.Boolean({ description: "Follow symbolic links during discovery." })),
  apiKey: Type.Optional(Type.String({ description: "One-command remote embedding provider credential." })),
  endpoint: Type.Optional(Type.String({ description: "Remote embedding provider endpoint." })),
  modelCache: Type.Optional(Type.String({ description: "Local embedding model cache path." })),
  device: Type.Optional(Type.String({ enum: DEVICES })),
  embeddingConcurrency: Type.Optional(Type.Integer({ minimum: 1, description: "Concurrent embedding tasks." })),
  allowRemote: Type.Optional(Type.Boolean({ description: "Authorize remote embedding for this command." })),
}, { additionalProperties: false });

function formatOutput(output: string): { text: string; truncated: boolean } {
  const truncated = truncateHead(output, {
    maxBytes: MAX_OUTPUT_BYTES - TRUNCATION_FOOTER_BYTES,
    maxLines: MAX_OUTPUT_LINES - TRUNCATION_FOOTER_LINES,
  });
  return {
    text: truncated.truncated
      ? `${truncated.content}\n\n[zg output truncated to ${truncated.outputLines} of ${truncated.totalLines} lines (${formatSize(truncated.outputBytes)} of ${formatSize(truncated.totalBytes)}). Read the cited files for more context.]`
      : truncated.content,
    truncated: truncated.truncated,
  };
}

function formatCommand(cmd: SlashCommandInfo): string {
  const desc = cmd.description ? ` - ${cmd.description}` : "";
  return `/${cmd.name}${desc}`;
}

function requireAbsoluteRoot(root: string): void {
  if (!isAbsolute(root)) throw new Error("root must be an absolute workspace path.");
}

export default function (pi: ExtensionAPI) {
  const execute = (command: string, args: string[], options: Parameters<typeof pi.exec>[2]) =>
    pi.exec(command, args, options);

  const toolResult = (output: string, root: string) => {
    const formatted = formatOutput(output);
    return {
      content: [{ type: "text" as const, text: formatted.text }],
      details: { root, truncated: formatted.truncated },
    };
  };

  const publishResult = (title: string, root: string, output: string) => {
    const formatted = formatOutput(output);
    pi.sendMessage({
      customType: "pi-zg-result",
      content: `${title} (${root})\n\n${formatted.text}`,
      display: true,
      details: { root, truncated: formatted.truncated },
    });
  };

  pi.registerTool({
    name: "zvec_grep_search",
    label: "zvec-grep Search",
    description: "Search an existing zvec-grep workspace index with hybrid, lexical, or semantic query groups. Returns compact ranked results grouped by file.",
    promptSnippet: "Search an existing workspace index by meaning, lexical anchors, symbols, scope, or modification time",
    promptGuidelines: [
      "Use zvec_grep_search for conceptual code search, a known symbol, or ranked lexical anchors; do not run a status preflight when sufficient results are available.",
      "Use zvec_grep_search with an absolute root and at least one of query, queries, fts, or vector. Keep limit small and use globs or file types to scope broad searches.",
    ],
    parameters: searchParameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      requireAbsoluteRoot(params.root);
      const result = await searchZg(execute, params as ZgSearchInput, ctx.cwd, signal);
      return toolResult(result.output, result.root);
    },
  });

  pi.registerTool({
    name: "zvec_grep_rg",
    label: "zvec-grep Managed rg",
    description: "Run an exhaustive managed ripgrep search without an index. command must be an rg command; it is parsed into arguments and never executed by a shell.",
    promptSnippet: "Run exhaustive managed ripgrep without an index when a precise occurrence lookup is required",
    promptGuidelines: [
      "Use zvec_grep_rg for exhaustive exact or regex occurrence lookup, not as a substitute for zvec_grep_search conceptual retrieval. Scope broad searches with paths, -g/--glob, or -t/--type.",
    ],
    parameters: Type.Object({
      root: Type.String({ description: "Absolute workspace path to search." }),
      command: Type.String({ minLength: 1, description: "The rg command to run, for example: rg -n -F 'loadTheme' -g '*.ts' src. An optional trailing | head -N bounds output." }),
    }, { additionalProperties: false }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      requireAbsoluteRoot(params.root);
      const result = await rgZg(execute, params as ZgRgInput, ctx.cwd, signal);
      return toolResult(result.output, result.root);
    },
  });

  pi.registerTool({
    name: "zvec_grep_index_status",
    label: "zvec-grep Index Status",
    description: "Inspect persisted and active zvec-grep index state for a workspace.",
    promptSnippet: "Inspect index readiness, paths, counts, and refresh state when diagnosing index problems",
    promptGuidelines: [
      "Use zvec_grep_index_status only to diagnose a missing, stale, or failed index; zvec_grep_search results do not require a routine status preflight.",
    ],
    parameters: Type.Object({
      root: Type.String({ description: "Absolute workspace path whose index state is inspected." }),
      checkReady: Type.Optional(Type.Boolean({ description: "Exit non-zero unless the index is ready." })),
    }, { additionalProperties: false }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      requireAbsoluteRoot(params.root);
      const result = await statusZg(execute, { root: params.root, checkReady: params.checkReady }, ctx.cwd, signal);
      return toolResult(result.output, result.root);
    },
  });

  pi.registerTool({
    name: "zvec_grep_index",
    label: "zvec-grep Index",
    description: "Create, update, or explicitly rebuild a zvec-grep workspace index after visible confirmation.",
    promptSnippet: "Create, update, or rebuild a workspace index only when the user explicitly requests it",
    promptGuidelines: [
      "Use zvec_grep_index only after the user explicitly asks to create, update, or rebuild a workspace index. It always requires visible user confirmation before it runs.",
    ],
    parameters: indexParameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      requireAbsoluteRoot(params.root);
      if (!ctx.hasUI) throw new Error("zvec_grep_index requires an interactive Pi session for user confirmation.");
      const action = params.rebuild ? "rebuild" : "create or update";
      const confirmed = await ctx.ui.confirm(
        `${action[0]?.toUpperCase()}${action.slice(1)} zg index?`,
        `Run zg index for ${params.root}? A remote embedding model may send workspace content to its provider.`,
      );
      if (!confirmed) return { content: [{ type: "text" as const, text: "zg index was cancelled." }], details: { root: params.root, cancelled: true } };

      const result = await indexZg(execute, params as ZgIndexInput, ctx.cwd, signal);
      return toolResult(result.output, result.root);
    },
  });

  pi.registerTool({
    name: "zvec_grep_index_drop",
    label: "zvec-grep Drop Index",
    description: "Permanently delete a zvec-grep workspace index after visible confirmation.",
    promptSnippet: "Permanently delete a workspace index only when the user explicitly requests it",
    promptGuidelines: [
      "Use zvec_grep_index_drop only when the user explicitly wants to delete a workspace index. It always requires visible user confirmation before it runs.",
    ],
    parameters: Type.Object({ root: Type.String({ description: "Absolute workspace path whose index is permanently deleted." }) }, { additionalProperties: false }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      requireAbsoluteRoot(params.root);
      if (!ctx.hasUI) throw new Error("zvec_grep_index_drop requires an interactive Pi session for user confirmation.");
      const confirmed = await ctx.ui.confirm(
        "Delete zg index?",
        `Run zg index --drop --yes for ${params.root}? This permanently deletes the workspace index.`,
      );
      if (!confirmed) return { content: [{ type: "text" as const, text: "zg index deletion was cancelled." }], details: { root: params.root, cancelled: true } };

      const result = await dropIndexZg(execute, params.root, ctx.cwd, signal);
      return toolResult(result.output, result.root);
    },
  });

  pi.registerCommand("commands", {
    description: "List available slash commands",
    getArgumentCompletions: (prefix) => {
      const sources = ["extension", "prompt", "skill"];
      const filtered = sources.filter((source) => source.startsWith(prefix));
      return filtered.length > 0 ? filtered.map((source) => ({ value: source, label: source })) : null;
    },
    handler: async (args, ctx) => {
      const commands = pi.getCommands();
      const sourceFilter = args.trim();
      const sources = ["extension", "prompt", "skill"];

      if (sourceFilter && !sources.includes(sourceFilter)) {
        ctx.ui.notify("Usage: /commands [extension|prompt|skill]", "warning");
        return;
      }

      const filtered = sourceFilter ? commands.filter((command) => command.source === sourceFilter) : commands;
      if (filtered.length === 0) {
        ctx.ui.notify(sourceFilter ? `No ${sourceFilter} commands found` : "No commands found", "info");
        return;
      }

      const items: string[] = [];
      const groupedSources: Array<{ key: "extension" | "prompt" | "skill"; label: string }> = [
        { key: "extension", label: "Extensions" },
        { key: "prompt", label: "Prompts" },
        { key: "skill", label: "Skills" },
      ];

      for (const { key, label } of groupedSources) {
        const cmds = filtered.filter((command) => command.source === key);
        if (cmds.length > 0) {
          items.push(`--- ${label} ---`);
          items.push(...cmds.map(formatCommand));
        }
      }

      const selected = await ctx.ui.select("Available Commands", items);
      if (!selected || selected.startsWith("---")) return;

      const cmdName = selected.match(/^\/([^\s]+)(?:\s-\s.*)?$/)?.[1];
      const cmd = commands.find((command) => command.name === cmdName);
      if (cmd?.sourceInfo.path) ctx.ui.notify(cmd.sourceInfo.path, "info");
    },
  });

  pi.registerCommand("zg-query", {
    description: "Run a hybrid zvec-grep query in the current workspace",
    handler: async (args, ctx) => {
      if (!args.trim() && !ctx.hasUI) {
        ctx.ui.notify("Usage: /zg-query <query>", "warning");
        return;
      }
      const query = args.trim() || (await ctx.ui.input("Query:", ""))?.trim() || "";
      if (!query) {
        ctx.ui.notify("Usage: /zg-query <query>", "warning");
        return;
      }
      const result = await searchZg(execute, { query }, ctx.cwd);
      publishResult("zg query", result.root, result.output);
    },
  });

  pi.registerCommand("zg-rg", {
    description: "Run a managed rg command in the current workspace",
    handler: async (args, ctx) => {
      if (!args.trim() && !ctx.hasUI) {
        ctx.ui.notify("Usage: /zg-rg <rg command>", "warning");
        return;
      }
      const command = args.trim() || (await ctx.ui.input("rg command:", "rg "))?.trim() || "";
      if (!command) {
        ctx.ui.notify("Usage: /zg-rg <rg command>", "warning");
        return;
      }
      const result = await rgZg(execute, { command }, ctx.cwd);
      publishResult("zg query --rg", result.root, result.output);
    },
  });

  pi.registerCommand("zg-status", {
    description: "Inspect zvec-grep index status for a workspace",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const checkReady = parts.at(-1) === "--check-ready";
      if (checkReady) parts.pop();
      const root = parts.join(" ") || ctx.cwd;
      const result = await statusZg(execute, { root, checkReady }, ctx.cwd);
      publishResult("zg status", result.root, result.output);
    },
  });

  pi.registerCommand("zg-index", {
    description: "Create or update a zvec-grep workspace index",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) throw new Error("zg-index requires an interactive Pi session so the user can confirm index creation.");
      const [embedding, ...rootParts] = args.trim().split(/\s+/).filter(Boolean);
      const root = rootParts.join(" ") || ctx.cwd;
      const confirmed = await ctx.ui.confirm(
        "Create or update zg index?",
        `Run zg index for ${root}${embedding ? ` with ${embedding}` : ""}? A remote embedding model may send workspace content to its provider.`,
      );
      if (!confirmed) {
        ctx.ui.notify("zg index was cancelled.", "info");
        return;
      }
      const result = await indexZg(execute, { root, embedding }, ctx.cwd);
      publishResult("zg index", result.root, result.output);
    },
  });

  pi.registerCommand("zg-index-drop", {
    description: "Delete a zvec-grep workspace index",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) throw new Error("zg-index-drop requires an interactive Pi session so the user can confirm deletion.");
      const root = args.trim() || ctx.cwd;
      const confirmed = await ctx.ui.confirm(
        "Delete zg index?",
        `Run zg index --drop --yes for ${root}? This permanently deletes the workspace index.`,
      );
      if (!confirmed) {
        ctx.ui.notify("zg index deletion was cancelled.", "info");
        return;
      }
      const result = await dropIndexZg(execute, root, ctx.cwd);
      publishResult("zg index --drop", result.root, result.output);
    },
  });
}
