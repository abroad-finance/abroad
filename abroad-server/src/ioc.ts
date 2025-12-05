// src/ioc.ts
import { Container } from 'inversify'

import { configureContainer } from './ioc/configureContainer'

const iocContainer = new Container({ defaultScope: 'Singleton' })

configureContainer(iocContainer)

export { iocContainer }
