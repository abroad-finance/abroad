import { defineConfig } from 'orval';

export default defineConfig({
    abroad: {
        input: '../src/swagger.json',
        output: {
            override: {
                mutator: {
                    path: './src/api/custom-client.ts',
                    name: 'customClient',
                },
            }
        }

    },

});