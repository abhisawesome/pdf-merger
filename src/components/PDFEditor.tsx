import { useState, useEffect, useRef, useCallback } from 'react';
import { PDFDocument, StandardFonts, degrees, rgb, LineCapStyle, BlendMode } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  MousePointer2,
  Type,
  Pen,
  Highlighter,
  Square,
  Circle,
  Minus,
  ArrowUpRight,
  Eraser,
  Image as ImageIcon,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Trash2,
  RotateCcw,
  RotateCw,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  Download,
  Loader2,
  Shield,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { formatPdfDownloadName } from '@/lib/download';

interface PDFFile {
  id: string;
  name: string;
  data: ArrayBuffer;
}

interface EditorPage {
  id: string;
  originalIndex: number;
  baseRotation: number;
  rotation: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  thumbnail: string;
}

// All object geometry lives in "page space": the unrotated page, origin at the
// top-left corner, x right / y down, units are PDF points. A single transform
// maps page space onto the (possibly rotated) on-screen preview.
interface TextObject {
  type: 'text';
  id: string;
  pageId: string;
  x: number; // baseline start of the first line
  y: number;
  text: string;
  size: number;
  color: string;
  angle: number; // page display rotation at creation time; keeps text upright
}

interface ShapeObject {
  type: 'rect' | 'ellipse' | 'highlight' | 'whiteout';
  id: string;
  pageId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  strokeWidth: number;
}

interface LineObject {
  type: 'line' | 'arrow';
  id: string;
  pageId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  strokeWidth: number;
}

interface DrawObject {
  type: 'draw';
  id: string;
  pageId: string;
  points: number[]; // flat [x0, y0, x1, y1, ...]
  color: string;
  strokeWidth: number;
}

interface ImageObject {
  type: 'image';
  id: string;
  pageId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  dataUrl: string; // always PNG, pre-rotated into page space
}

type EditorObject = TextObject | ShapeObject | LineObject | DrawObject | ImageObject;

type Tool =
  | 'select'
  | 'text'
  | 'draw'
  | 'highlight'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'whiteout';

interface DragState {
  mode: 'create' | 'draw' | 'move' | 'resize' | 'endpoint';
  start: { x: number; y: number };
  objId?: string;
  orig?: EditorObject;
  fixed?: { x: number; y: number }; // opposite corner during resize
  endpoint?: 1 | 2;
  moved?: boolean;
  wasSelected?: boolean; // clicking an already-selected text opens the editor
}

interface PDFEditorProps {
  file: PDFFile;
  onApply: (data: ArrayBuffer) => void;
  fileSelector?: React.ReactNode;
}

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.5, 2, 3];
const HIGHLIGHT_COLOR = '#facc15';

const newId = () => Math.random().toString(36).substring(2, 9);

async function renderPageImage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  rotation: number,
  targetWidth: number
): Promise<string> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1, rotation });
  const scale = targetWidth / base.width;
  const viewport = page.getViewport({ scale, rotation });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, viewport }).promise;
  return canvas.toDataURL();
}

// Map a point in the displayed (rotated) preview to page space.
function displayToPage(dx: number, dy: number, w: number, h: number, rotation: number) {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { x: dy, y: h - dx };
    case 180:
      return { x: w - dx, y: h - dy };
    case 270:
      return { x: w - dy, y: dx };
    default:
      return { x: dx, y: dy };
  }
}

// Map a page-space point to displayed preview coordinates.
function pageToDisplay(x: number, y: number, w: number, h: number, rotation: number) {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { dx: h - y, dy: x };
    case 180:
      return { dx: w - x, dy: h - y };
    case 270:
      return { dx: y, dy: w - x };
    default:
      return { dx: x, dy: y };
  }
}

// SVG transform mapping page space into the rotated display viewBox.
function rotationMatrix(w: number, h: number, rotation: number): string | undefined {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return `matrix(0 1 -1 0 ${h} 0)`;
    case 180:
      return `matrix(-1 0 0 -1 ${w} ${h})`;
    case 270:
      return `matrix(0 -1 1 0 0 ${w})`;
    default:
      return undefined;
  }
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const bin = atob(dataUrl.split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Re-encode an image as PNG, rotated counter-clockwise so that after the
// page's display rotation is applied it appears upright.
function normalizeImage(src: string, rotation: number): Promise<{ dataUrl: string; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const r = ((rotation % 360) + 360) % 360;
      const sideways = r % 180 === 90;
      const canvas = document.createElement('canvas');
      canvas.width = sideways ? img.height : img.width;
      canvas.height = sideways ? img.width : img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('no canvas context'));
      if (r === 90) {
        ctx.translate(0, img.width);
        ctx.rotate(-Math.PI / 2);
      } else if (r === 180) {
        ctx.translate(img.width, img.height);
        ctx.rotate(Math.PI);
      } else if (r === 270) {
        ctx.translate(img.height, 0);
        ctx.rotate(Math.PI / 2);
      }
      ctx.drawImage(img, 0, 0);
      resolve({ dataUrl: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height });
    };
    img.onerror = () => reject(new Error('failed to load image'));
    img.src = src;
  });
}

function arrowHead(obj: LineObject): [number, number][] {
  const ang = Math.atan2(obj.y2 - obj.y1, obj.x2 - obj.x1);
  const len = Math.max(10, obj.strokeWidth * 4);
  return [
    [obj.x2 + len * Math.cos(ang + (Math.PI * 5) / 6), obj.y2 + len * Math.sin(ang + (Math.PI * 5) / 6)],
    [obj.x2 + len * Math.cos(ang - (Math.PI * 5) / 6), obj.y2 + len * Math.sin(ang - (Math.PI * 5) / 6)],
  ];
}

function objectBounds(obj: EditorObject): { x: number; y: number; w: number; h: number } {
  switch (obj.type) {
    case 'rect':
    case 'ellipse':
    case 'highlight':
    case 'whiteout':
    case 'image':
      return { x: obj.x, y: obj.y, w: obj.w, h: obj.h };
    case 'line':
    case 'arrow':
      return {
        x: Math.min(obj.x1, obj.x2),
        y: Math.min(obj.y1, obj.y2),
        w: Math.abs(obj.x2 - obj.x1),
        h: Math.abs(obj.y2 - obj.y1),
      };
    case 'draw': {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < obj.points.length; i += 2) {
        minX = Math.min(minX, obj.points[i]);
        maxX = Math.max(maxX, obj.points[i]);
        minY = Math.min(minY, obj.points[i + 1]);
        maxY = Math.max(maxY, obj.points[i + 1]);
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    case 'text': {
      const lines = obj.text.split('\n');
      const width = Math.max(...lines.map((l) => l.length), 1) * obj.size * 0.55;
      return { x: obj.x, y: obj.y - obj.size * 0.9, w: width, h: lines.length * obj.size * 1.2 };
    }
  }
}

function translateObject(obj: EditorObject, dx: number, dy: number): EditorObject {
  switch (obj.type) {
    case 'line':
    case 'arrow':
      return { ...obj, x1: obj.x1 + dx, y1: obj.y1 + dy, x2: obj.x2 + dx, y2: obj.y2 + dy };
    case 'draw':
      return { ...obj, points: obj.points.map((v, i) => (i % 2 === 0 ? v + dx : v + dy)) };
    default:
      return { ...obj, x: obj.x + dx, y: obj.y + dy };
  }
}

const TOOLS: { key: Tool; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
  { key: 'select', label: 'Select', icon: MousePointer2, hint: 'Tap an object to select it, drag to move, use handles to resize. Tap selected text again to edit it.' },
  { key: 'text', label: 'Text', icon: Type, hint: 'Tap on the page where the text should start, then type. Tap outside to finish.' },
  { key: 'draw', label: 'Pen', icon: Pen, hint: 'Draw freehand by dragging on the page.' },
  { key: 'highlight', label: 'Highlight', icon: Highlighter, hint: 'Drag over content to highlight it.' },
  { key: 'rect', label: 'Box', icon: Square, hint: 'Drag on the page to draw a rectangle.' },
  { key: 'ellipse', label: 'Ellipse', icon: Circle, hint: 'Drag on the page to draw an ellipse.' },
  { key: 'line', label: 'Line', icon: Minus, hint: 'Drag from the start to the end of the line.' },
  { key: 'arrow', label: 'Arrow', icon: ArrowUpRight, hint: 'Drag from the tail to the tip of the arrow.' },
  { key: 'whiteout', label: 'Redact', icon: Eraser, hint: 'Drag over sensitive data to cover it with a saved black redaction block.' },
];

export default function PDFEditor({ file, onApply, fileSelector }: PDFEditorProps) {
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const objectsRef = useRef<EditorObject[]>([]);
  const historyRef = useRef<{ stack: EditorObject[][]; index: number }>({ stack: [[]], index: 0 });

  const [pages, setPages] = useState<EditorPage[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [objects, setObjects] = useState<EditorObject[]>([]);
  const [draft, setDraft] = useState<EditorObject | null>(null);
  const [selectedObjId, setSelectedObjId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tool, setTool] = useState<Tool>('select');
  const [color, setColor] = useState('#dc2626');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [fontSize, setFontSize] = useState(16);
  const [zoom, setZoom] = useState(1);
  const [baseW, setBaseW] = useState(800);
  const [downloadName, setDownloadName] = useState(() => file.name.replace(/\.pdf$/i, '') + '-edited');

  useEffect(() => {
    objectsRef.current = objects;
  }, [objects]);

  // Fit the canvas to the available space (mobile → desktop)
  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      setBaseW(Math.max(260, Math.min(900, Math.round((w - 32) / 20) * 20)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isLoading]);

  const selectedPage = pages.find((p) => p.id === selectedPageId) ?? null;
  const rotationTotal = selectedPage ? (selectedPage.baseRotation + selectedPage.rotation) % 360 : 0;
  const sideways = rotationTotal % 180 === 90;
  const dispW = selectedPage ? (sideways ? selectedPage.height : selectedPage.width) : 1;
  const dispH = selectedPage ? (sideways ? selectedPage.width : selectedPage.height) : 1;
  const containerW = Math.round(baseW * zoom);
  const pxScale = containerW / dispW; // CSS px per page unit
  const selectedObj = objects.find((o) => o.id === selectedObjId) ?? null;

  // ---------- Loading ----------

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);
      setPages([]);
      setObjects([]);
      setDraft(null);
      setSelectedObjId(null);
      setEditingTextId(null);
      setSelectedPageId(null);
      setPreviewUrl(null);
      historyRef.current = { stack: [[]], index: 0 };
      dragRef.current = null;

      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      // pdf.js transfers the buffer to its worker, so hand it a copy
      const doc = await pdfjs.getDocument({ data: file.data.slice(0) }).promise;
      if (cancelled) return;
      docRef.current = doc;

      const loaded: EditorPage[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const [x1, y1, x2, y2] = page.view;
        const thumbnail = await renderPageImage(doc, i, page.rotate, 140);
        if (cancelled) return;
        loaded.push({
          id: newId(),
          originalIndex: i - 1,
          baseRotation: page.rotate,
          rotation: 0,
          width: x2 - x1,
          height: y2 - y1,
          offsetX: x1,
          offsetY: y1,
          thumbnail,
        });
      }

      setPages(loaded);
      setSelectedPageId(loaded[0]?.id ?? null);
      setIsLoading(false);
    };

    load().catch((err) => {
      console.error('Error loading PDF for editing:', err);
      if (!cancelled) {
        setError('Failed to load this PDF for editing.');
        setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [file]);

  useEffect(() => {
    setDownloadName(file.name.replace(/\.pdf$/i, '') + '-edited');
  }, [file.name]);

  useEffect(() => {
    const doc = docRef.current;
    if (!doc || !selectedPage) {
      setPreviewUrl(null);
      return;
    }
    let cancelled = false;
    renderPageImage(
      doc,
      selectedPage.originalIndex + 1,
      (selectedPage.baseRotation + selectedPage.rotation) % 360,
      Math.min(containerW * (typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1), 2600)
    )
      .then((url) => {
        if (!cancelled) setPreviewUrl(url);
      })
      .catch((err) => console.error('Error rendering preview:', err));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPage?.id, selectedPage?.rotation, containerW]);

  // ---------- History ----------

  const pushHistory = useCallback((objs: EditorObject[]) => {
    const h = historyRef.current;
    h.stack = [...h.stack.slice(Math.max(0, h.index - 58), h.index + 1), objs];
    h.index = h.stack.length - 1;
  }, []);

  const commitObjects = useCallback(
    (objs: EditorObject[]) => {
      setObjects(objs);
      pushHistory(objs);
    },
    [pushHistory]
  );

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (h.index === 0) return;
    h.index--;
    setObjects(h.stack[h.index]);
    setSelectedObjId(null);
    setEditingTextId(null);
  }, []);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (h.index >= h.stack.length - 1) return;
    h.index++;
    setObjects(h.stack[h.index]);
    setSelectedObjId(null);
    setEditingTextId(null);
  }, []);

  const deleteObject = useCallback(
    (id: string) => {
      commitObjects(objectsRef.current.filter((o) => o.id !== id));
      setSelectedObjId((cur) => (cur === id ? null : cur));
      setEditingTextId((cur) => (cur === id ? null : cur));
    },
    [commitObjects]
  );

  // ---------- Keyboard ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedObjId) {
          e.preventDefault();
          deleteObject(selectedObjId);
        }
      } else if (e.key === 'Escape') {
        setSelectedObjId(null);
        setDraft(null);
        dragRef.current = null;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedObjId, undo, redo, deleteObject]);

  // ---------- Page operations ----------

  const rotatePage = useCallback(
    async (pageId: string, delta: 90 | -90) => {
      const doc = docRef.current;
      const page = pages.find((p) => p.id === pageId);
      if (!doc || !page) return;
      const rotation = (((page.rotation + delta) % 360) + 360) % 360;
      const thumbnail = await renderPageImage(
        doc,
        page.originalIndex + 1,
        (page.baseRotation + rotation) % 360,
        140
      );
      setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, rotation, thumbnail } : p)));
    },
    [pages]
  );

  const movePage = useCallback((index: number, dir: -1 | 1) => {
    setPages((prev) => {
      const newIndex = index + dir;
      if (newIndex < 0 || newIndex >= prev.length) return prev;
      const items = [...prev];
      const [moved] = items.splice(index, 1);
      items.splice(newIndex, 0, moved);
      return items;
    });
  }, []);

  const deletePage = useCallback(
    (pageId: string) => {
      commitObjects(objectsRef.current.filter((o) => o.pageId !== pageId));
      setPages((prev) => {
        const remaining = prev.filter((p) => p.id !== pageId);
        if (selectedPageId === pageId) {
          setSelectedPageId(remaining[0]?.id ?? null);
        }
        return remaining;
      });
    },
    [selectedPageId, commitObjects]
  );

  // ---------- Text editing ----------

  const finishTextEdit = useCallback(() => {
    const id = editingTextId;
    if (!id) return;
    setEditingTextId(null);
    const objs = objectsRef.current;
    const obj = objs.find((o) => o.id === id);
    if (!obj || obj.type !== 'text') return;
    if (!obj.text.trim()) {
      const next = objs.filter((o) => o.id !== id);
      setObjects(next);
      setSelectedObjId((cur) => (cur === id ? null : cur));
      const last = historyRef.current.stack[historyRef.current.index];
      if (last.some((o) => o.id === id)) pushHistory(next);
    } else {
      pushHistory(objs);
    }
  }, [editingTextId, pushHistory]);

  // ---------- Pointer interaction on the overlay ----------

  const svgPoint = useCallback(
    (e: { clientX: number; clientY: number }) => {
      if (!svgRef.current || !selectedPage) return null;
      const rect = svgRef.current.getBoundingClientRect();
      const dx = ((e.clientX - rect.left) / rect.width) * dispW;
      const dy = ((e.clientY - rect.top) / rect.height) * dispH;
      return displayToPage(dx, dy, selectedPage.width, selectedPage.height, rotationTotal);
    },
    [selectedPage, dispW, dispH, rotationTotal]
  );

  const capturePointer = useCallback((e: React.PointerEvent) => {
    try {
      svgRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // capture may fail for exotic pointer types; drags still mostly work
    }
  }, []);

  const handleSvgPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const pt = svgPoint(e);
      if (!pt || !selectedPage) return;
      if (editingTextId) return; // textarea blur handles commit
      e.preventDefault();
      capturePointer(e);

      if (tool === 'select') {
        setSelectedObjId(null);
        return;
      }
      if (tool === 'text') {
        const obj: TextObject = {
          type: 'text',
          id: newId(),
          pageId: selectedPage.id,
          x: pt.x,
          y: pt.y,
          text: '',
          size: fontSize,
          color,
          angle: rotationTotal,
        };
        setObjects((prev) => [...prev, obj]);
        setSelectedObjId(obj.id);
        setEditingTextId(obj.id);
        return;
      }
      if (tool === 'draw') {
        dragRef.current = { mode: 'draw', start: pt };
        setDraft({
          type: 'draw',
          id: newId(),
          pageId: selectedPage.id,
          points: [pt.x, pt.y],
          color,
          strokeWidth,
        });
        return;
      }
      if (tool === 'line' || tool === 'arrow') {
        dragRef.current = { mode: 'create', start: pt };
        setDraft({
          type: tool,
          id: newId(),
          pageId: selectedPage.id,
          x1: pt.x,
          y1: pt.y,
          x2: pt.x,
          y2: pt.y,
          color,
          strokeWidth,
        });
        return;
      }
      // rect / ellipse / highlight / whiteout
      dragRef.current = { mode: 'create', start: pt };
      setDraft({
        type: tool,
        id: newId(),
        pageId: selectedPage.id,
        x: pt.x,
        y: pt.y,
        w: 0,
        h: 0,
        color: tool === 'highlight' ? HIGHLIGHT_COLOR : tool === 'whiteout' ? '#111827' : color,
        strokeWidth,
      });
    },
    [svgPoint, selectedPage, tool, color, strokeWidth, fontSize, rotationTotal, editingTextId, capturePointer]
  );

  const handleObjectPointerDown = useCallback(
    (e: React.PointerEvent, obj: EditorObject) => {
      if (tool !== 'select') return;
      e.stopPropagation();
      e.preventDefault();
      capturePointer(e);
      const pt = svgPoint(e);
      if (!pt) return;
      const wasSelected = selectedObjId === obj.id;
      setSelectedObjId(obj.id);
      dragRef.current = { mode: 'move', start: pt, objId: obj.id, orig: obj, wasSelected };
    },
    [tool, svgPoint, selectedObjId, capturePointer]
  );

  const startResize = useCallback(
    (e: React.PointerEvent, obj: ShapeObject | ImageObject, corner: 0 | 1 | 2 | 3) => {
      e.stopPropagation();
      e.preventDefault();
      capturePointer(e);
      const pt = svgPoint(e);
      if (!pt) return;
      const fixed = {
        x: corner === 1 || corner === 2 ? obj.x : obj.x + obj.w,
        y: corner === 2 || corner === 3 ? obj.y : obj.y + obj.h,
      };
      dragRef.current = { mode: 'resize', start: pt, objId: obj.id, orig: obj, fixed };
    },
    [svgPoint, capturePointer]
  );

  const startEndpointDrag = useCallback(
    (e: React.PointerEvent, obj: LineObject, endpoint: 1 | 2) => {
      e.stopPropagation();
      e.preventDefault();
      capturePointer(e);
      const pt = svgPoint(e);
      if (!pt) return;
      dragRef.current = { mode: 'endpoint', start: pt, objId: obj.id, orig: obj, endpoint };
    },
    [svgPoint, capturePointer]
  );

  const handleSvgPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const pt = svgPoint(e);
      if (!pt) return;

      if (d.mode === 'draw') {
        setDraft((prev) => {
          if (!prev || prev.type !== 'draw') return prev;
          const n = prev.points.length;
          const lx = prev.points[n - 2];
          const ly = prev.points[n - 1];
          const minDist = 1.5 / (zoom || 1);
          if ((pt.x - lx) ** 2 + (pt.y - ly) ** 2 < minDist * minDist) return prev;
          return { ...prev, points: [...prev.points, pt.x, pt.y] };
        });
        return;
      }
      if (d.mode === 'create') {
        setDraft((prev) => {
          if (!prev) return prev;
          if (prev.type === 'line' || prev.type === 'arrow') {
            return { ...prev, x2: pt.x, y2: pt.y };
          }
          if (prev.type === 'rect' || prev.type === 'ellipse' || prev.type === 'highlight' || prev.type === 'whiteout') {
            return {
              ...prev,
              x: Math.min(d.start.x, pt.x),
              y: Math.min(d.start.y, pt.y),
              w: Math.abs(pt.x - d.start.x),
              h: Math.abs(pt.y - d.start.y),
            };
          }
          return prev;
        });
        return;
      }

      // move / resize / endpoint act on committed objects (transiently)
      const orig = d.orig;
      if (!orig || !d.objId) return;
      if ((pt.x - d.start.x) ** 2 + (pt.y - d.start.y) ** 2 > 1) d.moved = true;
      if (!d.moved) return;
      if (d.mode === 'move') {
        const moved = translateObject(orig, pt.x - d.start.x, pt.y - d.start.y);
        setObjects((prev) => prev.map((o) => (o.id === d.objId ? moved : o)));
      } else if (d.mode === 'resize' && d.fixed && orig.type !== 'text' && orig.type !== 'line' && orig.type !== 'arrow' && orig.type !== 'draw') {
        const x = Math.min(d.fixed.x, pt.x);
        const y = Math.min(d.fixed.y, pt.y);
        const w = Math.max(4, Math.abs(pt.x - d.fixed.x));
        const h = Math.max(4, Math.abs(pt.y - d.fixed.y));
        setObjects((prev) => prev.map((o) => (o.id === d.objId ? { ...orig, x, y, w, h } : o)));
      } else if (d.mode === 'endpoint' && (orig.type === 'line' || orig.type === 'arrow')) {
        const upd = d.endpoint === 1 ? { x1: pt.x, y1: pt.y } : { x2: pt.x, y2: pt.y };
        setObjects((prev) => prev.map((o) => (o.id === d.objId ? { ...orig, ...upd } : o)));
      }
    },
    [svgPoint, zoom]
  );

  const handleSvgPointerUp = useCallback(() => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;

    if (d.mode === 'create' || d.mode === 'draw') {
      setDraft((current) => {
        if (current) {
          let keep = false;
          if (current.type === 'draw') keep = current.points.length >= 4;
          else if (current.type === 'line' || current.type === 'arrow') {
            keep = (current.x2 - current.x1) ** 2 + (current.y2 - current.y1) ** 2 > 9;
          } else if ('w' in current) keep = current.w > 3 && current.h > 3;
          if (keep) {
            commitObjects([...objectsRef.current, current]);
            setSelectedObjId(current.id);
          }
        }
        return null;
      });
      return;
    }
    if (d.moved) {
      pushHistory(objectsRef.current);
      return;
    }
    // A tap (no movement) on already-selected text opens the inline editor
    if (d.mode === 'move' && d.wasSelected && d.orig?.type === 'text') {
      setEditingTextId(d.orig.id);
    }
  }, [commitObjects, pushHistory]);

  // ---------- Style changes applied to selection ----------

  const updateSelected = useCallback(
    (patch: { color?: string; strokeWidth?: number; size?: number }) => {
      if (!selectedObjId) return;
      const next = objectsRef.current.map((o) => (o.id === selectedObjId ? ({ ...o, ...patch } as EditorObject) : o));
      commitObjects(next);
    },
    [selectedObjId, commitObjects]
  );

  const handleColorChange = useCallback(
    (value: string) => {
      setColor(value);
      if (selectedObj && selectedObj.type !== 'image' && selectedObj.type !== 'whiteout') {
        updateSelected({ color: value });
      }
    },
    [selectedObj, updateSelected]
  );

  const handleStrokeWidthChange = useCallback(
    (value: number) => {
      const v = Math.max(1, Math.min(20, value || 1));
      setStrokeWidth(v);
      if (selectedObj && 'strokeWidth' in selectedObj) {
        updateSelected({ strokeWidth: v });
      }
    },
    [selectedObj, updateSelected]
  );

  const handleFontSizeChange = useCallback(
    (value: number) => {
      const v = Math.max(6, Math.min(144, value || 16));
      setFontSize(v);
      if (selectedObj?.type === 'text') {
        updateSelected({ size: v });
      }
    },
    [selectedObj, updateSelected]
  );

  // ---------- Image insertion ----------

  const handleImageFile = useCallback(
    async (fileObj: File) => {
      if (!selectedPage) return;
      try {
        const reader = new FileReader();
        const src = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('failed to read file'));
          reader.readAsDataURL(fileObj);
        });
        const { dataUrl, w, h } = await normalizeImage(src, rotationTotal);
        const maxDim = Math.min(selectedPage.width, selectedPage.height) * 0.5;
        const scale = Math.min(1, maxDim / Math.max(w, h));
        const obj: ImageObject = {
          type: 'image',
          id: newId(),
          pageId: selectedPage.id,
          x: (selectedPage.width - w * scale) / 2,
          y: (selectedPage.height - h * scale) / 2,
          w: w * scale,
          h: h * scale,
          dataUrl,
        };
        commitObjects([...objectsRef.current, obj]);
        setSelectedObjId(obj.id);
        setTool('select');
      } catch (err) {
        console.error('Error inserting image:', err);
        setError('Failed to insert that image.');
      }
    },
    [selectedPage, rotationTotal, commitObjects]
  );

  // ---------- Saving ----------

  const buildEditedPdf = useCallback(async () => {
    const srcDoc = await PDFDocument.load(file.data);
    const outDoc = await PDFDocument.create();
    const font = await outDoc.embedFont(StandardFonts.Helvetica);
    const imageCache = new Map<string, Awaited<ReturnType<typeof outDoc.embedPng>>>();
    const copiedPages = await outDoc.copyPages(
      srcDoc,
      pages.map((p) => p.originalIndex)
    );

    for (let i = 0; i < copiedPages.length; i++) {
      const page = copiedPages[i];
      const meta = pages[i];
      const rotation = (meta.baseRotation + meta.rotation) % 360;
      page.setRotation(degrees(rotation));

      const px = (x: number) => meta.offsetX + x;
      const py = (y: number) => meta.offsetY + meta.height - y;

      for (const obj of objects.filter((o) => o.pageId === meta.id)) {
        switch (obj.type) {
          case 'text':
            page.drawText(obj.text, {
              x: px(obj.x),
              y: py(obj.y),
              size: obj.size,
              font,
              color: hexToRgb(obj.color),
              rotate: degrees(obj.angle),
              lineHeight: obj.size * 1.2,
            });
            break;
          case 'rect':
            page.drawRectangle({
              x: px(obj.x),
              y: py(obj.y + obj.h),
              width: obj.w,
              height: obj.h,
              borderColor: hexToRgb(obj.color),
              borderWidth: obj.strokeWidth,
            });
            break;
          case 'ellipse':
            page.drawEllipse({
              x: px(obj.x + obj.w / 2),
              y: py(obj.y + obj.h / 2),
              xScale: obj.w / 2,
              yScale: obj.h / 2,
              borderColor: hexToRgb(obj.color),
              borderWidth: obj.strokeWidth,
            });
            break;
          case 'highlight':
            page.drawRectangle({
              x: px(obj.x),
              y: py(obj.y + obj.h),
              width: obj.w,
              height: obj.h,
              color: hexToRgb(obj.color),
              opacity: 0.4,
              blendMode: BlendMode.Multiply,
            });
            break;
          case 'whiteout':
            page.drawRectangle({
              x: px(obj.x),
              y: py(obj.y + obj.h),
              width: obj.w,
              height: obj.h,
              color: rgb(0.067, 0.094, 0.153),
            });
            break;
          case 'line':
          case 'arrow':
            page.drawLine({
              start: { x: px(obj.x1), y: py(obj.y1) },
              end: { x: px(obj.x2), y: py(obj.y2) },
              thickness: obj.strokeWidth,
              color: hexToRgb(obj.color),
              lineCap: LineCapStyle.Round,
            });
            if (obj.type === 'arrow') {
              for (const [hx, hy] of arrowHead(obj)) {
                page.drawLine({
                  start: { x: px(hx), y: py(hy) },
                  end: { x: px(obj.x2), y: py(obj.y2) },
                  thickness: obj.strokeWidth,
                  color: hexToRgb(obj.color),
                  lineCap: LineCapStyle.Round,
                });
              }
            }
            break;
          case 'draw':
            for (let j = 0; j + 3 < obj.points.length; j += 2) {
              page.drawLine({
                start: { x: px(obj.points[j]), y: py(obj.points[j + 1]) },
                end: { x: px(obj.points[j + 2]), y: py(obj.points[j + 3]) },
                thickness: obj.strokeWidth,
                color: hexToRgb(obj.color),
                lineCap: LineCapStyle.Round,
              });
            }
            break;
          case 'image': {
            let embedded = imageCache.get(obj.dataUrl);
            if (!embedded) {
              embedded = await outDoc.embedPng(dataUrlToBytes(obj.dataUrl));
              imageCache.set(obj.dataUrl, embedded);
            }
            page.drawImage(embedded, {
              x: px(obj.x),
              y: py(obj.y + obj.h),
              width: obj.w,
              height: obj.h,
            });
            break;
          }
        }
      }
      outDoc.addPage(page);
    }

    const bytes = await outDoc.save();
    const buffer = new ArrayBuffer(bytes.length);
    new Uint8Array(buffer).set(bytes);
    return buffer;
  }, [file, pages, objects]);

  const handleApply = useCallback(async () => {
    if (pages.length === 0) return;
    setIsSaving(true);
    setError(null);
    try {
      onApply(await buildEditedPdf());
    } catch (err) {
      console.error('Error saving edited PDF:', err);
      setError('Failed to save changes. Some characters may not be supported by the built-in font.');
    } finally {
      setIsSaving(false);
    }
  }, [pages.length, buildEditedPdf, onApply]);

  const handleDownload = useCallback(async () => {
    if (pages.length === 0) return;
    const fileName = formatPdfDownloadName(downloadName, `${file.name.replace(/\.pdf$/i, '')}-edited.pdf`);

    setIsSaving(true);
    setError(null);
    try {
      const buffer = await buildEditedPdf();
      const blob = new Blob([buffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error downloading edited PDF:', err);
      setError('Failed to generate the edited PDF.');
    } finally {
      setIsSaving(false);
    }
  }, [pages.length, buildEditedPdf, file.name, downloadName]);

  // ---------- Object rendering ----------

  const renderObjectSvg = (obj: EditorObject, isDraft: boolean) => {
    const common = {
      onPointerDown: (e: React.PointerEvent) => handleObjectPointerDown(e, obj),
      style: { cursor: tool === 'select' ? 'move' : undefined } as React.CSSProperties,
    };
    switch (obj.type) {
      case 'text': {
        if (obj.id === editingTextId) return null;
        const lines = obj.text.split('\n');
        return (
          <text
            key={obj.id}
            x={obj.x}
            y={obj.y}
            fontSize={obj.size}
            fill={obj.color}
            fontFamily="Helvetica, Arial, sans-serif"
            transform={obj.angle ? `rotate(${-obj.angle} ${obj.x} ${obj.y})` : undefined}
            {...common}
          >
            {lines.map((ln, i) => (
              <tspan key={i} x={obj.x} dy={i === 0 ? 0 : obj.size * 1.2}>
                {ln || ' '}
              </tspan>
            ))}
          </text>
        );
      }
      case 'rect':
        return (
          <rect
            key={obj.id}
            x={obj.x}
            y={obj.y}
            width={obj.w}
            height={obj.h}
            fill="transparent"
            stroke={obj.color}
            strokeWidth={obj.strokeWidth}
            {...common}
          />
        );
      case 'ellipse':
        return (
          <ellipse
            key={obj.id}
            cx={obj.x + obj.w / 2}
            cy={obj.y + obj.h / 2}
            rx={obj.w / 2}
            ry={obj.h / 2}
            fill="transparent"
            stroke={obj.color}
            strokeWidth={obj.strokeWidth}
            {...common}
          />
        );
      case 'highlight':
        return (
          <rect
            key={obj.id}
            x={obj.x}
            y={obj.y}
            width={obj.w}
            height={obj.h}
            fill={obj.color}
            opacity={0.4}
            style={{ ...common.style, mixBlendMode: 'multiply' }}
            onPointerDown={common.onPointerDown}
          />
        );
      case 'whiteout':
        return (
          <rect key={obj.id} x={obj.x} y={obj.y} width={obj.w} height={obj.h} fill="#111827" {...common} />
        );
      case 'line':
      case 'arrow': {
        const heads = obj.type === 'arrow' ? arrowHead(obj) : [];
        return (
          <g key={obj.id} {...common}>
            <line x1={obj.x1} y1={obj.y1} x2={obj.x2} y2={obj.y2} stroke="transparent" strokeWidth={Math.max(14 / pxScale, obj.strokeWidth)} />
            <line
              x1={obj.x1}
              y1={obj.y1}
              x2={obj.x2}
              y2={obj.y2}
              stroke={obj.color}
              strokeWidth={obj.strokeWidth}
              strokeLinecap="round"
            />
            {heads.map(([hx, hy], i) => (
              <line key={i} x1={hx} y1={hy} x2={obj.x2} y2={obj.y2} stroke={obj.color} strokeWidth={obj.strokeWidth} strokeLinecap="round" />
            ))}
          </g>
        );
      }
      case 'draw': {
        const pts: string[] = [];
        for (let i = 0; i < obj.points.length; i += 2) pts.push(`${obj.points[i]},${obj.points[i + 1]}`);
        return (
          <g key={obj.id} {...(isDraft ? {} : common)}>
            <polyline points={pts.join(' ')} fill="none" stroke="transparent" strokeWidth={Math.max(14 / pxScale, obj.strokeWidth)} />
            <polyline
              points={pts.join(' ')}
              fill="none"
              stroke={obj.color}
              strokeWidth={obj.strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        );
      }
      case 'image':
        return (
          <image
            key={obj.id}
            href={obj.dataUrl}
            x={obj.x}
            y={obj.y}
            width={obj.w}
            height={obj.h}
            preserveAspectRatio="none"
            {...common}
          />
        );
    }
  };

  const renderSelection = (obj: EditorObject) => {
    const handleR = 6 / pxScale;
    const bounds = objectBounds(obj);
    const outline = (
      <rect
        x={bounds.x - 2 / pxScale}
        y={bounds.y - 2 / pxScale}
        width={bounds.w + 4 / pxScale}
        height={bounds.h + 4 / pxScale}
        fill="none"
        stroke="#3b82f6"
        strokeWidth={1.5 / pxScale}
        strokeDasharray={`${4 / pxScale} ${3 / pxScale}`}
        pointerEvents="none"
      />
    );
    if (obj.type === 'line' || obj.type === 'arrow') {
      return (
        <g key="sel">
          {outline}
          {([1, 2] as const).map((ep) => (
            <circle
              key={ep}
              cx={ep === 1 ? obj.x1 : obj.x2}
              cy={ep === 1 ? obj.y1 : obj.y2}
              r={handleR}
              fill="#3b82f6"
              stroke="#ffffff"
              strokeWidth={1 / pxScale}
              style={{ cursor: 'crosshair' }}
              onPointerDown={(e) => startEndpointDrag(e, obj, ep)}
            />
          ))}
        </g>
      );
    }
    const resizable = obj.type === 'rect' || obj.type === 'ellipse' || obj.type === 'highlight' || obj.type === 'whiteout' || obj.type === 'image';
    if (!resizable) {
      const wrap =
        obj.type === 'text' && obj.angle
          ? `rotate(${-obj.angle} ${obj.x} ${obj.y})`
          : undefined;
      return (
        <g key="sel" transform={wrap}>
          {outline}
        </g>
      );
    }
    const corners: [number, number][] = [
      [obj.x, obj.y],
      [obj.x + obj.w, obj.y],
      [obj.x + obj.w, obj.y + obj.h],
      [obj.x, obj.y + obj.h],
    ];
    return (
      <g key="sel">
        {outline}
        {corners.map(([cx, cy], i) => (
          <rect
            key={i}
            x={cx - handleR}
            y={cy - handleR}
            width={handleR * 2}
            height={handleR * 2}
            fill="#3b82f6"
            stroke="#ffffff"
            strokeWidth={1 / pxScale}
            style={{ cursor: 'nwse-resize' }}
            onPointerDown={(e) => startResize(e, obj, i as 0 | 1 | 2 | 3)}
          />
        ))}
      </g>
    );
  };

  const renderPageCard = (page: EditorPage, index: number, layout: 'v' | 'h') => (
    <div key={page.id} className={cn(layout === 'v' ? 'w-full' : 'w-20 shrink-0')}>
      <button
        onClick={() => {
          setSelectedPageId(page.id);
          setSelectedObjId(null);
        }}
        className={cn(
          'w-full overflow-hidden rounded-md border-2 transition-colors',
          selectedPageId === page.id ? 'border-primary' : 'border-border hover:border-primary/50'
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={page.thumbnail} alt={`Page ${index + 1}`} className="w-full bg-white" />
      </button>
      <div className="mt-0.5 flex items-center justify-between">
        <span className="pl-0.5 text-[10px] text-muted-foreground">{index + 1}</span>
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon"
            className="size-5"
            onClick={() => movePage(index, -1)}
            disabled={index === 0}
            title={layout === 'v' ? 'Move page up' : 'Move page left'}
          >
            {layout === 'v' ? <ChevronUp className="size-3" /> : <ChevronLeft className="size-3" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-5"
            onClick={() => movePage(index, 1)}
            disabled={index === pages.length - 1}
            title={layout === 'v' ? 'Move page down' : 'Move page right'}
          >
            {layout === 'v' ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-5"
            onClick={() => rotatePage(page.id, -90)}
            title="Rotate counter-clockwise"
          >
            <RotateCcw className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-5"
            onClick={() => rotatePage(page.id, 90)}
            title="Rotate clockwise"
          >
            <RotateCw className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-5 hover:text-destructive"
            onClick={() => deletePage(page.id)}
            title="Delete page"
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </div>
    </div>
  );

  const hasEdits =
    objects.length > 0 ||
    pages.some((p, i) => p.rotation !== 0 || p.originalIndex !== i) ||
    (!isLoading && docRef.current !== null && pages.length !== docRef.current.numPages);

  const pageObjects = selectedPage ? objects.filter((o) => o.pageId === selectedPage.id) : [];
  const editingText = editingTextId ? (objects.find((o) => o.id === editingTextId) as TextObject | undefined) : undefined;
  const containerH = containerW * (dispH / dispW);
  const activeTool = TOOLS.find((t) => t.key === tool);

  let editingTextPos: { left: number; top: number } | null = null;
  if (editingText && selectedPage) {
    const d = pageToDisplay(editingText.x, editingText.y, selectedPage.width, selectedPage.height, rotationTotal);
    editingTextPos = {
      left: (d.dx / dispW) * containerW,
      top: (d.dy / dispH) * containerH - editingText.size * pxScale,
    };
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        {fileSelector}
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleApply}
            disabled={isSaving || isLoading || pages.length === 0 || !hasEdits}
            title="Save the edits back into the app so they carry over to merging"
          >
            {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            <span className="hidden sm:inline">{isSaving ? 'Saving...' : 'Apply'}</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleDownload}
            disabled={isSaving || isLoading || pages.length === 0}
          >
            <Download className="size-4" />
            <span className="hidden sm:inline">Download</span>
          </Button>
          <label className="hidden h-8 min-w-0 items-center overflow-hidden rounded-lg border bg-background text-xs text-muted-foreground shadow-sm focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 sm:flex">
            <span className="flex h-full shrink-0 items-center border-r bg-muted/50 px-2">File</span>
            <Input
              value={downloadName}
              onChange={(e) => setDownloadName(e.target.value.replace(/\.pdf$/i, ''))}
              className="h-7 w-40 border-0 px-2 text-sm shadow-none focus-visible:ring-0 lg:w-56"
              aria-label="Edited PDF file name"
            />
            <span className="flex h-full items-center border-l bg-muted/50 px-2 font-medium text-foreground">
              .pdf
            </span>
          </label>
        </div>
      </div>

      {error && (
        <div className="mx-3 mt-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="size-7 animate-spin" />
          <span className="text-sm">Loading pages...</span>
        </div>
      ) : pages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
          All pages were deleted. Re-select the file to start over.
        </div>
      ) : (
        <>
          {/* Toolbar */}
          <div className="flex items-center gap-1.5 overflow-x-auto border-b px-2 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={tool}
              onValueChange={(v) => {
                if (v) {
                  setTool(v as Tool);
                  setSelectedObjId(null);
                }
              }}
              className="shrink-0"
            >
              {TOOLS.map((t) => (
                <ToggleGroupItem key={t.key} value={t.key} title={t.hint} aria-label={t.label} className="px-2">
                  <t.icon className="size-4" />
                  <span className="ml-1 hidden text-xs xl:inline">{t.label}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                'shrink-0',
                tool === 'whiteout' && 'border-primary bg-primary/10 text-primary hover:bg-primary/15'
              )}
              data-state={tool === 'whiteout' ? 'on' : undefined}
              onClick={() => {
                setTool('whiteout');
                setSelectedObjId(null);
              }}
              title="Redact data by drawing a black block over sensitive content"
            >
              <Shield className="size-4" />
              <span className="ml-1 text-xs">Redact data</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => fileInputRef.current?.click()}
              title="Insert an image (e.g. a signature) onto the current page"
            >
              <ImageIcon className="size-4" />
              <span className="ml-1 hidden text-xs xl:inline">Image</span>
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImageFile(f);
                e.target.value = '';
              }}
            />

            <Separator orientation="vertical" className="mx-1 !h-6 shrink-0" />

            <input
              type="color"
              value={color}
              onChange={(e) => handleColorChange(e.target.value)}
              className="size-8 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
              title="Color"
            />
            <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground" title="Stroke width">
              W
              <Input
                type="number"
                min={1}
                max={20}
                value={strokeWidth}
                onChange={(e) => handleStrokeWidthChange(Number(e.target.value))}
                className="h-8 w-14 px-2"
              />
            </label>
            <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground" title="Font size">
              A
              <Input
                type="number"
                min={6}
                max={144}
                value={fontSize}
                onChange={(e) => handleFontSizeChange(Number(e.target.value))}
                className="h-8 w-14 px-2"
              />
            </label>

            <Separator orientation="vertical" className="mx-1 !h-6 shrink-0" />

            <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={undo} disabled={historyRef.current.index === 0} title="Undo (Cmd/Ctrl+Z)">
              <Undo2 className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              onClick={redo}
              disabled={historyRef.current.index >= historyRef.current.stack.length - 1}
              title="Redo (Cmd/Ctrl+Shift+Z)"
            >
              <Redo2 className="size-4" />
            </Button>

            <Separator orientation="vertical" className="mx-1 !h-6 shrink-0" />

            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              onClick={() => setZoom(ZOOM_LEVELS[Math.max(0, ZOOM_LEVELS.indexOf(zoom) - 1)])}
              disabled={zoom === ZOOM_LEVELS[0]}
              title="Zoom out"
            >
              <ZoomOut className="size-4" />
            </Button>
            <span className="w-9 shrink-0 text-center text-xs text-muted-foreground">{Math.round(zoom * 100)}%</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              onClick={() => setZoom(ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, ZOOM_LEVELS.indexOf(zoom) + 1)])}
              disabled={zoom === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
              title="Zoom in"
            >
              <ZoomIn className="size-4" />
            </Button>

            {selectedObjId && (
              <>
                <Separator orientation="vertical" className="mx-1 !h-6 shrink-0" />
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-destructive hover:text-destructive"
                  onClick={() => deleteObject(selectedObjId)}
                  title="Delete selected object (Delete)"
                >
                  <Trash2 className="size-4" />
                </Button>
              </>
            )}
          </div>
          {activeTool && (
            <p className="hidden border-b px-3 py-1 text-xs text-muted-foreground md:block">{activeTool.hint}</p>
          )}

          {/* Workspace */}
          <div className="flex min-h-0 flex-1">
            {/* Page sidebar (desktop) */}
            <aside className="hidden w-36 shrink-0 overflow-y-auto border-r p-3 md:block">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Pages ({pages.length})</p>
              <div className="space-y-3">{pages.map((p, i) => renderPageCard(p, i, 'v'))}</div>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col">
              {/* Page strip (mobile) */}
              <div className="flex gap-2 overflow-x-auto border-b p-2 md:hidden">
                {pages.map((p, i) => renderPageCard(p, i, 'h'))}
              </div>

              {/* Canvas */}
              <div ref={canvasWrapRef} className="flex-1 overflow-auto bg-muted/50 p-4">
                {selectedPage && previewUrl && (
                  <div
                    className="relative mx-auto rounded-sm shadow-lg ring-1 ring-border select-none"
                    style={{ width: `${containerW}px` }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={previewUrl} alt="Page preview" className="block w-full rounded-sm bg-white" draggable={false} />
                    <svg
                      ref={svgRef}
                      viewBox={`0 0 ${dispW} ${dispH}`}
                      className="absolute inset-0 h-full w-full"
                      style={{
                        cursor: tool === 'select' ? 'default' : 'crosshair',
                        touchAction: tool === 'select' ? 'pan-x pan-y' : 'none',
                      }}
                      onPointerDown={handleSvgPointerDown}
                      onPointerMove={handleSvgPointerMove}
                      onPointerUp={handleSvgPointerUp}
                      onPointerCancel={handleSvgPointerUp}
                    >
                      <g transform={rotationMatrix(selectedPage.width, selectedPage.height, rotationTotal)}>
                        <g style={{ pointerEvents: tool === 'select' ? 'auto' : 'none' }}>
                          {pageObjects.map((o) => renderObjectSvg(o, false))}
                        </g>
                        {draft && renderObjectSvg(draft, true)}
                        {selectedObj && selectedObj.pageId === selectedPage.id && tool === 'select' && renderSelection(selectedObj)}
                      </g>
                    </svg>

                    {/* Inline text editing */}
                    {editingText && editingTextPos && (
                      <textarea
                        autoFocus
                        value={editingText.text}
                        rows={Math.max(1, editingText.text.split('\n').length)}
                        onChange={(e) =>
                          setObjects((prev) =>
                            prev.map((o) => (o.id === editingText.id ? { ...o, text: e.target.value } : o))
                          )
                        }
                        onBlur={finishTextEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            (e.target as HTMLTextAreaElement).blur();
                          }
                        }}
                        placeholder="Type here..."
                        className="absolute resize-none overflow-hidden whitespace-pre bg-transparent p-0 outline-1 outline-dashed outline-blue-500"
                        style={{
                          left: `${editingTextPos.left}px`,
                          top: `${editingTextPos.top}px`,
                          color: editingText.color,
                          fontSize: `${editingText.size * pxScale}px`,
                          lineHeight: 1.2,
                          fontFamily: 'Helvetica, Arial, sans-serif',
                          minWidth: '120px',
                          width: `${Math.max(
                            120,
                            (Math.max(...editingText.text.split('\n').map((l) => l.length), 1) + 2) *
                              editingText.size *
                              pxScale *
                              0.6
                          )}px`,
                        }}
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
