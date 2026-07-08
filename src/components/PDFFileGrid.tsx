import { useCallback, useEffect, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Plus, Eye, X, ChevronLeft, ChevronRight, Loader2, FileText, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PDFFile {
  id: string;
  name: string;
  data: ArrayBuffer;
}

interface PDFFileGridProps {
  pdfFiles: PDFFile[];
  onFilesChange: (files: PDFFile[]) => void;
  onPreview: (file: PDFFile) => void;
  onRemoved?: (id: string) => void;
}

interface FileMeta {
  status: 'ready' | 'error';
  thumbnail?: string;
  pageCount?: number;
}

export default function PDFFileGrid({ pdfFiles, onFilesChange, onPreview, onRemoved }: PDFFileGridProps) {
  const [meta, setMeta] = useState<Record<string, FileMeta>>({});
  const pendingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const missing = pdfFiles.filter((f) => !meta[f.id] && !pendingRef.current.has(f.id));
    if (missing.length === 0) return;
    missing.forEach((f) => pendingRef.current.add(f.id));

    (async () => {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      for (const f of missing) {
        try {
          // pdf.js transfers the buffer to its worker, so hand it a copy
          const doc = await pdfjs.getDocument({ data: f.data.slice(0) }).promise;
          const page = await doc.getPage(1);
          const base = page.getViewport({ scale: 1 });
          const scale = 220 / base.width;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await page.render({ canvas, viewport }).promise;
          const entry: FileMeta = { status: 'ready', thumbnail: canvas.toDataURL(), pageCount: doc.numPages };
          if (cancelled) return;
          setMeta((prev) => ({ ...prev, [f.id]: entry }));
        } catch (err) {
          console.error('Error rendering thumbnail:', err);
          if (!cancelled) {
            setMeta((prev) => ({
              ...prev,
              [f.id]: { status: 'error' },
            }));
          }
        } finally {
          pendingRef.current.delete(f.id);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdfFiles, meta]);

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
      ).then((newFiles) => {
        onFilesChange([...pdfFiles, ...newFiles]);
      });
    },
    [onFilesChange, pdfFiles]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: true,
    noKeyboard: true,
  });

  const handleMove = useCallback(
    (index: number, dir: -1 | 1) => {
      const newIndex = index + dir;
      if (newIndex < 0 || newIndex >= pdfFiles.length) return;
      const items = [...pdfFiles];
      const [moved] = items.splice(index, 1);
      items.splice(newIndex, 0, moved);
      onFilesChange(items);
    },
    [pdfFiles, onFilesChange]
  );

  const handleRemove = useCallback(
    (id: string) => {
      onFilesChange(pdfFiles.filter((f) => f.id !== id));
      onRemoved?.(id);
    },
    [pdfFiles, onFilesChange, onRemoved]
  );

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {pdfFiles.map((file, index) => {
        const m = meta[file.id];
        return (
          <div
            key={file.id}
            className="group relative overflow-hidden rounded-xl border bg-card p-2.5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
          >
            <span className="absolute left-2 top-2 z-10 flex size-7 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground shadow-sm">
              {index + 1}
            </span>
            <Button
              variant="secondary"
              size="icon"
              className="absolute right-2 top-2 z-10 size-7 rounded-lg shadow-sm hover:text-destructive sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
              onClick={() => handleRemove(file.id)}
              title="Remove"
            >
              <X className="size-3.5" />
            </Button>

            <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-lg border bg-white shadow-inner">
              {m?.status === 'ready' && m.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.thumbnail} alt={file.name} className="max-h-full max-w-full" />
              ) : m?.status === 'error' ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted/30 p-3 text-center">
                  <FileText className="size-8 text-primary" />
                  <div className="flex items-center gap-1 rounded-md bg-background px-2 py-1 text-[11px] text-muted-foreground shadow-sm">
                    <AlertCircle className="size-3" />
                    Preview unavailable
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-5 animate-spin" />
                  <span className="text-[11px]">Preparing preview</span>
                </div>
              )}
            </div>

            <p className="mt-2 truncate text-xs font-medium" title={file.name}>
              {file.name}
            </p>
            <div className="mt-0.5 flex items-center justify-between">
              <p className="text-[11px] text-muted-foreground">
                {m?.status === 'ready' && m.pageCount
                  ? `${m.pageCount} page${m.pageCount === 1 ? '' : 's'}`
                  : m?.status === 'error'
                    ? 'Ready to merge'
                    : 'Loading preview'}
              </p>
              <div className="flex items-center">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={() => handleMove(index, -1)}
                  disabled={index === 0}
                  title="Move earlier"
                >
                  <ChevronLeft className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={() => onPreview(file)}
                  title="Preview"
                >
                  <Eye className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={() => handleMove(index, 1)}
                  disabled={index === pdfFiles.length - 1}
                  title="Move later"
                >
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>
            </div>
          </div>
        );
      })}

      {/* Add more tile */}
      <div
        {...getRootProps()}
        className={cn(
          'flex min-h-44 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 text-center transition-colors',
          isDragActive
            ? 'border-primary bg-primary/5'
            : 'border-border text-muted-foreground hover:border-primary/50 hover:bg-muted/50 hover:text-foreground'
        )}
      >
        <input {...getInputProps()} />
        <div className="flex size-10 items-center justify-center rounded-full bg-muted">
          <Plus className="size-5" />
        </div>
        <p className="text-xs font-medium">Add more PDFs</p>
      </div>
    </div>
  );
}
