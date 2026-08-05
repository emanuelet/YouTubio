const prefix = "yt_id:";
const reversedPrefix = "Reversed";
const channelRegex =
	/^(https:\/\/(www\.)?youtube\.com\/)?(?<id>@[a-zA-Z0-9][a-zA-Z0-9._-]{1,28}[a-zA-Z0-9])/;
const channelIDRegex =
	/^(https:\/\/(www\.)?youtube\.com\/channel\/)?(?<id>UC[A-Za-z0-9_-]{21}[AQgw])/;
const playlistIDRegex =
	/^(https:\/\/(www\.)?youtube\.com\/playlist\?list=)?(?<id>PL([0-9A-F]{16}|[A-Za-z0-9_-]{32}))/;
const videoIDRegex =
	/^(https:\/\/(www\.)?(youtube\.com|youtu\.be)(\/(watch|shorts|v|e(mbed)?|redirect))?(\?v=|\/))?(?<id>[A-Za-z0-9_-]{10}[AEIMQUYcgkosw048])/;
const channelTypeArray = ["auto", "video", "channel"];
const defaultConfig = {
	fallback: true,
	overestimate: false,
	markWatchedOnLoad: false,
	showBrokenLinks: false,
	search: true,
	catalogType: "YouTube",
	geminiModel: "gemini-2.5-pro",
};
const termKeyword = "{term}";
const sortKeyword = "{sort}";

module.exports = {
	channelIDRegex,
	channelRegex,
	channelTypeArray,
	defaultConfig,
	playlistIDRegex,
	prefix,
	reversedPrefix,
	sortKeyword,
	termKeyword,
	videoIDRegex,
};
