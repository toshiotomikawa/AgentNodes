# Local security model

Agent Nodes is a local desktop dashboard. Run it as your normal user on loopback, not as an administrator, on a shared server, through a public tunnel, or behind a network-facing proxy. It has no user accounts or remote access authentication.

Live collection reads agent session files and read-only databases. Titles, project paths, session identifiers, token counts and message excerpts are private runtime data. A secret pasted into a conversation can appear in an excerpt; this dashboard is not a secret redaction tool. Use the fictional Demo page for public recordings and screenshots.

The API checks the connection address, Host, browser origin, Fetch Metadata when present and a custom request header. CORS is disabled. Stop and quit require same-origin POSTs. These controls protect against other websites and DNS rebinding; they do not isolate the app from other programs running as the same OS user. Leave Close in its default hide-only mode unless you intend to stop a process.

Collection does not read credential stores or write agent databases. The optional OpenCode stop action uses the local service connection credential only for its loopback request. Unexpected API exceptions return generic messages. Local caches, logs, generated builds, environment files and dependencies are excluded from Git.

The server fetches public model metadata from Models.dev and keeps an offline cache. That request contains no session payload. The browser uses system fonts and does not request a remote font stylesheet.

If reporting a vulnerability, do not post credentials, real transcripts, screenshots of live sessions, or private filesystem paths in a public issue. Provide a synthetic reproduction and the affected version. For a sensitive report, first ask for a private reporting channel without including the sensitive material.
