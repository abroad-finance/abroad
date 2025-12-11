import { X } from 'lucide-react'
import React from 'react'

import type { Notice } from '@/shared/types/notice'

interface NoticeCenterProps {
  notices: Notice[]
  onDismiss: (id: string) => void
}

const KIND_STYLES: Record<Notice['kind'], { bg: string, border: string, text: string }> = {
  error: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800' },
  info: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-800' },
  success: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-800' },
  warning: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800' },
}

export const NoticeCenter: React.FC<NoticeCenterProps> = ({ notices, onDismiss }) => {
  if (!notices.length) return null

  return (
    <div aria-label="Notifications" className="fixed top-4 right-4 z-[1200] flex flex-col gap-2 w-[min(360px,90vw)]" role="region">
      {notices.map((notice) => {
        const styles = KIND_STYLES[notice.kind]
        return (
          <div
            aria-live={notice.kind === 'error' ? 'assertive' : 'polite'}
            className={`rounded-xl border shadow-sm p-3 ${styles.bg} ${styles.border} ${styles.text}`}
            key={notice.id}
            role="status"
          >
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <p className="font-semibold leading-tight">{notice.message}</p>
                {notice.description && (
                  <p className="text-sm opacity-80 mt-0.5">{notice.description}</p>
                )}
              </div>
              <button
                aria-label="Dismiss notification"
                className="p-1 rounded-full hover:bg-black/5"
                onClick={() => onDismiss(notice.id)}
                type="button"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
