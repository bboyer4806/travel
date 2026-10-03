# A placeholder page until the travel project replaces it. The image EXPOSEs
# 80, which is how Dokku knows where to send travel.dev.boyersoftware.com.
FROM nginx:1.30-alpine-slim
COPY index.html /usr/share/nginx/html/index.html
