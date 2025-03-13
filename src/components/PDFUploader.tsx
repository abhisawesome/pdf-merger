import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { XMarkIcon, EyeIcon, ArrowUpIcon, ArrowDownIcon } from '@heroicons/react/24/solid';

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
        className={`p-6 border-2 border-dashed rounded-lg text-center cursor-pointer transition-colors ${
          isDragActive 
            ? 'border-primary bg-primary/5' 
            : 'border-border-color hover:border-primary'
        }`}
      >
        <input {...getInputProps()} />
        <p className="text-text-secondary">
          {isDragActive
            ? 'Drop the PDF files here'
            : 'Drag and drop PDF files here, or click to select files'}
        </p>
      </div>

      {pdfFiles.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-medium text-text-primary">Uploaded Files</h3>
            <p className="text-sm text-text-secondary">Use arrows to reorder files</p>
          </div>
          <div className="space-y-2">
            {pdfFiles.map((file, index) => (
              <div
                key={file.id}
                className={`flex items-center p-3 bg-secondary rounded-lg border transition-colors ${
                  selectedPDF?.id === file.id 
                    ? 'border-primary' 
                    : 'border-border-color hover:border-primary/50'
                }`}
              >
                <div className="flex flex-col mr-2">
                  <button
                    onClick={() => handleMove(index, 'up')}
                    disabled={index === 0}
                    className="p-1 text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ArrowUpIcon className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleMove(index, 'down')}
                    disabled={index === pdfFiles.length - 1}
                    className="p-1 text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ArrowDownIcon className="w-4 h-4" />
                  </button>
                </div>
                <span className="text-text-primary truncate flex-1">{file.name}</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onFileSelect(file)}
                    className="p-1 text-text-secondary hover:text-primary transition-colors"
                  >
                    <EyeIcon className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => handleRemove(file.id)}
                    className="p-1 text-text-secondary hover:text-red-500 transition-colors"
                  >
                    <XMarkIcon className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
} 