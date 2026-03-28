export interface Notice {
  actionLabel?: string
  description?: string
  id: string
  kind: NoticeKind
  message: string
  onAction?: () => void
}

export type NoticeKind = 'error' | 'info' | 'success' | 'warning'
