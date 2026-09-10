const Fastify = require("fastify");
const registerRoutes = require("./routes");
const configStore = require("./config-store");

function buildApp() {
	const app = Fastify({
		trustProxy: true,
		logger: process.env.DEV_LOGGING
			? {
					level: "debug",
					transport: {
						target: "pino-pretty",
					},
					redact: [
						"req.headers.authorization",
						"req.headers.cookie",
						"req.url",
					],
				}
			: false,
		disableRequestLogging: !process.env.DEV_LOGGING,
		routerOptions: { maxParamLength: 65_536 },
	});

	app.setErrorHandler((error, req, reply) => {
		req.log.error(
			{ errorType: error.constructor.name, statusCode: error.statusCode },
			"request failed",
		);
		const statusCode = error.validation ? 400 : (error.statusCode ?? 500);
		return reply.code(statusCode).send({
			error: statusCode >= 500 ? "Internal server error" : error.message,
		});
	});

	app.register(registerRoutes);
	app.addHook("onClose", async () => configStore.close());
	return app;
}

module.exports = { buildApp };
