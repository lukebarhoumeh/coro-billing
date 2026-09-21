/** Browser download helpers (DOM-only — nothing here is unit-tested). */
import * as XLSX from "xlsx";

export function downloadBlob(fileName: string, mime: string, data: ArrayBuffer | string): void {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadWorkbook(wb: XLSX.WorkBook, fileName: string): void {
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  downloadBlob(
    fileName,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    bytes
  );
}

export function downloadText(fileName: string, mime: string, text: string): void {
  downloadBlob(fileName, mime, text);
}
