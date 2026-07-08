export function formatPdfDownloadName(name: string, fallbackName: string) {
  const cleaned = name.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-');
  return ensurePdfExtension(cleaned || fallbackName);
}

function ensurePdfExtension(name: string) {
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}
