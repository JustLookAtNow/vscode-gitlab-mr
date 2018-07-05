const vscode = require('vscode');
const open = require('opn');
const url = require('url');
const gitApi = require('simple-git');
const Q = require('q');

const gitActions = require('./git');
const gitlabActions = require('./gitlab');
const gitUtils = require('./git-utils');

const message = msg => `Gitlab MR: ${msg}`;
const ERROR_STATUS = message('Unable to create MR.');
const STATUS_TIMEOUT = 10000;
const WIP_STRING = 'WIP:';
const CONFIG_NAMESPACE = 'gitlab-mr';

const showErrorMessage = msg => {
    vscode.window.showErrorMessage(message(msg));
    vscode.window.setStatusBarMessage(ERROR_STATUS, STATUS_TIMEOUT);
};

const showAccessTokenErrorMessage = gitlabApiUrl => {
    const tokenUrl = `${gitlabApiUrl}/profile/personal_access_tokens`;
    const errorMsg = gitlabApiUrl === 'https://gitlab.com' ?
        'gitlab-mr.accessToken preference not set.' :
        `gitlab-mr.accessTokens["${gitlabApiUrl}"] preference not set.`;

    const generateTokenLabel = 'Generate Access Token';

    return vscode.window.showErrorMessage(message(errorMsg), generateTokenLabel).then(selected => {
        switch (selected) {
            case generateTokenLabel:
                open(tokenUrl);
                break;
        }
    });
};

const selectWorkspaceFolder = () => (
    Q.fcall(() => {
        if (vscode.workspace.workspaceFolders.length > 1) {
            return vscode.window.showQuickPick(vscode.workspace.workspaceFolders.map(folder => ({
                label: folder.name,
                folder
            })), {
                placeHolder: 'Select workspace folder'
            })
                .then(selected => {
                    if (selected) {
                        return selected.folder;
                    }
                });
        } else {
            return vscode.workspace.workspaceFolders[0];
        }
    })
);

const buildGitlabContext = workspaceFolderPath => (
    Q.fcall(() => {
        const preferences = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        const targetRemote = preferences.get('targetRemote', 'origin');

        // Access tokens
        const gitlabComAccessToken = preferences.get('accessToken');
        const gitlabCeAccessTokens = preferences.get('accessTokens') || {};

        // Set git context
        const git = buildGitContext(workspaceFolderPath);

        return git.parseRemotes(targetRemote)
            .then(({ repoId, repoHost }) => {
                const gitlabHosts = gitUtils.parseGitlabHosts(gitlabCeAccessTokens);
                const repoWebProtocol = gitUtils.parseRepoProtocol(repoHost, gitlabHosts);

                const gitlabApiUrl = url.format({
                    host: repoHost,
                    protocol: repoWebProtocol
                });
                const isGitlabCom = repoHost === 'gitlab.com';
                const accessToken = isGitlabCom ? gitlabComAccessToken : gitlabCeAccessTokens[gitlabApiUrl];

                // Token not set for repo host
                if (!accessToken) {
                    return showAccessTokenErrorMessage(gitlabApiUrl);
                }

                // Build Gitlab context
                return gitlabActions({
                    url: gitlabApiUrl,
                    token: accessToken,
                    repoId,
                    repoHost,
                    repoWebProtocol
                });
            });
    })
);

const buildGitContext = workspaceFolderPath => gitActions(gitApi(workspaceFolderPath));

const openMR = () => {
    const preferences = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);

    // Target branch and remote
    const targetRemote = preferences.get('targetRemote', 'origin');

    // Auto-open MR
    const autoOpenMr = preferences.get('autoOpenMr', false);

    // Open to edit screen
    const openToEdit = preferences.get('openToEdit', false);

    // Remove source branch
    const removeSourceBranch = preferences.get('removeSourceBranch', false);

    selectWorkspaceFolder()
        .then(workSpaceFolder => {
            if (!workSpaceFolder) {
                return;
            }

            const workspaceFolderPath = workSpaceFolder.uri.fsPath;

            // Set git context
            const git = buildGitContext(workspaceFolderPath);

            // Check repo status
            return buildGitlabContext(workspaceFolderPath)
                .then(gitlab => {
                    return Q.fcall(() => {
                        const useDefaultBranch = preferences.get('useDefaultBranch', false);

                        if (useDefaultBranch) {
                            return gitlab.getRepo()
                                .then(repo => {
                                    return repo.default_branch;
                                });
                        }

                        return preferences.get('targetBranch', 'master');
                    })
                        .then(targetBranch => {
                            return git.checkStatus(targetBranch)
                                .then(status => {
                                    const currentBranch = status.currentBranch;
                                    const onMaster = status.onMaster;
                                    const cleanBranch = status.cleanBranch;

                                    return git.lastCommitMessage()
                                        .then(lastCommitMessage => {
                                            // Prompt user for branch and commit message
                                            return vscode.window.showInputBox({
                                                prompt: 'Branch Name:',
                                                value: onMaster ? '' : currentBranch
                                            })
                                                .then(branch => {
                                                    // Validate branch name
                                                    if (!branch) {
                                                        return showErrorMessage('Branch name must be provided.');
                                                    }

                                                    if (branch.indexOf(' ') > -1) {
                                                        return showErrorMessage('Branch name must not contain spaces.');
                                                    }

                                                    if (branch === targetBranch) {
                                                        return showErrorMessage(`Branch name cannot be the default branch name (${targetBranch}).`);
                                                    }

                                                    return vscode.window.showInputBox({
                                                        prompt: 'Commit Message:',
                                                        value: cleanBranch ? lastCommitMessage : ''
                                                    })
                                                        .then(commitMessage => {
                                                            // Validate commit message
                                                            if (!commitMessage) {
                                                                return showErrorMessage('Commit message must be provided.');
                                                            }

                                                            const buildStatus = vscode.window.setStatusBarMessage(message(`Building MR to ${targetBranch} from ${branch}...`));

                                                            var gitPromises;
                                                            if (onMaster || (!onMaster && currentBranch !== branch)) {
                                                                if (cleanBranch) {
                                                                    // On master, clean: create and push branch
                                                                    gitPromises = git.createBranch(branch)
                                                                        .then(() => git.pushBranch(targetRemote, branch));
                                                                } else {
                                                                    // On master, not clean: create branch, commit, push branch
                                                                    gitPromises = git.createBranch(branch)
                                                                        .then(() => git.addFiles('./*'))
                                                                        .then(() => git.commitFiles(commitMessage))
                                                                        .then(() => git.pushBranch(targetRemote, branch));
                                                                }
                                                            } else {
                                                                if (cleanBranch) {
                                                                    // Not on master, clean: push branch
                                                                    gitPromises = git.pushBranch(targetRemote, branch);
                                                                } else {
                                                                    // Not on master, not clean: Commit, push branch
                                                                    gitPromises = git.addFiles('./*')
                                                                        .then(() => git.commitFiles(commitMessage))
                                                                        .then(() => git.pushBranch(targetRemote, branch));
                                                                }
                                                            }

                                                            gitPromises.catch(err => {
                                                                buildStatus.dispose();

                                                                showErrorMessage(err.message);
                                                            });

                                                            return gitPromises.then(() => {
                                                                return gitlab.openMr(branch, targetBranch, commitMessage, removeSourceBranch)
                                                                    .then(mr => {
                                                                        // Success message and prompt
                                                                        const successMessage = message(`MR !${mr.iid} created.`);
                                                                        const successButton = 'Open MR';

                                                                        buildStatus.dispose();
                                                                        vscode.window.setStatusBarMessage(successMessage, STATUS_TIMEOUT);

                                                                        const mrWebUrl = `${mr.web_url}${openToEdit ? '/edit': ''}`;

                                                                        if (autoOpenMr) {
                                                                            open(mrWebUrl);
                                                                            return vscode.window.showInformationMessage(successMessage);
                                                                        }

                                                                        return vscode.window.showInformationMessage(successMessage, successButton).then(selected => {
                                                                            switch (selected) {
                                                                                case successButton: {
                                                                                    open(mrWebUrl);
                                                                                    break;
                                                                                }
                                                                            }
                                                                        });
                                                                    })
                                                                    .catch(() => {
                                                                        buildStatus.dispose();

                                                                        // Build url to create MR from web ui
                                                                        const gitlabNewMrUrl = gitlab.buildMrUrl(branch, targetBranch);

                                                                        const createButton = 'Create on Gitlab';

                                                                        vscode.window.setStatusBarMessage(ERROR_STATUS, STATUS_TIMEOUT);
                                                                        vscode.window.showErrorMessage(ERROR_STATUS, createButton).then(selected => {
                                                                            switch (selected) {
                                                                                case createButton:
                                                                                    open(gitlabNewMrUrl);
                                                                                    break;
                                                                            }
                                                                        });
                                                                    });
                                                            });
                                                        });
                                                });
                                        });
                                });
                        })
                        .catch(err => {
                            showErrorMessage(err.message);
                        });
                });
        });
};

const listMRs = workspaceFolderPath => {
    const deferred = Q.defer();

    const preferences = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);

    // Target branch and remote
    const targetBranch = preferences.get('targetBranch', 'master');

    buildGitlabContext(workspaceFolderPath)
        .then(gitlab => {
            return gitlab.listMrs()
                .then(mrs => {
                    const mrList = mrs.map(mr => {
                        const label = `MR !${mr.iid}: ${mr.title}`;
                        const detail = mr.description;
                        let description = `${mr.source_branch}`;

                        if (mr.target_branch !== targetBranch) {
                            description += ` > ${mr.target_branch}`;
                        }

                        return {
                            mr,
                            label,
                            detail,
                            description
                        };
                    });

                    return vscode.window.showQuickPick(mrList, {
                        matchOnDescription: true,
                        placeHolder: 'Select MR'
                    })
                        .then(selected => {
                            if (selected) {
                                deferred.resolve(selected.mr);
                            }
                        });
                });
        })
        .catch(err => {
            deferred.reject(err);
        });

    return deferred.promise;
};

const viewMR = () => {
    selectWorkspaceFolder()
        .then(workSpaceFolder => {
            if (!workSpaceFolder) {
                return;
            }

            listMRs(workSpaceFolder.uri.fsPath)
                .then(mr => {
                    if (!mr) {
                        return showErrorMessage('MR not selected.');
                    }

                    open(mr.web_url);
                })
                .catch(err => {
                    showErrorMessage(err.message);
                });
        });
};

const checkoutMR = () => {
    const preferences = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    const targetRemote = preferences.get('targetRemote', 'master');

    selectWorkspaceFolder()
        .then(workSpaceFolder => {
            if (!workSpaceFolder) {
                return;
            }

            const workspaceFolderPath = workSpaceFolder.uri.fsPath;

            listMRs(workspaceFolderPath)
                .then(mr => {
                    if (!mr) {
                        return showErrorMessage('MR not selected.');
                    }

                    const git = buildGitContext(workspaceFolderPath);

                    const checkoutStatus = vscode.window.setStatusBarMessage(message(`Checking out MR !${mr.iid}...`));

                    return git.listBranches()
                        .then(branches => {
                            const branchName = mr.source_branch;
                            const targetBranch = branches.branches[branchName];

                            if (targetBranch) {
                                // Switch to existing branch
                                return git.checkoutBranch([branchName]);
                            }

                            // Fetch and switch to remote branch
                            return git.fetchRemote(targetRemote, branchName)
                                .then(() => {
                                    return git.checkoutBranch(['-b', branchName, `${targetRemote}/${branchName}`]);
                                });
                        })
                        .then(() => {
                            checkoutStatus.dispose();
                            vscode.window.setStatusBarMessage(message(`Switched to MR !${mr.iid}.`), STATUS_TIMEOUT);
                        })
                        .catch(err => {
                            checkoutStatus.dispose();
                            showErrorMessage(err.message);
                        });
                })
                .catch(err => {
                    showErrorMessage(err.message);
                });
        });
};

const searchUsers = gitlab => {
    return vscode.window.showInputBox({
        placeHolder: 'Search for user...'
    })
        .then(search => {
            if (search) {
                return gitlab.searchUsers(search);
            }
        })
        .then(users => {
            if (users) {
                const userOptions = users.map(user => ({
                    label: `${user.name} (${user.username})`,
                    user
                }));

                const otherOptions = [
                    { label: 'Search again...', searchAgain: true }
                ];

                return vscode.window.showQuickPick([
                    ...userOptions,
                    ...otherOptions
                ], {
                    placeHolder: 'Select a user...'
                })
                    .then(selection => {
                        if (selection.searchAgain) {
                            return searchUsers(gitlab);
                        }

                        return selection;
                    });
            }
        });
};

const editMR = () => {
    selectWorkspaceFolder()
        .then(workSpaceFolder => {
            if (!workSpaceFolder) {
                return;
            }

            const workspaceFolderPath = workSpaceFolder.uri.fsPath;

            return listMRs(workspaceFolderPath)
                .then(mr => {
                    if (!mr) {
                        return;
                    }

                    return buildGitlabContext(workspaceFolderPath)
                        .then(gitlab => {
                            const editCommands = {
                                editTitle: 'Edit title',
                                setWip: mr.work_in_progress ? 'Remove WIP' : 'Set as WIP',
                                editAssignee: mr.assignee ? `Edit assignee (${mr.assignee.username})`: 'Set assignee',
                                removeAssignee: `Remove assignee ${mr.assignee ? `(${mr.assignee.username})` : ''}`,
                                addApprovers: 'Add approvers'
                            };

                            return vscode.window.showQuickPick(Object.values(editCommands), {
                                placeHolder: 'Select an action...'
                            })
                                .then(selected => {
                                    switch (selected) {
                                        case editCommands.editTitle:
                                            return vscode.window.showInputBox({
                                                value: mr.title
                                            })
                                                .then(title => {
                                                    if (title) {
                                                        return gitlab.editMr(mr.iid, {
                                                            title
                                                        })
                                                            .then(() => {
                                                                return vscode.window.showInformationMessage(message(`MR !${mr.iid} title updated.`));
                                                            });
                                                    }
                                                });

                                        case editCommands.setWip:
                                            return gitlab.editMr(mr.iid, {
                                                title: mr.work_in_progress ? mr.title.split(WIP_STRING)[1].trim() : `${WIP_STRING} ${mr.title}`
                                            })
                                                .then(updatedMr => {
                                                    return vscode.window.showInformationMessage(message(`MR !${mr.iid} WIP ${updatedMr.work_in_progress ? 'added' : 'removed'}.`));
                                                });

                                        case editCommands.editAssignee:
                                            return searchUsers(gitlab)
                                                .then(selection => {
                                                    if (selection) {
                                                        return gitlab.editMr(mr.iid, {
                                                            assignee_id: selection.user.id
                                                        })
                                                            .then(() => {
                                                                return vscode.window.showInformationMessage(message(`MR !${mr.iid} assignee set to ${selection.user.username}`));
                                                            });
                                                    }
                                                });

                                        case editCommands.removeAssignee:
                                            return gitlab.editMr(mr.iid, {
                                                assignee_id: null
                                            })
                                                .then(() => {
                                                    return vscode.window.showInformationMessage(message(`MR !${mr.iid} assignee removed.`));
                                                });

                                        case editCommands.addApprovers:
                                            return gitlab.getApprovals(mr.iid)
                                                .then(approvals => {
                                                    return searchUsers(gitlab)
                                                        .then(selection => {
                                                            if (selection) {
                                                                return gitlab.editApprovers(mr.iid, {
                                                                    approver_ids: [
                                                                        ...approvals.approvers.map(app => app.user.id),
                                                                        selection.user.id
                                                                    ],
                                                                    approver_group_ids: [
                                                                        ...approvals.approver_groups.map(app => app.group.id)
                                                                    ]
                                                                })
                                                                    .then(() => {
                                                                        return vscode.window.showInformationMessage(message(`MR !${mr.iid} approver added.`));
                                                                    });
                                                            }
                                                        });
                                                });
                                        default:
                                            break;
                                    }
                                });
                        });
                });
        })
        .catch(err => {
            showErrorMessage(err.message);
        });
};

module.exports = {
    listMRs,
    viewMR,
    checkoutMR,
    openMR,
    editMR
};
