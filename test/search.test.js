const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");

const ytdlp = require("../src/ytdlp");
const extract = ytdlp.runYtDlpWithAuth;
const requests = [];
const entries = Array.from({ length: 65 }, (_, index) => ({
	id: `${String(index).padStart(10, "0")}A`,
	title: `Video ${index}`,
}));

ytdlp.runYtDlpWithAuth = async (url, _config, args) => {
	requests.push({ url, args });
	const [start, end, step] = args[args.indexOf("-I") + 1]
		.split(":")
		.map(Number);
	const selected = [];
	for (
		let position = start;
		step > 0 ? position <= end : position >= end;
		position += step
	) {
		const index = position > 0 ? position - 1 : entries.length + position;
		if (entries[index]) selected.push(entries[index]);
	}
	return {
		_type: "playlist",
		webpage_url_domain: "youtube.com",
		entries: selected,
	};
};

const { buildApp } = require("../src/app");
const app = buildApp();
before(async () => app.ready());
after(async () => app.close());

async function catalog(extra) {
	const response = await app.inject({
		method: "GET",
		url: `/c2.e30/catalog/YouTube/yt_id%3Aytsearch/${extra}.json`,
	});
	assert.equal(response.statusCode, 200);
	return response.json().metas.map((meta) => meta.id);
}

test("search pages contain 20 distinct results and advance with skip", async () => {
	const first = await catalog("search=hello");
	const second = await catalog("search=hello&skip=20");
	const third = await catalog("search=hello&skip=40");
	assert.deepEqual([first.length, second.length, third.length], [20, 20, 20]);
	assert.equal(new Set([...first, ...second, ...third]).size, 60);
	assert.deepEqual(
		requests.map((request) => request.args[request.args.indexOf("-I") + 1]),
		["1:20:1", "21:40:1", "41:60:1"],
	);
});

test("reversed search pages have nonoverlapping 20-result ranges", async () => {
	requests.length = 0;
	const first = await catalog("search=hello&genre=Reversed%20Relevance");
	const second = await catalog(
		"search=hello&genre=Reversed%20Relevance&skip=20",
	);
	assert.equal(first.length, 20);
	assert.equal(second.length, 20);
	assert.equal(new Set([...first, ...second]).size, 40);
	assert.deepEqual(
		requests.map((request) => request.args[request.args.indexOf("-I") + 1]),
		["-1:-20:-1", "-21:-40:-1"],
	);
});

test("cached search metadata is reused per page and expires", async () => {
	let executions = 0;
	const execute = async () => {
		executions++;
		return JSON.stringify({ entries: [{ id: "cached" }] });
	};
	const url =
		"https://www.youtube.com/results?search_query=cache-test&sp=CAASAhAB";
	const page = ["-I", "1:20:1", "--yes-playlist"];
	const nextPage = ["-I", "21:40:1", "--yes-playlist"];
	const originalNow = Date.now;
	let now = originalNow();
	Date.now = () => now;
	try {
		const first = await extract(url, {}, page, undefined, execute);
		first.entries[0].id = "changed";
		assert.equal(
			(await extract(url, {}, page, undefined, execute)).entries[0].id,
			"cached",
		);
		await extract(url, {}, nextPage, undefined, execute);
		assert.equal(executions, 2);
		now += 20 * 60 * 1000;
		await extract(url, {}, page, undefined, execute);
		assert.equal(executions, 3);
	} finally {
		Date.now = originalNow;
	}
});
