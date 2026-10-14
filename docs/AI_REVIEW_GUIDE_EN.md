# Review GitLab merge requests with AI

A guide for reviewers, MR authors and teammates joining an existing review. The workflow is **review → publish findings → fix code → reply → recheck**. Several people can review the same MR, each using their own AI tool.

The extension prepares context for your AI and imports selected results into GitLab. It does not run an AI model or send data to an AI provider. You paste the task into your chosen tool, then paste its response back. Comments are sent under your current GitLab account and permissions.

## Choose your task

Open **AI review…** and choose a tab. Every tab has the same main action: **Copy task**.

| Tab | Use it to | Choose |
|---|---|---|
| **New review** | Run a first or independent review of the whole MR | Description, code inclusion and optional file filters |
| **Fix review findings** | Implement fixes in code | Findings for your coding AI; unresolved discussions are selected initially |
| **Prepare replies** | Explain fixes after pushing them | Published discussions you want to answer |
| **Follow-up review** | Verify fixes and find new defects | Discussions and the previously reviewed revision; without one, check the full current MR |

The hint explains the task and the summary shows what will be included. **Advanced settings** contains instructions for the current task, plus file filters for New review and Follow-up review. **Preview** prepares the text without copying. **Paste AI response** opens result validation and editing before publication.

The tab determines the task. Clearing all checkboxes **does not switch to a new review**: Fix review findings and Prepare replies become unavailable, while Follow-up review reviews code only. Switching tabs preserves selected discussions and independent prompt edits, but clears the prepared text.

For replies and rechecks, selecting any comment includes its entire thread. The summary counts discussions; Fix review findings counts selected comments. Clear every checkbox in a thread to exclude it.

Use **Select all discussions** to include resolved and general threads too. The separate checkboxes in Import decide what you publish.

Review dialogs close without confirmation by default. Enable **Confirm closing review dialogs with unsaved work** in the extension’s **AI review** settings if you want a prompt before discarding changed inputs, selections or unfinished imports. Cancel keeps your work in the open dialog. A fully completed import closes without prompting even with this setting enabled. Closing during publication stops further sending but does not undo comments already sent.

## Before starting

Open an MR and hover over the extension icons to find **AI review…** and **Import AI review…**. If they are missing, check that AI review is enabled in the extension settings. Reload the GitLab page after updating the extension.

- **Local repository first:** compact export is the default. Open the task in an AI tool with the project available locally. Prompts instruct it to inspect local Git first and fetch missing commits through a verified configured remote using existing authentication. Review tasks use the specified revisions without changing your branch, with a separate worktree when needed. Fix tasks preserve the MR branch's later commits and uncommitted fixes. These instructions also apply to saved custom prompts; no reset is needed. Enable **Include code changes** for fresh/repeat review when local source is unavailable. A diff may still omit dependencies or tests; the AI should request the specific missing material, not GitLab access by default.
- **Description:** **Include description** adds the author's requirements and background. This preference is remembered. **Include code changes** starts unchecked whenever you open a new copy window.
- **File scope:** use **Advanced settings → Files to review** for a temporary scope, such as `src/**`. Empty lists include everything. Extension and path inclusion are alternatives, while exclusions win, including on either side of a rename. A scoped review is not a review of all files.
- **Language and criteria:** **AI review** settings have separate prompts for fixing feedback, fresh review, new findings, replies and repeat review. Choose **AI response language** for all tasks and import prompts: Automatic follows the AI conversation, or select Russian, English, German, Spanish, French, Japanese or Simplified Chinese. This is independent of the interface language and overrides conflicting language instructions in saved prompts. JSON keys, paths and code remain unchanged. Copy response format stays language-neutral. Set review criteria and style in the task prompts. The extension adds MR details and the required JSON format automatically.

## Configure automatic instructions

Open **AI review → Automatic instructions (advanced)** in extension settings. All 31 blocks start enabled and apply only to relevant tasks. Expand a block to edit its text, disable it while keeping the text, or clear the text to omit it. Reset restores its English default and enables that block. Each text supports up to 1,500 characters. `{language}` inserts the selected response language; `{selection}` inserts whether replies cover selected or unresolved discussions.

The main task prompts remain independently editable and can contain similar instructions. The full task preview shows the resulting combination. MR identifiers, JSON examples and loading notices are generated from the current context; editing instructions does not disable file filters, targeting checks or publication validation. The format-only shortcut always copies the supported import format without task instructions.

## Review an MR from scratch

1. Open **AI review…** and choose the **New review** tab.
2. Set file filters and the description/code options. Optionally edit the prompt for this copy.
3. Click **Preview**, then **Copy task**, or copy directly.
4. Paste the task into your AI with access to the pinned source. Ask it to inspect the combined result of every MR commit and the necessary surrounding code and tests. This task produces findings, without modifying code.
5. Import and review the returned JSON using the next section.

Discussion selection does not affect New review: it always checks the whole MR within the configured file scope.

Import retains a **Copy review prompt** shortcut under **Advanced settings** for a repository-based task without description or diff. Use the New review tab for those options.

If the AI already has the task and code context, use **Copy response format** next to the prompt shortcuts in Import. It copies only the JSON structure and field rules for inline comments, general comments and replies, without saved prompts or loading MR data. The AI must fill the example placeholders from verified context, including the revision actually reviewed for new findings and existing discussion IDs for replies. Replies-only JSON may omit `head_sha`.

## Preview and publish results

These steps apply to new findings, replies and repeat reviews.

1. Click **Paste AI response** or open **Import AI review…**, paste the complete JSON response and click **Check and preview**.
2. Review each card. The extension checks MR identity, revision and diff locations for new findings, and discussion targets for replies. It does not prove the AI's reasoning correct.
3. Uncheck unwanted findings and semantic duplicates. Check the original discussion shown beside each reply.
4. Use the pencil button to change or extend the text, then **Save changes**. Its file location or discussion stays attached. **Add comment** creates your own general MR comment.
5. Choose **Publish selected** to send immediately, or **Add to review** to create your unpublished GitLab drafts. Submit those drafts using GitLab's own review controls when ready for teammates to see them.
6. Check the outcome on every card. Some comments may succeed while others need corrections or another check.

Previewing and saving edits do not publish anything. For an open, resolvable thread, you can enable **Resolve discussion after publishing** on its reply; it is off by default. The extension publishes the reply first, checks the discussion again, then requests resolution using your GitLab permissions. The card shows the resolution result separately. If resolution fails or cannot be confirmed, the reply remains published: check the thread in GitLab without posting the reply again. Adding a draft never resolves a discussion, and this choice is not deferred until the draft is published. Approval, reopening and merging remain separate GitLab actions. An empty findings list does not approve the MR.

## Fix selected feedback

1. Open **AI review… → Fix review findings** and click **Refresh** if discussions have changed.
2. Click the **Unresolved** quick action to select all unresolved discussions. Uncheck work assigned to another person. Enable **General comments** separately when needed.
3. Click **Copy task** and paste the task into your coding AI working on the MR branch. This uses the fix-feedback prompt; other replies in the selected threads provide context.
4. Review the changes and run appropriate checks. Explain disputed, obsolete or unclear findings instead of changing code merely to satisfy a comment.
5. Commit and push the fixes using your usual workflow. The review copy/import feature does not commit or push code.
6. With **Prepare replies too** enabled, the fixing task also returns JSON replies for selected published MR discussions: completed fixes, remaining work and reasons for not changing something. After pushing all your commits, use **Paste AI response**, review/edit/select the replies and publish. No second AI pass or SHA update is needed. Replies-only JSON may omit `head_sha`; older SHAs do not block replies. New findings still require the reviewed revision.

**Prepare replies** remains useful when you fixed the code yourself or need to regenerate explanations. Replies to unpublished drafts without a published discussion target cannot be imported.

The **Prepare replies too** checkbox is on by default in **Fix review findings**. Turn it off to request fixes and a normal summary without importable replies. It applies to this open window and keeps its value when switching tabs.


For one finding, use its copy icon. If a thread has replies, choose **Select this discussion** inside the picker, then **Copy task**. Short code excerpts attached to feedback remain included regardless of the optional full-diff checkbox.

Changing the status filter replaces the previous selection. Check the selected items before copying. Use **Select all discussions** only when you want the entire set of discussions.

## Reply after fixes

1. Confirm that your changes have been pushed to the MR and refresh the page.
2. In **AI review… → Prepare replies**, select the discussions and click **Copy task**. Use **Unresolved** first if you want all open findings.
3. Give the prompt to an AI with access to the published revision. It should explain what changed, where, which checks actually ran and any remaining work.
4. Import the JSON, review the original threads and proposed answers, edit as needed and send only the replies you want to post under your name.

Copy prepares replies only for selected published discussions. Resolved or general threads can also be selected if GitLab supports replying to them. File filters do not remove selected reply threads. With none selected, the button is disabled. Unpublished drafts are not reply targets.

Import has no discussion picker. Under **Advanced settings**, its **Reply prompt for all unresolved discussions** includes all open threads, excluding general and resolved ones. Use Copy for a subset; the import preview still lets you decide what to publish.

Do not describe unpushed local edits as already available to the reviewer. A useful reply states the actual fix and evidence; if partially fixed, unclear or no longer applicable, say so. Never claim tests passed unless they actually ran and passed.

## Follow-up review: fixes and new commits

Replies from follow-up review should be short: normally 1–3 sentences with the verification result and one relevant fact or remaining problem. They should not retell the original finding, repeat the author’s reply, list unrelated tests or append a whole-MR summary to each thread. New defects are separate findings.

1. Open **AI review… → Follow-up review** and select the discussions to verify. Use **All**, clear search and **Select shown** to include resolved and general discussions as well.
2. Under the previously reviewed version selector, choose the MR state you actually checked before leaving feedback. You can enter its complete commit SHA manually. If unknown, keep **Full review — no previous version**.
3. Set file scope and optional code inclusion. Click **Copy task** and paste the copied task into your AI.
4. The AI verifies selected findings against the current code and checks for new defects within the file scope. Its JSON can mix replies and new findings.
5. Import, edit, remove unnecessary replies or duplicate findings, and publish selected items.

**Ten commits since your comments?** Choose the revision you reviewed before those fixes. All changes from that state to the current head belong to the task; you do not select commits one by one.

After rebase or force push, use the same previously reviewed SHA. A direct comparison checks code snapshots even when the old commit is no longer an ancestor. If that commit is unavailable, perform a full current-MR review and state that the exact incremental comparison could not be verified.

With code inclusion enabled, the selected delta is attached without duplicating the full MR diff. Unavailable comparisons fall back to the current diff with a warning. No prior revision or the same head also uses the current full diff: target-branch changes may affect the MR.

Selecting discussions does not restrict code review to the files those threads mention; file filters control code scope separately. A resolved status or a “fixed” reply is not proof. Findings outside the selected file scope must remain unverified.

**Follow-up review with no discussions selected** checks code only, without verifying old findings or replying. **New review** checks the entire current MR within the file scope, independently of a previous review.

## Several reviewers or people making fixes

Each participant has their own AI, settings and comparison revision. Shared context lives in GitLab's published code and discussions. The extension does not store review history or assign findings to people.

| Situation | How to work |
|---|---|
| Two independent reviews | Each uses fresh review. Both check existing discussions and remove duplicates before publication |
| Continue someone else's review | Select relevant threads or all threads, then repeat review with no previous revision for a full current check |
| Split review by area | Agree on file ownership and filters, and decide who checks interactions between those areas |
| Split fixes | Each person copies only their selected feedback and coordinates work on the shared branch |
| Reply only about your own fixes | Select your threads in the Prepare replies tab and click Copy task |
| One reviewer checked A, another B | Each selects their own reviewed version, not automatically the newest listed one |
| A colleague replies while the AI is working | Read the updated thread; if it changed after preview, get fresh context and check the response again |

Exact duplicate checks cannot guarantee detection of differently worded findings or simultaneous posts from different people. Review semantic duplicates yourself. Other people's unpublished drafts are not shared review context.

Keep the reviewed SHA in your final review comment or original AI task if you want to find it later. The extension does not create a review-history record.

## Changed or missing data

| Situation | Next step |
|---|---|
| Deleted a published reply or finding and want to send identical text again | Click Check and preview again. Import verifies the saved comment ID in GitLab and removes the duplicate block only after confirming it is absent. No extra spaces or changes to the text are needed |
| Deleted an imported draft and want to add it again | Click Check and preview again. Once GitLab confirms the draft is absent, it can be selected again. Unavailable draft lists and uncertain sends remain protected against duplicates |
| New commits arrived while the AI worked | Prepared replies can be imported after pushing your fixes; verify their text. New findings need a fresh review. Do not replace the old JSON's SHA merely to bypass validation |
| Wrong inline location | Give the AI the validation message and current diff; regenerate the location. The preview editor edits text, not anchors |
| Delivery unconfirmed | Check GitLab first. A comment may already exist; do not retry blindly |
| Selected discussion disappeared | Refresh and reselect. Reply preparation stops; repeat review marks the missing thread as unverified |
| Partial context | Read the warning, refresh or obtain the missing material before claiming complete verification |
| AI cannot access the repository | Include code changes and supply any additional files it needs. A private MR link alone does not grant access |
| Old GitLab has no version list | Enter the complete SHA manually or choose a full review |
| Draft API unavailable | No automatic public-post fallback occurs. Choose direct publication separately if appropriate |
| Comment was created through Add to review | It is a draft. Copy it individually if needed; teammates see it only after submission |
| Clipboard unavailable | Select and copy the prepared preview manually |

For issues, feedback and description copying are available. Fresh code review, version comparison and review import in this guide apply to merge requests.
