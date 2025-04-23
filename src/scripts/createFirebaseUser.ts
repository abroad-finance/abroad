import { Command } from 'commander'
import dotenv from 'dotenv'
import * as admin from 'firebase-admin'

dotenv.config()

try {
  admin.initializeApp({ projectId: process.env.PROJECT_ID })
  console.log('Firebase Admin SDK initialized.')
}
catch (error) {
  console.error('Error initializing Firebase Admin SDK:', error)
  process.exit(1)
}

const program = new Command()

program
  .requiredOption('-e, --email <email>', 'User email')
  .requiredOption('-p, --password <password>', 'User password')
  .requiredOption('-u, --uid <uid>', 'User ID')
  .parse(process.argv)

const options = program.opts()

const createUser = async (email: string, password: string, uid: string) => {
  try {
    const userRecord = await admin.auth().createUser({
      email,
      password,
      uid,
    })
    console.log('Successfully created new user:', userRecord.uid)
    process.exit(0)
  }
  catch (error) {
    console.error('Error creating new user:', error)
    process.exit(1)
  }
}

createUser(options.email, options.password, options.uid)
