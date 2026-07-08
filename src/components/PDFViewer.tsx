import { useState, useEffect } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

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
      <div className="flex h-[50vh] items-center justify-center rounded-lg border bg-muted/30 md:h-[65vh]">
        <div className="size-7 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="overflow-hidden rounded-lg border bg-muted/30">
        <object data={pdfUrl} type="application/pdf" className="h-[50vh] w-full md:h-[65vh]">
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              This browser can&apos;t display PDFs inline.
            </p>
            <Button variant="outline" size="sm" asChild>
              <a href={pdfUrl} download={fileName}>
                <Download className="size-4" />
                Download PDF
              </a>
            </Button>
          </div>
        </object>
      </div>
    </div>
  );
}
