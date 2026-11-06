import {
  arrayOf,
  decoder,
  isNumber,
  isString,
  nullable,
  objectOf,
  optional,
  recordOf,
} from "../../../shared/lib/validation";
import type { JiraNamed, JiraUser, RawJiraIssue } from "./types";

const user = objectOf<JiraUser>({
  accountId: optional(isString),
  key: optional(isString),
  name: optional(isString),
  displayName: isString,
  avatarUrls: optional(recordOf(isString)),
});
const named = objectOf<JiraNamed>({
  name: isString,
  iconUrl: optional(isString),
  statusCategory: optional(objectOf({ key: isString })),
});
export const readJiraUser = decoder(user, "Jira user response");
export const readRawJiraIssue = decoder(
  objectOf<RawJiraIssue>({
    key: optional(isString),
    fields: objectOf({
      summary: optional(isString),
      status: optional(named),
      description: optional(nullable(isString)),
      assignee: optional(nullable(user)),
      reporter: optional(nullable(user)),
      priority: optional(nullable(named)),
      issuetype: optional(named),
      created: optional(isString),
      updated: optional(isString),
      labels: optional(arrayOf(isString)),
      attachment: optional(
        arrayOf(
          objectOf({
            filename: isString,
            content: isString,
            size: optional(isNumber),
            mimeType: optional(isString),
          }),
        ),
      ),
      components: optional(arrayOf(named)),
      versions: optional(arrayOf(named)),
      fixVersions: optional(arrayOf(named)),
      resolution: optional(nullable(named)),
    }),
  }),
  "Jira issue response",
);
