import { defineConfig } from 'orval'

export default defineConfig({
  abroad: {
    input: '../abroad-server/src/swagger.json',
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
