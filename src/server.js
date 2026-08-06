const VERSION = require("../package.json").version;

const closeWithGrace = require("close-with-grace");
const { buildApp } = require("./app");

const { hasEncryptionKey } = require("./config");

const PORT = Number(process.env.PORT ?? 7000);

const app = buildApp();

closeWithGrace(async ({ err }) => {
	if (err) app.log.error({ errorType: err.constructor.name }, "shutdown error");
	app.log.info("closing addon server");
	await app.close();
});

app
	.listen({ port: PORT, host: "0.0.0.0" })
	.then(() => {
		app.log.info({ version: VERSION, port: PORT }, "addon server listening");
		if (!hasEncryptionKey) {
			app.log.warn(
				"WARNING: Using random encryption key. Set ENCRYPTION_KEY environment variable for production.",
			);
		}

		app.log.info(
			`Access the configuration page at: ${process.env.SPACE_HOST ? `https://${process.env.SPACE_HOST}` : `http://localhost:${PORT}`}`,
		);
	})
	.catch((error) => {
		app.log.error(
			{ errorType: error.constructor.name },
			"server failed to start",
		);
		process.exitCode = 1;
	});
