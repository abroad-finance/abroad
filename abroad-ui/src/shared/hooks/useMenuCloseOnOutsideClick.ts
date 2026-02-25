import {
  type RefObject,
  useEffect,
} from 'react'

type MenuCloseOptions = {
  isOpen: boolean
  menuRef: RefObject<HTMLElement | null>
  onClose: () => void
  skipNextRef: React.MutableRefObject<boolean>
}

/** Listens for outside clicks and Escape to close a menu. Shared by useSwap and useWebSwapController. */
export function useMenuCloseOnOutsideClick({
  isOpen,
  menuRef,
  onClose,
  skipNextRef,
}: MenuCloseOptions): void {
  useEffect(() => {
    if (!isOpen) return

    const onDocumentClick = (event: MouseEvent) => {
      if (skipNextRef.current) {
        skipNextRef.current = false
        return
      }
      const container = menuRef.current
      if (!container) return
      const path = (event as unknown as { composedPath?: () => EventTarget[] }).composedPath?.()
      const clickedInside = path ? path.includes(container) : container.contains(event.target as Node)
      if (!clickedInside) onClose()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('click', onDocumentClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('click', onDocumentClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [
    isOpen,
    menuRef,
    onClose,
    skipNextRef,
  ])
}
