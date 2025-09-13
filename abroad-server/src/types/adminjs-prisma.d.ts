declare module '@adminjs/prisma' {
  import BaseDatabase from 'adminjs/types/src/backend/adapters/database/base-database.js'
  import BaseResource from 'adminjs/types/src/backend/adapters/resource/base-resource.js'

  // Concrete adapter classes exported by @adminjs/prisma
  export class Database extends BaseDatabase {}
  export class Resource extends BaseResource {}

  const _default: {
    Database: typeof Database
    Resource: typeof Resource
  }
  export default _default
}
