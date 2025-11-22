import { ensureDir } from "@std/fs";
import { basename, join } from "@std/path";
import pLimit from "p-limit";
import { Parser, Segment } from "m3u8-parser";

const OUT_DIR = "out";

async function hashsum(str: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(str),
  );
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchOne(segment: Segment, savePathDir: string) {
  const filename = basename(segment.uri);
  const savePath = join(savePathDir, filename);

  const resp = await fetch(segment.uri);
  const buf = await resp.arrayBuffer();

  if (!segment.key) {
    await Deno.writeFile(savePath, new Uint8Array(buf));
    return;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    await fetch(segment.key.uri).then((resp) => resp.arrayBuffer()),
    {
      // mostly AES-128 with CBC mode
      name: "AES-CBC",
      length: 128,
    },
    false,
    ["decrypt"],
  );

  const dbuf = crypto.subtle.decrypt(
    {
      name: "AES-CBC",
      iv: new Uint32Array(segment.key.iv ?? new ArrayBuffer(4)),
    },
    key,
    buf,
  );

  await Deno.writeFile(savePath, new Uint8Array(await dbuf));
}

async function fetchAll(m3u8Uri: string) {
  // if exists, load from local
  let m3u8Text: string;
  let cachePath: string;

  if (!m3u8Uri.startsWith("http")) {
    m3u8Text = await Deno.readTextFile(m3u8Uri);
    cachePath = join(OUT_DIR, await hashsum(m3u8Text));
  } else {
    const resp = await fetch(m3u8Uri);
    m3u8Text = await resp.text();
    cachePath = join(OUT_DIR, await hashsum(m3u8Text));
    await Deno.writeTextFile(`${cachePath}.m3u8`, m3u8Text);
  }

  await ensureDir(cachePath);

  const parser = new Parser();
  parser.push(m3u8Text);
  parser.end();
  const segments = parser.manifest.segments;

  const limit = pLimit(10);
  const tasks = segments.map((segment) => {
    const task = limit(() => fetchOne(segment, cachePath));
    return task;
  });
  await Promise.all(tasks);

  const files = segments.map((segment) => {
    const filename = basename(segment.uri);
    return `file '${filename}'`;
  });
  const filesPath = join(cachePath, "files.txt");
  await Deno.writeTextFile(filesPath, files.join("\n"));

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
      `${cachePath}.mp4`,
    ],
  }).output();

  if (!ffo.success) {
    console.error("ffmpeg failed");
    console.error(new TextDecoder().decode(ffo.stderr));
    return;
  }

  await Deno.remove(cachePath, { recursive: true });
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
