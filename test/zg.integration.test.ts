import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const zg = process.env.ZG_BIN || "zg";
const hasZg = spawnSync(zg, ["--version"], { stdio: "ignore" }).status === 0;

test("installed zg supports the direct managed-rg and status contracts", { skip: !hasZg }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-zg-"));
  try {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "theme.ts"), 'export const loadTheme = () => "light";\n');
    await writeFile(join(root, "src", "theme.txt"), "loadTheme\n");

    const rg = await execFileAsync(zg, ["query", "--mode", "direct", "--rg", "-n", "-F", "loadTheme", "-g", "*.ts", "src"], { cwd: root });
    assert.match(`${rg.stdout}${rg.stderr}`, /src\/theme\.ts/);
    assert.doesNotMatch(`${rg.stdout}${rg.stderr}`, /theme\.txt/);

    const status = await execFileAsync(zg, ["status", "--mode", "direct"], { cwd: root });
    assert.match(`${status.stdout}${status.stderr}`, /Workspace index is not configured/);
    await assert.rejects(
      execFileAsync(zg, ["status", "--mode", "direct", "--check-ready"], { cwd: root }),
      (error: any) => error.code === 1 && /Workspace index is not configured/.test(`${error.stdout}${error.stderr}`),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
