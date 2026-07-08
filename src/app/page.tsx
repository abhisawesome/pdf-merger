'use client';

import PDFUploader from '@/components/PDFUploader';
import PDFFileGrid from '@/components/PDFFileGrid';
import PDFViewer from '@/components/PDFViewer';
import PDFEditor from '@/components/PDFEditor';
import { ModeToggle } from '@/components/ModeToggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PDFDocument } from 'pdf-lib';
import { useDropzone } from 'react-dropzone';
import {
  FileStack,
  Upload,
  Combine,
  Loader2,
  CheckCircle2,
  Download,
  Pencil,
  Eye,
  Sparkles,
  ShieldCheck,
  Grip,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPdfDownloadName } from '@/lib/download';
import { useCallback, useMemo, useState } from 'react';

interface PDFFile {
  id: string;
  name: string;
  data: ArrayBuffer;
}

export default function Home() {
  const [pdfFiles, setPdfFiles] = useState<PDFFile[]>([]);
  const [selectedPDF, setSelectedPDF] = useState<PDFFile | null>(null);
  const [mergedPdfData, setMergedPdfData] = useState<ArrayBuffer | null>(null);
  const [mergedPageCount, setMergedPageCount] = useState(0);
  const [isMerging, setIsMerging] = useState(false);
  const [activeTab, setActiveTab] = useState<'merge' | 'edit'>('merge');
  const [editingMerged, setEditingMerged] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ name: string; data: ArrayBuffer } | null>(null);
  const [mergedFileName, setMergedFileName] = useState('merged');

  const handleFileSelect = useCallback((file: PDFFile | null) => {
    setSelectedPDF(file);
    setEditingMerged(false);
  }, []);

  // Reordering / adding / removing files makes an existing merge result stale
  const handleMergeFilesChange = useCallback((files: PDFFile[]) => {
    setPdfFiles(files);
    setMergedPdfData(null);
  }, []);

  const handleFileRemoved = useCallback(
    (id: string) => {
      if (selectedPDF?.id === id) setSelectedPDF(null);
    },
    [selectedPDF]
  );

  const handleMerge = useCallback(async () => {
    if (pdfFiles.length < 2) return;
    setIsMerging(true);
    try {
      const mergedPdf = await PDFDocument.create();
      for (const file of pdfFiles) {
        const pdfDoc = await PDFDocument.load(file.data);
        const copiedPages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
      }
      const bytes = await mergedPdf.save();
      const buffer = new ArrayBuffer(bytes.length);
      new Uint8Array(buffer).set(bytes);
      setMergedPdfData(buffer);
      setMergedPageCount(mergedPdf.getPageCount());
    } catch (error) {
      console.error('Error merging PDFs:', error);
    } finally {
      setIsMerging(false);
    }
  }, [pdfFiles]);

  const handleDownloadMerged = useCallback(() => {
    if (!mergedPdfData) return;
    const fileName = formatPdfDownloadName(mergedFileName, 'merged.pdf');

    const blob = new Blob([mergedPdfData], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [mergedPdfData, mergedFileName]);

  const editorFile = useMemo<PDFFile | null>(() => {
    if (editingMerged && mergedPdfData) {
      return { id: '__merged__', name: 'Merged PDF', data: mergedPdfData };
    }
    return selectedPDF;
  }, [editingMerged, mergedPdfData, selectedPDF]);

  const handleEditApply = useCallback(
    (data: ArrayBuffer) => {
      if (editingMerged) {
        setMergedPdfData(data);
        return;
      }
      if (!selectedPDF) return;
      const updated = { ...selectedPDF, data };
      setPdfFiles((files) => files.map((f) => (f.id === selectedPDF.id ? updated : f)));
      setSelectedPDF(updated);
    },
    [editingMerged, selectedPDF]
  );

  const handleClearEditor = useCallback(() => {
    setEditingMerged(false);
    setSelectedPDF(null);
  }, []);

  const fileSelector = (
    <div className="flex min-w-0 items-center gap-2">
      <Select
        value={editingMerged ? '__merged__' : selectedPDF?.id ?? ''}
        onValueChange={(v) => {
          if (v === '__merged__') {
            setEditingMerged(true);
          } else {
            setEditingMerged(false);
            setSelectedPDF(pdfFiles.find((f) => f.id === v) ?? null);
          }
        }}
      >
        <SelectTrigger size="sm" className="w-44 md:w-64">
          <SelectValue placeholder="Choose a PDF" />
        </SelectTrigger>
        <SelectContent>
          {pdfFiles.map((f) => (
            <SelectItem key={f.id} value={f.id}>
              {f.name}
            </SelectItem>
          ))}
          {mergedPdfData && <SelectItem value="__merged__">Merged PDF</SelectItem>}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleClearEditor}
        title="Clear the PDF from the editor"
      >
        <X className="size-4" />
        <span className="hidden sm:inline">Clear</span>
      </Button>
    </div>
  );

  return (
    <div
      className={cn(
        'flex flex-col bg-background',
        activeTab === 'edit' ? 'h-dvh overflow-hidden' : 'min-h-dvh'
      )}
    >
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-14 items-center gap-3 px-4 md:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <FileStack className="size-4.5" />
            </div>
            <span className="hidden text-base font-semibold tracking-tight sm:inline">
              PDF Toolkit
            </span>
          </div>
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as 'merge' | 'edit')}
            className="ml-2 sm:ml-6"
          >
            <TabsList>
              <TabsTrigger value="merge">Merge</TabsTrigger>
              <TabsTrigger value="edit">Edit</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="ml-auto flex items-center gap-1">
            <ModeToggle />
          </div>
        </div>
      </header>

      {activeTab === 'merge' ? (
        <main className="w-full flex-1 bg-[linear-gradient(180deg,color-mix(in_oklch,var(--primary)_7%,transparent),transparent_32rem)]">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-10">
          {pdfFiles.length === 0 ? (
            <HeroDropzone onFilesAdded={handleMergeFilesChange} />
          ) : (
            <>
              <div className="mb-6 overflow-hidden rounded-xl border bg-card shadow-sm">
                <div className="flex flex-col gap-5 p-5 md:flex-row md:items-center md:justify-between md:p-6">
                  <div className="min-w-0">
                    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
                      <span className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1">
                        <Grip className="size-3.5" />
                        Visual ordering
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1">
                        <ShieldCheck className="size-3.5" />
                        Browser only
                      </span>
                    </div>
                    <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Build one polished PDF</h1>
                    <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
                      {pdfFiles.length === 1
                        ? 'Add one more file, then merge them into a single document.'
                        : `${pdfFiles.length} files ready. The number on each card is its position in the final PDF.`}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row md:shrink-0">
                    <Button
                      size="lg"
                      onClick={handleMerge}
                      disabled={pdfFiles.length < 2 || isMerging}
                      className="h-11 px-4"
                    >
                      {isMerging ? <Loader2 className="size-4 animate-spin" /> : <Combine className="size-4" />}
                      {isMerging ? 'Merging...' : `Merge ${pdfFiles.length} PDFs`}
                    </Button>
                  </div>
                </div>
              </div>

              {mergedPdfData && (
                <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-600/25 bg-emerald-500/10 p-4 shadow-sm">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
                    <CheckCircle2 className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">Your merged PDF is ready</p>
                    <p className="text-xs text-muted-foreground">
                      {mergedPageCount} page{mergedPageCount === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingMerged(true);
                        setActiveTab('edit');
                      }}
                    >
                      <Pencil className="size-4" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPreviewFile({ name: 'Merged PDF', data: mergedPdfData })}
                    >
                      <Eye className="size-4" />
                      Preview
                    </Button>
                    <label className="flex h-8 min-w-0 items-center overflow-hidden rounded-lg border bg-background text-xs text-muted-foreground shadow-sm focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
                      <span className="flex h-full shrink-0 items-center border-r bg-muted/50 px-2">File</span>
                      <Input
                        value={mergedFileName}
                        onChange={(e) => setMergedFileName(e.target.value.replace(/\.pdf$/i, ''))}
                        className="h-7 w-36 border-0 px-2 text-sm shadow-none focus-visible:ring-0 md:w-44"
                        aria-label="Merged PDF file name"
                      />
                      <span className="flex h-full items-center border-l bg-muted/50 px-2 font-medium text-foreground">
                        .pdf
                      </span>
                    </label>
                    <Button size="sm" onClick={handleDownloadMerged}>
                      <Download className="size-4" />
                      Download
                    </Button>
                  </div>
                </div>
              )}

              <PDFFileGrid
                pdfFiles={pdfFiles}
                onFilesChange={handleMergeFilesChange}
                onPreview={(f) => setPreviewFile({ name: f.name, data: f.data })}
                onRemoved={handleFileRemoved}
              />
            </>
          )}
          </div>
        </main>
      ) : (
        <main className="flex min-h-0 flex-1 flex-col">
          {editorFile ? (
            <PDFEditor file={editorFile} onApply={handleEditApply} fileSelector={fileSelector} />
          ) : (
            <div className="flex flex-1 items-center justify-center overflow-y-auto p-4">
              <Card className="w-full max-w-xl">
                <CardHeader>
                  <CardTitle>Edit a PDF</CardTitle>
                  <CardDescription>
                    Upload a PDF, or pick one of your files with the eye icon, to start editing
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <PDFUploader
                    onFilesChange={setPdfFiles}
                    onFileSelect={handleFileSelect}
                    selectedPDF={selectedPDF}
                    pdfFiles={pdfFiles}
                  />
                </CardContent>
              </Card>
            </div>
          )}
        </main>
      )}

      {/* Preview dialog */}
      <Dialog open={!!previewFile} onOpenChange={(open) => !open && setPreviewFile(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-8">{previewFile?.name}</DialogTitle>
          </DialogHeader>
          {previewFile && <PDFViewer file={previewFile.data} fileName={previewFile.name} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HeroDropzone({ onFilesAdded }: { onFilesAdded: (files: PDFFile[]) => void }) {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      Promise.all(
        acceptedFiles.map((file) =>
          file.arrayBuffer().then((data) => ({
            id: Math.random().toString(36).substring(7),
            name: file.name,
            data,
          }))
        )
      ).then(onFilesAdded);
    },
    [onFilesAdded]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: true,
  });

  return (
    <div className="grid items-center gap-8 py-6 md:grid-cols-[1fr_1.05fr] md:py-14">
      <div className="text-left">
        <div className="mb-4 inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm">
          <Sparkles className="size-3.5 text-primary" />
          Merge locally in your browser
        </div>
        <h1 className="max-w-xl text-4xl font-semibold tracking-tight md:text-5xl">
          Merge PDF files without the clutter
        </h1>
        <p className="mt-4 max-w-lg text-base text-muted-foreground">
          Drop your documents, arrange the order, preview the result, then download a clean combined PDF.
        </p>
        <div className="mt-6 grid max-w-lg gap-3 text-sm text-muted-foreground sm:grid-cols-3">
          <div className="rounded-lg border bg-card p-3 shadow-sm">
            <p className="font-medium text-foreground">Private</p>
            <p className="mt-1 text-xs">No upload required</p>
          </div>
          <div className="rounded-lg border bg-card p-3 shadow-sm">
            <p className="font-medium text-foreground">Ordered</p>
            <p className="mt-1 text-xs">Move pages visually</p>
          </div>
          <div className="rounded-lg border bg-card p-3 shadow-sm">
            <p className="font-medium text-foreground">Editable</p>
            <p className="mt-1 text-xs">Annotate after merge</p>
          </div>
        </div>
      </div>
      <div
        {...getRootProps()}
        className={cn(
          'relative flex min-h-80 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed bg-card px-6 text-center shadow-sm transition-colors md:min-h-96',
          isDragActive
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-primary/50 hover:bg-muted/40'
        )}
      >
        <input {...getInputProps()} />
        <div className="mb-5 flex size-16 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Upload className="size-7" />
        </div>
        <Button size="lg" className="pointer-events-none h-11 px-5 text-base">
          Select PDF files
        </Button>
        <p className="mt-3 text-sm text-muted-foreground">or drop PDFs here</p>
        <p className="mt-1 text-xs text-muted-foreground">Multiple PDFs supported</p>
      </div>
    </div>
  );
}
