import { join } from "@std/path";

const CACHE_DIR = ".cache";

async function readLocalResource(
  pathname: string,
): Promise<Uint8Array<ArrayBuffer>> {
  return await Deno.readFile(join(CACHE_DIR, pathname));
}

const tmplIndex = await Deno.readTextFile("./static/index.html");
const tmplPlayer = await Deno.readTextFile("./static/player.html");

async function getIndexHtml(): Promise<string> {
  const elemList: string[] = [];
  for await (const entry of Deno.readDir(CACHE_DIR)) {
    const video = entry.name;
    const elem = `<li><a href="/video/${video}">${video}</a></li>`;
    elemList.push(elem);
  }
  return tmplIndex.replace(
    "{{VideoList}}",
    elemList.join("\n"),
  );
}

function getPlayerHtml(pathname: string) {
  return tmplPlayer.replace(
    "{{M3U8URL}}",
    pathname.replace(/^\/video/, "") + "/index.m3u8",
  );
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
    return new Response(getPlayerHtml(pathname), {
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
