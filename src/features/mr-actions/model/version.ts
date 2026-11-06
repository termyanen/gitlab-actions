import { VERSION_DEFAULTS } from "../../../entities/settings";
import {
  bumpVersion,
  getNestedValue,
  parseToml,
  setNestedValue,
  updateTomlVersion,
} from "../../../shared/lib/version";
import type { MrServices, RepositoryFile } from "./types";
export function createVersionActions({
  context,
  api,
  getMR,
  getSettings,
}: MrServices) {
  function doVersionBump() {
    return getSettings().then(function (settings) {
      const filePath = settings.versionFile || "package.json";
      const versionPath = settings.versionPath || "version";
      const strategy = settings.versionStrategy || "patch";
      const commitTemplate =
        settings.versionCommitTemplate ||
        VERSION_DEFAULTS.versionCommitTemplate;

      return getMR().then(function (mr) {
        const branch = mr.source_branch;
        const fileUrl =
          "/projects/" +
          context.projectId +
          "/repository/files/" +
          encodeURIComponent(filePath);
        // Always edit the source file. The target supplies only the version
        // number, never dependencies or other contents to copy into the MR.
        const sourceFilePromise = api<RepositoryFile>(
          "GET",
          fileUrl + "?ref=" + encodeURIComponent(branch),
        );
        const versionFilePromise =
          settings.version_from_target && mr.target_branch !== branch
            ? api<RepositoryFile>(
                "GET",
                fileUrl + "?ref=" + encodeURIComponent(mr.target_branch),
              )
            : sourceFilePromise;
        return Promise.all([sourceFilePromise, versionFilePromise]).then(
          function (files) {
            const file = files[0];
            const rawContent = decodeURIComponent(escape(atob(file.content)));
            const versionContent = decodeURIComponent(
              escape(atob(files[1].content)),
            );
            let newVersion: string;
            let newRawContent: string;

            if (filePath.match(/\.json$/i)) {
              // JSON file (package.json, composer.json, etc.)
              const jsonObj = JSON.parse(rawContent);
              const currentVersion = getNestedValue(
                JSON.parse(versionContent),
                versionPath,
              );
              if (!currentVersion)
                throw new Error(
                  'Version field "' +
                    versionPath +
                    '" not found in ' +
                    filePath,
                );
              newVersion = bumpVersion(currentVersion as string, strategy);
              setNestedValue(jsonObj, versionPath, newVersion);
              newRawContent = JSON.stringify(jsonObj, null, 2) + "\n";
            } else if (filePath.match(/\.toml$/i)) {
              // TOML file (pyproject.toml, Cargo.toml, etc.)
              const tomlObj = parseToml(versionContent);
              const currentVersion = getNestedValue(tomlObj, versionPath);
              if (!currentVersion)
                throw new Error(
                  'Version field "' +
                    versionPath +
                    '" not found in ' +
                    filePath,
                );
              newVersion = bumpVersion(currentVersion as string, strategy);
              newRawContent = updateTomlVersion(
                rawContent,
                versionPath,
                newVersion,
              );
            } else {
              // Plain text file (version.txt, VERSION, etc.)
              const currentVersion = versionContent.trim();
              if (!currentVersion.match(/^\d+(\.\d+)*$/))
                throw new Error(
                  "Invalid version format in " +
                    filePath +
                    ': "' +
                    currentVersion +
                    '"',
                );
              newVersion = bumpVersion(currentVersion, strategy);
              newRawContent = newVersion + "\n";
            }

            const newContent = btoa(
              unescape(encodeURIComponent(newRawContent)),
            );
            const commitMessage = commitTemplate.replace(
              /\{version\}/g,
              newVersion,
            );

            return api(
              "PUT",
              "/projects/" +
                context.projectId +
                "/repository/files/" +
                encodeURIComponent(filePath),
              {
                branch: branch,
                content: newContent,
                encoding: "base64",
                commit_message: commitMessage,
                // Reject an outdated write if the source file changed meanwhile.
                last_commit_id: file.last_commit_id,
              },
            ).then(function () {
              return { version: newVersion, branch: branch };
            });
          },
        );
      });
    });
  }
  return { doVersionBump };
}
