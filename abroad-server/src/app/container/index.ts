// src/app/container/index.ts
import { Container } from 'inversify'

import { configureContainer } from './configureContainer'

const iocContainer = new Container({ defaultScope: 'Singleton' })

configureContainer(iocContainer)

export { iocContainer }
