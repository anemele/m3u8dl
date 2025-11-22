import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import pLimit from "p-limit";
import { Parser, Segment } from "m3u8-parser";

const OUT_DIR = "out";
await ensureDir(OUT_DIR);

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

async function fetchOne(segment: Segment, savePath: string, origin: string) {
  let uri = segment.uri;
  if (!uri.startsWith("http")) {
    uri = origin + uri;
  }

  const resp = await fetch(uri);
  const buf = await resp.arrayBuffer();

  if (!segment.key) {
    await Deno.writeFile(savePath, new Uint8Array(buf));
    return;
  }

  let keyUri = segment.key.uri;
  if (!keyUri.startsWith("http")) {
    keyUri = origin + keyUri;
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
}

async function fetchAll(m3u8Uri: string) {
  const resp = await fetch(m3u8Uri);
  const m3u8Text = await resp.text();

  const m3u8Hashsum = await hashsum(m3u8Text);
  const savePath = join(OUT_DIR, m3u8Hashsum);
  await ensureDir(savePath);

  await Deno.writeTextFile(`${savePath}.url`, m3u8Uri);
  await Deno.writeTextFile(`${savePath}.m3u8`, m3u8Text);

  const parser = new Parser();
  parser.push(m3u8Text);
  parser.end();
  const segments = parser.manifest.segments;

  const baseUrl = new URL(m3u8Uri);

  const filenames = [] as string[];
  const limit = pLimit(10);
  const tasks = segments.map((segment, idx) => {
    const filename = idx.toString().padStart(4, "0") + ".ts";
    filenames.push(`file '${filename}'`);
    const task = limit(() =>
      fetchOne(segment, join(savePath, filename), baseUrl.origin)
    );
    return task;
  });
  await Promise.all(tasks);

  const filesPath = join(savePath, "files.txt");
  await Deno.writeTextFile(filesPath, filenames.join("\n"));

  const ffo = await new Deno.Command("ffmpeg", {
    args: [
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      filesPath,
      "-c",
      "copy",
      `${savePath}.mp4`,
    ],
  }).output();

  if (!ffo.success) {
    console.error("ffmpeg failed");
    console.error(new TextDecoder().decode(ffo.stderr));
    return;
  }

  await Deno.remove(savePath, { recursive: true });
}

if (import.meta.main) {
  console.log("m3u8dl <url>");
  console.log("type nothing to exit");

  while (true) {
    console.log();
    const url = prompt("url> ")?.trim();
    if (!url) {
      break;
    }
    try {
      await fetchAll(url);
    } catch (e) {
      console.error(e);
    }
  }
}
