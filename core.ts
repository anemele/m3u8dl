/*
 * m3u8dl
 *
 * cache structure
 *
 * .cache/
 * ├── <hashsum>/
 * │   ├── 0001.ts
 * │   ├── 0002.ts
 * │   ├── ...
 * │   ├── index.m3u8
 * │   ├── m3u8.raw
 * │   ├── m3u8.url
 * ├── ...
 */

import { ensureDir, exists } from "@std/fs";
import { join } from "@std/path";
import pLimit from "p-limit";
import { Parser, Segment } from "m3u8-parser";
import Progress from "cli-progress";

const CACHE_DIR = ".cache";
await ensureDir(CACHE_DIR);

async function hashsum(str: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(str),
  );
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const KeyCache = new Map<string, CryptoKey>();

async function fetchOne(
  segment: Segment,
  savePath: string,
  m3u8Uri: string,
  bar: Progress.SingleBar,
) {
  let uri: string | URL = segment.uri;
  if (!uri.startsWith("http")) {
    if (uri.startsWith("/")) {
      uri = new URL(uri, new URL(m3u8Uri).origin);
    } else {
      uri = new URL(uri, m3u8Uri);
    }
  }

  const resp = await fetch(uri);
  const buf = await resp.arrayBuffer();

  if (!segment.key) {
    await Deno.writeFile(savePath, new Uint8Array(buf));
    bar.increment();
    return;
  }

  let keyUri: string | URL = segment.key.uri;
  if (!keyUri.startsWith("http")) {
    if (keyUri.startsWith("/")) {
      keyUri = new URL(keyUri, new URL(m3u8Uri).origin);
    } else {
      keyUri = new URL(keyUri, m3u8Uri);
    }
    keyUri = keyUri.toString();
  }

  let key = KeyCache.get(keyUri);
  if (!key) {
    key = await crypto.subtle.importKey(
      "raw",
      await fetch(keyUri).then((resp) => resp.arrayBuffer()),
      {
        // mostly AES-128 with CBC mode
        name: "AES-CBC",
        length: 128,
      },
      false,
      ["decrypt"],
    );
    KeyCache.set(keyUri, key);
  }

  const dbuf = crypto.subtle.decrypt(
    {
      name: "AES-CBC",
      iv: new Uint32Array(segment.key.iv ?? new ArrayBuffer(16)),
    },
    key,
    buf,
  );

  await Deno.writeFile(savePath, new Uint8Array(await dbuf));
  bar.increment();
}

function numberedFilename(num: number): string {
  return num.toString().padStart(4, "0") + ".ts";
}

interface ValidateAndPrepareResult {
  m3u8Hashsum: string;
  savePath: string;
  segments: Segment[];
}

async function validateAndPrepare(
  m3u8Uri: string,
): Promise<null | ValidateAndPrepareResult> {
  let resp: Response;
  try {
    resp = await fetch(m3u8Uri);
  } catch (_err) {
    return null;
  }

  // 这个判断会不会太简单了？
  if (resp.status !== 200) {
    console.error(resp.statusText);
    return null;
  }

  const m3u8Text = await resp.text();

  const m3u8Hashsum = await hashsum(m3u8Text);
  // console.log(`  ${m3u8Hashsum}`);

  const savePath = join(CACHE_DIR, m3u8Hashsum);
  await ensureDir(savePath);

  await Deno.writeTextFile(join(savePath, "m3u8.url"), m3u8Uri);
  await Deno.writeTextFile(join(savePath, "m3u8.raw"), m3u8Text);

  let lineNum = 0;
  const lines = m3u8Text.trim().split("\n").map((line) => {
    if (line.startsWith("#")) {
      return line;
    } else {
      return numberedFilename(lineNum++);
    }
  });
  await Deno.writeTextFile(join(savePath, "index.m3u8"), lines.join("\n"));

  const parser = new Parser();
  parser.push(m3u8Text);
  parser.end();
  const segments = parser.manifest.segments;

  return {
    m3u8Hashsum,
    savePath,
    segments,
  };
}

const multiBar = new Progress.MultiBar({
  // format: "    [{bar}] {percentage}% | {value}/{total}",
  barCompleteChar: "#",
  barIncompleteChar: "-",
  hideCursor: true,
  // barsize: 20,
});

async function fetchAll(
  m3u8Uri: string,
  vpr: ValidateAndPrepareResult,
): Promise<void> {
  const bar = multiBar.create(vpr.segments.length, 0, null, {
    format: ` ${vpr.m3u8Hashsum} | [{bar}] {value}/{total}`,
    barsize: 10,
  });
  const limit = pLimit(6);
  const tasks = vpr.segments.map(async (segment, idx) => {
    const filename = numberedFilename(idx);
    const saveSegmentPath = join(vpr.savePath, filename);
    if (await exists(saveSegmentPath)) {
      bar.increment();
      return null;
    }
    const task = limit(() => fetchOne(segment, saveSegmentPath, m3u8Uri, bar));
    return task;
  });

  // bar.start(tasks.length, 0);
  await Promise.all(tasks);
  bar.stop();
}

export { CACHE_DIR, fetchAll, validateAndPrepare };
