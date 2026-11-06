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
import type {
  JiraNamed,
  JiraUser,
  RawJiraComment,
  RawJiraIssue,
} from "./types";

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
    fields: objectOf<RawJiraIssue["fields"]>({
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
          objectOf<NonNullable<RawJiraIssue["fields"]["attachment"]>[number]>({
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

export const readRawJiraComment = decoder(
  objectOf<RawJiraComment>({
    id: isString,
    author: optional(user),
    body: optional(isString),
    created: optional(isString),
  }),
  "Jira comment response",
);
