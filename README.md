# Number Bot

Telegram webhook bot on Cloudflare Pages Functions with Cloudflare D1. It handles
`/start`, `/help`, and `/ping` in private chats. Telegram sends the reply directly
from the webhook response, so the function makes no outbound Bot API request.
Only `/start` uses D1, with a single idempotent write.

## Development

Run `npm test` with Node.js 24 or newer. The tests execute the D1 migration and
write query against in-memory SQLite.

To preview the Pages routing locally, create an ignored `.dev.vars` file with
`TELEGRAM_WEBHOOK_SECRET=local_test_secret`, then run
`npx wrangler pages dev public`. Use `/ping` for the preview smoke test.

## Deploy from GitHub

1. Create a Telegram bot through [@BotFather](https://t.me/BotFather) and keep its
   token in a secure location.
2. In Cloudflare, create a D1 database named `number-bot`. Open its Console and
   run the SQL in `migrations/0001_create_chats.sql`.
3. Create a **Pages** project using Git integration. Select this repository and
   set the production branch to `main`. Use framework preset **None**, leave the
   build command blank, and set the build output directory to `public`. Keep
   the root directory at the repository root so Pages can find `functions/`.
4. In the Pages project settings, add a production D1 binding named `DB` and
   select the database. Add an encrypted production secret named
   `TELEGRAM_WEBHOOK_SECRET`. Generate the value with `openssl rand -hex 32`.
   Redeploy production to apply the bindings.
5. Register the production webhook once. Run this in a trusted local terminal,
   entering the BotFather token and the same webhook secret when prompted.

   ```bash
   (
     read -rsp 'BotFather token: ' bot_token; printf '\n'
     read -rsp 'Webhook secret: ' webhook_secret; printf '\n'
     read -rp 'Pages production URL (https://your-project.pages.dev): ' pages_url
     curl --silent --show-error --fail-with-body \
       --data-urlencode "url=${pages_url%/}/api/telegram" \
       --data-urlencode "secret_token=$webhook_secret" \
       --data-urlencode 'allowed_updates=["message"]' \
       "https://api.telegram.org/bot${bot_token}/setWebhook"
   )
   ```

6. Verify Telegram reports `"ok":true`, then send `/ping` and `/start` to your bot.
   Future pushes to `main` trigger production deploys through Pages Git
   integration. Apply any future D1 migrations separately.

The deployed function only needs the webhook secret and D1 binding. The BotFather
token is used for webhook registration.
