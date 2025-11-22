import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import pLimit from "p-limit";

const OUT_DIR = "out";

async function fetchM3U8(url: string): Promise<string[]> {
  const resp = await fetch(url);
  const text = await resp.text();
  // await Deno.writeTextFile("play.m3u8", text);
  const urls = text.trim().split("\n").filter((line) => !line.startsWith("#"));
  return urls;
}

async function fetchOne(url: string, filepath: string) {
  const resp = await fetch(url);
  const arrayBuffer = await resp.arrayBuffer();
  await Deno.writeFile(filepath, new Uint8Array(arrayBuffer));
}

async function hashsum(str: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(str),
  );
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchAll(url: string) {
  const cachePath = join(OUT_DIR, await hashsum(url));
  await ensureDir(cachePath);

  const urls = await fetchM3U8(url);

  const limit = pLimit(10);
  const tasks = urls.map((url, idx) => {
    const filepath = join(
      cachePath,
      (idx + 1).toString().padStart(3, "0") + ".ts",
    );
    const task = limit(() => fetchOne(url, filepath));
    return task;
  });

  await Promise.all(tasks);

  const files = [] as string[];
  Deno.readDirSync(cachePath).forEach((file) => {
    files.push(`file '${file.name}'`);
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
