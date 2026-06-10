import { FastifyInstance } from "fastify";
import { buildServer } from "../src/server";

// Cache the Fastify instance so it doesn't rebuild on every function invocation
let app: FastifyInstance | null = null;

export default async function handler(req: any, res: any) {
  if (!app) {
    app = await buildServer();
    await app.ready();
  }
  
  // Pass the incoming Vercel Request/Response directly to Fastify's internal HTTP server
  app.server.emit("request", req, res);
}
