FROM node:24-slim

# Install Python and yt-dlp
# We switch to root to perform these operations and then switch back to the node user.
USER root
RUN apt-get update && \
    apt-get install -y python3 python3-pip && \
    pip3 install "yt-dlp[default,curl-cffi]" --break-system-packages && \
    rm -rf /var/lib/apt/lists/*
USER node

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to the working directory
# This leverages Docker's layer caching. These files don't change often,
# so this step will be cached, speeding up future builds.
COPY package*.json ./

# Install the lockfile-resolved production dependencies
RUN npm ci --omit=dev

# Bundle app source
# Copy the rest of your app's source code from your host to your image filesystem.
COPY . .

# Your app binds to port 7000, so you need to expose it
# The README.md's app_port should match this.
EXPOSE 7000

# Define the command to run your app
# need to use node to have the executable receive signals properly, otherwise it will not terminate on SIGTERM and SIGINT
CMD [ "node", "--env-file-if-exists=.env", "addon.js" ]
