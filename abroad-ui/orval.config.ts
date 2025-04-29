import { defineConfig } from 'orval';

export default defineConfig({
    abroad: {
        input: '../src/swagger.json',
        output: {
            target: './src/api/index.ts',
            override: {
                mutator: {
                    path: './src/api/customClient.ts',
                    name: 'customClient',
                },
                
            },
            httpClient: 'fetch',
            client: 'fetch'
        }

    },

});