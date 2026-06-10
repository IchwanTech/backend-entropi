import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { env } from "./config/env";
import { errorHandler } from "./middleware/error-handler";

export async function buildServer() {
  const fastify = Fastify({
    logger:
      env.NODE_ENV === "production"
        ? true
        : {
            transport: {
              target: "pino-pretty",
              options: { colorize: true },
            },
          },
  });

  // Security headers
  await fastify.register(helmet);

  // CORS — allow frontend origin
  await fastify.register(cors, {
    origin: env.NODE_ENV === "production",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Idempotency-Key"],
  });

  // Health check
  fastify.get("/test", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }));

  // Global error handler
  fastify.setErrorHandler(errorHandler);

  return fastify;
}

if (require.main === module) {
  buildServer()
    .then((server) => server.listen({ port: env.PORT, host: "0.0.0.0" }))
    .then(() => console.log(`Server running on port ${env.PORT}`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
