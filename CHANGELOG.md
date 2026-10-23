# Changelog

## 0.21.0 (2026-10-23)

- Prepare a clean public source snapshot with an original favicon and system fonts.
- Guard live data and control routes against cross-origin access and DNS rebinding.
- Validate complete session identifiers before process lookup and match dedicated Codex resume commands.
- Add synthetic API safety tests and document the local privacy model.
- Include model catalogue details, card preferences and age grouping improvements.

## 0.7.0 (2026-10-20)

- Codex sessions no longer show a long list of Guardian review cards. Codex starts a new auto-review thread each time it checks a command, so all of a session's reviews now fold into one Guardian review card with their combined cost, tokens and a Threads count.
- A blob bounces once when the pointer enters its card, and once each time it is clicked, instead of looping while hovered. Clicking the blob no longer opens the card.
- Detail values stay on one line. An expanded card widens to fit the longest one, up to two cards wide; anything longer is cut and shows the full value on hover.
- Copy all is now an icon, the copy hint has more room below it, and "Est. cost" is now "Cost".

## 0.6.0 (2026-10-20)

- A Claude Code conversation that ran out of context and continued in a new session no longer shows twice. Its parts become one card, with the earliest start, the combined cost (each reply counted once) and the newest session id.
- An expanded card grows to fit its details, with no scrollbar.
- Details say "Click on a value to copy it." Clicking a value copies just that value, and a Copy all button at the end copies everything.
- "Model id" is now "Model" and "Own cost" is now "Est. cost".

## 0.5.0 (2026-10-20)

- Blobs stay still until you hover over their card, then wobble like jelly (the gumdrop hops and the amoeba changes shape). The floating is gone.
- The computer uptime timer is hidden by default. Turn it on in More settings; it shows just the time, at the bottom right, lined up with the cards.
- The subagent count sits in the middle of the card's footer, so the status stays on the right.
- Live no longer shows the "Agents on this environment" title.
- When there are no agents to show, "No identifiable agents found." appears in the middle of the page.

## 0.4.0 (2026-10-20)

- Blobs are bigger (28 px) and their float is clearly visible: wider drift, sway and squash, on shorter cycles.
- The menu keeps only the essentials (theme, Demo, GitHub, Quit). A "More settings" page holds the close setting, the blob options and animations.
- New settings: hide the blobs (cards then show the provider logo again) and turn off all animations.
- Live shows how long the computer has been on, next to the title.
- Rename a card by clicking its name or choosing Rename from its right-click menu. Enter saves, Escape cancels, and an empty name restores the original. Live names are saved in this browser.

## 0.3.2 (2026-10-20)

- Blobs float slowly instead of bobbing: three gentle motions with uneven lengths, timed a little differently for each blob, so the movement does not visibly repeat. Running agents float a bit wider.
- A blob's eyes follow the pointer while you hover over its card.

## 0.3.1 (2026-10-20)

- Vite updated to 6.4.4, which fixes the security issues GitHub reported in the dev server.

## 0.3.0 (2026-10-20)

- Each card has a small blob in its model's color (Opus orange, Sonnet violet, GPT green, minimax pink and so on). It moves while the agent runs and blinks otherwise. The menu offers three shapes: Jelly (the default), Gumdrop and Amoeba.
- Cost digits line up on one baseline. Each rolling digit moved by a fraction of a pixel, so some sat a little higher than others.
- The filter is now a funnel icon after the total. Its tooltip names the time window, and a blue dot shows when other filters are on.
- Hovering near a card's top right corner shows a faint X that closes it, the same as Close in the right-click menu.
- Text uses three sizes only: titles, primary text and secondary text.
- More space between the title row and the first cards.

## 0.2.0 (2026-10-20)

- Cards show the reasoning effort next to the model, such as "Opus 5.5 (Medium)", for Claude Code, Codex and OpenCode.
- The filters (apps, time window, active only) moved into a Filter menu next to the title.
- The cost disclaimer is now a tooltip on the total, shown on hover or click.
- The app name is centered in the top bar. The sparkle icon is gone, and the title reads "Agents on this environment".
- The menu has a GitHub link to this repository.
- New fonts: Google Sans, Google Sans Code and Google Sans Mono.
- The repository is now named AgentNodes.

## 0.1.1 (2026-10-20)

- All trees now share one column grid, so cards line up across trees and with the title, filters and total. Cards stretch to fill the width, and subagent stacks stay inside their column.

## 0.1.0 (2026-10-20)

First release.

- Live page: Claude Code, Codex and OpenCode sessions on this PC, drawn as trees of agents and subagents, refreshed every 2.5 seconds.
- Estimated costs at API list prices, per agent and per subtree.
- Filters by app and time window, including "since the PC was turned on", plus an "Active only" switch.
- Click a card to expand its details: tokens, cache, tools, folder and session id.
- Right-click a card to close it. A menu setting picks Hide (default) or Close, which also stops the real agent.
- Status sits at the bottom of each card, and cards are wider to use more of the screen.
- Menu with theme (System, Light, Dark), the Demo page and Quit, which stops the local server.
- Demo page: a scripted replica of the original video, with autopilot and 1×, 4× and 8× speeds.
- Favicon and the name "Agent Nodes".
