<img src="./icon.png" /><br> 

# 📺 YouTubio: Stremio YouTube Addon

A **Stremio addon** that lets you watch YouTube videos and access your **subscriptions**, **watch later list**, and **history** directly inside Stremio.

---

## ✨ Features
- **Watch YouTube Content in Stremio** – Browse and watch your favorite YouTube videos without leaving the Stremio app.
- **Personalized Feeds** – Access your Subscriptions, *Watch Later* list, and viewing history.
- **Powerful Search** – Search for YouTube videos and channels directly within Stremio.
- **Customizable Catalogs** – Use default catalogs or add your own custom playlists.
- **Ad- and Click-Bait-Free** - Use **SponsorBlock** (with configurable Gemini fallback support) and/or **DeArrow** across all of YouTube.
- **Secure Configuration** – User data (including cookies) is **encrypted** for security.
- **Easy Deployment** – Deploy with **Docker**, **Node.js**, or **ngrok**.

---

## ⏱️ Quick Setup with Cookies
For more detailed instructions or other platforms, go to the [YT-DLP cookie extraction guide](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies)
1. Install the Addon [Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc) in a Chromium browser (or [cookies.txt](https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/) for Firefox)<br>
<img width="1366" height="768" alt="Click the `Get` Button" src="https://github.com/user-attachments/assets/b60986e1-7484-412d-84af-f4d90973ab83" /><br>
<img width="506" height="282" alt="Click the `Add Extension` Button" src="https://github.com/user-attachments/assets/10c73fba-e850-4a41-a25a-46afd6a71fea" /><br>

2. Allow the extension in Private Windows<br>
<img width="1366" height="768" alt="Open the `Extensions` Menu in the Toolbar" src="https://github.com/user-attachments/assets/011ab527-945a-43c7-adc8-218c4b2ea6a3" /><br>
<img width="378" height="206" alt="Open the `Settings` Menu for the Addon" src="https://github.com/user-attachments/assets/8dfab594-dc40-456a-8ddb-d8c269f0e1a0" /><br>
<img width="252" height="269" alt="Click the `Manage Extension` Button" src="https://github.com/user-attachments/assets/08a88d96-2566-4355-8147-9e8080d25a4d" /><br>
Enable `Allow in InPrivate`<br>
<img width="1366" height="768" alt="Enable the Checkbox to `Enable in InPrivate`" src="https://github.com/user-attachments/assets/9a4f9317-f2c6-4245-9c7f-b802e1fbe9c4" /><br>

3. Open a Private Window<br>
<img width="1366" height="768" alt="Open the `Settings` Menu" src="https://github.com/user-attachments/assets/4c7aa6b9-a83b-47d2-82fc-c96d391a3614" /><br>
<img width="406" height="635" alt="Click to open a `New InPrivate window`" src="https://github.com/user-attachments/assets/4f6ed1d0-3daa-4c4c-bdf5-d3035b558c10" /><br>

4. Go to [youtube.com](https://www.youtube.com) and sign in<br>

5. Extract the `cookies.txt`<br>
<img width="1366" height="768" alt="Open the `Extensions` Menu in the Toolbar" src="https://github.com/user-attachments/assets/b8720843-77f5-4e2f-90c3-2ff8f2a600be" /><br>
<img width="378" height="206" alt="Select the Addon" src="https://github.com/user-attachments/assets/d70f0d12-e10d-46bd-b682-4d5e67d4aa72" /><br>
<img width="558" height="432" alt="Click the `Copy` Button" src="https://github.com/user-attachments/assets/82caac82-0acd-469a-8bae-36ca2207cd83" /><br>

6. Close the Window<br>
<img width="1366" height="774" alt="Close the Window" src="https://github.com/user-attachments/assets/6afc85a7-5ab9-42a6-98fd-84d694c2a3dd" /><br>

7. In your Stremio-logged-in browser, go to [youtubio.elfhosted.com](https://youtubio.elfhosted.com) and <b>Paste the Content</b> in the Textbox<br>
<img width="1366" height="768" alt="Paste the `cookies.txt` in the box" src="https://github.com/user-attachments/assets/0157804a-6732-4ae5-b85d-c4235c04ab95" /><br>

8. Generate and Install the manifest in the way of your choosing<br>
<img width="1366" height="768" alt="Scroll to the bottom and click `Generate Install Link` to Generate the Manifest" src="https://github.com/user-attachments/assets/fb0a738a-9447-4de5-af34-18a3bb5bada1" /><br>
<img width="1366" height="768" alt="Install in the way of your choosing" src="https://github.com/user-attachments/assets/e2857a18-06cc-481a-8564-bcc9de5c353f" /><br>

> [!IMPORTANT]
> The manifest URL is a credential-bearing URL when it contains encrypted cookies. Keep it private. After upgrading, generate a new manifest URL; old raw-JSON URLs may not work with playlist URLs.

---

## 🚀 Deployment

### 🐳 Docker Deployment

#### ✅ Prerequisites
- **Docker** installed  

#### ⚡ Steps
```bash
# Build the Docker image
docker build -t youtubio .
```

### 🟢 Node.js Deployment

#### ✅ Prerequisites
- **Node.js 24** installed
- **npm** package manager
- **[YT-DLP](https://github.com/yt-dlp/yt-dlp/releases/latest)** installed

#### ⚡ Steps
```bash
# Install dependencies
npm install --omit=dev

# Start the addon
npm start
```

By default, the addon will be available at: `http://localhost:7000`

## Environment Variables

Copy `.env.example` to `.env` and set the values needed by your deployment. `npm start` loads `.env` automatically. For Docker, supply the file at runtime: `docker run --env-file .env -p 7000:7000 youtubio`.

| Variable | Default | Effect |
| --- | --- | --- |
| `ENCRYPTION_KEY` | Random per process | Base64-encoded 32-byte key used to encrypt and decrypt user cookies and Gemini keys. Required for production so generated configuration URLs survive restarts. |
| `PORT` | `7000` | HTTP listening port. |
| `TTL` | `3600` | Cached yt-dlp metadata lifetime and Stremio catalog cache hint, in seconds. |
| `SPACE_HOST` | Unset | Public hostname, without `https://`, shown in the startup configuration URL. |
| `YTDLP_EXTRACTORS` | `all` | Value passed to yt-dlp's `--ies` option to restrict enabled extractors. |
| `DEV_LOGGING` | Unset | Enables Fastify debug logs, error logging, and main-branch icon assets. |
| `NO_DEARROW` | Unset | Disables DeArrow titles and thumbnails and hides its configuration option. |
| `NO_SPONSORBLOCK` | Unset | Disables SponsorBlock and Gemini fallback and hides their configuration options. |
| `EMBED` | Unset | Trusted HTML inserted into the configuration page. Do not set from untrusted input. |
| `YTDLP_EXTRACTORS_EMBED` | Unset | Trusted HTML inserted into the supported-extractors section. Do not set from untrusted input. |

For `DEV_LOGGING`, `NO_DEARROW`, and `NO_SPONSORBLOCK`, any non-empty value enables the option.

### ⚙️ ngrok Deployment

#### ✅ Prerequisites
- **Node.js 24** installed
- **npm** package manager
- **[YT-DLP](https://github.com/yt-dlp/yt-dlp/releases/latest)** installed
- ngrok account

#### ⚡ Steps
```bash
# Install dependencies
npm install

# Start the addon
npm run local
```

By default, the addon will be available at: `http://localhost:7000`

## Example YouTube Search Catalog

Playlist ID / URL: `https://www.youtube.com/results?search_query={term}{sort}`

Name: `Search`

Sort Order `(Sort Name: Sort ID)`:
> [!NOTE]
> By including the `&sp=` in the ID, we can ensure the catalog works without sorting parameters as well.
- Video Relevance: `&sp=CAASAhAB`
- Video Upload Date: `&sp=CAISAhAB`
- Video View Count: `&sp=CAMSAhAB`
- Video Rating: `&sp=CAESAhAB`
- Channel Relevance: `&sp=CAASAhAC`
- Channel Upload Date: `&sp=CAISAhAC`
- Channel View Count: `&sp=CAMSAhAC`
- Channel Rating: `&sp=CAESAhAC`
