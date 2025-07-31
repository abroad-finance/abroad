import * as admin from 'firebase-admin'
import { injectable } from 'inversify'
import 'reflect-metadata'

import { IAuthService } from '../interfaces'

@injectable()
export class FirebaseAuthService implements IAuthService {
  private initialized = false

  constructor() {
    this.initialize()
  }

  initialize(): void {
    if (!this.initialized && !admin.apps.length) {
      admin.initializeApp({ projectId: process.env.PROJECT_ID })
      console.log('Firebase Admin SDK initialized by FirebaseAuthService.')
      this.initialized = true
    }
  }

  verifyToken: IAuthService['verifyToken'] = async (token: string) => {
    if (!this.initialized) {
      this.initialize() // Ensure initialized
    }
    try {
      const decodedToken = await admin.auth().verifyIdToken(token)
      return { userId: decodedToken.uid }
    }
    catch {
      throw new Error('Firebase token verification failed')
    }
  }
}
