import { defineConfig } from 'orval'

export default defineConfig({
  abroad: {
    input: '../abroad-server/src/app/http/swagger.json',
    output: {
      client: 'fetch',
      httpClient: 'fetch',
      override: {
        mutator: {
          name: 'customClient',
          path: './src/api/customClient.ts',
        },

      },
      target: './src/api/index.ts',
    },

  },

})
