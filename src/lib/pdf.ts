/** Dependency-free PDF writer for downloadable demo documents. */
function escapePdf(value: string) { return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)').replace(/[^\x20-\x7e]/g, '?'); }

/** Branding is deliberately stored as an attachment-like PDF object as well as being
 * rendered as a document note. This keeps the exact persisted data URL together with
 * the output (including image types the dependency-free renderer cannot rasterize).
 */
export type PdfBranding = { logoDataUrl?: string; stampDataUrl?: string; signatureDataUrl?: string };

export function pdfDocument(title: string, lines: string[], branding: PdfBranding = {}): Uint8Array {
  const labels = [['Logo', branding.logoDataUrl], ['Company stamp', branding.stampDataUrl], ['Authorised signature', branding.signatureDataUrl]].filter(([, asset]) => Boolean(asset));
  const content = ['BT', '/F1 18 Tf', '54 790 Td', `(${escapePdf(title)}) Tj`, '/F1 10 Tf', ...labels.map(([label]) => ['0 -16 Td', `(${escapePdf(`${label}: retained with this document`)}) Tj`]).flat(), ...lines.slice(0, 48 - labels.length).flatMap((line) => ['0 -16 Td', `(${escapePdf(line)}) Tj`]), 'ET'].join('\n');
  const assets = JSON.stringify({ ClientBillingAssets: branding });
  const objects = ['<< /Type /Catalog /Pages 2 0 R /Metadata 6 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${content.length} >>\nstream\n${content}\nendstream`, `<< /Type /Metadata /Subtype /XML /Length ${assets.length} >>\nstream\n${assets}\nendstream`];
  let output = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(output.length); output += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(output);
}

export function pdfDownload(filename: string, title: string, lines: string[], branding?: PdfBranding) { return new Response(pdfDocument(title, lines, branding) as unknown as BodyInit, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` } }); }
