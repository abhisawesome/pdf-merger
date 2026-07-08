import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileText, Eye, X, ChevronUp, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PDFFile {
  id: string;
  name: string;
  data: ArrayBuffer;
}

interface PDFUploaderProps {
  onFilesChange: (files: PDFFile[]) => void;
  onFileSelect: (file: PDFFile | null) => void;
  selectedPDF: PDFFile | null;
  pdfFiles: PDFFile[];
}

export default function PDFUploader({ onFilesChange, onFileSelect, selectedPDF, pdfFiles }: PDFUploaderProps) {
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
        const updatedFiles = [...pdfFiles, ...newFiles];
        onFilesChange(updatedFiles);
        if (newFiles.length > 0 && !selectedPDF) {
          onFileSelect(newFiles[0]);
        }
      });
    },
    [onFilesChange, onFileSelect, selectedPDF, pdfFiles]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
    },
    multiple: true,
  });

  const handleMove = useCallback(
    (index: number, direction: 'up' | 'down') => {
      const newIndex = direction === 'up' ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= pdfFiles.length) return;

      const items = [...pdfFiles];
      const [movedItem] = items.splice(index, 1);
      items.splice(newIndex, 0, movedItem);
      onFilesChange(items);
    },
    [pdfFiles, onFilesChange]
  );

  const handleRemove = useCallback(
    (id: string) => {
      const updatedFiles = pdfFiles.filter((file) => file.id !== id);
      onFilesChange(updatedFiles);
      if (selectedPDF?.id === id) {
        onFileSelect(null);
      }
    },
    [pdfFiles, onFilesChange, onFileSelect, selectedPDF]
  );

  return (
    <div className="w-full">
      <div
        {...getRootProps()}
        className={cn(
          'cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors',
          isDragActive
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-primary/50 hover:bg-muted/50'
        )}
      >
        <input {...getInputProps()} />
        <Upload className="mx-auto mb-3 size-8 text-muted-foreground" />
        <p className="text-sm font-medium">
          {isDragActive ? 'Drop the PDF files here' : 'Drop PDFs here or click to browse'}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Your files never leave this device</p>
      </div>

      {pdfFiles.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium">Files ({pdfFiles.length})</h3>
            <p className="text-xs text-muted-foreground">Order sets the merge sequence</p>
          </div>
          <ul className="space-y-2">
            {pdfFiles.map((file, index) => (
              <li
                key={file.id}
                className={cn(
                  'flex items-center gap-2 rounded-lg border bg-card p-2 pl-1 transition-colors',
                  selectedPDF?.id === file.id
                    ? 'border-primary ring-1 ring-primary'
                    : 'hover:border-primary/40'
                )}
              >
                <div className="flex flex-col">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-5"
                    onClick={() => handleMove(index, 'up')}
                    disabled={index === 0}
                    aria-label="Move up"
                  >
                    <ChevronUp className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-5"
                    onClick={() => handleMove(index, 'down')}
                    disabled={index === pdfFiles.length - 1}
                    aria-label="Move down"
                  >
                    <ChevronDown className="size-3.5" />
                  </Button>
                </div>
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn('size-7', selectedPDF?.id === file.id && 'text-primary')}
                  onClick={() => onFileSelect(file)}
                  title="Preview / edit this file"
                >
                  <Eye className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 hover:text-destructive"
                  onClick={() => handleRemove(file.id)}
                  title="Remove"
                >
                  <X className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
