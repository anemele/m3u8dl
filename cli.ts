import { fetchAll, validateAndPrepare } from "./core.ts";

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
      const vpr = await validateAndPrepare(url);
      if (!vpr) {
        continue;
      }
      fetchAll(url, vpr).catch((e) => {
        console.error(e);
      });
    } catch (e) {
      console.error(e);
    }
  }
}
