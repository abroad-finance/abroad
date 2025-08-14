import dotenv from 'dotenv'

import { IAuthService } from './interfaces'
import { iocContainer } from './ioc'
import { startListeners } from './listeners/index'
import { TYPES } from './types'

dotenv.config()

startListeners()

iocContainer.get<IAuthService>(TYPES.IAuthService).initialize()
