import { join } from "@std/path";

const CACHE_DIR = ".cache";

async function readLocalResource(
  pathname: string,
): Promise<Uint8Array<ArrayBuffer>> {
  return await Deno.readFile(join(CACHE_DIR, pathname));
}

async function getIndexHtml(): Promise<string> {
  const tmplIndex = await Deno.readTextFile("./static/index.html");
  const videoList: string[] = [];
  for await (const entry of Deno.readDir(CACHE_DIR)) {
    videoList.push(entry.name);
  }
  const indexHtml = tmplIndex.replace(
    "{{VideoList}}",
    videoList.map(
      (video) => `<li><a href="/video/${video}">${video}</a></li>`,
    ).join("\n"),
  );
  return indexHtml;
}

async function getPlayerHtml(pathname: string) {
  const tmplPlayer = await Deno.readTextFile("./static/player.html");
  const playerHtml = tmplPlayer.replace(
    "{{M3U8URL}}",
    pathname.replace(/^\/video/, "") + "/index.m3u8",
  );
  return playerHtml;
}

Deno.serve(async (req) => {
  //   console.log(req);
  const url = new URL(req.url);
  //   console.log(url);
  const pathname = url.pathname;

  if (
    pathname.endsWith(".ts") ||
    pathname.endsWith(".m3u8")
  ) {
    return new Response(await readLocalResource(pathname));
  }

  if (pathname.startsWith("/video")) {
    return new Response(await getPlayerHtml(pathname), {
      headers: {
        "Content-Type": "text/html; charset=UTF-8",
      },
    });
  }

  if (pathname === "/") {
    return new Response(await getIndexHtml(), {
      headers: {
        "Content-Type": "text/html; charset=UTF-8",
      },
    });
  }

  return new Response(await Deno.readFile("./static/404.html"), {
    status: 404,
  });
});
