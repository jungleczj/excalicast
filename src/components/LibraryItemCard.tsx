'use client';

import { useEffect, useState } from 'react';
import { I } from '@/components/icons';
import { libraryThumbnail } from '@/utils/libraryThumbnail';
import type { LibraryItemRow } from '@/lib/db-client';

interface Props {
  item: LibraryItemRow;
  onDelete: (id: string) => void;
  deleteTooltip: string;
}

export function LibraryItemCard({ item, onDelete, deleteTooltip }: Props): JSX.Element {
  const [dataUrl, setDataUrl] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    void libraryThumbnail(item).then((url) => {
      if (!cancelled) setDataUrl(url);
    });
    return () => { cancelled = true; };
  }, [item]);

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    // 用 MIME `application/vnd.excalidrawlib+json` —— 嵌入的 Excalidraw drop handler 认这个
    // payload 用整个 LibraryItemRow（含 id/status/elements/created/name），匹配 LibraryItems 形状
    // 必须是完整的 .excalidrawlib 信封（type+version），否则 Excalidraw 的
    // parseLibraryJSON → isValidLibrary 校验不过，drop 时报 "Invalid library"。
    e.dataTransfer.setData(
      'application/vnd.excalidrawlib+json',
      JSON.stringify({
        type: 'excalidrawlib',
        version: 2,
        libraryItems: [{
          id: item.id,
          status: item.status,
          elements: item.elements,
          created: item.created,
          name: item.name,
        }],
      }),
    );
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className="group relative"
      style={{
        background: 'var(--paper)',
        border: '1.5px solid var(--ink)',
        borderRadius: 3,
        padding: 8,
        cursor: 'grab',
        userSelect: 'none',
      }}
      onMouseDown={(e) => (e.currentTarget.style.cursor = 'grabbing')}
      onMouseUp={(e) => (e.currentTarget.style.cursor = 'grab')}
    >
      {dataUrl ? (
        <img
          src={dataUrl}
          alt={item.name ?? ''}
          style={{
            width: '100%',
            aspectRatio: '1 / 1',
            objectFit: 'contain',
            pointerEvents: 'none',
            display: 'block',
          }}
          draggable={false}
        />
      ) : (
        <div
          style={{
            width: '100%',
            aspectRatio: '1 / 1',
            background: 'var(--paper-2, #f3f3f0)',
          }}
        />
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(item.id);
        }}
        title={deleteTooltip}
        className="absolute opacity-0 transition group-hover:opacity-100"
        style={{
          top: 4,
          right: 4,
          width: 22,
          height: 22,
          display: 'grid',
          placeItems: 'center',
          background: 'var(--paper)',
          border: '1.4px solid var(--ink)',
          borderRadius: 3,
          color: 'var(--ink)',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <I.Trash size={12} />
      </button>
    </div>
  );
}
