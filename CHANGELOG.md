# CHANGELOG

## 1.1.1

* Fixed: Properly dispose of VS Code status bar messages.

## 1.1.0

* Added: New workflow to checkout an existing MR on your computer.
* Added: New workflow to open an existing MR in your browser.
* Updated: Changed the command palette label of "Open MR" to "Create MR" to reduce confusion with "View MR".
* Added: `gitlab-mr.autoOpenMr` to automatically open a new MR in your browser.

## 1.0.0

* Added: Support for opening MRs from any branch. If you are on a branch other than `master` (or your default), the branch input prompt will be autofilled with that branch name. Changing the name will create a new branch.
* Added: Support for opening MRs from a clean branch. If you are on a clean branch, the commit message input prompt will be autofilled with the last commit message. Changing the message will only impact the MR.
* Breaking: `gitlab-mr.gitlabUrl` has been removed, and `gitlab-mr.accessToken` is now for Gitlab.com access tokens.
* Added: `gitlab-mr.accessTokens` to specify access tokens for Gitlab CE/EE servers. Example:

```json
"gitlab-mr.accessToken": "ACCESS_TOKEN_FOR_GITLAB.COM",
"gitlab-mr.accessTokens": {
    "https://gitlab.domain.com": "ACCESS_TOKEN_FOR_GITLAB.DOMAIN.COM"
}
```

## 0.1.1

* Added: Initial error hanlding for creating the MR via the Gitlab API.

## 0.1.0

* Breaking: Changed preferences id from `gitlab` to `gitlab-mr`, and renamed existing preferences.
* Added: Preference to change default branch name from `master`.
* Added: Preference to change default remote repository.
* Added: Initial error handling for required preferences, user inputs, and git operations.
* Updated: README with detailed explanation of first workflow.
* Migrating to public Gitlab.

## 0.0.1

Initial release. Proof of concept, no error handling.
