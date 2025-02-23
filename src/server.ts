// src/server.ts
import express, { Request, Response } from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { RegisterRoutes } from "./routes";
import fs from "fs";
import path from "path";
import { registerConsumers } from "./stellar";
import packageJson from '../package.json';

const app = express();
app.use(cors());
app.use(bodyParser.json());

RegisterRoutes(app);

app.get("/docs", (req: Request, res: Response) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>API Documentation</title>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/redoc@next/bundles/redoc.standalone.css">
      </head>
      <body>
        <redoc spec-url='/swagger.json'></redoc>
        <script src="https://cdn.jsdelivr.net/npm/redoc@next/bundles/redoc.standalone.js"></script>
      </body>
    </html>
  `);
});

app.get("/", (req: Request, res: Response) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.format({
    'text/html': () => {
      res.redirect('/docs');
    },
    'application/json': () => {
      res.json({
        message: 'Welcome to the API',
        documentation: `${baseUrl}/docs`,
        swagger: `${baseUrl}/swagger.json`,
        version: packageJson.version
      });
    },
    default: () => {
      res.redirect('/docs');
    }
  });
});

app.get("/swagger.json", (req: Request, res: Response) => {
  const swaggerPath = path.resolve(__dirname, "./swagger.json");
  res.sendFile(swaggerPath);
});

app.use((err: any, req: Request, res: Response, next: any) => {
  res.status(err.status || 500).json({
    message: err.message || "An error occurred",
  });
});

const port = process.env.PORT || 3784;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
  console.log(`API documentation available at http://localhost:${port}/docs`);
});

registerConsumers();
