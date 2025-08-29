import { useEffect } from 'react'
import type { Emitter } from 'mitt'

// Subscribe to a mitt event bus with automatic cleanup.
export function useEventBus<Events extends Record<string, any>, K extends keyof Events>(
  emitter: Emitter<Events>,
  event: K,
  handler: (payload: Events[K]) => void,
) {
  useEffect(() => {
    emitter.on(event as any, handler as any)
    return () => emitter.off(event as any, handler as any)
  }, [emitter, event, handler])
}

// Subscribe to a DOM event target with automatic cleanup.
export function useDomEvent<T extends Event = Event>(
  target: EventTarget | null | undefined,
  type: string,
  handler: (event: T) => void,
  options?: boolean | AddEventListenerOptions,
) {
  useEffect(() => {
    if (!target) return
    const h = handler as EventListener
    ;(target as EventTarget).addEventListener(type, h, options as any)
    return () => (target as EventTarget).removeEventListener(type, h, options as any)
  }, [target, type, handler, options])
}

