import { useState, useEffect } from 'react';

interface PDFViewerProps {
  file: ArrayBuffer | string;
  fileName: string;
}

export default function PDFViewer({ file, fileName }: PDFViewerProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    if (file instanceof ArrayBuffer) {
      const blob = new Blob([file], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);

      return () => {
        URL.revokeObjectURL(url);
      };
    } else if (typeof file === 'string') {
      setPdfUrl(file);
    }
  }, [file]);

  if (!pdfUrl) {
    return (
      <div className="flex justify-center items-center h-[600px] border rounded-lg bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="mb-2">
        <h3 className="text-lg font-medium text-gray-900 truncate">{fileName}</h3>
      </div>
      <div className="border rounded-lg overflow-hidden bg-gray-50">
        <object
          data={pdfUrl}
          type="application/pdf"
          className="w-full h-[600px]"
        >
          <div className="p-4 text-center">
            <p>Your browser does not support PDF viewing.</p>
            <a
              href={pdfUrl}
              download={fileName}
              className="text-blue-500 hover:text-blue-600 underline mt-2 inline-block"
            >
              Download PDF
            </a>
          </div>
        </object>
      </div>
    </div>
  );
} 