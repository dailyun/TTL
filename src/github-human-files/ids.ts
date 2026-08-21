import { createHash } from "node:crypto";

export function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function stableItemId(sourcePath: string): string {
  return `item_${shortHash(sourcePath)}`;
}

export function stableCheckboxId(sourcePath: string, line: number, title: string): string {
  return `item_${shortHash(`${sourcePath}:${line}:${title}`)}`;
}

export function contentHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
