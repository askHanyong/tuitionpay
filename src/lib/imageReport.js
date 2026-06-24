import html2canvas from "html2canvas";
import { reportFilenameBase } from "./monthlyReport";

export async function downloadMonthlyReportImage(node, monthDate) {
  if (!node) return;
  const canvas = await html2canvas(node, {
    scale: 2,
    backgroundColor: "#ffffff",
  });
  const dataUrl = canvas.toDataURL("image/png");
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = reportFilenameBase(monthDate, "png");
  link.click();
}
