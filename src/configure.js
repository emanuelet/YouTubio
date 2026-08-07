async function registerConfigureRoutes(app, deps) {
	app.log.debug({ module: "configure" }, "registering route plugin");
	const {
		VERSION,
		decryptConfig,
		defaultConfig,
		addonPrefix,
		termKeyword,
		sortKeyword,
		channelTypeArray,
		supportedWebsites,
		logError,
	} = deps;

	async function configurationPage(req, reply) {
		req.log.debug(
			{ route: req.routeOptions.url },
			"rendering configuration page",
		);
		/** @type {Object} */
		let userConfig = {};
		try {
			userConfig = req.params.config
				? decryptConfig(req.params.config, false)
				: {};
		} catch (error) {
			logError(error);
		}
		const catalogType = JSON.stringify(
			userConfig.catalogType ?? defaultConfig.catalogType,
		);
		return reply.type("text/html").send(`
        <!DOCTYPE html>
        <html>
        <head>
            <link rel="icon" href="https://github.com/xXCrash2BomberXx/YouTubio/blob/${process.env.DEV_LOGGING ? "main" : `v${VERSION}`}/icon.png?raw=true">
            <title>YouTubio | ElfHosted</title>
            <link href="https://fonts.googleapis.com/css2?family=Ubuntu&display=swap" rel="stylesheet">
            <style>
                body { font-family: 'Ubuntu', Helvetica, Arial, sans-serif; text-align: center; padding: 2rem; background: #f4f4f8; color: #333; }
                .container { max-width: 50rem; margin: auto; background: white; padding: 2rem; border-radius: 1rem; }
                h1 { color: #d92323; }
                textarea { width: 100%; height: 15rem; padding: 1rem; border-radius: 1rem; border: 0.1rem solid #ccc; box-sizing: border-box; resize: vertical; }
                th, td { border: 0.1rem solid #ccc; padding: 1rem; text-align: left; }
                input { width: 100%; box-sizing: border-box; }
                .install-button { margin-top: 1rem; border-width: 0; display: inline-block; padding: 0.5rem; background-color: #5835b0; color: white; border-radius: 0.2rem; cursor: pointer; }
                .install-button:hover { background-color: #4a2c93; }
                .install-button:disabled { background-color: #ccc; cursor: not-allowed; }
                .error { color: #d92323; margin-top: 1rem; }
                .settings-section { text-align: left; margin-top: 2rem; padding: 1rem; border: 0.1rem solid #ddd; border-radius: 1rem; background: #f9f9f9; }
                .toggle-container { display: flex; align-items: center; margin: 1rem 0; }
                .toggle-container input[type="checkbox"] { margin-right: 1rem; }
                .toggle-container label { cursor: pointer; }
                .setting-description { color: #666; }
                @media (prefers-color-scheme: dark) {
                    body { background: #121212; color: #e0e0e0; }
                    .container { background: #1e1e1e; }
                    textarea, input, select {
                        background: #2a2a2a;
                        color: #e0e0e0;
                        border: 0.1rem solid #555;
                    }
                    th, td { border: 0.1rem solid #555; }
                    .install-button { background-color: #6a5acd; }
                    .install-button:hover { background-color: #5941a9; }
                    .install-button:disabled { background-color: #555; }
                    .settings-section { background: #1e1e1e; border: 0.1rem solid #333; }
                    .setting-description { color: #aaa; }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div style="display: flex; justify-content: center; margin: 1rem; align-items: center;">
                    <img src="https://github.com/xXCrash2BomberXx/YouTubio/blob/${process.env.DEV_LOGGING ? "main" : `v${VERSION}`}/icon.png?raw=true" alt="YouTubio">
                    <h1 style="position: relative; top: 96px; left: -80px; font-size: 32px;">ElfHosted</h1>
                </div>
                <h3 style="color: #f5a623;">v${VERSION}</h3>
                ${process.env.EMBED ?? ""}
                For a quick setup guide, go to <a href="https://github.com/xXCrash2BomberXx/YouTubio#%EF%B8%8F-quick-setup-with-cookies" target="_blank" rel="noopener noreferrer">github.com/xXCrash2BomberXx/YouTubio</a>
                <form id="config-form">
                    <div class="settings-section">
                        <details style="text-align: center;">
                            <summary>
                                This addon supports FAR more than just YouTube with URLs!<br>
                                <a href="https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md" target="_blank" rel="noopener noreferrer">Read more here.</a>
                            </summary>
                            ${process.env.YTDLP_EXTRACTORS_EMBED ?? ""}
                            <div style="max-height: 20rem; overflow: auto;">
                                ${await supportedWebsites}
                            </div>
                        </details>
                    </div>
                    <div class="settings-section">
                        <h3>Cookies</h3>
                        <hr>
                        <textarea id="cookie-data" placeholder="Paste the content of your cookies.txt file here..."${userConfig.encrypted ? ` disabled>${userConfig.encrypted ?? ""}` : ">"}</textarea>
                        <h3>Gemini API Key</h3>
                        <hr>
                        <input type="text" id="gemini" name="gemini" placeholder="Enter your Gemini API key here..."${userConfig.encrypted ? " disabled" : ""}>
                        <button type="button" class="install-button" id="clear-cookies">Clear</button>
                    </div>
                    <div class="settings-section">
                        <h3>Playlists</h3>
                        <hr>
                        <details>
                            <summary>Advanced Usage</summary>
                            <p>
                                &#128712;
                                <b>Search Type</b> determines how the backend interprets the <b>Playlist ID / URL</b>.
                                <ul style="margin-top: 0; font-size: small;">
                                    <li><b>Auto</b>: The backend will attempt to determine the type of the input automatically.</li>
                                    <li><b>Video</b>: Treats the <b>Playlist ID / URL</b> as though it were typed directly into the YouTube search bar.</li>
                                    <li><b>Channel</b>: Treats the <b>Playlist ID / URL</b> as though it were typed directly into the YouTube search bar with the channel filter enabled.</li>
                                </ul>
                            </p>
                            <p>
                                &#128712;
                                You can use <b><code>${termKeyword}</code></b> in the <b>Playlist ID / URL</b> for custom search catalogs in places the encoded URI search component is used.
                                ex. <code>https://www.youtube.com/results?search_query=example+search</code> &rarr; <code>https://www.youtube.com/results?search_query=${termKeyword}</code>
                            </p>
                            <p>
                                &#128712;
                                You can use <b><code>${sortKeyword}</code></b> in the <b>Playlist ID / URL</b> for custom sort order in places the encoded URI sorting component is used.
                                ex. <code>https://www.youtube.com/results?search_query=example+search&sp=CAASAhAC</code> &rarr; <code>https://www.youtube.com/results?search_query=${termKeyword}${sortKeyword}</code> &amp; Sort ID: <code>&sp=CAASAhAC</code>, Sort Name: <code>Channel</code>
                            </p>
                            <hr>
                        </details>
                        <div style="margin-bottom: 1rem;">
                            <button type="button" id="add-defaults" class="install-button">Add Defaults</button>
                            <button type="button" id="remove-defaults" class="install-button">Remove Defaults</button>
                            <button type="button" id="add-accounts" class="install-button">Load from YouTube</button>
                            <button type="button" id="add-playlist" class="install-button">Add Playlist</button>
                        </div>
                        <table id="playlist-table" style="width:100%;border-collapse:collapse;">
                            <thead>
                                <tr>
                                    <th>Type</th>
                                    <th>Playlist ID / URL</th>
                                    <th>Catalog Name</th>
                                    <th>Search Type</th>
                                    <th>Sort Order</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody></tbody>
                        </table>
                    </div>
                    <div class="settings-section" id="addon-settings">
                        <h3>Settings</h3>
                        <hr>
                        <table>
                            <thead>
                                <tr>
                                    <th>Value</th>
                                    <th>Setting</th>
                                    <th>Description</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${process.env.NO_DEARROW ? "<!--" : ""}
                                <tr>
                                    <td><input type="checkbox" id="dearrow" name="dearrow" data-default=0 ${userConfig.dearrow ? "checked" : ""}></td>
                                    <td><label for="dearrow">DeArrow</label></td>
                                    <td class="setting-description">Use DeArrow to fetch video thumbnails and Titles.</td>
                                </tr>
                                ${process.env.NO_DEARROW ? "-->" : ""}
                                ${process.env.NO_SPONSORBLOCK ? "<!--" : ""}
                                <tr>
                                    <td>
                                        <select name="sponsorblock" id="sponsorblock" multiple>
                                            <option value="sponsor" ${userConfig.sponsorblock?.includes("sponsor") ? "selected" : ""}>Sponsor</option>
                                            <option value="selfpromo" ${userConfig.sponsorblock?.includes("selfpromo") ? "selected" : ""}>Self Promo</option>
                                            <option value="interaction" ${userConfig.sponsorblock?.includes("interaction") ? "selected" : ""}>Interaction</option>
                                            <option value="intro" ${userConfig.sponsorblock?.includes("intro") ? "selected" : ""}>Intro</option>
                                            <option value="outro" ${userConfig.sponsorblock?.includes("outro") ? "selected" : ""}>Outro</option>
                                            <option value="preview" ${userConfig.sponsorblock?.includes("preview") ? "selected" : ""}>Preview</option>
                                            <option value="hook" ${userConfig.sponsorblock?.includes("hook") ? "selected" : ""}>Hook</option>
                                            <option value="filler" ${userConfig.sponsorblock?.includes("filler") ? "selected" : ""}>Filler</option>
                                        </select>
                                    </td>
                                    <td><label for="sponsorblock">SponsorBlock</label></td>
                                    <td class="setting-description">Use SponsorBlock to skip various video segments. (Hold Ctrl/Cmd to select multiple segment types.)</td>
                                </tr>
                                <tr>
                                    <td><input type="checkbox" id="fallback" name="fallback" data-default=1 ${(userConfig.fallback ?? defaultConfig.fallback) ? "checked" : ""}></td>
                                    <td><label for="fallback">SponsorBlock Fallback</label></td>
                                    <td class="setting-description">Fallback to the untrimmed video if trimming results in an error.</td>
                                </tr>
                                <tr>
                                    <td><input type="checkbox" id="overestimate" name="overestimate" data-default=0 ${(userConfig.overestimate ?? defaultConfig.overestimate) ? "checked" : ""}></td>
                                    <td><label for="overestimate">Overestimate SponsorBlock Segments</label></td>
                                    <td class="setting-description">Overestimate trimming of SponsorBlock segments.</td>
                                </tr>
                                ${process.env.NO_SPONSORBLOCK ? "-->" : ""}
                                <tr>
                                    <td><input type="checkbox" id="markWatchedOnLoad" name="markWatchedOnLoad" data-default=0 ${(userConfig.markWatchedOnLoad ?? defaultConfig.markWatchedOnLoad) ? "checked" : ""}></td>
                                    <td><label for="markWatchedOnLoad">Mark Watched</label></td>
                                    <td class="setting-description">Mark videos as watched in your YouTube history when you open them in Stremio. This helps keep your YouTube watch history synchronized. (This disables caching.)</td>
                                </tr>
                                <tr>
                                    <td><input type="checkbox" id="showBrokenLinks" name="showBrokenLinks" data-default=0 ${(userConfig.showBrokenLinks ?? defaultConfig.showBrokenLinks) ? "checked" : ""}></td>
                                    <td><label for="showBrokenLinks">Show Unsupported Streams</label></td>
                                    <td class="setting-description">Return all streams found by YT-DLP, not just ones supported by Stremio.</td>
                                </tr>
                                <tr>
                                    <td><input type="checkbox" id="search" name="search" data-default=1 ${(userConfig.search ?? defaultConfig.search) ? "checked" : ""}></td>
                                    <td><label for="search">Add YouTube Search</label></td>
                                    <td class="setting-description">Add a default YouTube search catalog for videos and channels.</td>
                                </tr>
                                <tr>
                                    <td><input type="text" id="catalogType" name="catalogType" data-default=${JSON.stringify(defaultConfig.catalogType)} value=${catalogType} style="width: 5rem;"></td>
                                    <td><label for="catalogType">YouTube Search Type</label></td>
                                    <td class="setting-description">Specify the fallback type name of catalogs.</td>
                                </tr>
                                <tr>
                                    <td><input type="text" id="geminiModel" name="geminiModel" data-default=${JSON.stringify(defaultConfig.geminiModel)} value=${JSON.stringify(userConfig.geminiModel ?? defaultConfig.geminiModel)} style="width: 5rem;"></td>
                                    <td><label for="geminiModel">Gemini Model</label></td>
                                    <td class="setting-description">Specify the Gemini model to use for AI features.</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <button type="submit" class="install-button" id="submit-btn">Generate Install Link</button>
                    <div id="error-message" class="error" style="display:none;"></div>
                </form>
                <div id="results" style="display:none;">
                    <h2>Install your addon</h2>
                    <a href="#" target="_blank" id="install-stremio" class="install-button">Stremio</a>
                    <a href="#" target="_blank" id="install-web" class="install-button">Stremio Web</a>
                    <a id="copy-btn" class="install-button">Copy URL</a>
                    <a href="#" id="reload" class="install-button">Reload</a>
                    <input type="text" id="install-url" style="display: none;" readonly class="url-input">
                </div>
            </div>
            <script>
                const cookies = document.getElementById('cookie-data');
                const gemini = document.getElementById('gemini');
                const addAccounts = document.getElementById('add-accounts')
                const addDefaults = document.getElementById('add-defaults');
                const addonSettings = document.getElementById('addon-settings');
                const submitBtn = document.getElementById('submit-btn');
                const errorDiv = document.getElementById('error-message');
                const resultsDiv = document.getElementById('results');
                function encodeConfig(config) {
                    const bytes = new TextEncoder().encode(JSON.stringify(config));
                    let binary = '';
                    for (const byte of bytes) binary += String.fromCharCode(byte);
                    return 'c2.' + btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
                }
                function configChanged() {
                    resultsDiv.style.display = 'none';
                    addDefaults.disabled = cookies.value.length <= 0;
                    addAccounts.disabled = addDefaults.disabled;
                }
                const installStremio = document.getElementById('install-stremio');
                const installWeb = document.getElementById('install-web');
                const reload = document.getElementById('reload');
                const installUrlInput = document.getElementById('install-url');
                const playlistTableBody = document.querySelector('#playlist-table tbody');
                const defaultPlaylists = [
                    { type: ${catalogType}, id: ':ytrec', name: 'Discover', channelType: 'auto' },
                    { type: ${catalogType}, id: ':ytsubs', name: 'Subscriptions', channelType: 'auto' },
                    { type: ${catalogType}, id: ':ytwatchlater', name: 'Watch Later', channelType: 'auto' },
                    { type: ${catalogType}, id: ':ythistory', name: 'History', channelType: 'auto' }
                ];
                let playlists = ${JSON.stringify(
									userConfig.catalogs?.map((pl) => ({
										...pl,
										id: pl.id.startsWith(addonPrefix)
											? pl.id.slice(addonPrefix.length)
											: pl.id,
									})) ?? [],
								)};
                document.getElementById('clear-cookies').addEventListener('click', () => {
                    cookies.value = "";
                    cookies.disabled = false;
                    gemini.value = "";
                    gemini.disabled = false;
                    configChanged();
                });
                cookies.addEventListener('input', configChanged);
                gemini.addEventListener('input', configChanged);
                addonSettings.querySelectorAll("input, select").forEach(e => e.addEventListener('change', configChanged));
                function makeActions(callback, array, index) {
                    const actionsCell = document.createElement('td');
                    const upBtn = document.createElement('button');
                    upBtn.textContent = '↑';
                    upBtn.classList.add('install-button');
                    upBtn.style.margin = '0.2rem';
                    upBtn.addEventListener('click', () => {
                        if (index > 0) {
                            [array[index - 1], array[index]] = [array[index], array[index - 1]];
                            callback();
                        }
                    });
                    const downBtn = document.createElement('button');
                    downBtn.textContent = '↓';
                    downBtn.classList.add('install-button');
                    downBtn.style.margin = '0.2rem';
                    downBtn.addEventListener('click', () => {
                        if (index < array.length - 1) {
                            [array[index + 1], array[index]] = [array[index], array[index + 1]];
                            callback();
                        }
                    });
                    const removeBtn = document.createElement('button');
                    removeBtn.textContent = 'Remove';
                    removeBtn.classList.add('install-button');
                    removeBtn.style.margin = '0.2rem';
                    removeBtn.addEventListener('click', () => {
                        array.splice(index, 1);
                        callback();
                    });
                    actionsCell.appendChild(upBtn);
                    actionsCell.appendChild(downBtn);
                    actionsCell.appendChild(removeBtn);
                    return actionsCell;
                }
                function renderPlaylists() {
                    playlistTableBody.innerHTML = '';
                    playlists.forEach((pl, index) => {
                        const row = document.createElement('tr');
                        // Type
                        const typeCell = document.createElement('td');
                        const typeInput = document.createElement('input');
                        typeInput.value = pl.type;
                        typeInput.addEventListener('input', () => {
                            pl.type = typeInput.value.trim();
                            configChanged();
                        });
                        typeCell.appendChild(typeInput);
                        // ID
                        const idCell = document.createElement('td');
                        const idInput = document.createElement('input');
                        idInput.value = pl.id;
                        idInput.required = true;
                        idInput.addEventListener('change', () => {
                            pl.id = idInput.value;
                            configChanged();
                        });
                        idCell.appendChild(idInput);
                        // Name
                        const nameCell = document.createElement('td');
                        const nameInput = document.createElement('input');
                        nameInput.value = pl.name;
                        nameInput.required = true;
                        nameInput.addEventListener('input', () => {
                            pl.name = nameInput.value.trim();
                            configChanged();
                        });
                        nameCell.appendChild(nameInput);
                        // Search Type
                        const channelTypeCell = document.createElement('td');
                        const channelTypeInput = document.createElement('select');
                        ${JSON.stringify(channelTypeArray)}.forEach((type, index) => {
                            const option = document.createElement('option');
                            option.value = index;
                            option.textContent = type.charAt(0).toUpperCase() + type.slice(1);
                            channelTypeInput.appendChild(option);
                        });
                        channelTypeInput.defaultValue = 0;
                        channelTypeInput.addEventListener('change', () => {
                            pl.channelType = channelTypeInput.value;
                            configChanged();
                        });
                        channelTypeCell.appendChild(channelTypeInput);
                        // Sort Order
                        pl.sortOrder = pl.sortOrder ?? [];
                        const sortOrderCell = document.createElement('td');
                        const sortOrderInput = document.createElement('button');
                        sortOrderInput.textContent = 'Modify';
                        sortOrderInput.title = 'Requires Playlist ID / URL to contain \\'${sortKeyword}\\'';
                        sortOrderInput.classList.add('install-button');
                        sortOrderInput.type = 'button';
                        sortOrderInput.addEventListener('click', () => {
                            if (!idInput.value?.includes(${JSON.stringify(sortKeyword)})) return;
                            const sorts = JSON.parse(JSON.stringify(pl.sortOrder));
                            function renderSorts() {
                                tbody.innerHTML = '';
                                sorts.forEach((s, index) => {
                                    const row = document.createElement('tr');
                                    const idCell = document.createElement('td');
                                    const idInput = document.createElement('input');
                                    idInput.required = true;
                                    idInput.addEventListener('change', () => s.id = idInput.value);
                                    idInput.value = s.id;
                                    const nameCell = document.createElement('td');
                                    const nameInput = document.createElement('input');
                                    nameInput.required = true;
                                    nameInput.addEventListener('change', () => s.name = nameInput.value);
                                    nameInput.value = s.name;
                                    idCell.appendChild(idInput);
                                    row.appendChild(idCell);
                                    nameCell.appendChild(nameInput);
                                    row.appendChild(nameCell);
                                    row.appendChild(makeActions(renderSorts, sorts, index));
                                    tbody.appendChild(row);
                                });
                            }
                            const blur = document.createElement('div');
                            blur.style.position = 'fixed';
                            blur.style.top = 0;
                            blur.style.left = 0;
                            blur.style.right = 0;
                            blur.style.bottom = 0;
                            blur.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
                            blur.addEventListener('click', e => {
                                e.preventDefault();
                                e.stopPropagation();
                            });
                            const modal = document.createElement('form');
                            modal.style.position = 'fixed';
                            modal.style.top = '50%';
                            modal.style.left = '50%';
                            modal.style.transform = 'translate(-50%, -50%)';
                            modal.classList.add('settings-section');
                            function closeModal(save = false) {
                                if (save) pl.sortOrder = sorts;
                                document.body.removeChild(blur);
                                document.body.removeChild(modal);
                            }
                            const title = document.createElement('h3');
                            title.textContent = 'Modify Sort Order';
                            const sortButtons = document.createElement('div');
                            sortButtons.style.marginBottom = '1rem';
                            const addSort = document.createElement('button');
                            addSort.type = 'button';
                            addSort.textContent = 'Add Sort';
                            addSort.classList.add('install-button');
                            addSort.addEventListener('click', () => {
                                sorts.push({ id: '', name: '' });
                                renderSorts();
                            });
                            const saveBtn = document.createElement('button');
                            saveBtn.type = 'submit';
                            saveBtn.textContent = 'Save';
                            saveBtn.classList.add('install-button');
                            modal.addEventListener('submit', () => {
                                closeModal(true);
                                configChanged();
                            });
                            const cancelBtn = document.createElement('button');
                            cancelBtn.textContent = 'Cancel';
                            cancelBtn.classList.add('install-button');
                            cancelBtn.addEventListener('click', () => closeModal(false));
                            const table = document.createElement('table');
                            table.style.width = '100%';
                            table.style.borderCollapse = 'collapse';
                            const thead = document.createElement('thead');
                            const headerRow = document.createElement('tr');
                            const thID = document.createElement('th');
                            thID.textContent = 'Sort ID';
                            const thName = document.createElement('th');
                            thName.textContent = 'Sort Name';
                            const thActions = document.createElement('th');
                            thActions.textContent = 'Actions';
                            const tbody = document.createElement('tbody');
                            renderSorts();
                            document.body.appendChild(blur);
                            headerRow.appendChild(thID);
                            headerRow.appendChild(thName);
                            headerRow.appendChild(thActions);
                            modal.appendChild(title);
                            modal.appendChild(document.createElement('hr'));
                            sortButtons.appendChild(addSort);
                            sortButtons.appendChild(saveBtn);
                            sortButtons.appendChild(cancelBtn);
                            modal.appendChild(sortButtons);
                            thead.appendChild(headerRow);
                            table.appendChild(thead);
                            table.appendChild(tbody);
                            modal.appendChild(table);
                            document.body.appendChild(modal);
                        });
                        sortOrderCell.appendChild(sortOrderInput);
                        row.appendChild(typeCell);
                        row.appendChild(idCell);
                        row.appendChild(nameCell);
                        row.appendChild(channelTypeCell);
                        row.appendChild(sortOrderCell);
                        row.appendChild(makeActions(renderPlaylists, playlists, index));
                        playlistTableBody.appendChild(row);
                    });
                    configChanged();
                }
                document.getElementById('add-playlist').addEventListener('click', () => {
                    playlists.push({ type: ${catalogType}, id: '', name: '', channelType: 'auto' });
                    renderPlaylists();
                });
                addAccounts.addEventListener('click', async e => {
                    const originalDisabled = e.target.disabled;
                    e.target.disabled = true;
                    if (!reload.href.endsWith('configure'))
                        await populateInstall();
                    (await (await fetch(reload.href.replace(/configure$/, 'playlists'))).json()).forEach(p =>
                        playlists.push({ type: ${catalogType}, id: p.id, name: p.name, channelType: 'auto' })
                    );
                    renderPlaylists();
                    e.target.disabled = originalDisabled;
                });
                addDefaults.addEventListener('click', () => {
                    playlists = [...playlists, ...defaultPlaylists];
                    renderPlaylists();
                });
                document.getElementById('remove-defaults').addEventListener('click', () => {
                    playlists = playlists.filter(pl => !defaultPlaylists.some(def => def.id === pl.id));
                    renderPlaylists();
                });
                renderPlaylists();
                async function populateInstall(event) {
                    event?.preventDefault();
                    submitBtn.disabled = true;
                    const originalText = submitBtn.textContent
                    submitBtn.textContent = 'Encrypting...';
                    errorDiv.style.display = 'none';
                    try {
                        // Encrypt the sensitive data
                        if ((cookies.value && !cookies.disabled) || (gemini.value && !gemini.disabled))
                            cookies.value = await (await fetch('/encrypt', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
                                    auth: cookies.value,
                                    gemini: gemini.value
                                })
                            })).text();
                        cookies.disabled = true;
                        gemini.disabled = true;
                        const modifiedPlaylists = playlists.map(pl => ({
                            ...pl,
								id: ${JSON.stringify(addonPrefix)} + pl.id,
                            ...(pl.sortOrder?.length ? { sortOrder: pl.sortOrder } : {})
                        }));
                        const configPath = \`/\${encodeConfig({
                            ...(cookies.value ? {encrypted: cookies.value} : {}),
                            ...(modifiedPlaylists.length ? { catalogs: modifiedPlaylists } : {}),
                            // Non-Sensitive Settings
                            ...Object.fromEntries(
                                Array.from(addonSettings.querySelectorAll("input, select"))
                                    .map(x => {
                                        if (x.type === 'select-multiple') {
                                            const value = Array.from(x.selectedOptions).map(o => o.value);
                                            return value.length ? [x.name, value] : null;
                                        }
                                        const value = x.type === 'checkbox' ? (x.checked ? 1 : 0) : x.value;
                                        return value != x.dataset.default ? [x.name, value] : null;
                                    }).filter(x => x !== null)
                            )
                        })}/\`;
                        const manifestPath = configPath + 'manifest.json';
                        installStremio.href = \`stremio://\${window.location.host}\${manifestPath}\`;
                        reload.href = window.location.origin + configPath + 'configure';
                        installUrlInput.value = window.location.origin + manifestPath;
                        installWeb.href = \`https://web.stremio.com/#/addons?addon=\${encodeURIComponent(installUrlInput.value)}\`;
                        resultsDiv.style.display = 'block';
                    } catch (error) {
                        errorDiv.textContent = error.message;
                        errorDiv.style.display = 'block';
                    } finally {
                        submitBtn.disabled = false;
                        submitBtn.textContent = originalText;
                    }
                }
                document.getElementById('config-form').addEventListener('submit', populateInstall);
                document.getElementById('copy-btn').addEventListener('click', async function() {
                    await navigator.clipboard.writeText(installUrlInput.value);
                    this.textContent = 'Copied!';
                    setTimeout(() => { this.textContent = 'Copy URL'; }, 2000);
                });
            </script>
        </body>
        </html>
    `);
	}

	app.get("/", configurationPage);
	app.get("/:config/configure", configurationPage);
}

module.exports = { registerConfigureRoutes };
