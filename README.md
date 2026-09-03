# pi-zg

Search your codebase from Pi with [`zg`](https://github.com/zvec-ai/zvec-grep).

This extension runs the local `zg` CLI directly. It does **not** use MCP or a server.

## What you need

- [Pi](https://pi.dev)
- Node.js / npm
- The `zg` CLI

You’ll install `zg` in the next step.

## Fastest way to get started

1. Install `zg`:

```sh
npm install -g @zvec/zvec-grep
```

2. Install this extension:

```sh
pi install npm:pi-zg
```

3. Open your project in Pi.
4. Start with a search:

```text
/zg-query "where are user settings loaded?"
```

Use `/zg-rg` when you want exact matches:

```text
/zg-rg rg -n -F "loadTheme" -g "*.ts" src
```

Use `/zg-status` when you want to check the index:

```text
/zg-status /absolute/path/to/workspace
```

## Commands you’ll use most

| Command | What it does |
| --- | --- |
| `/zg-query <query>` | Smart search across the indexed workspace |
| `/zg-rg <rg command>` | Exact ripgrep search through the workspace |
| `/zg-status [root] [--check-ready]` | Check whether an index exists and is ready |
| `/zg-index [embedding] [root]` | Create or update the index |
| `/zg-index-drop [root]` | Delete the index |

### Examples

```text
/zg-query "authentication flow"
/zg-query "where preferences are restored"
/zg-rg rg -n "TODO|FIXME" src
/zg-status /project --check-ready
```

>`root` must be an **absolute path** when you pass it to the tools.

## If something goes wrong

- **`Unable to run zg...command not found`** → install `zg` with the npm command above.
- **`root must be an absolute workspace path`** → pass a full path like `/Users/me/project`.
- **`At least one of query, queries, fts, or vector is required`** → add a search query.
- **`zg index was cancelled`** → you declined the confirmation prompt.

## Tool reference

### `zvec_grep_search`

```json
{
  "root": "/absolute/path/to/workspace",
  "query": "authentication flow",
  "limit": 5
}
```

### `zvec_grep_rg`

```json
{
  "root": "/absolute/path/to/workspace",
  "command": "rg -n -F 'loadTheme' -g '*.ts' src"
}
```

### `zvec_grep_index_status`

```json
{
  "root": "/absolute/path/to/workspace",
  "checkReady": true
}
```

### `zvec_grep_index`

```json
{
  "root": "/absolute/path/to/workspace",
  "rebuild": true
}
```

### `zvec_grep_index_drop`

```json
{
  "root": "/absolute/path/to/workspace"
}
```

## Development

```sh
npm test
npm run pack:check
```
