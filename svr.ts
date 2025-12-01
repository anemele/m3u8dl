import { join } from "@std/path";
import { CACHE_DIR, fetchAll, validateAndPrepare } from "./core.ts";

async function readLocalResource(
  pathname: string,
): Promise<Uint8Array<ArrayBuffer>> {
  return await Deno.readFile(join(CACHE_DIR, pathname));
}

const tmplList = await Deno.readTextFile("./static/list.html");
const tmplPlayer = await Deno.readTextFile("./static/player.html");

async function getListHtml(): Promise<string> {
  const elemList: string[] = [];
  for await (const entry of Deno.readDir(CACHE_DIR)) {
    const video = entry.name;
    const elem = `<li><a href="/video/${video}">${video}</a></li>`;
    elemList.push(elem);
  }
  return tmplList.replace(
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
  // console.log(req);
  const url = new URL(req.url);
  // console.log(url);
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

  if (pathname === "/list") {
    return new Response(await getListHtml(), {
      headers: {
        "Content-Type": "text/html; charset=UTF-8",
      },
    });
  }

  if (pathname === "/download") {
    const body = await req.json();
    const m3u8Url: string = body.url;
    const video = await validateAndPrepare(m3u8Url);
    if (!video) {
      return new Response("Invalid M3U8 URL", {
        status: 400,
      });
    }

    fetchAll(m3u8Url, video.savePath, video.segments).catch((err) => {
      console.error(err);
    });

    return new Response(video.m3u8Hashsum, {
      headers: {
        "Content-Type": "text/plain; charset=UTF-8",
      },
      status: 200,
    });
  }

  if (pathname === "/") {
    return new Response(await Deno.readFile("./static/index.html"), {
      headers: {
        "Content-Type": "text/html; charset=UTF-8",
      },
    });
  }

  return new Response(await Deno.readFile("./static/404.html"), {
    status: 404,
  });
});
