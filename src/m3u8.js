function cutM3U8(body, ranges = [], overestimate = false) {
	if (!ranges?.length) return body;
	const lines = body.split("\n");
	const output = [];
	let time = 0;
	let discontinuity = false;
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index].trim();
		if (!line.startsWith("#EXTINF:")) {
			if (line) output.push(line);
			continue;
		}
		const start = time;
		const end = time + parseFloat(line.split(":")[1]);
		time = end;
		const skip = ranges.some(([rangeStart, rangeEnd]) =>
			overestimate
				? !(end <= rangeStart || start >= rangeEnd)
				: start >= rangeStart && end <= rangeEnd,
		);
		if (skip) {
			discontinuity = true;
		} else {
			if (discontinuity) output.push("#EXT-X-DISCONTINUITY");
			discontinuity = false;
			output.push(line, (lines[index + 1] || "").trim());
		}
		index++;
	}
	return output.join("\n");
}

module.exports = { cutM3U8 };
