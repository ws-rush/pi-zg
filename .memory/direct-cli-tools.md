---
name: direct-cli-tool-integration
description: pi-zg exposes zvec-grep-compatible direct Pi tools backed by the local zg CLI rather than MCP.
type: decision
---

## Why

Direct tool calls minimize prompt surface and protocol indirection. The Pi surface mirrors zvec-grep's indexed search and managed-rg inputs while executing the installed `zg` CLI; it does not start or use an MCP server.

## How to apply

Keep `zvec_grep_search`, `zvec_grep_rg`, and `zvec_grep_index_status` read-only and bounded. `zvec_grep_index` may create, update, or explicitly rebuild only after visible user confirmation; `zvec_grep_index_drop` requires its own deletion confirmation. Force `--mode direct` internally rather than exposing transport controls; direct mode cannot honor `autoUpdate: true`. Map indexed query groups and freshness to `zg query` flags, and parse managed-rg input without a shell while preserving regex backslashes. Keep exact `grep` and `find` additive rather than overriding them.

## Related

[[context-efficient-search]]
