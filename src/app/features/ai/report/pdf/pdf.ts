/** 複製元: slide_creator の src/app/export/pdf.ts（変更なし） */
/** 複数ページ PDF（1920×1080 px、1 スライド 1 ページ） */
export async function buildPdf(images: { dataUrl: string; format: 'jpeg' | 'png' }[]): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'px', format: [1920, 1080], orientation: 'landscape', hotfixes: ['px_scaling'] });
  images.forEach((img, i) => {
    if (i > 0) doc.addPage([1920, 1080], 'landscape');
    doc.addImage(img.dataUrl, img.format === 'png' ? 'PNG' : 'JPEG', 0, 0, 1920, 1080, undefined, 'FAST');
  });
  return doc.output('blob');
}
