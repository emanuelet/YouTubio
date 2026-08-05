const app = require("fastify")({
	trustProxy: true,
	logger: process.env.DEV_LOGGING ? { level: "debug" } : false,
	routerOptions: { maxParamLength: 65_536 },
});
const closeWithGrace = require("close-with-grace");
const registerRoutes = require("./routes");

const PORT = Number(process.env.PORT ?? 7000);

registerRoutes(app);

app.setErrorHandler((error, _req, reply) => {
	if (process.env.DEV_LOGGING) console.error(error);
	if (!reply.sent)
		reply
			.code(500)
			.send({ error: "Internal server error", message: error.message });
});

closeWithGrace(async ({ err }) => {
	if (err) console.error(err);
	await app.close();
});

app.listen({ port: PORT, host: "0.0.0.0" }).catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
