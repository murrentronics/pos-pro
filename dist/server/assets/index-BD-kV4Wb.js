import { r as registerPlugin } from "./router-CQroFC2z.js";
import "./server-DI1Zlwds.js";
import "node:async_hooks";
import "node:stream/web";
import "node:stream";
const Share = registerPlugin("Share", {
  web: () => import("./web-BYsxm-xW.js").then((m) => new m.ShareWeb())
});
export {
  Share
};
