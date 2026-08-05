import { f as createLucideIcon } from "./router-CQroFC2z.js";
import { r as reactExports } from "./server-DI1Zlwds.js";
const __iconNode = [
  ["path", { d: "M10 11v6", key: "nco0om" }],
  ["path", { d: "M14 11v6", key: "outv1u" }],
  ["path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", key: "miytrc" }],
  ["path", { d: "M3 6h18", key: "d0wm0j" }],
  ["path", { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2", key: "e791ji" }]
];
const Trash2 = createLucideIcon("trash-2", __iconNode);
const Ctx = reactExports.createContext(null);
function useTranslation() {
  const ctx = reactExports.useContext(Ctx);
  if (!ctx) throw new Error("useTranslation must be inside I18nProvider");
  return ctx;
}
export {
  Trash2 as T,
  useTranslation as u
};
