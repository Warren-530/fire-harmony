# Fire Harmony Ask (relay)

The relay behind the "Ask" panel of [Fire Harmony](https://warren-530.github.io/fire-harmony/): a Google Apps Script web
app (`apps_script.gs`, free, on Google's servers, where the Gemini API always answers). It keeps the Gemini API key (a
script property, `GEMINI_API_KEY`) and reads the models, the rules and the tool declarations from the site
(`app/public/assistant.json`). The tools run in the visitor's browser (`app/src/lib/assistant.ts`) on the app's own
published data, so every number in an answer comes from Fire Harmony, never from the model's memory.

Free Gemini quota: 20 requests a day per model, so the relay goes down a list of eight free models and skips the
used up ones until they reset (midnight Pacific time). `dev_relay.py` is the same relay for local tests.
