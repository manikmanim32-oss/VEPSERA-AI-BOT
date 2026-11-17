# VESPERA AI BOT — Website package

Your supplied VESPERA artwork is included as `public/vespera-avatar.png` and is used as the logo/profile avatar. The name is consistently shown as **VESPERA** / **VESPERA AI BOT**.

## Included in this package
- Responsive dark futuristic VESPERA website and light theme
- Supabase email/password sign-up, sign-in, session and sign-out
- Authenticated chat; chat history saved per account
- Claude, OpenAI and Gemini provider selection (each needs its own API key)
- General, coding, research, writing and tutor agents
- Optional Tavily web search
- Image generation and text-to-video / image-to-video request + result polling using FAL queue API
- Private per-user TXT/Markdown knowledge documents with keyword retrieval in chat
- Tamil UI toggle, profile view, chat export
- No app-imposed daily message/image/video counter and no forced upgrade/subscription wall

## Important reality about "unlimited"
VESPERA does not add artificial daily counters or an upgrade wall. But AI APIs, GPU/media providers, hosting, bandwidth and database services have their own quotas, fair-use rules and costs. This code cannot override a provider's limits. To move closer to genuinely high-volume use, operate open models and media models on your own GPU infrastructure and budget for capacity.

## Setup (local)
1. Install Node.js 20+.
2. Create a Supabase project and enable Email sign-in under Authentication.
3. Edit `public/config.js` and set:
   - `VESPERA_SUPABASE_URL`
   - `VESPERA_SUPABASE_ANON_KEY`
   These are public browser configuration values; never put provider secrets here.
4. Run `supabase-schema.sql` in Supabase SQL Editor. It creates user-owned conversation and knowledge tables, RLS policies, and a public `vespera-media` bucket with authenticated upload policy.
5. Copy `.env.example` to `.env`. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
6. Add at least one server-side model key: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY`.
7. Optional: add `TAVILY_API_KEY` for search and `FAL_KEY` for image/video generation. Check provider account access, model availability and billing.
8. In terminal, run `npm install` then `npm start`.
9. Open `http://localhost:3000`.

## Deploy
Use a Node.js host such as Render or Railway:
- Build command: `npm install`
- Start command: `npm start`
- Add all `.env` values in the host's server-side environment settings.
- Keep `public/config.js` populated with the Supabase URL and anon key.
- Set Supabase Auth Site URL and allowed redirect URLs to your deployed HTTPS domain.
- Never commit `.env` or place AI provider keys in browser code.

## Media
- Image model: `FAL_IMAGE_MODEL` (default `fal-ai/flux/dev`)
- Text-to-video model: `FAL_TEXT_VIDEO_MODEL` (default `fal-ai/wan-t2v`)
- Image-to-video model: `FAL_IMAGE_VIDEO_MODEL` (default `fal-ai/wan-i2v`)
- The browser uploads reference images to the `vespera-media` Supabase Storage bucket, then sends the public image URL to the configured image-to-video model.
- Model input schemas and output shapes can vary by provider/model. If a selected model changes its API schema, update the corresponding request fields in `server.js`.

## Knowledge base
The starter accepts `.txt` and `.md` files. It stores documents per user under Supabase RLS and retrieves matching text excerpts with keyword scoring. This is a lightweight retrieval starter, not vector-embedding RAG yet. For semantic RAG, add embeddings and a vector index (e.g. pgvector) and query it server-side.

## Security
- AI provider secrets are server-side only.
- Supabase anon key is intended for browser use; RLS protects user-owned records.
- Do not expose service-role keys in the browser.
- Enable email confirmation and secure password policies for public deployment.
- Add rate limiting, abuse monitoring, backups and billing controls before opening a public service. Avoid calling this provider-unlimited.
