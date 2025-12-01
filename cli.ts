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
      const data = await validateAndPrepare(url);
      if (!data) {
        continue;
      }
      await fetchAll(url, data.m3u8Hashsum, data.segments);
    } catch (e) {
      console.error(e);
    }
  }
}
