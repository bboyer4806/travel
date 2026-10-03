# travel.dev.boyersoftware.com

A proof of concept, listed on [dev.boyersoftware.com](https://dev.boyersoftware.com).
For now it serves a placeholder page.

## Deploying

Every push to `main` runs `.github/workflows/deploy.yml`, which builds the image
on GitHub, pushes it to GHCR, and has Dokku on the server run it as the app
`travel`. The same run creates the app if it is missing, sets its domain, and
requests its first HTTPS certificate. The server renews it, as described in the
[dev repo's README](https://github.com/bboyer4806/dev#one-time-server-setup).

The repo needs two Actions secrets (Settings > Secrets and variables > Actions):

| Secret | Value |
| --- | --- |
| `DOKKU_SSH_KEY` | the private deploy key whose public half is added to Dokku |
| `DOKKU_HOST` | `15.204.120.53` |

## Replacing the placeholder

Swap `index.html` and the `Dockerfile` for the real project. Dokku serves the
domain from whatever port the image `EXPOSE`s. Port 80 works as is. For any
other port, run this once on the server after the first deploy:
`sudo dokku ports:set travel http:80:<port> https:443:<port>`.
