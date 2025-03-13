import { useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { ArrowDownTrayIcon } from '@heroicons/react/24/solid';

interface PDFFile {
  id: string;
  name: string;
  data: ArrayBuffer;
}

interface PDFMergerProps {
  pdfFiles: PDFFile[];
  onMergeComplete: (mergedPdf: ArrayBuffer) => void;
}

export default function PDFMerger({ pdfFiles, onMergeComplete }: PDFMergerProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [mergedPdfUrl, setMergedPdfUrl] = useState<string | null>(null);

  const handleMerge = async () => {
    if (pdfFiles.length === 0) return;

    setIsLoading(true);
    try {
      const mergedPdf = await PDFDocument.create();

      for (const file of pdfFiles) {
        const pdfDoc = await PDFDocument.load(file.data);
        const copiedPages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
      }

      const mergedPdfBytes = await mergedPdf.save();
      const buffer = new ArrayBuffer(mergedPdfBytes.length);
      new Uint8Array(buffer).set(mergedPdfBytes);
      
      // Create URL for download
      const blob = new Blob([buffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      setMergedPdfUrl(url);
      
      onMergeComplete(buffer);
    } catch (error) {
      console.error('Error merging PDFs:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = () => {
    if (!mergedPdfUrl) return;
    
    const link = document.createElement('a');
    link.href = mergedPdfUrl;
    link.download = 'merged.pdf';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-text-primary">Merge PDFs</h2>
        <div className="flex gap-2">
          <button
            onClick={handleMerge}
            disabled={pdfFiles.length === 0 || isLoading}
            className={`btn ${
              pdfFiles.length === 0 || isLoading
                ? 'bg-secondary text-text-secondary cursor-not-allowed'
                : 'btn-primary'
            }`}
          >
            {isLoading ? (
              <div className="flex items-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>Merging...</span>
              </div>
            ) : (
              'Merge PDFs'
            )}
          </button>
          {mergedPdfUrl && (
            <button
              onClick={handleDownload}
              className="btn btn-primary flex items-center gap-2"
            >
              <ArrowDownTrayIcon className="w-5 h-5" />
              <span>Download</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
} 