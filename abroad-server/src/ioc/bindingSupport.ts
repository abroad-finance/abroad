import { Container, Newable, ServiceIdentifier } from 'inversify'

export type BindingRegistration<T> = {
  bindSelf?: boolean
  identifier: ServiceIdentifier<T>
  implementation: Constructor<T>
  name?: string
}

export type Constructor<T> = Newable<T>

export function registerBindings(
  container: Container,
  registrations: ReadonlyArray<BindingRegistration<unknown>>,
): void {
  registrations.forEach(({ bindSelf, identifier, implementation, name }) => {
    const binding = bindSelf
      ? container.bind(implementation).toSelf()
      : container.bind(identifier).to(implementation)

    if (name) {
      binding.whenNamed(name)
    }
  })
}
