import { Application, Router } from "@oak/oak";
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
  return tmplPlayer.replace("{{M3U8URL}}", pathname + "/index.m3u8");
}

const router = new Router();

router.get("/", async (ctx) => {
  ctx.response.body = await Deno.readFile("./static/index.html");
});

router.get("/list", async (ctx) => {
  ctx.response.body = await getListHtml();
});

router.get("/video/:video", (ctx) => {
  const video = ctx.params.video;
  ctx.response.body = getPlayerHtml(`/video/${video}`);
});

router.post("/download", async (ctx) => {
  const body = await ctx.request.body.json();
  const m3u8Url: string = body.url;
  const vpr = await validateAndPrepare(m3u8Url);
  if (!vpr) {
    ctx.response.body = "Invalid M3U8 URL";
    ctx.response.status = 400;
    return;
  }

  fetchAll(m3u8Url, vpr).catch((err) => {
    console.error(err);
  });

  ctx.response.body = vpr.m3u8Hashsum;
  ctx.response.status = 200;
});

router.get("/video/:video/index.m3u8", async (ctx) => {
  const video = ctx.params.video;
  ctx.response.body = await readLocalResource(join(video, "index.m3u8"));
});

router.get("/video/:video/:segment.ts", async (ctx) => {
  const video = ctx.params.video;
  const segment = ctx.params.segment;
  ctx.response.body = await readLocalResource(join(video, `${segment}.ts`));
});

const app = new Application();

app.use(router.routes());
app.use(router.allowedMethods());

const addr = { hostname: "127.0.0.1", port: 8080 };
console.log(`server is running at http://${addr.hostname}:${addr.port}`);
app.listen(addr);
