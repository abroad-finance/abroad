export interface Notice {
  description?: string
  id: string
  kind: NoticeKind
  message: string
}

export type NoticeKind = 'error' | 'info' | 'success' | 'warning'
