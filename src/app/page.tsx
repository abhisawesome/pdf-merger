'use client';

import PDFUploader from '@/components/PDFUploader';
import PDFMerger from '@/components/PDFMerger';
import PDFViewer from '@/components/PDFViewer';
import { ThemeProvider } from '@/components/ThemeProvider';
import { useState } from 'react';

interface PDFFile {
  id: string;
  name: string;
  data: ArrayBuffer;
}

function PDFMergerApp() {
  const [pdfFiles, setPdfFiles] = useState<PDFFile[]>([]);
  const [selectedPDF, setSelectedPDF] = useState<PDFFile | null>(null);
  const [mergedPdfData, setMergedPdfData] = useState<ArrayBuffer | null>(null);
  const [viewMode, setViewMode] = useState<'uploaded' | 'merged'>('uploaded');

  return (
    <main className="min-h-screen bg-background text-text-primary transition-colors duration-200">
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-4xl font-bold text-center mb-2">PDF Merger</h1>
        <p className="text-center text-text-secondary mb-8">Merge multiple PDF files into one</p>
        <div className="flex gap-6">
          {/* Left side - Upload and controls */}
          <div className="w-1/2">
            <div className="card p-6 mb-6">
              <PDFUploader 
                onFilesChange={setPdfFiles} 
                onFileSelect={setSelectedPDF}
                selectedPDF={selectedPDF}
                pdfFiles={pdfFiles}
              />
            </div>
            <div className="card p-6">
              <PDFMerger 
                pdfFiles={pdfFiles} 
                onMergeComplete={setMergedPdfData}
              />
            </div>
          </div>

          {/* Right side - PDF Preview */}
          <div className="w-1/2 card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">PDF Preview</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => setViewMode('uploaded')}
                  className={`btn ${
                    viewMode === 'uploaded'
                      ? 'btn-primary'
                      : 'btn-secondary'
                  }`}
                >
                  Uploaded PDFs
                </button>
                <button
                  onClick={() => setViewMode('merged')}
                  className={`btn ${
                    viewMode === 'merged'
                      ? 'btn-primary'
                      : 'btn-secondary'
                  }`}
                >
                  Merged Preview
                </button>
              </div>
            </div>

            {viewMode === 'uploaded' ? (
              selectedPDF ? (
                <PDFViewer file={selectedPDF.data} fileName={selectedPDF.name} />
              ) : (
                <div className="flex items-center justify-center h-[600px] border border-border-color rounded-lg bg-secondary text-text-secondary">
                  Select a PDF to preview
                </div>
              )
            ) : (
              mergedPdfData ? (
                <PDFViewer file={mergedPdfData} fileName="Merged PDF" />
              ) : (
                <div className="flex items-center justify-center h-[600px] border border-border-color rounded-lg bg-secondary text-text-secondary">
                  Merge PDFs to preview
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <ThemeProvider>
      <PDFMergerApp />
    </ThemeProvider>
  );
}
