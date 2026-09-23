import { createFileRoute } from "@tanstack/react-router";
import DownloadAppPage from "@/pages/DownloadAppPage";

export const Route = createFileRoute("/download")({
  component: DownloadAppPage,
});
